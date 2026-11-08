import {AudioReferenceConfig, ListenSegment} from '../types/reader';
import type {LocalAudio, LocalProject} from './repository';
import {
  assignmentSource,
  referenceLinks,
  referenceSignature,
  resolveReference,
} from './referenceResolver';
import {createTextHash} from '../utils/listenBook';

export const GRAPH_EMOTIONS = [
  'neutral',
  'happy',
  'angry',
  'sad',
  'fearful',
  'disgusted',
  'melancholy',
  'surprised',
];
export interface VoiceGraphEdit {
  role: string;
  emotion: string;
  audioId: string | null;
}
export interface VoiceGraphRequest {
  revision: string;
  edits: VoiceGraphEdit[];
  coverExceptions: boolean;
}
export interface GraphUsage {
  chapter: number;
  index: number;
  role: string;
  emotion: string;
  source: string;
  text: string;
  pending: boolean;
  failed: boolean;
}
export interface GraphEdge {
  id: string;
  audioId: string;
  role: string;
  kind: 'voice' | 'emotion';
  emotions: string[];
  usages: GraphUsage[];
}
export interface GraphRole {
  name: string;
  emotions: string[];
  exceptions: number;
}
export interface GraphImpact {
  chapters: number[];
  segments: number;
  exceptions: number;
  roles: string[];
  emotions: string[];
}
export interface VoiceGraphSnapshot {
  revision: string;
  provider: string;
  roles: GraphRole[];
  audios: {id: string; name: string; missing?: boolean}[];
  edges: GraphEdge[];
  layout: Record<string, {x: number; y: number}>;
  usages: GraphUsage[];
  parsedChapters: number[];
  pending: number;
}

/** 只比较分配相关数据；播放进度、布局和生成状态刷新不造成虚假冲突。 */
export function graphRevision(project: LocalProject) {
  return createTextHash(
    JSON.stringify({
      bindings: project.bindings,
      overrides: project.overrides,
      characters: project.characters,
      chapters: Object.entries(project.chapters).map(([chapter, value]) => [
        chapter,
        value.contentHash,
        value.segments.map(s => [
          s.role,
          s.emotion,
          s.referenceAudio,
          s.autoEmotionAudioMap,
          s.assignmentSource,
          s.referenceSpeakerId,
          s.manualAssigned,
          s.missingEmotionPolicy,
        ]),
      ]),
    }),
  );
}

export function buildVoiceGraph(
  project: LocalProject,
  audios: LocalAudio[],
  provider: string,
): VoiceGraphSnapshot {
  const roleMap = new Map<string, GraphRole>();
  const edgeMap = new Map<string, GraphEdge>();
  const usages: GraphUsage[] = [];
  const role = (name: string) => {
    if (!roleMap.has(name))
      roleMap.set(name, {name, emotions: [], exceptions: 0});
    return roleMap.get(name)!;
  };
  const edge = (
    audioId: string,
    name: string,
    emotion: string,
    kind: 'voice' | 'emotion',
    usage?: GraphUsage,
  ) => {
    const id = JSON.stringify([audioId, name, kind]);
    if (!edgeMap.has(id))
      edgeMap.set(id, {
        id,
        audioId,
        role: name,
        kind,
        emotions: [],
        usages: [],
      });
    const value = edgeMap.get(id)!;
    if (!value.emotions.includes(emotion)) value.emotions.push(emotion);
    if (usage) value.usages.push(usage);
  };
  Object.keys(project.characters).forEach(role);
  Object.entries(project.bindings).forEach(([name, map]) => {
    const r = role(name);
    Object.entries(map).forEach(([emotion, ref]) => {
      if (!r.emotions.includes(emotion)) r.emotions.push(emotion);
      const virtual: ListenSegment = {
        type: name === '旁白' ? 'narration' : 'dialogue',
        text: '',
        role: name,
        emotion,
        referenceAudio: ref,
      };
      referenceLinks(virtual, project.bindings, provider).forEach(link =>
        edge(link.audioId, name, emotion, link.kind),
      );
    });
  });
  Object.entries(project.chapters).forEach(([chapter, value]) => {
    value.segments.forEach((segment, index) => {
      const name = segment.role || '旁白',
        emotion = segment.emotion || 'neutral';
      const r = role(name);
      if (!r.emotions.includes(emotion)) r.emotions.push(emotion);
      const source = assignmentSource(segment, project.bindings);
      if (source === 'segment' || source === 'legacy') r.exceptions++;
      const usage = {
        chapter: Number(chapter),
        index,
        role: name,
        emotion,
        source,
        text: segment.text.slice(0, 120),
        pending: !!segment.needsVoiceRegeneration,
        failed: !!segment.generationError,
      };
      usages.push(usage);
      referenceLinks(segment, project.bindings, provider).forEach(link =>
        edge(link.audioId, name, emotion, link.kind, usage),
      );
    });
  });
  return {
    revision: graphRevision(project),
    provider,
    roles: [...roleMap.values()],
    audios: audios.map(a => ({id: a.id, name: a.name})),
    edges: [...edgeMap.values()],
    usages,
    layout: project.voiceGraphLayout || {},
    parsedChapters: Object.keys(project.chapters)
      .map(Number)
      .sort((a, b) => a - b),
    pending: usages.filter(u => u.pending).length,
  };
}

/** 纯函数预演和实际保存使用同一逻辑，避免影响数量与结果不一致。 */
export function applyVoiceGraphEdits(
  project: LocalProject,
  audios: LocalAudio[],
  provider: string,
  request: VoiceGraphRequest,
): GraphImpact {
  if (graphRevision(project) !== request.revision)
    throw new Error('小说分配已变化，请刷新关系图后重试。');
  if (!Array.isArray(request.edits) || request.edits.length > 2000)
    throw new Error('修改数量无效。');
  const knownRoles = new Set(
    buildVoiceGraph(project, audios, provider).roles.map(r => r.name),
  );
  const audioIds = new Set(audios.map(a => a.id));
  const previousBindings = JSON.parse(
    JSON.stringify(project.bindings),
  ) as LocalProject['bindings'];
  const touched = new Set<string>();
  for (const edit of request.edits) {
    if (
      !knownRoles.has(edit.role) ||
      typeof edit.emotion !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,60}$/.test(edit.emotion) ||
      (edit.audioId !== null && !audioIds.has(edit.audioId))
    )
      throw new Error('角色、情绪或参考录音已不存在，请刷新。');
    touched.add(edit.role);
    const binding = {...project.bindings[edit.role]};
    if (edit.audioId === null) delete binding[edit.emotion];
    else
      binding[edit.emotion] = {
        ...binding[edit.emotion],
        id: edit.audioId,
        mode: binding[edit.emotion]?.mode || 1,
      };
    if (Object.keys(binding).length) project.bindings[edit.role] = binding;
    else delete project.bindings[edit.role];
  }
  const impact: GraphImpact = {
    chapters: [],
    segments: 0,
    exceptions: 0,
    roles: [...touched],
    emotions: [...new Set(request.edits.map(edit => edit.emotion))],
  };
  for (const [chapterIndex, chapter] of Object.entries(project.chapters)) {
    let changed = false;
    chapter.segments = chapter.segments.map(segment => {
      const name = segment.role || '旁白';
      if (!touched.has(name)) return segment;
      const source = assignmentSource(segment, previousBindings);
      const exceptional = source === 'segment' || source === 'legacy';
      const emotion = segment.emotion || 'neutral';
      const previousNeutral =
        previousBindings[name]?.neutral || segment.autoEmotionAudioMap?.neutral;
      const hasSpecificEmotion = Boolean(
        previousBindings[name]?.[emotion] ||
          segment.autoEmotionAudioMap?.[emotion] ||
          (emotion !== 'neutral' &&
            segment.referenceAudio?.id &&
            segment.referenceAudio.id !== previousNeutral?.id),
      );
      const neutralAffectsVoice =
        segment.referenceAudio?.mode === 2 ||
        segment.referenceAudio?.mode === 3 ||
        (segment.missingEmotionPolicy !== 'strict' && !hasSpecificEmotion);
      const relevant = request.edits.some(
        e =>
          e.role === name &&
          (e.emotion === emotion ||
            (e.emotion === 'neutral' && neutralAffectsVoice)),
      );
      if (!relevant) return segment;
      if (exceptional && !request.coverExceptions) {
        impact.exceptions++;
        const old = resolveReference(segment, previousBindings);
        const preserved = {
          ...segment,
          assignmentSource: source,
          referenceAudio: old.reference || null,
          manualAssigned: true,
          referenceSpeakerId:
            provider === 'indextts2'
              ? referenceLinks(segment, previousBindings, provider)[0]?.audioId
              : segment.referenceSpeakerId,
        };
        if (JSON.stringify(preserved) !== JSON.stringify(segment))
          changed = true;
        return preserved;
      }
      const map = project.bindings[name] || {};
      const reference: AudioReferenceConfig | undefined =
        map[emotion] ||
        (segment.missingEmotionPolicy === 'strict' ? undefined : map.neutral);
      const next: ListenSegment = {
        ...segment,
        referenceAudio: reference,
        assignmentSource: reference ? 'role' : 'auto',
        manualAssigned: Boolean(reference),
        referenceSpeakerId: undefined,
      };
      if (!reference && project.overrides[name])
        next.referenceAudio = {id: project.overrides[name]!, mode: 1};
      if (
        referenceSignature(segment, previousBindings, provider) ===
        referenceSignature(next, project.bindings, provider)
      )
        return next;
      changed = true;
      impact.segments++;
      return {
        ...next,
        needsVoiceRegeneration: true,
        generationError: null,
        previousAudioUrl: segment.audioUrl || segment.previousAudioUrl,
        previousLocalAudioUrl:
          segment.localAudioUrl || segment.previousLocalAudioUrl,
        audioUrl: null,
        localAudioUrl: null,
        cacheState: 'idle',
        lastCacheError: null,
      };
    });
    if (changed) {
      impact.chapters.push(Number(chapterIndex));
      chapter.taskId = undefined;
      chapter.phase = 'edited';
    }
  }
  return impact;
}
