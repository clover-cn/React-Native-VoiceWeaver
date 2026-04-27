import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Alert,
  BackHandler,
  Platform,
  StyleSheet,
  ToastAndroid,
  View,
} from 'react-native';
import {SegmentEditPayload} from './components/SegmentEditorModal';
import VideoPlayerController from './controllers/VideoPlayerController';
import VideoSessionController from './controllers/VideoSessionController';
import {API_BASE, fetchWithTimeout, useListenBook} from './hooks/useListenBook';
import NovelHome from './screens/NovelHome';
import NovelReader from './screens/NovelReader';
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
  ListenSegment,
} from './types/reader';
import {AudioOption} from './types/audio';
import {useAudioPlayer} from './hooks/useAudioPlayer';
import {
  loadReadingRecord,
  ReadingRecord,
  saveReadingRecord,
} from './utils/readerStorage';
import AudioLibraryModal from './components/AudioLibraryModal';
import SourceSwitchModal from './components/SourceSwitchModal';

export type ViewState = 'home' | 'search' | 'reader';

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

const cloneConfig = <T,>(data: T): T => {
  if (data == null) {
    return data;
  }

  return JSON.parse(JSON.stringify(data));
};

const createSegmentCacheToken = () => {
  return `cache_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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

const requestJson = async <T,>(
  url: string,
  options?: RequestInit,
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
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [chapterList, setChapterList] = useState<Chapter[]>([]);
  const [currentChapterIndex, setCurrentChapterIndex] = useState<number>(-1);
  const [contentParagraphs, setContentParagraphs] = useState<string[]>([]);
  const [isListenMode, setIsListenMode] = useState<boolean>(false);
  const [continueReadingRecord, setContinueReadingRecord] =
    useState<ReadingRecord | null>(null);
  const [audioOptions, setAudioOptions] = useState<AudioOption[]>([]);
  const [globalAudioBindings, setGlobalAudioBindings] =
    useState<GlobalAudioBindings>({});
  const [missingEmotionPolicy, setMissingEmotionPolicy] =
    useState<MissingEmotionPolicy>('fallback_neutral');
  const [sourceModalVisible, setSourceModalVisible] = useState(false);
  const [audioLibraryVisible, setAudioLibraryVisible] = useState(false);
  const [loadingMenuItemId, setLoadingMenuItemId] = useState<string | null>(
    null,
  );
  const backPressAtRef = useRef(0);

  const audioRecordMap = useMemo(() => {
    return audioOptions.reduce<Record<string, AudioOption>>((acc, item) => {
      acc[item.id] = item;
      return acc;
    }, {});
  }, [audioOptions]);

  const chapterListRef = useRef<Chapter[]>([]);
  const currentChapterIndexRef = useRef<number>(-1);
  const selectedBookRef = useRef<Book | null>(null);
  const autoGeneratingSegmentIndexesRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    chapterListRef.current = chapterList;
  }, [chapterList]);
  useEffect(() => {
    currentChapterIndexRef.current = currentChapterIndex;
  }, [currentChapterIndex]);
  useEffect(() => {
    selectedBookRef.current = selectedBook;
  }, [selectedBook]);

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

  const projectName = selectedBook
    ? `reader_${selectedBook.name || 'unknown'}`
    : '';

  useEffect(() => {
    loadReadingRecord().then(setContinueReadingRecord);
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

  const fetchGlobalBindings = useCallback(async () => {
    if (!projectName || projectName === 'reader_unknown') {
      setGlobalAudioBindings({});
      return;
    }

    try {
      const data = await requestJson<{
        success?: boolean;
        roles?: GlobalAudioBindings;
      }>(
        `${API_BASE}/api/audio/global-roles?projectName=${encodeURIComponent(
          projectName,
        )}`,
      );
      if (data.success) {
        setGlobalAudioBindings(data.roles || {});
      }
    } catch (e) {
      console.warn('[NovelReaderApp] 获取全局角色绑定失败', e);
    }
  }, [projectName]);

  const fetchGenerationSettings = useCallback(async () => {
    if (!projectName || projectName === 'reader_unknown') {
      setMissingEmotionPolicy('fallback_neutral');
      return;
    }

    try {
      const data = await requestJson<{
        success?: boolean;
        settings?: {missingEmotionPolicy?: MissingEmotionPolicy};
      }>(
        `${API_BASE}/api/reader/generation-settings?projectName=${encodeURIComponent(
          projectName,
        )}`,
      );
      if (data.success && data.settings?.missingEmotionPolicy) {
        setMissingEmotionPolicy(data.settings.missingEmotionPolicy);
      }
    } catch (e) {
      console.warn('[NovelReaderApp] 获取阅读生成策略失败', e);
    }
  }, [projectName]);

  useEffect(() => {
    fetchAudioRecords();
  }, [fetchAudioRecords]);

  useEffect(() => {
    fetchGlobalBindings();
    fetchGenerationSettings();
  }, [fetchGenerationSettings, fetchGlobalBindings]);

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
        payload?.requestUrl ??
        (currentChapter
          ? `${API_BASE}/api/reader/getBookContent?url=${encodeURIComponent(
              currentChapter.bookUrl,
            )}&index=${index}`
          : '');

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

      await saveReadingRecord(record);
      setContinueReadingRecord(record);
    },
    [chapterList, currentChapterIndex, selectedBook],
  );

  const showExitPrompt = useCallback(() => {
    if (Platform.OS === 'android' && ToastAndroid?.show) {
      ToastAndroid.show('再次按下返回可退出', ToastAndroid.SHORT);
      return;
    }

    Alert.alert('提示', '再次按下返回可退出');
  }, []);

  const handleBookSelect = async (book: Book) => {
    setSelectedBook(book);
    setViewState('reader');

    try {
      const targetUrl = `${API_BASE}/api/reader/getChapterList?url=${encodeURIComponent(
        book.bookUrl,
      )}&bookSourceUrl=${encodeURIComponent(book.origin || '')}`;
      const data = await requestJson<{isSuccess?: boolean; data?: Chapter[]}>(
        targetUrl,
      );

      if (data.isSuccess && data.data) {
        setChapterList(data.data);
        if (data.data.length > 0) {
          const resumeIndex =
            continueReadingRecord?.book.bookUrl === book.bookUrl
              ? continueReadingRecord.currentChapterIndex
              : 0;
          const safeIndex = Math.min(
            Math.max(resumeIndex, 0),
            data.data.length - 1,
          );
          loadChapterContent(data.data, safeIndex, book);
        }
      } else {
        Alert.alert('获取目录失败');
      }
    } catch (e) {
      console.warn('Get chapter failed.', e);
      Alert.alert('获取目录失败', '请检查服务端是否正常运行。');
    }
  };

  const loadChapterContent = useCallback(
    async (
      list: Chapter[],
      index: number,
      book: Book | null = selectedBook,
    ) => {
      if (index < 0 || index >= list.length) {
        return;
      }

      resetListen(false);
      setIsListenMode(false);
      setCurrentChapterIndex(index);
      setContentParagraphs([]);

      const chap = list[index];
      const curProjectName = `reader_${book?.name || 'unknown'}`;

      try {
        const targetUrl = `${API_BASE}/api/reader/getBookContent?url=${encodeURIComponent(
          chap.bookUrl,
        )}&index=${index}`;
        const data = await requestJson<{isSuccess?: boolean; data?: string}>(
          targetUrl,
        );
        if (data.isSuccess && data.data) {
          const paras = data.data
            .split('\n')
            .map((p: string) => p.trim())
            .filter((p: string) => p.length > 0);
          setContentParagraphs(paras);
          await persistReadingProgress({
            book,
            list,
            index,
            requestUrl: targetUrl,
            requestBody: null,
          });
        }
      } catch (e) {
        console.warn('Get content failed.', e);
      }

      checkListenCache(curProjectName, index);
    },
    [checkListenCache, persistReadingProgress, resetListen, selectedBook],
  );

  const startListenForChapter = useCallback(
    async (index: number) => {
      const book = selectedBookRef.current;
      const list = chapterListRef.current;

      if (!book || index < 0 || index >= list.length) {
        return;
      }

      await loadChapterContent(list, index, book);
      const chapter = list[index];
      const currentProjectName = `reader_${book.name || 'unknown'}`;

      if (!chapter) {
        return;
      }

      setIsListenMode(true);
      startListening(currentProjectName, index, chapter, list);
    },
    [loadChapterContent, startListening],
  );

  const handleSourceSelect = async (source: any) => {
    setSourceModalVisible(false);
    if (!selectedBook) {
      return;
    }

    setLoadingMenuItemId('source');
    const newBook = {...selectedBook, ...source};
    setSelectedBook(newBook);

    try {
      const targetUrl = `${API_BASE}/api/reader/getChapterList?url=${encodeURIComponent(
        newBook.bookUrl,
      )}&bookSourceUrl=${encodeURIComponent(newBook.origin || '')}`;
      const data = await requestJson<{isSuccess?: boolean; data?: Chapter[]}>(
        targetUrl,
      );

      if (data.isSuccess && data.data) {
        setChapterList(data.data);
        if (data.data.length > 0) {
          const safeIndex = Math.min(
            Math.max(currentChapterIndex, 0),
            data.data.length - 1,
          );
          await loadChapterContent(data.data, safeIndex, newBook);
        }
      } else {
        Alert.alert('切换书源失败', '无法拉取新书源的章节目录');
      }
    } catch (e) {
      console.warn('Switch source failed.', e);
      Alert.alert('切换书源失败', '请检查网络或服务端是否正常运行。');
    } finally {
      setLoadingMenuItemId(null);
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
          ? `reader_${selectedBookRef.current.name || 'unknown'}`
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

  const exitReaderToHome = useCallback(async () => {
    await persistReadingProgress();
    stopPlayback();
    resetListen();
    setIsListenMode(false);
    setViewState('home');
  }, [persistReadingProgress, resetListen, stopPlayback]);

  const requestExitReaderToHome = useCallback(() => {
    exitReaderToHome().catch(error => {
      console.warn('Exit reader failed.', error);
    });
  }, [exitReaderToHome]);

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

  const handleResumeReading = async () => {
    if (!continueReadingRecord) {
      return;
    }

    await handleBookSelect(continueReadingRecord.book);
  };

  useEffect(() => {
    const handleSystemBack = () => {
      if (viewState === 'reader') {
        requestExitReaderToHome();
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
  }, [requestExitReaderToHome, showExitPrompt, viewState]);

  const handleStartListen = () => {
    if (!selectedBook) {
      return;
    }

    setIsListenMode(true);
    const curProjectName = `reader_${selectedBook.name || 'unknown'}`;
    const chapter = chapterList[currentChapterIndex];
    if (chapter) {
      startListening(curProjectName, currentChapterIndex, chapter, chapterList);
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
            ? `reader_${selectedBookRef.current.name || 'unknown'}`
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
        : normalizedBase.autoEmotionAudioMap || null;
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
      const nextSegments = segments.map((segment, segIndex) => {
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
              : null,
            manualAssigned: true,
            audioUrl: null,
            cacheKey: createSegmentCacheToken(),
            localAudioUrl: null,
            cacheState: 'idle',
            lastCacheError: null,
          };
        }

        return segment;
      });

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

  const handleMenuItemClick = useCallback((id: string) => {
    if (id === 'source') {
      setSourceModalVisible(true);
      return;
    }

    if (id === 'audio') {
      setAudioLibraryVisible(true);
    }
  }, []);

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

  return (
    <View style={styles.container}>
      {viewState === 'home' && (
        <NovelHome
          onNavigateSearch={() => setViewState('search')}
          continueReadingRecord={continueReadingRecord}
          onResumeReading={handleResumeReading}
        />
      )}

      {viewState === 'search' && (
        <NovelSearch
          onBack={() => setViewState('home')}
          onBookSelect={handleBookSelect}
        />
      )}

      {viewState === 'reader' && (
        <ActiveSegContext.Provider value={activeSegCtxValue}>
          <PlaybackProgressContext.Provider value={progressCtxValue}>
            <NovelReader
              currentChapter={chapterList[currentChapterIndex]}
              chapterList={chapterList}
              currentChapterIndex={currentChapterIndex}
              contentParagraphs={contentParagraphs}
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
              onBack={requestExitReaderToHome}
              onPrevChapter={handlePrevChapter}
              onNextChapter={handleNextChapter}
              onSelectChapter={handleSelectChapter}
              onStartListen={handleStartListen}
              onStopListen={handleStopListen}
              onSegmentEditSubmit={handleSegmentEditSubmit}
              loadingMenuItemId={loadingMenuItemId}
              onMenuItemClick={handleMenuItemClick}
            />
          </PlaybackProgressContext.Provider>
        </ActiveSegContext.Provider>
      )}

      <SourceSwitchModal
        visible={sourceModalVisible}
        currentBook={selectedBook}
        apiBase={API_BASE}
        onClose={() => setSourceModalVisible(false)}
        onSourceSelect={handleSourceSelect}
      />
      <AudioLibraryModal
        visible={audioLibraryVisible}
        apiBase={API_BASE}
        onClose={() => setAudioLibraryVisible(false)}
        onRecordsChanged={setAudioOptions}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
});

export default NovelReaderApp;
