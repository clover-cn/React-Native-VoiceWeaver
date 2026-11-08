import type {VoicePool} from './audio';

export interface Book {
  name: string;
  author: string;
  coverUrl?: string;
  intro?: string;
  origin?: string;
  originName?: string;
  latestChapterTitle?: string;
  bookUrl: string;
  tocUrl?: string;
  sourceType?: 'remote' | 'local_txt';
  localBookId?: string;
  contentHash?: string;
}

export interface Chapter {
  title: string;
  bookUrl: string; // 本章的具体源URL或者索引标识
  isVolume?: boolean; // 是否是卷名
  index: number;
  sourceId?: string;
  baseUrl?: string;
}

export interface AudioReferenceConfig {
  id: string;
  mode?: number;
  emoWeight?: number;
}

export interface ListenSegment {
  /** 音色分配来源；旧记录由解析器保守识别。 */
  assignmentSource?: 'auto' | 'role' | 'segment' | 'legacy';
  /** 保留 IndexTTS2 片段特例时固定说话人，避免被新的普通音色间接替换。 */
  referenceSpeakerId?: string;
  /** 分配已保存，须由用户主动重新生成。 */
  needsVoiceRegeneration?: boolean;
  previousAudioUrl?: string | null;
  previousLocalAudioUrl?: string | null;
  missingEmotionPolicy?: 'strict' | 'fallback_neutral';
  index?: number;
  type: 'narration' | 'dialogue';
  role?: string;
  emotion?: string;
  text: string;
  audioUrl?: string | null;
  generationError?: string | null;
  localAudioUrl?: string | null;
  cacheState?: 'idle' | 'preloading' | 'ready' | 'failed';
  cacheKey?: string;
  lastCacheError?: string | null;
  referenceAudio?: AudioReferenceConfig | null;
  autoEmotionAudioMap?: Record<string, AudioReferenceConfig>;
  autoAssignedVoiceActor?: string | null;
  voiceAllocationType?:
    | 'core'
    | 'supporting'
    | 'temporary'
    | 'unknown'
    | string;
  voicePool?: VoicePool;
  sharedVoice?: boolean;
  manualAssigned?: boolean;
  referenceAudioFallback?: string;
}

export interface ListenBookPrescanText {
  chapterIndex: number;
  chapterTitle: string;
  text: string;
}

export interface ListenBookGeneratePayload {
  chapterTitle?: string;
  chapterText: string;
  prescanTexts?: ListenBookPrescanText[];
}

export interface GenerationSettings {
  projectName: string;
  missingEmotionPolicy: 'strict' | 'fallback_neutral';
}

export interface AudioRecord {
  id: string;
  name: string;
  url: string;
}

export interface GlobalAudioBindings {
  [roleName: string]: {
    [emotion: string]: AudioReferenceConfig;
  };
}
