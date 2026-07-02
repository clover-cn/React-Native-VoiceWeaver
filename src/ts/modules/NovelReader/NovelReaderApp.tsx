import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Alert,
  BackHandler,
  StyleSheet,
  View,
} from 'react-native';
import {Toast, GlobalToast} from '../base/utils/ToastManager';
import {SegmentEditPayload} from './components/SegmentEditorModal';
import VideoPlayerController from './controllers/VideoPlayerController';
import VideoSessionController from './controllers/VideoSessionController';
import {
  API_BASE,
  fetchWithTimeout,
  TimeoutRequestInit,
  useListenBook,
} from './hooks/useListenBook';
import NovelHome from './screens/NovelHome';
import NovelReader, {ReaderLoadingState} from './screens/NovelReader';
import {
  ActiveSegContext,
  ActiveSegCtx,
  PlaybackProgressContext,
  PlaybackProgressCtx,
} from './contexts/ActiveSegContext';
import NovelSearch from './screens/NovelSearch';
import {
  AudioReferenceConfig,
  Book,
  Chapter,
  GlobalAudioBindings,
  ListenBookPrescanText,
  ListenSegment,
} from './types/reader';
import {AudioOption} from './types/audio';
import {useAudioPlayer} from './hooks/useAudioPlayer';
import {useSleepTimer} from './hooks/useSleepTimer';
import {
  loadReadingRecords,
  ReadingRecord,
  removeReadingRecord,
  upsertReadingRecord,
} from './utils/readerStorage';
import AudioLibraryModal from './components/AudioLibraryModal';
import BookSourceManagerModal from './components/BookSourceManagerModal';
import SourceSwitchModal from './components/SourceSwitchModal';
import SleepTimerModal from './components/SleepTimerModal';
import LocalBookSourceService from './bookSource/LocalBookSourceService';
import {BookSourceCancelToken} from './bookSource/types';
import {
  buildListenProjectName,
  normalizeChapterTextForRequest,
} from './utils/listenBook';

export type ViewState = 'home' | 'search' | 'reader';
type ReaderReturnViewState = Exclude<ViewState, 'reader'>;

type MissingEmotionPolicy = 'strict' | 'fallback_neutral';

const EMOTION_LABEL_MAP: Record<string, string> = {
  happy: '高兴',
  angry: '愤怒',
  sad: '悲伤',
  fearful: '害怕',
  disgusted: '厌恶',
  melancholy: '忧郁',
  surprised: '惊讶',
  neutral: '平静',
};

const sleep = (ms: number) =>
  new Promise(resolve => {
    setTimeout(resolve, ms);
  });

// 配置型小对象（AudioReferenceConfig / 单个 ListenSegment 等）的深拷贝。
// primitive 与 null 走快路径，避免无意义的 JSON 序列化；其余对象走 JSON 兜底。
// 注意：调用点目前均为深度 ≤ 3 的小对象，未用于整章 segments 数组，故 JSON 法
// 在性能上是可接受的；若未来扩展到大数组拷贝，应改为窄拷贝函数。
const cloneConfig = <T,>(data: T): T => {
  if (data == null || typeof data !== 'object') {
    return data;
  }

  return JSON.parse(JSON.stringify(data));
};

const createSegmentCacheToken = () => {
  return `cache_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
};

const createBookSourceCancelToken = (): BookSourceCancelToken => {
  const AbortControllerCtor = (globalThis as any).AbortController;
  const controller =
    typeof AbortControllerCtor === 'function'
      ? new AbortControllerCtor()
      : null;

  return {
    cancelled: false,
    signal: controller?.signal,
    cancel: () => {
      try {
        controller?.abort?.();
      } catch (_error) {
        // ignore
      }
    },
  };
};

const markSegmentCacheDirty = (segment: ListenSegment): ListenSegment => {
  return {
    ...segment,
    cacheKey: createSegmentCacheToken(),
    localAudioUrl: null,
    cacheState: 'idle',
    lastCacheError: null,
  };
};

const markSegmentsCacheDirty = (nextSegments: ListenSegment[]) => {
  return nextSegments.map(segment => markSegmentCacheDirty(segment));
};

interface AutoRegenerateAfterEditResponse {
  success?: boolean;
  taskId?: string;
  segments?: ListenSegment[];
  failedIndexes?: number[];
  queuedFutureChapters?: number[];
}

interface ListenTaskStatusResponse {
  phase?: string;
  segments?: ListenSegment[];
  failedIndexes?: number[];
  error?: string;
}

interface ListenBookConfigResponse {
  success?: boolean;
  prefetchCount?: number;
  prescanCount?: number;
}

const requestJson = async <T,>(
  url: string,
  options?: TimeoutRequestInit,
  timeoutMs: number = 15000,
): Promise<T> => {
  let retried = false;

  while (true) {
    try {
      const response = await fetchWithTimeout(url, options, timeoutMs);
      if (response.status === 429 && !retried) {
        retried = true;
        await sleep(20000);
        continue;
      }

      if (response.status >= 500 && response.status < 600 && !retried) {
        retried = true;
        await sleep(2000);
        continue;
      }

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || `请求失败(${response.status})`);
      }
      return data as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isTimeout = message.includes('请求超时');
      if (isTimeout && !retried) {
        retried = true;
        await sleep(2000);
        continue;
      }
      throw error;
    }
  }
};

const getReferenceAudioConfig = (
  segment?: ListenSegment | null,
): AudioReferenceConfig | null => {
  if (!segment?.referenceAudio) {
    return null;
  }

  if (typeof segment.referenceAudio === 'string') {
    return {id: segment.referenceAudio};
  }

  return segment.referenceAudio;
};

const normalizeAudioEmotion = (emotion?: string) => {
  const value = String(emotion || '')
    .trim()
    .toLowerCase();
  const map: Record<string, string> = {
    happy: 'happy',
    开心: 'happy',
    高兴: 'happy',
    angry: 'angry',
    生气: 'angry',
    愤怒: 'angry',
    sad: 'sad',
    悲伤: 'sad',
    fearful: 'fearful',
    害怕: 'fearful',
    恐惧: 'fearful',
    disgusted: 'disgusted',
    厌恶: 'disgusted',
    melancholy: 'melancholy',
    忧郁: 'melancholy',
    忧伤: 'melancholy',
    surprised: 'surprised',
    惊讶: 'surprised',
    neutral: 'neutral',
    平静: 'neutral',
  };
  return map[value] || 'neutral';
};

const parseAudioRecordMeta = (
  audioId: string | null,
  audioMap: Record<string, AudioOption>,
) => {
  const record = audioId ? audioMap[audioId] : null;
  const name = String(record?.name || '').trim();
  if (!name) {
    return null;
  }

  const parts = name
    .split('-')
    .map(item => item.trim())
    .filter(Boolean);

  if (parts.length < 2) {
    return null;
  }

  return {
    voiceActor: parts[0] || null,
    emotion: parts[1] || 'neutral',
  };
};

const getVoiceActorFromAudioId = (
  audioId: string | null,
  audioMap: Record<string, AudioOption>,
) => {
  return parseAudioRecordMeta(audioId, audioMap)?.voiceActor || null;
};

const buildEmotionAudioMapForVoiceActor = (
  audioId: string | null,
  audioOptions: AudioOption[],
  audioMap: Record<string, AudioOption>,
) => {
  const meta = parseAudioRecordMeta(audioId, audioMap);
  if (!meta?.voiceActor) {
    return null;
  }

  const emotionMap: Record<string, AudioReferenceConfig> = {};
  audioOptions.forEach(item => {
    const itemMeta = parseAudioRecordMeta(item.id, audioMap);
    if (!itemMeta || itemMeta.voiceActor !== meta.voiceActor) {
      return;
    }

    const emotion = normalizeAudioEmotion(itemMeta.emotion);
    if (!emotionMap[emotion]) {
      emotionMap[emotion] = {id: item.id, mode: 1, emoWeight: 0.65};
    }
  });

  return Object.keys(emotionMap).length ? emotionMap : null;
};

const buildGlobalBindingPayloadFromEmotionMap = (
  emotionMap: Record<string, AudioReferenceConfig> | null,
) => {
  if (!emotionMap) {
    return null;
  }

  const payload: Record<string, AudioReferenceConfig | null> = {};
  Object.keys(EMOTION_LABEL_MAP).forEach(emotion => {
    const conf = emotionMap[emotion];
    payload[emotion] = conf?.id
      ? {
          id: conf.id,
          mode: conf.mode || 1,
          emoWeight: conf.emoWeight ?? 0.65,
        }
      : null;
  });
  return payload;
};

const pickReferenceAudioByEmotion = (
  emotionMap: Record<string, AudioReferenceConfig> | null,
  emotion: string,
  missingEmotionPolicy: MissingEmotionPolicy,
) => {
  if (!emotionMap) {
    return null;
  }

  const normalizedEmotion = normalizeAudioEmotion(emotion);
  if (emotionMap[normalizedEmotion]) {
    return cloneConfig(emotionMap[normalizedEmotion]);
  }

  if (missingEmotionPolicy === 'fallback_neutral' && emotionMap.neutral) {
    return cloneConfig(emotionMap.neutral);
  }

  return null;
};

const normalizeSegment = (
  segment: ListenSegment,
  globalAudioBindings: GlobalAudioBindings,
  editingSegIndex: number,
  currentSegments: ListenSegment[],
  missingEmotionPolicy: MissingEmotionPolicy,
) => {
  const nextSegment = cloneConfig(segment);
  nextSegment.role = nextSegment.role || '旁白';
  nextSegment.emotion = nextSegment.emotion || 'neutral';
  nextSegment.type = nextSegment.role === '旁白' ? 'narration' : 'dialogue';

  delete nextSegment.referenceAudio;
  delete nextSegment.autoEmotionAudioMap;
  delete nextSegment.autoAssignedVoiceActor;

  if (nextSegment.role === '旁白') {
    const sameNarration = currentSegments.find(
      (item, index) =>
        index !== editingSegIndex &&
        item.role === '旁白' &&
        getReferenceAudioConfig(item),
    );
    if (sameNarration) {
      nextSegment.referenceAudio = cloneConfig(
        getReferenceAudioConfig(sameNarration),
      );
    }
  } else if (nextSegment.role && globalAudioBindings[nextSegment.role]) {
    const roleBinding = globalAudioBindings[nextSegment.role];
    const roleEmotion = nextSegment.emotion || 'neutral';
    if (roleBinding[roleEmotion]) {
      nextSegment.referenceAudio = cloneConfig(roleBinding[roleEmotion]);
    } else if (
      missingEmotionPolicy === 'fallback_neutral' &&
      roleBinding.neutral
    ) {
      nextSegment.referenceAudio = cloneConfig(roleBinding.neutral);
      nextSegment.referenceAudioFallback = 'neutral';
    }
  } else if (nextSegment.role) {
    const sameRoleSegment = currentSegments.find(
      (item, index) =>
        index !== editingSegIndex &&
        item.role === nextSegment.role &&
        item.autoEmotionAudioMap,
    );
    if (sameRoleSegment?.autoEmotionAudioMap) {
      nextSegment.autoEmotionAudioMap = cloneConfig(
        sameRoleSegment.autoEmotionAudioMap,
      );
      nextSegment.autoAssignedVoiceActor =
        sameRoleSegment.autoAssignedVoiceActor || null;
      nextSegment.referenceAudio = pickReferenceAudioByEmotion(
        nextSegment.autoEmotionAudioMap,
        nextSegment.emotion,
        missingEmotionPolicy,
      );
    }
  }

  return nextSegment;
};

const NovelReaderApp: React.FC = () => {
  const [viewState, setViewState] = useState<ViewState>('home');
  const [readerReturnViewState, setReaderReturnViewState] =
    useState<ReaderReturnViewState>('home');
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [chapterList, setChapterList] = useState<Chapter[]>([]);
  const [currentChapterIndex, setCurrentChapterIndex] = useState<number>(-1);
  const [contentParagraphs, setContentParagraphs] = useState<string[]>([]);
  const [currentChapterText, setCurrentChapterText] = useState<string>('');
  const [isListenMode, setIsListenMode] = useState<boolean>(false);
  const [readingRecords, setReadingRecords] = useState<ReadingRecord[]>([]);
  const [audioOptions, setAudioOptions] = useState<AudioOption[]>([]);
  const [globalAudioBindings, setGlobalAudioBindings] =
    useState<GlobalAudioBindings>({});
  const [missingEmotionPolicy, setMissingEmotionPolicy] =
    useState<MissingEmotionPolicy>('fallback_neutral');
  const [sourceModalVisible, setSourceModalVisible] = useState(false);
  const [bookSourceManagerVisible, setBookSourceManagerVisible] =
    useState(false);
  const [audioLibraryVisible, setAudioLibraryVisible] = useState(false);
  const [sleepTimerVisible, setSleepTimerVisible] = useState(false);
  const [readerLoading, setReaderLoading] = useState<ReaderLoadingState | null>(
    null,
  );
  const [loadingMenuItemId, setLoadingMenuItemId] = useState<string | null>(
    null,
  );
  const backPressAtRef = useRef(0);
  // 去抖:同一次返回键在某些平台(如鸿蒙)会同时触发 hardwareBackPress 与 backPress 别名,导致 handler 跑两次
  const lastBackFireAtRef = useRef(0);

  const audioRecordMap = useMemo(() => {
    return audioOptions.reduce<Record<string, AudioOption>>((acc, item) => {
      acc[item.id] = item;
      return acc;
    }, {});
  }, [audioOptions]);

  const chapterListRef = useRef<Chapter[]>([]);
  const currentChapterIndexRef = useRef<number>(-1);
  const selectedBookRef = useRef<Book | null>(null);
  const projectNameRef = useRef<string>('');
  const autoGeneratingSegmentIndexesRef = useRef<Set<number>>(new Set());
  const prefetchedChapterKeyRef = useRef<string>('');
  const listenContextLoadedProjectRef = useRef<string>('');
  const listenContextLoadingRef = useRef<Promise<void> | null>(null);
  const chapterLoadSeqRef = useRef(0);
  const chapterLoadCancelRef = useRef<BookSourceCancelToken | null>(null);

  useEffect(() => {
    chapterListRef.current = chapterList;
  }, [chapterList]);
  useEffect(() => {
    currentChapterIndexRef.current = currentChapterIndex;
  }, [currentChapterIndex]);
  useEffect(() => {
    selectedBookRef.current = selectedBook;
  }, [selectedBook]);

  const cancelActiveChapterLoad = useCallback(() => {
    chapterLoadSeqRef.current += 1;
    const cancelToken = chapterLoadCancelRef.current;
    if (cancelToken) {
      cancelToken.cancelled = true;
      cancelToken.cancel?.();
      chapterLoadCancelRef.current = null;
    }
  }, []);

  const beginChapterLoad = useCallback(() => {
    cancelActiveChapterLoad();
    const cancelToken = createBookSourceCancelToken();
    chapterLoadCancelRef.current = cancelToken;
    return {
      loadSeq: chapterLoadSeqRef.current,
      cancelToken,
    };
  }, [cancelActiveChapterLoad]);

  const isChapterLoadActive = useCallback(
    (loadSeq: number, cancelToken?: BookSourceCancelToken) =>
      chapterLoadSeqRef.current === loadSeq && !cancelToken?.cancelled,
    [],
  );

  const {
    listenState,
    listenPhase,
    segments,
    isGenerationComplete,
    startListening,
    resetListen,
    checkListenCache,
    replaceSegments,
    updateListenRuntime,
    cancelListenTask,
  } = useListenBook();

  const projectName = selectedBook ? buildListenProjectName(selectedBook) : '';

  useEffect(() => {
    projectNameRef.current = projectName;
  }, [projectName]);

  useEffect(() => {
    loadReadingRecords().then(setReadingRecords);
  }, []);

  const fetchAudioRecords = useCallback(async () => {
    try {
      const data = await requestJson<{success?: boolean; list?: AudioOption[]}>(
        `${API_BASE}/api/audio/list`,
      );
      if (data.success && Array.isArray(data.list)) {
        setAudioOptions(data.list);
      }
    } catch (e) {
      console.warn('[NovelReaderApp] 获取参考音频列表失败', e);
    }
  }, []);

  const fetchGlobalBindings = useCallback(
    async (targetProjectName = projectNameRef.current) => {
      if (!targetProjectName || targetProjectName === 'reader_unknown') {
        if (targetProjectName === projectNameRef.current) {
          setGlobalAudioBindings({});
        }
        return;
      }

      try {
        const data = await requestJson<{
          success?: boolean;
          roles?: GlobalAudioBindings;
        }>(
          `${API_BASE}/api/audio/global-roles?projectName=${encodeURIComponent(
            targetProjectName,
          )}`,
        );
        if (targetProjectName !== projectNameRef.current) {
          return;
        }
        if (data.success) {
          setGlobalAudioBindings(data.roles || {});
        }
      } catch (e) {
        console.warn('[NovelReaderApp] 获取全局角色绑定失败', e);
      }
    },
    [],
  );

  const fetchGenerationSettings = useCallback(
    async (targetProjectName = projectNameRef.current) => {
      if (!targetProjectName || targetProjectName === 'reader_unknown') {
        if (targetProjectName === projectNameRef.current) {
          setMissingEmotionPolicy('fallback_neutral');
        }
        return;
      }

      try {
        const data = await requestJson<{
          success?: boolean;
          settings?: {missingEmotionPolicy?: MissingEmotionPolicy};
        }>(
          `${API_BASE}/api/reader/generation-settings?projectName=${encodeURIComponent(
            targetProjectName,
          )}`,
        );
        if (targetProjectName !== projectNameRef.current) {
          return;
        }
        if (data.success && data.settings?.missingEmotionPolicy) {
          setMissingEmotionPolicy(data.settings.missingEmotionPolicy);
        }
      } catch (e) {
        console.warn('[NovelReaderApp] 获取阅读生成策略失败', e);
      }
    },
    [],
  );

  useEffect(() => {
    fetchAudioRecords();
  }, [fetchAudioRecords]);

  useEffect(() => {
    listenContextLoadedProjectRef.current = '';
    listenContextLoadingRef.current = null;

    if (!projectName || projectName === 'reader_unknown') {
      setGlobalAudioBindings({});
      setMissingEmotionPolicy('fallback_neutral');
    }
  }, [projectName]);

  const ensureListenGenerationContext = useCallback(async () => {
    if (!projectName || projectName === 'reader_unknown') {
      setGlobalAudioBindings({});
      setMissingEmotionPolicy('fallback_neutral');
      listenContextLoadedProjectRef.current = '';
      listenContextLoadingRef.current = null;
      return;
    }

    const targetProjectName = projectName;
    if (listenContextLoadedProjectRef.current === projectName) {
      return;
    }

    if (listenContextLoadingRef.current) {
      await listenContextLoadingRef.current;
      return;
    }

    const loadingPromise = Promise.all([
      fetchGlobalBindings(targetProjectName),
      fetchGenerationSettings(targetProjectName),
    ])
      .then(() => {
        if (projectNameRef.current === targetProjectName) {
          listenContextLoadedProjectRef.current = targetProjectName;
        }
      })
      .finally(() => {
        listenContextLoadingRef.current = null;
      });

    listenContextLoadingRef.current = loadingPromise;
    await loadingPromise;
  }, [fetchGenerationSettings, fetchGlobalBindings, projectName]);

  const persistReadingProgress = useCallback(
    async (payload?: {
      book?: Book | null;
      list?: Chapter[];
      index?: number;
      requestUrl?: string;
      requestBody?: string | null;
    }) => {
      const book = payload?.book ?? selectedBook;
      const list = payload?.list ?? chapterList;
      const index = payload?.index ?? currentChapterIndex;
      const currentChapter = list[index];
      const requestUrl =
        payload?.requestUrl ?? (currentChapter ? currentChapter.bookUrl : '');

      if (!book || !currentChapter || !requestUrl) {
        return;
      }

      const record: ReadingRecord = {
        book,
        chapterList: list,
        currentChapterIndex: index,
        currentChapter,
        contentRequest: {
          url: requestUrl,
          options: {
            method: 'GET',
            body: payload?.requestBody ?? null,
          },
        },
        updatedAt: Date.now(),
      };

      const nextRecords = await upsertReadingRecord(record);
      setReadingRecords(nextRecords);
    },
    [chapterList, currentChapterIndex, selectedBook],
  );

  const showExitPrompt = useCallback(() => {
    // 使用全局半透明 Toast(类似 wx.showToast),替代 Alert/ToastAndroid 的弹窗式提示
    Toast.show('再次按下返回可退出', 1500, 'center');
  }, []);

  const openReaderFromView = useCallback(
    (nextReturnViewState?: ReaderReturnViewState) => {
      const returnViewState =
        nextReturnViewState ?? (viewState === 'reader' ? 'home' : viewState);
      setReaderReturnViewState(returnViewState);
      setViewState('reader');
    },
    [viewState],
  );

  const handleBookSelect = async (book: Book) => {
    const {loadSeq, cancelToken} = beginChapterLoad();

    setSelectedBook(book);
    setChapterList([]);
    setCurrentChapterIndex(-1);
    setContentParagraphs([]);
    setCurrentChapterText('');
    resetListen(false);
    setIsListenMode(false);
    setReaderLoading({
      phase: 'toc',
      title: '正在解析目录',
      detail: book.name,
    });
    openReaderFromView();

    try {
      const data = await LocalBookSourceService.getChapterList(
        book,
        cancelToken,
      );
      if (!isChapterLoadActive(loadSeq, cancelToken)) {
        return;
      }

      setSelectedBook(data.book);
      setChapterList(data.chapters);
      if (data.chapters.length > 0) {
        const matchedRecord = readingRecords.find(
          item => item.book.bookUrl === book.bookUrl,
        );
        const resumeIndex = matchedRecord
          ? matchedRecord.currentChapterIndex
          : 0;
        const safeIndex = Math.min(
          Math.max(resumeIndex, 0),
          data.chapters.length - 1,
        );
        await loadChapterContent(
          data.chapters,
          safeIndex,
          data.book,
          loadSeq,
          cancelToken,
        );
      } else {
        setReaderLoading(null);
        Alert.alert('获取目录失败', '本地书源未解析到章节目录。');
      }
    } catch (e) {
      if (!isChapterLoadActive(loadSeq, cancelToken)) {
        return;
      }

      setReaderLoading(null);
      console.warn('Get chapter failed.', e);
      Alert.alert('获取目录失败', '请检查本地书源规则或目标站点网络。');
    }
  };

  const loadChapterContent = useCallback(
    async (
      list: Chapter[],
      index: number,
      book: Book | null = selectedBook,
      requestSeq?: number,
      requestCancelToken?: BookSourceCancelToken,
    ) => {
      if (index < 0 || index >= list.length) {
        return null;
      }

      const loadContext =
        requestSeq == null || !requestCancelToken
          ? beginChapterLoad()
          : {loadSeq: requestSeq, cancelToken: requestCancelToken};
      const {loadSeq, cancelToken} = loadContext;

      resetListen(false);
      setIsListenMode(false);
      setCurrentChapterIndex(index);
      setContentParagraphs([]);
      setCurrentChapterText('');

      const chap = list[index];
      const curProjectName = buildListenProjectName(book);
      setReaderLoading({
        phase: 'content',
        title: '正在加载章节内容',
        detail: chap?.title || book?.name,
      });

      try {
        if (!book) {
          if (isChapterLoadActive(loadSeq, cancelToken)) {
            setReaderLoading(null);
          }
          return null;
        }
        const data = await LocalBookSourceService.getBookContent(
          book,
          chap,
          cancelToken,
        );
        if (!isChapterLoadActive(loadSeq, cancelToken)) {
          return null;
        }

        setContentParagraphs(data.paragraphs);
        setCurrentChapterText(data.text);
        await persistReadingProgress({
          book,
          list,
          index,
          requestUrl: data.requestUrl,
          requestBody: null,
        });
        if (!isChapterLoadActive(loadSeq, cancelToken)) {
          return null;
        }

        setReaderLoading(null);
        checkListenCache(curProjectName, index, data.text);
        return data;
      } catch (e) {
        if (!isChapterLoadActive(loadSeq, cancelToken)) {
          return null;
        }

        setReaderLoading(null);
        console.warn('Get content failed.', e);
        Alert.alert('获取正文失败', '本地书源未能解析该章节正文。');
      }

      return null;
    },
    [
      beginChapterLoad,
      checkListenCache,
      isChapterLoadActive,
      persistReadingProgress,
      resetListen,
      selectedBook,
    ],
  );

  const fetchListenBookConfig = useCallback(async () => {
    try {
      return await requestJson<ListenBookConfigResponse>(
        `${API_BASE}/api/listen-book/config`,
      );
    } catch (error) {
      console.warn('[NovelReaderApp] 获取听书配置失败，使用默认配置', error);
      return {success: false, prefetchCount: 2, prescanCount: 10};
    }
  }, []);

  const loadChapterTextForTts = useCallback(
    async (
      book: Book,
      list: Chapter[],
      index: number,
      cachedText?: string,
    ): Promise<ListenBookPrescanText | null> => {
      const chapter = list[index];
      if (!chapter || chapter.isVolume) {
        return null;
      }

      const normalizedCachedText = normalizeChapterTextForRequest(cachedText);
      if (normalizedCachedText) {
        return {
          chapterIndex: index,
          chapterTitle: chapter.title || '',
          text: normalizedCachedText,
        };
      }

      const data = await LocalBookSourceService.getBookContent(book, chapter);
      const text = normalizeChapterTextForRequest(data.text);
      if (!text) {
        return null;
      }

      return {
        chapterIndex: index,
        chapterTitle: chapter.title || '',
        text,
      };
    },
    [],
  );

  const buildPrescanTexts = useCallback(
    async (
      book: Book,
      list: Chapter[],
      startIndex: number,
      prescanCount: number,
      currentText: string,
    ): Promise<ListenBookPrescanText[]> => {
      if (prescanCount <= 0) {
        return [];
      }

      const output: ListenBookPrescanText[] = [];
      for (
        let index = startIndex;
        index < list.length && output.length < prescanCount;
        index += 1
      ) {
        try {
          const item = await loadChapterTextForTts(
            book,
            list,
            index,
            index === startIndex ? currentText : undefined,
          );
          if (item) {
            output.push(item);
          }
        } catch (error) {
          console.warn('[NovelReaderApp] 预扫描章节正文拉取失败', {
            chapterIndex: index,
            error,
          });
        }
      }

      return output;
    },
    [loadChapterTextForTts],
  );

  const triggerPrefetch = useCallback(async () => {
    const book = selectedBookRef.current;
    const list = chapterListRef.current;
    const fromIndex = currentChapterIndexRef.current;
    const requestProjectName = buildListenProjectName(book);

    if (
      !book ||
      !requestProjectName ||
      requestProjectName === 'reader_unknown'
    ) {
      return;
    }

    const config = await fetchListenBookConfig();
    const prefetchCount = Number.isFinite(config.prefetchCount)
      ? Math.max(0, Number(config.prefetchCount))
      : 2;
    if (prefetchCount <= 0) {
      return;
    }

    for (let offset = 1; offset <= prefetchCount; offset += 1) {
      const chapterIndex = fromIndex + offset;
      const chapter = list[chapterIndex];
      if (!chapter || chapter.isVolume) {
        continue;
      }

      loadChapterTextForTts(book, list, chapterIndex)
        .then(item => {
          if (!item) {
            return null;
          }

          return requestJson(`${API_BASE}/api/listen-book/generate`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
              projectName: requestProjectName,
              chapterIndex,
              chapterTitle: item.chapterTitle,
              chapterText: item.text,
              prescanTexts: [],
            }),
          });
        })
        .catch(error => {
          console.warn('[NovelReaderApp] 后台预生成章节失败', {
            chapterIndex,
            error,
          });
        });
    }
  }, [fetchListenBookConfig, loadChapterTextForTts]);

  const startListenForChapter = useCallback(
    async (index: number) => {
      const book = selectedBookRef.current;
      const list = chapterListRef.current;

      if (!book || index < 0 || index >= list.length) {
        return;
      }

      const content = await loadChapterContent(list, index, book);
      const chapter = list[index];
      const currentProjectName = buildListenProjectName(book);

      if (!chapter) {
        return;
      }

      const chapterText = normalizeChapterTextForRequest(content?.text);
      if (!chapterText) {
        Alert.alert('听书失败', '当前章节正文为空，无法生成语音。');
        return;
      }

      setIsListenMode(true);
      startListening(currentProjectName, index, {
        chapterTitle: chapter.title || '',
        chapterText,
        prescanTexts: [],
      });
    },
    [loadChapterContent, startListening],
  );

  const handleSourceSelect = async (source: any) => {
    setSourceModalVisible(false);
    if (!selectedBook) {
      return;
    }

    setLoadingMenuItemId('source');
    const {loadSeq, cancelToken} = beginChapterLoad();
    const newBook = {...selectedBook, ...source};
    setSelectedBook(newBook);
    setReaderLoading({
      phase: 'toc',
      title: '正在解析目录',
      detail: newBook.name,
    });

    try {
      const data = await LocalBookSourceService.getChapterList(
        newBook,
        cancelToken,
      );
      if (!isChapterLoadActive(loadSeq, cancelToken)) {
        return;
      }

      setSelectedBook(data.book);
      setChapterList(data.chapters);
      if (data.chapters.length > 0) {
        const safeIndex = Math.min(
          Math.max(currentChapterIndex, 0),
          data.chapters.length - 1,
        );
        await loadChapterContent(
          data.chapters,
          safeIndex,
          data.book,
          loadSeq,
          cancelToken,
        );
      } else {
        setReaderLoading(null);
        Alert.alert('切换书源失败', '无法拉取新书源的章节目录');
      }
    } catch (e) {
      if (!isChapterLoadActive(loadSeq, cancelToken)) {
        return;
      }

      setReaderLoading(null);
      console.warn('Switch source failed.', e);
      Alert.alert('切换书源失败', '请检查本地书源规则或目标站点网络。');
    } finally {
      setLoadingMenuItemId(current => (current === 'source' ? null : current));
    }
  };

  const handleChapterFinished = useCallback(() => {
    const list = chapterListRef.current;
    const idx = currentChapterIndexRef.current;
    const nextIdx = idx + 1;

    if (nextIdx >= list.length) {
      Alert.alert('提示', '全书已播放完毕');
      return;
    }

    startListenForChapter(nextIdx).catch(error => {
      console.warn('[NovelReaderApp] 自动换章失败:', error);
    });
  }, [startListenForChapter]);

  const handleAutoGenerateMissingSegment = useCallback(
    async (segmentIndex: number) => {
      const requestProjectName = projectName;
      const requestChapterIndex = currentChapterIndex;

      if (
        !requestProjectName ||
        segmentIndex < 0 ||
        segmentIndex >= segments.length ||
        autoGeneratingSegmentIndexesRef.current.has(segmentIndex)
      ) {
        return;
      }

      autoGeneratingSegmentIndexesRef.current.add(segmentIndex);
      updateListenRuntime(
        'loading',
        isGenerationComplete,
        '正在生成当前段音频…',
      );

      try {
        const data = await requestJson<{
          segments?: ListenSegment[];
          segment?: ListenSegment;
        }>(`${API_BASE}/api/listen-book/regenerate-segment`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            projectName: requestProjectName,
            chapterIndex: requestChapterIndex,
            segmentIndex,
          }),
        });

        const latestProjectName = selectedBookRef.current
          ? buildListenProjectName(selectedBookRef.current)
          : '';
        if (
          currentChapterIndexRef.current !== requestChapterIndex ||
          latestProjectName !== requestProjectName
        ) {
          return;
        }

        if (Array.isArray(data.segments) && data.segments.length) {
          replaceSegments(markSegmentsCacheDirty(data.segments));
        } else if (data.segment) {
          const nextSegments = [...segments];
          nextSegments[segmentIndex] = markSegmentCacheDirty(data.segment);
          replaceSegments(nextSegments);
        }

        updateListenRuntime('ready', isGenerationComplete, '');
      } catch (error) {
        updateListenRuntime('ready', isGenerationComplete, '');
        console.warn(
          '[NovelReaderApp] 自动生成缺失音频失败',
          segmentIndex,
          error,
        );
      } finally {
        autoGeneratingSegmentIndexesRef.current.delete(segmentIndex);
      }
    },
    [
      currentChapterIndex,
      isGenerationComplete,
      projectName,
      replaceSegments,
      segments,
      updateListenRuntime,
    ],
  );

  const {
    isPlaying,
    currentSegIdx,
    currentProgress,
    totalDuration,
    togglePlayPause,
    stopPlayback,
    playFromIndex,
  } = useAudioPlayer(
    segments,
    isGenerationComplete,
    isListenMode ? listenState : 'idle',
    selectedBook && currentChapterIndex >= 0
      ? {
          assetId: `${projectName}_${currentChapterIndex}`,
          title: chapterList[currentChapterIndex]?.title || '',
          author: selectedBook.author,
          album: selectedBook.name || '',
          mediaImage: selectedBook.coverUrl,
        }
      : undefined,
    projectName,
    currentChapterIndex,
    handleChapterFinished,
    handleAutoGenerateMissingSegment,
  );

  // 定时关闭：到点 / 段落结束 / 章节结束时暂停。仅在 isPlaying=true 时触发，避免误暂停。
  // 用 ref 持有 isPlaying，使 onTrigger 引用不随播放状态变化（hook 内部已用
  // onTriggerRef 桥接最新值,无须依赖项变更触发重新订阅)。
  const isPlayingRef = useRef(isPlaying);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);
  const handleSleepTrigger = useCallback(() => {
    if (isPlayingRef.current) {
      togglePlayPause();
    }
  }, [togglePlayPause]);
  const sleepTimer = useSleepTimer({
    onTrigger: handleSleepTrigger,
    isPlaying,
  });

  useEffect(() => {
    if (!isListenMode || !isGenerationComplete || currentChapterIndex < 0) {
      return;
    }

    const prefetchKey = `${projectName}_${currentChapterIndex}`;
    if (!projectName || prefetchedChapterKeyRef.current === prefetchKey) {
      return;
    }

    prefetchedChapterKeyRef.current = prefetchKey;
    triggerPrefetch().catch(error => {
      console.warn('[NovelReaderApp] 后台预生成调度失败', error);
    });
  }, [
    currentChapterIndex,
    isGenerationComplete,
    isListenMode,
    projectName,
    triggerPrefetch,
  ]);

  const exitReader = useCallback(async () => {
    const nextViewState = readerReturnViewState;
    cancelActiveChapterLoad();
    setReaderLoading(null);
    setLoadingMenuItemId(current => (current === 'source' ? null : current));
    stopPlayback();
    resetListen();
    setIsListenMode(false);
    setViewState(nextViewState);

    await persistReadingProgress();
  }, [
    cancelActiveChapterLoad,
    persistReadingProgress,
    readerReturnViewState,
    resetListen,
    stopPlayback,
  ]);

  const requestExitReader = useCallback(() => {
    exitReader().catch(error => {
      console.warn('Exit reader failed.', error);
    });
  }, [exitReader]);

  useEffect(() => {
    try {
      VideoSessionController.initSession();
      VideoPlayerController.init();
    } catch (e) {
      console.warn('[NovelReaderApp] 播控中心初始化失败，听书功能将不可用:', e);
    }

    return () => {
      try {
        VideoSessionController.destroy();
        VideoPlayerController.clearAllListeners();
      } catch (e) {
        // ignore
      }
    };
  }, []);

  const handleResumeReading = async (record: ReadingRecord) => {
    if (!record?.book) {
      return;
    }

    setReaderReturnViewState('home');
    await handleBookSelect(record.book);
  };

  const handleRemoveReadingRecord = useCallback(async (bookUrl: string) => {
    const nextRecords = await removeReadingRecord(bookUrl);
    setReadingRecords(nextRecords);
  }, []);

  useEffect(() => {
    const handleSystemBack = () => {
      // 100ms 内的重复回调直接吞掉(防止 hardwareBackPress + backPress 别名双触发)
      const fireAt = Date.now();
      if (fireAt - lastBackFireAtRef.current < 100) {
        return true;
      }
      lastBackFireAtRef.current = fireAt;

      if (viewState === 'reader') {
        requestExitReader();
        return true;
      }

      if (viewState === 'search') {
        setViewState('home');
        return true;
      }

      if (viewState === 'home') {
        const now = Date.now();
        if (now - backPressAtRef.current < 2000) {
          BackHandler.exitApp();
          return true;
        }

        backPressAtRef.current = now;
        showExitPrompt();
        return true;
      }

      return false;
    };

    const hardwareSubscription = BackHandler.addEventListener(
      'hardwareBackPress',
      handleSystemBack,
    );
    const legacySubscription = BackHandler.addEventListener(
      'backPress' as 'hardwareBackPress',
      handleSystemBack,
    );

    return () => {
      hardwareSubscription.remove();
      legacySubscription.remove();
    };
  }, [requestExitReader, showExitPrompt, viewState]);

  const handleStartListen = async () => {
    if (!selectedBook) {
      return;
    }

    const curProjectName = buildListenProjectName(selectedBook);
    const chapter = chapterList[currentChapterIndex];
    if (!chapter) {
      return;
    }

    try {
      const currentChapter = await loadChapterTextForTts(
        selectedBook,
        chapterList,
        currentChapterIndex,
        currentChapterText,
      );
      const chapterText = normalizeChapterTextForRequest(currentChapter?.text);

      if (!chapterText) {
        Alert.alert('听书失败', '当前章节正文为空，无法生成语音。');
        return;
      }

      await ensureListenGenerationContext();

      // 先检查后端是否已有该章缓存音频/在途任务,命中即跳过预扫描,
      // 避免每次点击听书都重复串行拉取多章正文。
      const cacheStatus = await checkListenCache(
        curProjectName,
        currentChapterIndex,
        chapterText,
      );

      let prescanTexts: ListenBookPrescanText[] = [];
      if (!cacheStatus.cached && !cacheStatus.inProgress) {
        const config = await fetchListenBookConfig();
        const prescanCount = Number.isFinite(config.prescanCount)
          ? Math.max(0, Number(config.prescanCount))
          : 10;
        prescanTexts = await buildPrescanTexts(
          selectedBook,
          chapterList,
          currentChapterIndex,
          prescanCount,
          chapterText,
        );
      }

      setIsListenMode(true);
      startListening(curProjectName, currentChapterIndex, {
        chapterTitle: chapter.title || '',
        chapterText,
        prescanTexts,
      });
    } catch (error) {
      console.warn('[NovelReaderApp] 启动听书失败', error);
      Alert.alert(
        '听书失败',
        error instanceof Error ? error.message : '无法获取章节正文。',
      );
    }
  };

  const handleStopListen = () => {
    stopPlayback();
    resetListen();
    setIsListenMode(false);
  };

  const persistChapterEdits = useCallback(
    async (
      nextSegments: ListenSegment[],
      invalidatedSegmentIndexes: number[],
    ) => {
      await requestJson(`${API_BASE}/api/listen-book/chapter-edits`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          projectName,
          chapterIndex: currentChapterIndex,
          invalidatedSegmentIndexes,
          segments: nextSegments.map(segment => ({
            type: segment.type,
            role: segment.role,
            emotion: segment.emotion || 'neutral',
            text: segment.text || '',
            referenceAudio: getReferenceAudioConfig(segment),
            autoEmotionAudioMap: segment.autoEmotionAudioMap || null,
            autoAssignedVoiceActor: segment.autoAssignedVoiceActor || null,
            manualAssigned: Boolean(segment.manualAssigned),
          })),
        }),
      });
    },
    [currentChapterIndex, projectName],
  );

  const syncRoleOverrideForSegment = useCallback(
    async (segment: ListenSegment, audioId: string | null) => {
      if (
        !audioId ||
        segment.type !== 'dialogue' ||
        !segment.role ||
        segment.role === '旁白'
      ) {
        return;
      }

      await requestJson(`${API_BASE}/api/reader/role-audio-override`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          projectName,
          role: segment.role,
          audioId,
          chapterIndex: currentChapterIndex + 1,
          skipCacheInvalidation: true,
        }),
      });
    },
    [currentChapterIndex, projectName],
  );

  const syncGlobalBindingsForRole = useCallback(
    async (
      role: string,
      emotionMap: Record<string, AudioReferenceConfig> | null,
    ) => {
      if (!role || role === '旁白') {
        return;
      }

      const bindingPayload =
        buildGlobalBindingPayloadFromEmotionMap(emotionMap);
      if (!bindingPayload) {
        return;
      }

      await requestJson(`${API_BASE}/api/audio/global-roles`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          projectName,
          bindings: {
            [role]: bindingPayload,
          },
        }),
      });
      await fetchGlobalBindings();
    },
    [fetchGlobalBindings, projectName],
  );

  const autoRegenerateAfterSegmentEdit = useCallback(
    async (
      invalidatedIndexes: number[],
      futureRoleUpdate: {
        role: string;
        audioId: string;
        emotionMap: Record<string, AudioReferenceConfig> | null;
        voiceActor: string | null;
      } | null,
    ) => {
      const requestProjectName = projectName;
      const requestChapterIndex = currentChapterIndex;
      const data = await requestJson<AutoRegenerateAfterEditResponse>(
        `${API_BASE}/api/listen-book/auto-regenerate-after-edit`,
        {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            projectName,
            currentChapterIndex,
            invalidatedSegmentIndexes: invalidatedIndexes,
            futureRoleUpdate,
          }),
        },
      );

      if (Array.isArray(data.segments)) {
        replaceSegments(markSegmentsCacheDirty(data.segments));
        updateListenRuntime('ready', true, '');

        if (Array.isArray(data.failedIndexes) && data.failedIndexes.length) {
          Alert.alert(
            '部分片段生成失败',
            `当前章节有 ${data.failedIndexes.length} 个片段自动生成失败，请稍后重试。`,
          );
          return;
        }

        if (
          Array.isArray(data.queuedFutureChapters) &&
          data.queuedFutureChapters.length
        ) {
          Alert.alert(
            '保存成功',
            `当前章节已自动重生成，后续 ${data.queuedFutureChapters.length} 个已缓存章节正在后台更新。`,
          );
          return;
        }

        Alert.alert('保存成功', '当前章节受影响片段已自动重生成完成。');
        return;
      }

      if (!data.taskId) {
        throw new Error('自动重生成任务未返回 taskId');
      }

      updateListenRuntime('loading', false, '正在重生成当前章节音频…');

      let transientErrorCount = 0;
      while (true) {
        await sleep(2000);

        try {
          const status = await requestJson<ListenTaskStatusResponse>(
            `${API_BASE}/api/listen-book/status/${data.taskId}`,
          );
          transientErrorCount = 0;

          const latestProjectName = selectedBookRef.current
            ? buildListenProjectName(selectedBookRef.current)
            : '';
          if (
            latestProjectName !== requestProjectName ||
            currentChapterIndexRef.current !== requestChapterIndex
          ) {
            return;
          }

          if (status.phase === 'error') {
            throw new Error(status.error || '编辑后自动重生成失败');
          }

          if (status.phase !== 'done') {
            updateListenRuntime(
              'loading',
              false,
              status.phase === 'running'
                ? '正在重生成当前章节音频…'
                : status.phase || '正在重生成当前章节音频…',
            );
            continue;
          }

          if (Array.isArray(status.segments)) {
            replaceSegments(markSegmentsCacheDirty(status.segments));
          }
          updateListenRuntime('ready', true, '');

          if (
            Array.isArray(status.failedIndexes) &&
            status.failedIndexes.length
          ) {
            Alert.alert(
              '部分片段生成失败',
              `当前章节有 ${status.failedIndexes.length} 个片段自动生成失败，请稍后重试。`,
            );
            return;
          }

          if (
            Array.isArray(data.queuedFutureChapters) &&
            data.queuedFutureChapters.length
          ) {
            Alert.alert(
              '保存成功',
              `当前章节已自动重生成，后续 ${data.queuedFutureChapters.length} 个已缓存章节正在后台更新。`,
            );
            return;
          }

          Alert.alert('保存成功', '当前章节受影响片段已自动重生成完成。');
          return;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          const isTransientError =
            message.includes('请求超时') ||
            message.includes('Network request failed') ||
            message.includes('Failed to fetch');

          if (!isTransientError) {
            throw error;
          }

          transientErrorCount += 1;
          if (transientErrorCount <= 3) {
            continue;
          }
          throw error;
        }
      }
    },
    [currentChapterIndex, projectName, replaceSegments, updateListenRuntime],
  );

  const handleSegmentEditSubmit = useCallback(
    async (index: number, payload: SegmentEditPayload) => {
      if (!projectName || index < 0 || index >= segments.length) {
        return;
      }

      const currentSegment = segments[index];
      const normalizedBase = normalizeSegment(
        {
          ...currentSegment,
          role: payload.role || '旁白',
          emotion: payload.emotion || 'neutral',
        },
        globalAudioBindings,
        index,
        segments,
        missingEmotionPolicy,
      );

      const manualEmotionMap = buildEmotionAudioMapForVoiceActor(
        payload.selectedAudioId,
        audioOptions,
        audioRecordMap,
      );
      const nextVoiceActor = getVoiceActorFromAudioId(
        payload.selectedAudioId,
        audioRecordMap,
      );

      normalizedBase.autoEmotionAudioMap = manualEmotionMap
        ? cloneConfig(manualEmotionMap)
        : normalizedBase.autoEmotionAudioMap || undefined;
      normalizedBase.referenceAudio = manualEmotionMap
        ? pickReferenceAudioByEmotion(
            manualEmotionMap,
            normalizedBase.emotion || 'neutral',
            missingEmotionPolicy,
          )
        : payload.selectedAudioId
        ? {id: payload.selectedAudioId, mode: 1, emoWeight: 0.65}
        : normalizedBase.referenceAudio || null;
      normalizedBase.manualAssigned = true;
      normalizedBase.audioUrl = null;
      normalizedBase.cacheKey = createSegmentCacheToken();
      normalizedBase.localAudioUrl = null;
      normalizedBase.cacheState = 'idle';
      normalizedBase.lastCacheError = null;
      normalizedBase.autoAssignedVoiceActor =
        nextVoiceActor || normalizedBase.autoAssignedVoiceActor || null;

      const invalidatedIndexes: number[] = [];
      const nextSegments: ListenSegment[] = segments.map(
        (segment, segIndex) => {
          if (segIndex === index) {
            invalidatedIndexes.push(segIndex);
            return cloneConfig(normalizedBase);
          }

          if (
            payload.selectedAudioId &&
            normalizedBase.type === 'dialogue' &&
            segment.role === normalizedBase.role
          ) {
            invalidatedIndexes.push(segIndex);
            return {
              ...segment,
              referenceAudio: manualEmotionMap
                ? pickReferenceAudioByEmotion(
                    manualEmotionMap,
                    segment.emotion || 'neutral',
                    missingEmotionPolicy,
                  ) || cloneConfig(manualEmotionMap.neutral)
                : {id: payload.selectedAudioId, mode: 1, emoWeight: 0.65},
              autoAssignedVoiceActor: nextVoiceActor,
              autoEmotionAudioMap: manualEmotionMap
                ? cloneConfig(manualEmotionMap)
                : undefined,
              manualAssigned: true,
              audioUrl: null,
              cacheKey: createSegmentCacheToken(),
              localAudioUrl: null,
              cacheState: 'idle',
              lastCacheError: null,
            };
          }

          return segment;
        },
      );

      const normalizedInvalidatedIndexes = Array.from(
        new Set(invalidatedIndexes),
      );
      replaceSegments(nextSegments);
      stopPlayback();
      await cancelListenTask(projectName);
      updateListenRuntime('idle', false, '');

      try {
        await syncRoleOverrideForSegment(
          normalizedBase,
          payload.selectedAudioId,
        );
        await syncGlobalBindingsForRole(
          normalizedBase.role || '旁白',
          manualEmotionMap,
        );
        await persistChapterEdits(nextSegments, normalizedInvalidatedIndexes);
        await autoRegenerateAfterSegmentEdit(
          normalizedInvalidatedIndexes,
          payload.selectedAudioId &&
            normalizedBase.role &&
            normalizedBase.role !== '旁白'
            ? {
                role: normalizedBase.role,
                audioId: payload.selectedAudioId,
                emotionMap: manualEmotionMap
                  ? cloneConfig(manualEmotionMap)
                  : null,
                voiceActor: nextVoiceActor,
              }
            : null,
        );
      } catch (e) {
        console.error('保存片段修改失败', e);
        replaceSegments(segments);
        updateListenRuntime('ready', true, '');
        Alert.alert(
          '保存失败',
          e instanceof Error ? e.message : '保存失败，请稍后重试。',
        );
      }
    },
    [
      audioOptions,
      audioRecordMap,
      autoRegenerateAfterSegmentEdit,
      cancelListenTask,
      globalAudioBindings,
      missingEmotionPolicy,
      persistChapterEdits,
      projectName,
      replaceSegments,
      segments,
      stopPlayback,
      syncGlobalBindingsForRole,
      syncRoleOverrideForSegment,
      updateListenRuntime,
    ],
  );

  const handlePrevChapter = useCallback(() => {
    loadChapterContent(
      chapterListRef.current,
      currentChapterIndexRef.current - 1,
    );
  }, [loadChapterContent]);

  const handleNextChapter = useCallback(() => {
    loadChapterContent(
      chapterListRef.current,
      currentChapterIndexRef.current + 1,
    );
  }, [loadChapterContent]);

  const handleSelectChapter = useCallback(
    (index: number) => {
      loadChapterContent(chapterListRef.current, index);
    },
    [loadChapterContent],
  );

  const handleOpenSegmentEditor = useCallback(async () => {
    await ensureListenGenerationContext();
  }, [ensureListenGenerationContext]);

  const handleMenuItemClick = useCallback((id: string) => {
    if (id === 'sourceManage') {
      setBookSourceManagerVisible(true);
      return;
    }

    if (id === 'source') {
      setSourceModalVisible(true);
      return;
    }

    if (id === 'audio') {
      setAudioLibraryVisible(true);
      return;
    }

    if (id === 'sleep') {
      setSleepTimerVisible(true);
    }
  }, []);

  // —— Modal onClose 回调收敛 (A3): 改为稳定的 useCallback,避免每次 render 给 Modal 传新引用,
  // 这些 Modal 已 memo / 内部 visible 检查开销可控,但稳定引用能减少不必要的 reconcile。
  const handleCloseSourceModal = useCallback(
    () => setSourceModalVisible(false),
    [],
  );
  const handleCloseBookSourceManager = useCallback(
    () => setBookSourceManagerVisible(false),
    [],
  );
  const handleCloseAudioLibrary = useCallback(
    () => setAudioLibraryVisible(false),
    [],
  );
  const handleCloseSleepTimer = useCallback(
    () => setSleepTimerVisible(false),
    [],
  );

  const activeSegCtxValue = useMemo<ActiveSegCtx>(
    () => ({
      currentSegIdx,
      listenState: isListenMode ? listenState : 'idle',
    }),
    [currentSegIdx, listenState, isListenMode],
  );

  const progressCtxValue = useMemo<PlaybackProgressCtx>(
    () => ({currentProgress, totalDuration}),
    [currentProgress, totalDuration],
  );
  const shouldKeepSearchMounted =
    viewState === 'search' ||
    (viewState === 'reader' && readerReturnViewState === 'search');

  return (
    <View style={styles.container}>
      {viewState === 'home' && (
        <NovelHome
          onNavigateSearch={() => setViewState('search')}
          readingRecords={readingRecords}
          onResumeReading={handleResumeReading}
          onRemoveRecord={handleRemoveReadingRecord}
        />
      )}

      {shouldKeepSearchMounted && (
        <View
          style={[
            styles.searchHost,
            viewState === 'reader' && styles.hiddenSearchView,
          ]}
          pointerEvents={viewState === 'search' ? 'auto' : 'none'}>
          <NovelSearch
            onBack={() => setViewState('home')}
            onBookSelect={handleBookSelect}
          />
        </View>
      )}

      {viewState === 'reader' && (
        <ActiveSegContext.Provider value={activeSegCtxValue}>
          <PlaybackProgressContext.Provider value={progressCtxValue}>
            <NovelReader
              currentChapter={chapterList[currentChapterIndex]}
              chapterList={chapterList}
              currentChapterIndex={currentChapterIndex}
              contentParagraphs={contentParagraphs}
              readerLoading={readerLoading}
              listenState={listenState}
              listenPhase={listenPhase}
              segments={segments}
              isListenMode={isListenMode}
              isGenerationComplete={isGenerationComplete}
              projectName={projectName}
              audioOptions={audioOptions}
              isPlaying={isPlaying}
              currentSegIdx={currentSegIdx}
              onTogglePlayPause={togglePlayPause}
              onPlaySegment={playFromIndex}
              onBack={requestExitReader}
              onPrevChapter={handlePrevChapter}
              onNextChapter={handleNextChapter}
              onSelectChapter={handleSelectChapter}
              onStartListen={handleStartListen}
              onStopListen={handleStopListen}
              onSegmentEditSubmit={handleSegmentEditSubmit}
              onOpenSegmentEditor={handleOpenSegmentEditor}
              loadingMenuItemId={loadingMenuItemId}
              onMenuItemClick={handleMenuItemClick}
            />
          </PlaybackProgressContext.Provider>
        </ActiveSegContext.Provider>
      )}

      <SourceSwitchModal
        visible={sourceModalVisible}
        currentBook={selectedBook}
        onClose={handleCloseSourceModal}
        onSourceSelect={handleSourceSelect}
      />
      <BookSourceManagerModal
        visible={bookSourceManagerVisible}
        onClose={handleCloseBookSourceManager}
      />
      <AudioLibraryModal
        visible={audioLibraryVisible}
        apiBase={API_BASE}
        onClose={handleCloseAudioLibrary}
        onRecordsChanged={setAudioOptions}
      />
      <SleepTimerModal
        visible={sleepTimerVisible}
        info={sleepTimer.info}
        onClose={handleCloseSleepTimer}
        onSelectDuration={sleepTimer.setDuration}
        onClear={sleepTimer.clear}
      />
      {/* 全局 Toast 挂载点:不依赖 setWrapperComponentProvider,确保鸿蒙等多 bundle 子应用也能弹出半透明提示 */}
      <GlobalToast />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  searchHost: {
    flex: 1,
  },
  hiddenSearchView: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0,
  },
});

export default NovelReaderApp;
