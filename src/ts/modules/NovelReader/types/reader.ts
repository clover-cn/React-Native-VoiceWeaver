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
  type: 'narration' | 'dialogue';
  role?: string;
  emotion?: string;
  text: string;
  audioUrl?: string | null;
  localAudioUrl?: string | null;
  cacheState?: 'idle' | 'preloading' | 'ready' | 'failed';
  cacheKey?: string;
  lastCacheError?: string | null;
  referenceAudio?: AudioReferenceConfig | null;
  autoEmotionAudioMap?: Record<string, AudioReferenceConfig>;
  autoAssignedVoiceActor?: string | null;
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
