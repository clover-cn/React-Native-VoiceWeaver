import {DeviceEventEmitter} from 'react-native';
import {loadConfig} from './config';
import {
  cancelVoiceAssignmentTasks,
  getActiveChapterTask,
  regenerateSegments,
} from './engine';
import {listAudio, loadProject, updateProject} from './repository';
import {
  applyVoiceGraphEdits,
  buildVoiceGraph,
  VoiceGraphRequest,
  graphRevision,
} from './voiceGraph';
import {nativeCall} from './native';

const fileChecks = new Map<string, {time: number; exists: boolean}>();
const regenerating = new Set<string>();
/** 所有持久化都留在应用端；网页只能提交受校验的分配和布局。 */
export const voiceGraphService = {
  snapshot: async (projectName: string) => {
    const [project, audios, config] = await Promise.all([
      loadProject(projectName),
      listAudio(),
      loadConfig(),
    ]);
    const snapshot = buildVoiceGraph(project, audios, config.provider);
    const used = new Set(snapshot.edges.map(edge => edge.audioId));
    snapshot.audios = await Promise.all(
      snapshot.audios.map(async audio => {
        const record = audios.find(item => item.id === audio.id)!;
        if (!used.has(audio.id)) return audio;
        let check = fileChecks.get(record.url);
        if (!check || Date.now() - check.time > 10000) {
          const exists = await nativeCall<boolean>('exists', {
            uri: record.url,
          }).catch(() => false);
          check = {time: Date.now(), exists};
          if (fileChecks.size > 2048) fileChecks.clear();
          fileChecks.set(record.url, check);
        }
        return {...audio, missing: !check.exists};
      }),
    );
    return {
      ...snapshot,
      tasks: snapshot.parsedChapters.flatMap(chapter => {
        const task = getActiveChapterTask(projectName, chapter);
        return task
          ? [{chapter, phase: task.phase, index: task.currentSegmentIndex}]
          : [];
      }),
    };
  },
  preview: async (projectName: string, request: VoiceGraphRequest) => {
    const [project, audios, config] = await Promise.all([
      loadProject(projectName),
      listAudio(),
      loadConfig(),
    ]);
    return applyVoiceGraphEdits(project, audios, config.provider, request);
  },
  save: async (projectName: string, request: VoiceGraphRequest) => {
    const config = await loadConfig();
    const impact = await updateProject(projectName, async asyncProject => {
      // 写队列持锁期间完成验证与取消，旧请求不能在保存后再提交检查点。
      const audios = await listAudio();
      for (const id of new Set(
        request.edits.flatMap(edit => (edit.audioId ? [edit.audioId] : [])),
      )) {
        const record = audios.find(audio => audio.id === id);
        if (
          !record ||
          !(await nativeCall<boolean>('exists', {uri: record.url}))
        )
          throw new Error('所选参考录音文件已失效，请刷新。');
      }
      const result = applyVoiceGraphEdits(
        asyncProject,
        audios,
        config.provider,
        request,
      );
      cancelVoiceAssignmentTasks(projectName, result.chapters);
      return result;
    });
    DeviceEventEmitter.emit('VoiceWeaverBindingsChanged', {projectName});
    return impact;
  },
  saveLayout: async (
    projectName: string,
    layout: Record<string, {x: number; y: number}>,
    revision: string,
  ) => {
    const entries = Object.entries(layout);
    if (
      entries.length > 2000 ||
      entries.some(
        ([key, p]) =>
          key.length > 300 ||
          !p ||
          !Number.isFinite(p.x) ||
          !Number.isFinite(p.y) ||
          Math.abs(p.x) > 100000 ||
          Math.abs(p.y) > 100000,
      )
    ) {
      throw new Error('布局坐标无效。');
    }
    await updateProject(projectName, project => {
      if (graphRevision(project) !== revision)
        throw new Error('小说分配已变化，请刷新后再保存布局。');
      project.voiceGraphLayout = layout;
    });
  },
  regenerate: async (projectName: string, chapterIndex?: number) => {
    if (regenerating.has(projectName))
      throw new Error('本书已有音色更新任务，请等待完成。');
    regenerating.add(projectName);
    try {
      const project = await loadProject(projectName);
      const chapters = Object.keys(project.chapters)
        .map(Number)
        .filter(index => chapterIndex === undefined || chapterIndex === index);
      for (const chapter of chapters) {
        const latest = await loadProject(projectName);
        const indexes =
          latest.chapters[chapter]?.segments.flatMap((s, i) =>
            s.needsVoiceRegeneration ? [i] : [],
          ) || [];
        if (indexes.length) {
          try {
            await regenerateSegments(
              projectName,
              chapter,
              indexes,
              false,
              true,
            );
          } finally {
            DeviceEventEmitter.emit('VoiceWeaverBindingsChanged', {
              projectName,
            });
          }
        }
      }
    } finally {
      regenerating.delete(projectName);
    }
  },
  audioUri: async (audioId: string) => {
    const record = (await listAudio()).find(a => a.id === audioId);
    if (!record || !(await nativeCall<boolean>('exists', {uri: record.url})))
      throw new Error('参考录音不存在或文件已失效。');
    return record.url;
  },
};
