import {
  AudioReferenceConfig,
  ListenSegment,
  ListenBookPrescanText,
} from '../types/reader';
import {loadConfig} from './config';
import * as engine from './engine';
import * as repository from './repository';

/** 界面使用的端侧业务接口，不再经过 HTTP 路由。 */
export const localService = {
  audioList: async () => ({success: true, list: await repository.listAudio()}),
  provider: async () => ({
    success: true,
    provider: (await loadConfig()).provider,
  }),
  globalRoles: async (projectName: string) => ({
    success: true,
    roles: (await repository.loadProject(projectName)).bindings,
  }),
  generationSettings: async (projectName: string) => ({
    success: true,
    settings: (await repository.loadProject(projectName)).settings,
  }),
  config: async () => ({success: true, ...(await loadConfig()).generation}),
  generate: async (payload: {
    projectName: string;
    chapterIndex: number;
    chapterText: string;
    chapterTitle?: string;
    prescanTexts?: ListenBookPrescanText[];
    listenerId?: string;
  }) => {
    const task = await engine.generateChapter(
      payload.projectName,
      payload.chapterIndex,
      payload,
      true,
    );
    return {success: true, taskId: task.id};
  },
  regenerate: async (payload: {
    projectName: string;
    chapterIndex: number;
    segmentIndex: number;
  }) => {
    const segments = await engine.regenerateSegments(
      payload.projectName,
      payload.chapterIndex,
      [payload.segmentIndex],
    );
    return {
      success: true,
      segments,
      segment: segments[payload.segmentIndex],
      failedIndexes: segments.flatMap((item, index) =>
        item.generationError ? [index] : [],
      ),
    };
  },
  chapterEdits: async (payload: {
    projectName: string;
    chapterIndex: number;
    segments: ListenSegment[];
    invalidatedSegmentIndexes: number[];
  }) => {
    await engine.saveChapterEdits(
      payload.projectName,
      payload.chapterIndex,
      payload.segments,
      payload.invalidatedSegmentIndexes,
    );
  },
  roleOverride: async (payload: {
    projectName: string;
    role: string;
    audioId: string | null;
    [key: string]: unknown;
  }) =>
    engine.setRoleOverride(payload.projectName, payload.role, payload.audioId),
  setGlobalRoles: async (payload: {
    projectName: string;
    bindings: Record<
      string,
      Record<string, AudioReferenceConfig | null> | null
    >;
  }) => {
    await repository.updateProject(payload.projectName, project => {
      for (const [role, binding] of Object.entries(payload.bindings)) {
        if (binding === null) {
          delete project.bindings[role];
          continue;
        }
        const current = {...project.bindings[role]};
        for (const [emotion, value] of Object.entries(binding)) {
          if (value === null) {
            delete current[emotion];
          } else {
            current[emotion] = value;
          }
        }
        project.bindings[role] = current;
      }
    });
  },
  autoRegenerate: async (payload: {
    projectName: string;
    currentChapterIndex: number;
    invalidatedSegmentIndexes: number[];
    futureRoleUpdate?: {
      role: string;
      audioId: string;
      emotionMap: Record<string, AudioReferenceConfig> | null;
      voiceActor: string | null;
    } | null;
    listenerId?: string;
  }) => {
    const futureChapters: number[] = [];
    if (payload.futureRoleUpdate) {
      const update = payload.futureRoleUpdate;
      await repository.updateProject(payload.projectName, project => {
        for (const key of Object.keys(project.chapters)) {
          if (Number(key) <= payload.currentChapterIndex) {
            continue;
          }
          const chapter = project.chapters[key];
          let changed = false;
          chapter.segments = chapter.segments.map(segment => {
            if (segment.role !== update.role) {
              return segment;
            }
            changed = true;
            return {
              ...segment,
              referenceAudio: update.emotionMap?.[
                segment.emotion || 'neutral'
              ] || {id: update.audioId, mode: 1},
              autoEmotionAudioMap: update.emotionMap || undefined,
              autoAssignedVoiceActor: update.voiceActor,
              manualAssigned: true,
              audioUrl: null,
              localAudioUrl: null,
              generationError: null,
            };
          });
          if (changed) {
            chapter.taskId = undefined;
            futureChapters.push(Number(key));
          }
        }
      });
    }
    const segments = await engine.regenerateSegments(
      payload.projectName,
      payload.currentChapterIndex,
      payload.invalidatedSegmentIndexes,
    );
    // 后续章节进入低优先级队列，当前章节无需等待它们生成完成。
    const queuedFutureChapters: number[] = [];
    for (const chapterIndex of futureChapters) {
      const chapter = (await repository.loadProject(payload.projectName))
        .chapters[chapterIndex];
      if (!chapter.sourceText) {
        continue;
      }
      await engine.generateChapter(
        payload.projectName,
        chapterIndex,
        {chapterText: chapter.sourceText},
        true,
      );
      queuedFutureChapters.push(chapterIndex);
    }
    return {
      success: true,
      segments,
      queuedFutureChapters,
      failedIndexes: segments.flatMap((segment, index) =>
        segment.generationError ? [index] : [],
      ),
    };
  },
  sampleText: async (id: string, payload: {sampleText: string}) => {
    await repository.updateAudio(records =>
      records.map(item =>
        item.id === id
          ? {...item, sampleText: payload.sampleText, siliconVoices: {}}
          : item,
      ),
    );
    return {success: true};
  },
  voicePool: async (
    voiceActor: string,
    payload: {voicePool: 'general' | 'bystander' | 'protected'},
  ) => {
    await repository.setVoicePool(voiceActor, payload.voicePool);
    return {success: true};
  },
  deleteAudio: async (id: string) => {
    await repository.deleteAudio(id);
    return {success: true};
  },
};
