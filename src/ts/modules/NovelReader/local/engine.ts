import {
  ListenBookGeneratePayload,
  ListenSegment,
  AudioReferenceConfig,
} from '../types/reader';
import {AppState, DeviceEventEmitter} from 'react-native';
import {
  createTextHash,
  normalizeChapterTextForRequest,
} from '../utils/listenBook';
import {EngineConfig, loadConfig, validateConfig} from './config';
import {createCastingEngine} from './casting';
import {
  nativeCall,
  readDocument,
  writeDocument,
  logModelProgress,
} from './native';
import {callLlm, generateSpeech} from './providers';
import {parsePrompt, prescanPrompt} from './prompts';
import {assertNarratorAvailable} from './preflight';
import {logPrescanResult} from './prescanLog';
import {
  listAudio,
  loadProject,
  updateProject,
  LocalProject,
  serialized,
  deleteProjectFiles,
} from './repository';

export interface TaskSnapshot {
  id: string;
  projectName: string;
  chapterIndex: number;
  phase: string;
  segments: ListenSegment[];
  error?: string;
  failedIndexes: number[];
}
interface Task extends TaskSnapshot {
  controller: AbortController;
  config: EngineConfig;
  payload: ListenBookGeneratePayload;
  version: number;
  paused?: boolean;
}
const tasks = new Map<string, Task>();
let globalCancelVersion = 0;
const cancelVersions = new Map<string, number>();
const cancelStamp = (project: string) =>
  `${globalCancelVersion}:${cancelVersions.get(project) || 0}`;
function assertStartAllowed(project: string, stamp: string): void {
  if (stamp !== cancelStamp(project)) {
    throw new Error('生成启动已取消。');
  }
}
/** 播放等待时查询真实任务，避免依赖页面中可能滞后的阶段。 */
export function getActiveChapterTask(
  projectName: string,
  chapterIndex: number,
): TaskSnapshot | undefined {
  return [...tasks.values()].find(
    task =>
      task.projectName === projectName &&
      task.chapterIndex === chapterIndex &&
      !task.controller.signal.aborted &&
      !['done', 'error', 'cancelled', 'paused'].includes(task.phase),
  );
}
const deletingProjects = new Set<string>();
const projectVersions = new Map<string, number>();

/** 取消该书任务，等待在途请求退出后清理，阻止旧结果重建已删除资料。 */
export async function deleteBookProject(
  projectName: string,
  cleanup: (chapterIndexes: number[]) => Promise<void>,
): Promise<void> {
  if (deletingProjects.has(projectName)) {
    throw new Error('正在删除该书籍。');
  }
  deletingProjects.add(projectName);
  projectVersions.set(projectName, (projectVersions.get(projectName) || 0) + 1);
  cancelGeneration(projectName, undefined, '从书架删除书籍');
  try {
    await enqueue(async () => {
      const uris = [...tasks.values()]
        .filter(task => task.projectName === projectName)
        .flatMap(task =>
          task.segments.flatMap(segment =>
            [segment.audioUrl, segment.localAudioUrl].filter(
              (uri): uri is string => Boolean(uri),
            ),
          ),
        );
      await deleteProjectFiles(projectName, uris, cleanup);
      for (const [id, task] of tasks) {
        if (task.projectName === projectName) {
          tasks.delete(id);
        }
      }
      await rememberPending();
    }, -1);
  } finally {
    deletingProjects.delete(projectName);
  }
}
const listeners = new Set<(snapshot: TaskSnapshot) => void>();
const idleListeners = new Set<() => void>();
let pending = 0;
let clearingAudio = false;
export const isGenerationBusy = () => pending > 0 || clearingAudio;
/** 清理期间阻止新生成，清除终态任务中的失效播放地址。章节解析和角色资料继续保留。 */
export async function clearGeneratedAudio(): Promise<void> {
  if (isGenerationBusy()) {
    throw new Error('请先停止生成任务，再清理音频。');
  }
  clearingAudio = true;
  try {
    await nativeCall('clearGenerated');
  } finally {
    // 删除失败也可能已经清理了部分文件，页面必须重新检查实际文件。
    tasks.clear();
    try {
      await rememberPending();
    } finally {
      clearingAudio = false;
      DeviceEventEmitter.emit('VoiceWeaverAudioCleared');
    }
  }
}

/** 文件被清理或被系统回收后，不再将旧地址发布给播放器。 */
async function validateSegmentFiles(
  segments: ListenSegment[],
): Promise<ListenSegment[]> {
  return Promise.all(
    segments.map(async segment =>
      segment.audioUrl &&
      !(await nativeCall<boolean>('exists', {uri: segment.audioUrl}))
        ? {
            ...segment,
            audioUrl: null,
            localAudioUrl: null,
            cacheState: 'idle' as const,
            generationError: null,
          }
        : segment,
    ),
  );
}
interface QueuedWork {
  priority: number;
  run: () => Promise<void>;
}
const workQueue: QueuedWork[] = [];
let draining = false;
function enqueue<T>(work: () => Promise<T>, priority = 0): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    workQueue.push({
      priority,
      run: async () => {
        try {
          resolve(await work());
        } catch (error) {
          reject(error);
        }
      },
    });
    if (draining) {
      return;
    }
    draining = true;
    void (async () => {
      while (workQueue.length) {
        workQueue.sort((a, b) => a.priority - b.priority);
        await workQueue.shift()!.run();
      }
      draining = false;
    })();
  });
}
export const waitForGenerationIdle = async (): Promise<void> => {
  if (pending === 0) {
    return;
  }
  await new Promise<void>(resolve => idleListeners.add(resolve));
};
DeviceEventEmitter.addListener('VoiceWeaverCancelGeneration', () =>
  cancelGeneration(undefined, undefined, '原生通知栏或后台服务取消'),
);
AppState.addEventListener('change', state => {
  if (state !== 'active') {
    for (const task of tasks.values()) {
      if (
        !task.config.generation.background &&
        !['done', 'error', 'cancelled'].includes(task.phase)
      ) {
        task.paused = true;
        console.info('[VoiceWeaverLocal] 暂停生成任务', {
          taskId: task.id,
          reason: '应用切后台且已关闭后台生成',
        });
        task.controller.abort();
      }
    }
  } else {
    void restorePendingGeneration().catch(() => undefined);
  }
});
async function rememberPending(): Promise<void> {
  await serialized(async () => {
    const latest = new Map<
      string,
      {
        projectName: string;
        chapterIndex: number;
        payload: ListenBookGeneratePayload;
      }
    >();
    for (const task of tasks.values()) {
      const key = taskKey(task.projectName, task.chapterIndex);
      if (['done', 'cancelled', 'error'].includes(task.phase)) {
        latest.delete(key);
      } else {
        latest.set(key, {
          projectName: task.projectName,
          chapterIndex: task.chapterIndex,
          payload: task.payload,
        });
      }
    }
    await writeDocument('pending.json', [...latest.values()]);
  });
}
export async function restorePendingGeneration(): Promise<void> {
  const cancellationVersions = new Map(cancelVersions);
  const globalVersion = globalCancelVersion;
  const versions = new Map(projectVersions);
  const saved = await readDocument<
    Array<{
      projectName: string;
      chapterIndex: number;
      payload: ListenBookGeneratePayload;
    }>
  >('pending.json', []);
  for (const item of saved) {
    if (
      globalVersion !== globalCancelVersion ||
      (cancellationVersions.get(item.projectName) || 0) !==
        (cancelVersions.get(item.projectName) || 0)
    ) {
      continue;
    }
    if (
      deletingProjects.has(item.projectName) ||
      (versions.get(item.projectName) || 0) !==
        (projectVersions.get(item.projectName) || 0)
    ) {
      continue;
    }
    await generateChapter(item.projectName, item.chapterIndex, item.payload);
  }
}
const configIdentity = (config: EngineConfig) =>
  createTextHash(
    JSON.stringify({
      llm: config.llm,
      prescan: config.prescan,
      provider: config.provider,
      tts: config[config.provider],
    }),
  );
const taskKey = (project: string, chapter: number) => `${project}:${chapter}`;
const publish = (task: Task) => {
  const snapshot: TaskSnapshot = {
    id: task.id,
    projectName: task.projectName,
    chapterIndex: task.chapterIndex,
    phase: task.phase,
    segments: task.segments.map(item => ({...item})),
    error: task.error,
    failedIndexes: task.segments.flatMap((item, index) =>
      item.generationError ? [index] : [],
    ),
  };
  listeners.forEach(listener => listener(snapshot));
};
export const subscribeTasks = (listener: (snapshot: TaskSnapshot) => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const getTask = (id: string): TaskSnapshot | undefined => {
  const task = tasks.get(id);
  return task
    ? ({
        ...task,
        config: undefined,
        controller: undefined,
        payload: undefined,
      } as TaskSnapshot)
    : undefined;
};
const active = (task: Task) => {
  if (task.controller.signal.aborted) {
    throw new Error('任务已取消');
  }
};
async function checkpoint(task: Task, contentHash: string): Promise<void> {
  active(task);
  await updateProject(task.projectName, project => {
    active(task);
    const previous = project.chapters[task.chapterIndex];
    if (previous?.taskId && previous.taskId !== task.id) {
      throw new Error('任务已被替换');
    }
    project.chapters[task.chapterIndex] = {
      sourceText: task.payload.chapterText || previous?.sourceText,
      contentHash,
      configHash: configIdentity(task.config),
      segments: task.segments,
      phase: task.phase,
      taskId: task.id,
      error: task.error,
    };
  });
  publish(task);
}
function mergeCharacters(project: LocalProject, value: any): void {
  for (const character of value.characters || []) {
    const name = String(character.standardName || '').trim();
    if (!name || name === '说明') {
      continue;
    }
    const previous = project.characters[name];
    project.characters[name] = {
      ...previous,
      name,
      gender: character.gender,
      description: character.description,
      aliases: [
        ...new Set([
          ...(previous?.aliases || []),
          ...(Array.isArray(character.aliases)
            ? character.aliases.filter(
                (alias: unknown) => typeof alias === 'string',
              )
            : []),
        ]),
      ] as string[],
    };
  }
  for (const name of Object.keys(value.detectedAliases || {})) {
    if (name === '说明' || !Array.isArray(value.detectedAliases[name])) {
      continue;
    }
    const previous = project.characters[name];
    project.characters[name] = {
      ...previous,
      name,
      aliases: [
        ...new Set([
          ...(previous?.aliases || []),
          ...value.detectedAliases[name].filter(
            (alias: unknown) => typeof alias === 'string',
          ),
        ]),
      ] as string[],
    };
  }
}
function normalizeCards(value: any, project: LocalProject): ListenSegment[] {
  const array = Array.isArray(value) ? value : value.dialogues;
  if (!Array.isArray(array) || array.length === 0) {
    throw new Error('解析结果缺少有效对白。');
  }
  const aliases = new Map<string, string>();
  for (const character of Object.values(project.characters)) {
    for (const alias of character.aliases) {
      aliases.set(alias, character.name);
    }
  }
  return array.map((item: any, index: number) => {
    if (
      typeof item.text !== 'string' ||
      !item.text.trim() ||
      !['dialogue', 'narration'].includes(item.type)
    ) {
      throw new Error(`第 ${index + 1} 段解析格式无效。`);
    }
    const narration = item.type === 'narration';
    const emotions = [
      'happy',
      'angry',
      'sad',
      'fearful',
      'disgusted',
      'melancholy',
      'surprised',
      'neutral',
    ];
    const role = narration ? '旁白' : aliases.get(item.role) || item.role;
    if (!role) {
      throw new Error(`第 ${index + 1} 段缺少角色名。`);
    }
    if (!narration && !project.characters[role]) {
      project.characters[role] = {
        name: role,
        aliases: [],
        gender: item.gender || 'unknown',
      };
    }
    return {
      ...item,
      index,
      role,
      emotion:
        narration || !emotions.includes(item.emotion)
          ? 'neutral'
          : item.emotion,
      audioUrl: null,
    };
  });
}
const castingEnvironment = (config: EngineConfig) => ({
  PRESCAN_CHAPTER_COUNT: config.generation.prescanCount,
  VOICE_ALLOCATION_CORE_MIN_CHAPTERS: config.advanced.coreMinChapters,
  VOICE_ALLOCATION_CORE_MIN_DIALOGUE_COUNT: config.advanced.coreMinDialogues,
  VOICE_ALLOCATION_TEMPORARY_MAX_CHAPTERS: config.advanced.temporaryMaxChapters,
  VOICE_ALLOCATION_TEMPORARY_MAX_DIALOGUE_COUNT:
    config.advanced.temporaryMaxDialogues,
});

/** 失败片段重试时刷新旁白引用；保留已完成音频及显式手动绑定。 */
async function refreshNarratorReferences(
  task: Task,
  indexes?: number[],
): Promise<void> {
  const records = await listAudio();
  const selectedIndexes = indexes ? new Set(indexes) : null;
  await updateProject(task.projectName, project => {
    active(task);
    const casting = createCastingEngine(
      {casting: project.casting, settings: project.settings},
      records,
      castingEnvironment(task.config),
    );
    const narratorId = casting.resolveNarratorAudioId(task.projectName);
    project.casting = casting.snapshot().casting;
    task.segments = task.segments.map((segment, index) => {
      if (
        (segment.type !== 'narration' && segment.role !== '旁白') ||
        (selectedIndexes
          ? !selectedIndexes.has(index)
          : Boolean(segment.audioUrl)) ||
        segment.manualAssigned
      ) {
        return segment;
      }
      const binding = project.bindings['旁白'];
      const manual =
        binding?.[segment.emotion || 'neutral'] || binding?.neutral;
      return {
        ...segment,
        referenceAudio: binding
          ? manual || null
          : narratorId
          ? {id: narratorId, mode: 1}
          : undefined,
        ...(binding ? {manualAssigned: true} : {}),
      };
    });
  });
}
async function run(task: Task): Promise<void> {
  const hash = createTextHash(
    normalizeChapterTextForRequest(task.payload.chapterText),
  );
  try {
    active(task);
    if (task.config.generation.background) {
      await nativeCall('background', {enabled: true}).catch(() => undefined);
    }
    let project = await loadProject(task.projectName);
    const cached = project.chapters[task.chapterIndex];
    if (
      cached?.contentHash === hash &&
      cached.configHash === configIdentity(task.config)
    ) {
      task.segments = await validateSegmentFiles(cached.segments);
    }
    await updateProject(task.projectName, current => {
      active(task);
      if (current.chapters[task.chapterIndex]) {
        current.chapters[task.chapterIndex].taskId = task.id;
      }
    });
    if (!task.segments.length) {
      const config = task.config;
      const prescan = (
        task.payload.prescanTexts?.length
          ? task.payload.prescanTexts
          : [
              {
                chapterIndex: task.chapterIndex,
                chapterTitle: '',
                text: task.payload.chapterText,
              },
            ]
      ).slice(0, config.generation.prescanCount);
      if (prescan.length) {
        task.phase = 'prescan';
        publish(task);
        const value = await callLlm(
          config.prescan.independent
            ? config.prescan
            : {...config.llm, model: config.prescan.model || config.llm.model},
          prescanPrompt(JSON.stringify(project.characters)),
          JSON.stringify(prescan),
          config.advanced.llmTimeout,
          task.controller.signal,
          `角色预扫描（${prescan.length}章）`,
        );
        active(task);
        logPrescanResult(
          value,
          prescan.map(item => item.chapterIndex),
        );
        const records = await listAudio();
        await updateProject(task.projectName, current => {
          active(task);
          mergeCharacters(current, value);
          const casting = createCastingEngine(
            {casting: current.casting, settings: current.settings},
            records,
            castingEnvironment(config),
          );
          casting.mergeProjectRoleActivity(
            task.projectName,
            value.roleActivity || [],
            prescan.map(item => item.chapterIndex),
            {complete: true},
          );
          current.casting = casting.snapshot().casting;
        });
      }
      active(task);
      task.phase = 'parsing';
      publish(task);
      project = await loadProject(task.projectName);
      const parsed = await callLlm(
        config.llm,
        parsePrompt(JSON.stringify(project.characters)),
        task.payload.chapterText,
        config.advanced.llmTimeout,
        task.controller.signal,
        '当前章节正文解析',
      );
      task.phase = 'assigning';
      publish(task);
      const records = await listAudio();
      await updateProject(task.projectName, current => {
        active(task);
        mergeCharacters(current, parsed);
        const cards = normalizeCards(parsed, current);
        const casting = createCastingEngine(
          {casting: current.casting, settings: current.settings},
          records,
          castingEnvironment(config),
        );
        const assigned = casting.autoAssignReferenceAudios({
          parsedCards: cards,
          projectName: task.projectName,
          provider: config.provider,
          chapterIndex: task.chapterIndex,
        });
        current.casting = casting.snapshot().casting;
        task.segments = assigned.cards.map(
          (card: ListenSegment, index: number) => {
            const bound = current.bindings[card.role || ''];
            const overrideId = current.overrides[card.role || ''];
            const manual = bound
              ? bound[card.emotion || 'neutral'] ||
                (current.settings.missingEmotionPolicy === 'fallback_neutral'
                  ? bound.neutral
                  : undefined)
              : card.manualAssigned
              ? card.referenceAudio
              : overrideId
              ? {id: overrideId, mode: 1}
              : undefined;
            return {
              ...card,
              index,
              missingEmotionPolicy: current.settings.missingEmotionPolicy,
              ...(manual || bound
                ? {referenceAudio: manual || null, manualAssigned: true}
                : {}),
            };
          },
        );
      });
      await checkpoint(task, hash);
    }
    task.phase = 'generating';
    await refreshNarratorReferences(task);
    await checkpoint(task, hash);
    for (let index = 0; index < task.segments.length; index++) {
      active(task);
      const segment = task.segments[index];
      if (
        segment.audioUrl &&
        (await nativeCall<boolean>('exists', {uri: segment.audioUrl}))
      ) {
        continue;
      }
      try {
        project = await loadProject(task.projectName);
        const startedAt = Date.now();
        logModelProgress(
          `章节 ${task.chapterIndex + 1} 片段 ${index + 1}/${
            task.segments.length
          } 合成开始`,
        );
        const uri = await generateSpeech(
          segment,
          task.config,
          project.bindings,
          task.controller.signal,
          task.projectName,
        );
        active(task);
        logModelProgress(
          `章节 ${task.chapterIndex + 1} 片段 ${index + 1}/${
            task.segments.length
          } 合成完成，耗时=${Date.now() - startedAt}ms`,
        );
        task.segments[index] = {
          ...segment,
          audioUrl: uri,
          localAudioUrl: uri,
          cacheState: 'ready',
          generationError: null,
        };
      } catch (error) {
        active(task);
        task.segments[index] = {
          ...segment,
          audioUrl: null,
          localAudioUrl: null,
          generationError: error instanceof Error ? error.message : '生成失败',
        };
      }
      await checkpoint(task, hash);
    }
    task.phase = 'done';
    logModelProgress(
      `章节 ${task.chapterIndex + 1} 生成结束，成功=${
        task.segments.filter(item => item.audioUrl).length
      }/${task.segments.length}`,
    );
    await checkpoint(task, hash);
  } catch (error) {
    task.phase = task.paused
      ? 'paused'
      : task.controller.signal.aborted
      ? 'cancelled'
      : 'error';
    task.error = error instanceof Error ? error.message : '生成失败';
    logModelProgress(
      `章节 ${task.chapterIndex + 1} 生成中断，状态=${task.phase}，已完成=${
        task.segments.filter(item => item.audioUrl).length
      }/${task.segments.length}`,
    );
    publish(task);
  } finally {
    pending--;
    await rememberPending().catch(() => undefined);
    if (pending === 0) {
      await nativeCall('background', {enabled: false}).catch(() => undefined);
      idleListeners.forEach(resolve => resolve());
      idleListeners.clear();
    }
  }
}
export async function generateChapter(
  projectName: string,
  chapterIndex: number,
  payload: ListenBookGeneratePayload,
  prefetch = false,
): Promise<TaskSnapshot> {
  const startStamp = cancelStamp(projectName);
  const projectVersion = projectVersions.get(projectName) || 0;
  if (deletingProjects.has(projectName)) {
    throw new Error('正在删除该书籍。');
  }
  if (clearingAudio) {
    throw new Error('正在清理音频，请稍后重试。');
  }
  const config = await loadConfig();
  validateConfig(config, true);
  await assertNarratorAvailable();
  // 取消必须覆盖仍在读取配置或检查录音、尚未登记到 tasks 的请求。
  assertStartAllowed(projectName, startStamp);
  const key = taskKey(projectName, chapterIndex);
  const hash = createTextHash(
    normalizeChapterTextForRequest(payload.chapterText),
  );
  if (!payload.chapterText.trim()) {
    throw new Error('章节正文不能为空。');
  }
  const existing = [...tasks.values()].find(
    task =>
      taskKey(task.projectName, task.chapterIndex) === key &&
      !task.controller.signal.aborted &&
      !['done', 'error', 'cancelled'].includes(task.phase),
  );
  if (
    existing &&
    configIdentity(existing.config) === configIdentity(config) &&
    createTextHash(
      normalizeChapterTextForRequest(existing.payload.chapterText),
    ) === hash
  ) {
    return existing;
  }
  if (existing) {
    existing.controller.abort();
  }
  const task: Task = {
    id: `local_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    projectName,
    chapterIndex,
    payload,
    config,
    controller: new AbortController(),
    version: 1,
    phase: 'queued',
    segments: [],
    failedIndexes: [],
  };
  if (clearingAudio) {
    throw new Error('正在清理音频，请稍后重试。');
  }
  if (
    deletingProjects.has(projectName) ||
    projectVersion !== (projectVersions.get(projectName) || 0)
  ) {
    throw new Error('书籍已删除，生成已取消。');
  }
  tasks.set(task.id, task);
  publish(task);
  pending++;
  try {
    await rememberPending();
  } catch (error) {
    pending--;
    tasks.delete(task.id);
    throw error;
  }
  void enqueue(() => run(task), prefetch ? 1 : 0).catch(() => undefined);
  return task;
}
export async function checkChapter(
  projectName: string,
  chapterIndex: number,
  contentHash?: string,
) {
  const project = await loadProject(projectName);
  const entry = project.chapters[chapterIndex];
  const config = await loadConfig();
  const task = [...tasks.values()].find(
    item =>
      item.projectName === projectName &&
      item.chapterIndex === chapterIndex &&
      !['done', 'error', 'cancelled'].includes(item.phase),
  );
  if (
    !entry ||
    (contentHash && entry.contentHash !== contentHash) ||
    entry.configHash !== configIdentity(config)
  ) {
    return {
      exists: false,
      segments: [],
      inProgress: Boolean(task),
      taskId: task?.id,
    };
  }
  const segments = await validateSegmentFiles(entry.segments);
  return {
    exists:
      segments.length > 0 &&
      segments.every(segment => Boolean(segment.audioUrl)),
    segments,
    inProgress: Boolean(task),
    taskId: task?.id,
  };
}
export function cancelGeneration(
  projectName?: string,
  id?: string,
  reason = '页面操作或任务替换',
): void {
  if (!id) {
    if (projectName) {
      cancelVersions.set(
        projectName,
        (cancelVersions.get(projectName) || 0) + 1,
      );
    } else {
      globalCancelVersion++;
    }
  }
  for (const task of tasks.values()) {
    if (
      (!projectName || task.projectName === projectName) &&
      (!id || task.id === id) &&
      !['done', 'error', 'cancelled'].includes(task.phase)
    ) {
      console.info('[VoiceWeaverLocal] 取消生成任务', {
        taskId: task.id,
        phase: task.phase,
        reason,
      });
      task.controller.abort();
      task.phase = 'cancelled';
      publish(task);
    }
  }
  void rememberPending().catch(() => undefined);
}
export async function saveChapterEdits(
  projectName: string,
  chapterIndex: number,
  segments: ListenSegment[],
  indexes: number[],
): Promise<void> {
  cancelGeneration(projectName, undefined, '保存章节编辑');
  await updateProject(projectName, project => {
    const entry = project.chapters[chapterIndex];
    if (!entry) {
      throw new Error('章节尚未解析，无法编辑。');
    }
    const dirty = new Set(indexes);
    entry.segments = segments.map((segment, index) => ({
      ...entry.segments[index],
      ...segment,
      index,
      ...(dirty.has(index)
        ? {audioUrl: null, localAudioUrl: null, generationError: null}
        : {}),
    }));
    entry.taskId = undefined;
    entry.phase = 'edited';
  });
}
export async function regenerateSegments(
  projectName: string,
  chapterIndex: number,
  indexes: number[],
  waitForActiveTask = false,
): Promise<ListenSegment[]> {
  const initialStamp = cancelStamp(projectName);
  const projectVersion = projectVersions.get(projectName) || 0;
  if (deletingProjects.has(projectName)) {
    throw new Error('正在删除该书籍。');
  }
  if (clearingAudio) {
    throw new Error('正在清理音频，请稍后重试。');
  }
  const config = await loadConfig();
  validateConfig(config, true);
  assertStartAllowed(projectName, initialStamp);
  // 播放追上生成进度时等待原任务，自动补段不能取消整章连续生成。
  if (waitForActiveTask) {
    const running = [...tasks.values()].find(
      task =>
        task.projectName === projectName &&
        task.chapterIndex === chapterIndex &&
        !task.controller.signal.aborted &&
        !['done', 'error', 'cancelled', 'paused'].includes(task.phase),
    );
    if (running) {
      return running.segments;
    }
  }
  cancelGeneration(projectName, undefined, '启动片段重生成');
  const startStamp = cancelStamp(projectName);
  const project = await loadProject(projectName);
  assertStartAllowed(projectName, startStamp);
  const entry = project.chapters[chapterIndex];
  if (!entry) {
    throw new Error('没有可重生成的章节。');
  }
  const task: Task = {
    id: `edit_${Date.now()}`,
    projectName,
    chapterIndex,
    payload: {chapterText: entry.sourceText || ''},
    config,
    controller: new AbortController(),
    version: 1,
    phase: 'generating',
    segments: entry.segments,
    failedIndexes: [],
  };
  if (clearingAudio) {
    throw new Error('正在清理音频，请稍后重试。');
  }
  if (
    deletingProjects.has(projectName) ||
    projectVersion !== (projectVersions.get(projectName) || 0)
  ) {
    throw new Error('书籍已删除，生成已取消。');
  }
  tasks.set(task.id, task);
  pending++;
  try {
    await rememberPending();
  } catch (error) {
    pending--;
    tasks.delete(task.id);
    throw error;
  }
  const work = async () => {
    if (config.generation.background) {
      await nativeCall('background', {enabled: true}).catch(() => undefined);
    }
    await updateProject(projectName, current => {
      active(task);
      current.chapters[chapterIndex].taskId = task.id;
    });
    await refreshNarratorReferences(task, indexes);
    for (const index of [...new Set(indexes)]) {
      active(task);
      const segment = task.segments[index];
      if (!segment) {
        continue;
      }
      try {
        const uri = await generateSpeech(
          segment,
          config,
          (
            await loadProject(projectName)
          ).bindings,
          task.controller.signal,
          task.projectName,
        );
        active(task);
        task.segments[index] = {
          ...segment,
          audioUrl: uri,
          localAudioUrl: uri,
          cacheState: 'ready',
          generationError: null,
        };
      } catch (error) {
        active(task);
        task.segments[index] = {
          ...segment,
          audioUrl: null,
          localAudioUrl: null,
          generationError: error instanceof Error ? error.message : '生成失败',
        };
      }
      await checkpoint(task, entry.contentHash);
    }
    task.phase = 'done';
    await checkpoint(task, entry.contentHash);
    return task.segments;
  };
  return enqueue(async () => {
    try {
      return await work();
    } catch (error) {
      task.phase = task.paused
        ? 'paused'
        : task.controller.signal.aborted
        ? 'cancelled'
        : 'error';
      publish(task);
      throw error;
    } finally {
      pending--;
      await rememberPending().catch(() => undefined);
      if (pending === 0) {
        await nativeCall('background', {enabled: false}).catch(() => undefined);
        idleListeners.forEach(resolve => resolve());
        idleListeners.clear();
      }
    }
  });
}
export async function setRoleOverride(
  projectName: string,
  role: string,
  audioId: string | null,
): Promise<void> {
  const records = await listAudio();
  await updateProject(projectName, project => {
    project.overrides[role] = audioId;
    const casting = createCastingEngine(
      {casting: project.casting, settings: project.settings},
      records,
    );
    const state = casting.loadProjectCasting(projectName) as ReturnType<
      typeof casting.loadProjectCasting
    > & {
      roleAssignments: Record<
        string,
        {voiceActor: string; gender: string; manualOverride: boolean}
      >;
    };
    if (!audioId) {
      delete state.roleAssignments[role];
    } else {
      const record = records.find(item => item.id === audioId);
      if (!record) {
        throw new Error('所选参考录音不存在。');
      }
      const parsed = casting.parseAudioRecordName(record.name);
      if (!parsed?.voiceActor || parsed.emotion === 'narration') {
        throw new Error('请选择标准命名的角色录音。');
      }
      state.roleAssignments[role] = {
        ...state.roleAssignments[role],
        voiceActor: parsed.voiceActor,
        gender: parsed.gender,
        manualOverride: true,
      };
    }
    casting.saveProjectCasting(projectName, state);
    project.casting = casting.snapshot().casting;
  });
}
export async function setBindings(
  projectName: string,
  bindings: Record<string, Record<string, AudioReferenceConfig>>,
): Promise<void> {
  await updateProject(projectName, project => {
    project.bindings = {...project.bindings, ...bindings};
  });
}
