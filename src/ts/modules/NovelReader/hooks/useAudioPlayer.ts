import {useState, useCallback, useEffect, useRef, useMemo} from 'react';
import {ListenSegment} from '../types/reader';
import VideoPlayerController from '../controllers/VideoPlayerController';
import ListenAudioCacheController from '../controllers/ListenAudioCacheController';
import {API_BASE} from './useListenBook';
import {saveListenProgress} from '../utils/readerStorage';

export interface AudioChapterMetadata {
  assetId: string;
  title: string;
  author?: string;
  album?: string;
  mediaImage?: string;
}

export interface UseAudioPlayerReturn {
  isPlaying: boolean;
  currentSegIdx: number;
  currentProgress: number;
  totalDuration: number;
  togglePlayPause: () => void;
  stopPlayback: () => void;
  playFromIndex: (index: number) => void;
}

type SegmentCacheState = 'idle' | 'preloading' | 'ready' | 'failed';

interface SegmentCacheEntry {
  cacheKey: string;
  chapterAssetId: string;
  segmentIndex: number;
  remoteUrl: string;
  state: SegmentCacheState;
  localUri?: string;
  localPath?: string;
  errorMessage?: string;
}

interface CacheQueueTask {
  cacheKey: string;
  priority: number;
  execute: () => Promise<void>;
}

interface PlaybackSourceInfo {
  sourceType: 'local_cache' | 'remote_stream' | 'missing';
  resolvedUrl: string | null;
  remoteUrl: string | null;
  cacheKey?: string;
  cacheState?: SegmentCacheState;
}

const PROGRESS_SAVE_THROTTLE_MS = 5000;
const PROGRESS_UI_THROTTLE_MS = 1000;
const MAX_CONCURRENT_CACHE_DOWNLOADS = 2;
const PREFETCH_WINDOW_SIZE = 4;
const MAX_CACHED_CHAPTERS = 3;

const buildAbsoluteAudioUrl = (audioUrl?: string | null): string | null => {
  if (!audioUrl) {
    return null;
  }

  if (/^https?:\/\//.test(audioUrl)) {
    return audioUrl;
  }

  return `${API_BASE}${audioUrl}`;
};

const getAudioFileExtension = (url: string): string => {
  const cleanUrl = url.split('?')[0];
  const fileName = cleanUrl.substring(cleanUrl.lastIndexOf('/') + 1);
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex < 0 || dotIndex === fileName.length - 1) {
    return 'mp3';
  }
  return fileName.substring(dotIndex + 1).toLowerCase();
};

const simpleHash = (value: string): string => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 4294967295;
  }
  return hash.toString(16);
};

const buildSegmentCacheKey = (
  chapterAssetId: string,
  segmentIndex: number,
  remoteUrl: string,
  cacheIdentity?: string,
): string => {
  const identity =
    typeof cacheIdentity === 'string' && cacheIdentity.trim().length > 0
      ? `${remoteUrl}__${cacheIdentity.trim()}`
      : remoteUrl;
  return `${chapterAssetId}__${segmentIndex}__${simpleHash(identity)}`;
};

export const useAudioPlayer = (
  segments: ListenSegment[],
  isGenerationComplete: boolean,
  listenState: string,
  chapterMeta?: AudioChapterMetadata,
  projectName?: string,
  chapterIndex?: number,
  onChapterFinished?: () => void,
  onMissingSegmentAudio?: (segmentIndex: number) => void,
): UseAudioPlayerReturn => {
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentSegIdx, setCurrentSegIdx] = useState<number>(-1);
  const [currentProgress, setCurrentProgress] = useState<number>(0);
  const [totalDuration, setTotalDuration] = useState<number>(0);
  const [cacheEntries, setCacheEntries] = useState<
    Record<string, SegmentCacheEntry>
  >({});

  const lastSaveTimeRef = useRef<number>(0);
  const currentSegIdxRef = useRef<number>(-1);
  const currentChapterAssetIdRef = useRef<string>('');
  const isPlayingRef = useRef<boolean>(false);
  const currentProgressRef = useRef<number>(0);
  const totalDurationRef = useRef<number>(0);
  const lastProgressUiUpdateRef = useRef<number>(0);
  const lastQueueSyncKeyRef = useRef<string>('');
  const pendingManualStartIndexRef = useRef<number>(-1);
  const lastRequestedMissingSegmentRef = useRef<number>(-1);
  const cacheEntriesRef = useRef<Record<string, SegmentCacheEntry>>({});
  const pendingCachePromisesRef = useRef<
    Map<string, Promise<SegmentCacheEntry | null>>
  >(new Map());
  const cacheQueueRef = useRef<CacheQueueTask[]>([]);
  const activeCacheDownloadsRef = useRef<number>(0);
  const chapterCachedUrisRef = useRef<Map<string, Set<string>>>(new Map());
  const chapterOrderRef = useRef<string[]>([]);

  const updateCacheEntry = useCallback(
    (cacheKey: string, nextEntry: SegmentCacheEntry) => {
      setCacheEntries(prev => {
        const next = {
          ...prev,
          [cacheKey]: nextEntry,
        };
        cacheEntriesRef.current = next;
        return next;
      });
    },
    [],
  );

  const removeChapterCacheEntries = useCallback((chapterAssetId: string) => {
    setCacheEntries(prev => {
      const next = {...prev};
      Object.keys(next).forEach(cacheKey => {
        if (cacheKey.startsWith(`${chapterAssetId}__`)) {
          delete next[cacheKey];
        }
      });
      cacheEntriesRef.current = next;
      return next;
    });
  }, []);

  const cleanupEvictedChapters = useCallback(
    (chapterIds: string[]) => {
      chapterIds.forEach(chapterId => {
        const cachedUris = Array.from(
          chapterCachedUrisRef.current.get(chapterId) || [],
        );
        if (cachedUris.length > 0) {
          ListenAudioCacheController.cleanupAudioCache({
            localUris: cachedUris,
          }).catch(error => {
            console.warn(
              '[useAudioPlayer] 清理旧章节缓存失败',
              chapterId,
              error,
            );
          });
        }

        chapterCachedUrisRef.current.delete(chapterId);
        removeChapterCacheEntries(chapterId);
      });
    },
    [removeChapterCacheEntries],
  );

  useEffect(() => {
    cacheEntriesRef.current = cacheEntries;
  }, [cacheEntries]);

  useEffect(() => {
    currentSegIdxRef.current = currentSegIdx;
  }, [currentSegIdx]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    lastQueueSyncKeyRef.current = '';
    pendingManualStartIndexRef.current = -1;
    lastRequestedMissingSegmentRef.current = -1;
    currentChapterAssetIdRef.current = chapterMeta?.assetId || '';
  }, [chapterMeta?.assetId]);

  useEffect(() => {
    if (!chapterMeta?.assetId) {
      return;
    }

    const nextOrder = chapterOrderRef.current.filter(
      chapterId => chapterId !== chapterMeta.assetId,
    );
    nextOrder.push(chapterMeta.assetId);
    chapterOrderRef.current = nextOrder;

    if (nextOrder.length <= MAX_CACHED_CHAPTERS) {
      return;
    }

    const evicted = nextOrder.slice(0, nextOrder.length - MAX_CACHED_CHAPTERS);
    chapterOrderRef.current = nextOrder.slice(-MAX_CACHED_CHAPTERS);
    cleanupEvictedChapters(evicted);
  }, [chapterMeta?.assetId, cleanupEvictedChapters]);

  const persistProgress = useCallback(
    (segIdx: number, time: number) => {
      const now = Date.now();
      if (
        now - lastSaveTimeRef.current < PROGRESS_SAVE_THROTTLE_MS ||
        !projectName ||
        chapterIndex === undefined ||
        segIdx < 0
      ) {
        return;
      }

      lastSaveTimeRef.current = now;
      saveListenProgress({
        segmentIndex: segIdx,
        currentTime: time,
        chapterIndex,
        projectName,
        updatedAt: now,
      }).catch(e => console.warn('[useAudioPlayer] 保存进度失败', e));
    },
    [projectName, chapterIndex],
  );

  const pumpCacheQueue = useCallback(() => {
    while (
      activeCacheDownloadsRef.current < MAX_CONCURRENT_CACHE_DOWNLOADS &&
      cacheQueueRef.current.length > 0
    ) {
      const nextTask = cacheQueueRef.current.shift();
      if (!nextTask) {
        return;
      }

      activeCacheDownloadsRef.current += 1;
      nextTask
        .execute()
        .catch(error => {
          console.warn('[useAudioPlayer] 执行缓存任务失败', error);
        })
        .finally(() => {
          activeCacheDownloadsRef.current = Math.max(
            0,
            activeCacheDownloadsRef.current - 1,
          );
          pumpCacheQueue();
        });
    }
  }, []);

  const enqueueCacheTask = useCallback(
    (task: CacheQueueTask) => {
      const existingTaskIndex = cacheQueueRef.current.findIndex(
        item => item.cacheKey === task.cacheKey,
      );

      if (existingTaskIndex >= 0) {
        const existingTask = cacheQueueRef.current[existingTaskIndex];
        if (existingTask.priority > task.priority) {
          cacheQueueRef.current.splice(existingTaskIndex, 1, task);
        }
      } else {
        cacheQueueRef.current.push(task);
      }

      cacheQueueRef.current.sort(
        (left, right) => left.priority - right.priority,
      );
      pumpCacheQueue();
    },
    [pumpCacheQueue],
  );

  const requestSegmentCache = useCallback(
    (
      chapterAssetId: string,
      segmentIndex: number,
      segment: ListenSegment,
      priority: number,
    ): Promise<SegmentCacheEntry | null> => {
      const remoteUrl = buildAbsoluteAudioUrl(segment.audioUrl);
      if (!remoteUrl) {
        return Promise.resolve(null);
      }

      const cacheKey = buildSegmentCacheKey(
        chapterAssetId,
        segmentIndex,
        remoteUrl,
        segment.cacheKey,
      );
      const existingEntry = cacheEntriesRef.current[cacheKey];
      if (existingEntry?.state === 'ready' && existingEntry.localUri) {
        // console.log('[useAudioPlayer] 片段已命中本地缓存', {
        //   chapterAssetId,
        //   segmentIndex,
        //   cacheKey,
        //   localUri: existingEntry.localUri,
        // });
        return Promise.resolve(existingEntry);
      }

      if (existingEntry?.state === 'failed') {
        console.log('[useAudioPlayer] 片段缓存已失败，回退远端播放', {
          chapterAssetId,
          segmentIndex,
          cacheKey,
          remoteUrl,
          errorMessage: existingEntry.errorMessage,
        });
        return Promise.resolve(existingEntry);
      }

      const pendingTask = pendingCachePromisesRef.current.get(cacheKey);
      if (pendingTask) {
        return pendingTask;
      }

      updateCacheEntry(cacheKey, {
        cacheKey,
        chapterAssetId,
        segmentIndex,
        remoteUrl,
        state:
          existingEntry?.state === 'failed'
            ? existingEntry.state
            : 'preloading',
        localUri: existingEntry?.localUri,
        localPath: existingEntry?.localPath,
        errorMessage: existingEntry?.errorMessage,
      });

      const cachePromise = new Promise<SegmentCacheEntry | null>(resolve => {
        enqueueCacheTask({
          cacheKey,
          priority,
          execute: async () => {
            console.log('[useAudioPlayer] 开始缓存音频片段', {
              chapterAssetId,
              segmentIndex,
              cacheKey,
              remoteUrl,
              priority,
            });
            const result = await ListenAudioCacheController.cacheAudio({
              url: remoteUrl,
              cacheKey,
              extension: getAudioFileExtension(remoteUrl),
            });

            const nextEntry: SegmentCacheEntry = {
              cacheKey,
              chapterAssetId,
              segmentIndex,
              remoteUrl,
              state: result.success && result.localUri ? 'ready' : 'failed',
              localUri: result.localUri,
              localPath: result.localPath,
              errorMessage: result.errorMessage,
            };

            if (result.success && result.localUri) {
              const existingUris =
                chapterCachedUrisRef.current.get(chapterAssetId) || new Set();
              existingUris.add(result.localUri);
              chapterCachedUrisRef.current.set(chapterAssetId, existingUris);
              console.log('[useAudioPlayer] 音频缓存完成', {
                chapterAssetId,
                segmentIndex,
                cacheKey,
                hit: result.hit === true,
                localUri: result.localUri,
                localPath: result.localPath,
              });
            } else {
              console.warn(
                '[useAudioPlayer] 音频缓存失败，播放时将回退远端 URL',
                {
                  chapterAssetId,
                  segmentIndex,
                  cacheKey,
                  remoteUrl,
                  errorCode: result.errorCode,
                  errorMessage: result.errorMessage,
                },
              );
            }

            updateCacheEntry(cacheKey, nextEntry);
            resolve(nextEntry);
          },
        });
      });

      pendingCachePromisesRef.current.set(cacheKey, cachePromise);
      cachePromise.finally(() => {
        pendingCachePromisesRef.current.delete(cacheKey);
      });

      return cachePromise;
    },
    [enqueueCacheTask, updateCacheEntry],
  );

  const getSegmentCacheEntry = useCallback(
    (chapterAssetId: string, index: number, segment: ListenSegment) => {
      const remoteUrl = buildAbsoluteAudioUrl(segment.audioUrl);
      if (!remoteUrl) {
        return null;
      }
      const cacheKey = buildSegmentCacheKey(
        chapterAssetId,
        index,
        remoteUrl,
        segment.cacheKey,
      );
      return cacheEntriesRef.current[cacheKey] || null;
    },
    [],
  );

  const getSegmentPlaybackSource = useCallback(
    (
      chapterAssetId: string,
      index: number,
      segment: ListenSegment,
    ): PlaybackSourceInfo => {
      const remoteUrl = buildAbsoluteAudioUrl(segment.audioUrl);
      if (!remoteUrl) {
        return {
          sourceType: 'missing',
          resolvedUrl: null,
          remoteUrl: null,
        };
      }

      const cacheKey = buildSegmentCacheKey(
        chapterAssetId,
        index,
        remoteUrl,
        segment.cacheKey,
      );
      const cacheEntry = cacheEntriesRef.current[cacheKey];
      if (cacheEntry?.state === 'ready' && cacheEntry.localUri) {
        return {
          sourceType: 'local_cache',
          resolvedUrl: cacheEntry.localUri,
          remoteUrl,
          cacheKey,
          cacheState: cacheEntry.state,
        };
      }

      return {
        sourceType: 'remote_stream',
        resolvedUrl: remoteUrl,
        remoteUrl,
        cacheKey,
        cacheState: cacheEntry?.state,
      };
    },
    [],
  );

  const resolveSegmentPlaybackUrl = useCallback(
    (chapterAssetId: string, index: number, segment: ListenSegment) => {
      const remoteUrl = buildAbsoluteAudioUrl(segment.audioUrl);
      if (!remoteUrl) {
        return null;
      }

      const cacheEntry = getSegmentCacheEntry(chapterAssetId, index, segment);
      if (cacheEntry?.state === 'ready' && cacheEntry.localUri) {
        return cacheEntry.localUri;
      }

      return remoteUrl;
    },
    [getSegmentCacheEntry],
  );

  const canStartPlaybackAtIndex = useCallback(
    (index: number): boolean => {
      if (!chapterMeta || index < 0 || index >= segments.length) {
        return false;
      }

      const remoteUrl = buildAbsoluteAudioUrl(segments[index]?.audioUrl);
      if (!remoteUrl) {
        return false;
      }

      const cacheEntry = getSegmentCacheEntry(
        chapterMeta.assetId,
        index,
        segments[index],
      );
      if (!cacheEntry) {
        return false;
      }

      if (cacheEntry.state === 'ready' && cacheEntry.localUri) {
        return true;
      }

      return cacheEntry.state === 'failed';
    },
    [chapterMeta, getSegmentCacheEntry, segments],
  );

  const prefetchWindow = useCallback(
    (startIndex: number) => {
      if (!chapterMeta || startIndex < 0) {
        return;
      }

      const endIndex = Math.min(
        segments.length - 1,
        startIndex + PREFETCH_WINDOW_SIZE - 1,
      );

      for (let index = startIndex; index <= endIndex; index += 1) {
        const segment = segments[index];
        if (!segment?.audioUrl) {
          continue;
        }

        requestSegmentCache(
          chapterMeta.assetId,
          index,
          segment,
          index - startIndex,
        );
      }
    },
    [chapterMeta, requestSegmentCache, segments],
  );

  const buildQueuePayload = useCallback(
    (
      startIndex?: number,
      autoPlay?: boolean,
      isExplicitStart: boolean = false,
    ) => {
      if (!chapterMeta) {
        return null;
      }

      const nativeSegments = segments.map((segment, index) => ({
        id: `${chapterMeta.assetId}_${index}_${
          typeof segment.cacheKey === 'string' && segment.cacheKey.trim().length
            ? segment.cacheKey.trim()
            : 'nocache'
        }`,
        url: resolveSegmentPlaybackUrl(chapterMeta.assetId, index, segment),
        title: `${chapterMeta.title}_${index + 1}`,
      }));

      if (nativeSegments.length === 0) {
        return null;
      }

      return {
        chapterAssetId: chapterMeta.assetId,
        title: chapterMeta.title,
        author: chapterMeta.author,
        album: chapterMeta.album,
        mediaImage: chapterMeta.mediaImage,
        segments: nativeSegments,
        startIndex,
        isExplicitStart,
        autoPlay,
        isGenerationComplete,
      };
    },
    [chapterMeta, isGenerationComplete, resolveSegmentPlaybackUrl, segments],
  );

  const queueSyncKey = useMemo(() => {
    const assetId = chapterMeta?.assetId || 'unknown';
    const queueSignature = segments
      .map((segment, index) => {
        const remoteUrl = buildAbsoluteAudioUrl(segment.audioUrl);
        const cacheIdentity =
          typeof segment.cacheKey === 'string' ? segment.cacheKey.trim() : '';
        if (!remoteUrl) {
          return `${index}:pending:${cacheIdentity}`;
        }

        const cacheKey = buildSegmentCacheKey(
          assetId,
          index,
          remoteUrl,
          segment.cacheKey,
        );
        const cacheEntry = cacheEntries[cacheKey];
        return `${index}:${cacheIdentity}:${cacheEntry?.state || 'idle'}:${
          cacheEntry?.localUri || remoteUrl
        }`;
      })
      .join('|');
    const generationState = isGenerationComplete ? 'done' : 'pending';
    return `${assetId}|${generationState}|${queueSignature}`;
  }, [cacheEntries, chapterMeta?.assetId, isGenerationComplete, segments]);

  const stopPlayback = useCallback(() => {
    setIsPlaying(false);
    setCurrentSegIdx(-1);
    setCurrentProgress(0);
    setTotalDuration(0);
    isPlayingRef.current = false;
    currentSegIdxRef.current = -1;
    currentChapterAssetIdRef.current = '';
    currentProgressRef.current = 0;
    totalDurationRef.current = 0;
    lastProgressUiUpdateRef.current = 0;
    lastQueueSyncKeyRef.current = '';
    pendingManualStartIndexRef.current = -1;
    lastRequestedMissingSegmentRef.current = -1;
    VideoPlayerController.stop();
  }, []);

  const playFromIndex = useCallback(
    (index: number) => {
      if (index < 0 || index >= segments.length || !chapterMeta) {
        return;
      }

      const sourceInfo = getSegmentPlaybackSource(
        chapterMeta.assetId,
        index,
        segments[index],
      );
      console.log('[useAudioPlayer] 请求从片段开始播放', {
        chapterAssetId: chapterMeta.assetId,
        segmentIndex: index,
        sourceType: sourceInfo.sourceType,
        resolvedUrl: sourceInfo.resolvedUrl,
        remoteUrl: sourceInfo.remoteUrl,
        cacheKey: sourceInfo.cacheKey,
        cacheState: sourceInfo.cacheState,
      });

      currentChapterAssetIdRef.current = chapterMeta.assetId;
      pendingManualStartIndexRef.current = index;
      prefetchWindow(index);

      const payload = buildQueuePayload(
        index,
        canStartPlaybackAtIndex(index),
        true,
      );
      if (!payload) {
        return;
      }

      VideoPlayerController.loadQueue(payload);
    },
    [
      buildQueuePayload,
      canStartPlaybackAtIndex,
      chapterMeta,
      getSegmentPlaybackSource,
      prefetchWindow,
      segments,
    ],
  );

  const togglePlayPause = useCallback(() => {
    if (isPlayingRef.current) {
      VideoPlayerController.pause();
      return;
    }

    if (currentSegIdxRef.current === -1) {
      playFromIndex(0);
      return;
    }

    VideoPlayerController.play();
  }, [playFromIndex]);

  useEffect(() => {
    const unsubscribe = VideoPlayerController.onPlaybackState(payload => {
      const nextSegIdx =
        payload.currentIndex >= 0 && payload.currentIndex < segments.length
          ? payload.currentIndex
          : -1;
      const nextProgress = payload.positionMs / 1000;
      const nextDuration = payload.durationMs / 1000;
      const nextIsPlaying =
        payload.state === 'playing' || payload.state === 'loading';
      const now = Date.now();
      const segChanged = currentSegIdxRef.current !== nextSegIdx;
      const playingChanged = isPlayingRef.current !== nextIsPlaying;
      const durationChanged =
        Math.abs(totalDurationRef.current - nextDuration) >= 0.1;
      const shouldUpdateProgress =
        segChanged ||
        playingChanged ||
        Math.abs(currentProgressRef.current - nextProgress) >= 0.25 ||
        now - lastProgressUiUpdateRef.current >= PROGRESS_UI_THROTTLE_MS;

      if (segChanged) {
        currentSegIdxRef.current = nextSegIdx;
        setCurrentSegIdx(nextSegIdx);
        if (nextSegIdx !== lastRequestedMissingSegmentRef.current) {
          lastRequestedMissingSegmentRef.current = -1;
        }
        if (nextSegIdx >= 0) {
          const activeSegment = segments[nextSegIdx];
          if (chapterMeta && activeSegment) {
            const sourceInfo = getSegmentPlaybackSource(
              chapterMeta.assetId,
              nextSegIdx,
              activeSegment,
            );
            console.log('[useAudioPlayer] 当前播放片段来源', {
              chapterAssetId: chapterMeta.assetId,
              segmentIndex: nextSegIdx,
              sourceType: sourceInfo.sourceType,
              resolvedUrl: sourceInfo.resolvedUrl,
              remoteUrl: sourceInfo.remoteUrl,
              cacheKey: sourceInfo.cacheKey,
              cacheState: sourceInfo.cacheState,
            });
          }
          prefetchWindow(nextSegIdx);
        }
      }

      if (payload.currentIndex >= 0) {
        pendingManualStartIndexRef.current = -1;
      }

      if (durationChanged) {
        totalDurationRef.current = nextDuration;
        setTotalDuration(nextDuration);
      }

      if (playingChanged) {
        isPlayingRef.current = nextIsPlaying;
        setIsPlaying(nextIsPlaying);
      }

      if (shouldUpdateProgress) {
        currentProgressRef.current = nextProgress;
        lastProgressUiUpdateRef.current = now;
        setCurrentProgress(nextProgress);
      }

      if (nextSegIdx >= 0) {
        persistProgress(nextSegIdx, nextProgress);
      }

      if (
        payload.state === 'waiting' &&
        nextSegIdx >= 0 &&
        !segments[nextSegIdx]?.audioUrl &&
        lastRequestedMissingSegmentRef.current !== nextSegIdx
      ) {
        lastRequestedMissingSegmentRef.current = nextSegIdx;
        onMissingSegmentAudio?.(nextSegIdx);
      }

      if (
        payload.chapterFinished &&
        payload.chapterAssetId &&
        payload.chapterAssetId === currentChapterAssetIdRef.current
      ) {
        onChapterFinished?.();
      }
    });

    return unsubscribe;
  }, [
    onChapterFinished,
    chapterMeta,
    getSegmentPlaybackSource,
    onMissingSegmentAudio,
    persistProgress,
    prefetchWindow,
    segments,
  ]);

  useEffect(() => {
    if (listenState !== 'ready') {
      return;
    }

    const preferredStartIndex =
      pendingManualStartIndexRef.current >= 0
        ? pendingManualStartIndexRef.current
        : currentSegIdxRef.current >= 0
        ? currentSegIdxRef.current
        : segments.length > 0
        ? 0
        : -1;

    if (preferredStartIndex >= 0) {
      prefetchWindow(preferredStartIndex);
    }
  }, [
    chapterMeta?.assetId,
    currentSegIdx,
    listenState,
    prefetchWindow,
    segments.length,
  ]);

  useEffect(() => {
    if (listenState !== 'ready') {
      return;
    }

    if (
      lastRequestedMissingSegmentRef.current >= 0 &&
      segments[lastRequestedMissingSegmentRef.current]?.audioUrl &&
      chapterMeta
    ) {
      const missingIndex = lastRequestedMissingSegmentRef.current;
      lastRequestedMissingSegmentRef.current = -1;
      requestSegmentCache(
        chapterMeta.assetId,
        missingIndex,
        segments[missingIndex],
        0,
      );
    }

    const hasManualStart = pendingManualStartIndexRef.current >= 0;
    const shouldAutoStart =
      currentSegIdxRef.current === -1 && !isPlayingRef.current;
    const startIndex = hasManualStart
      ? pendingManualStartIndexRef.current
      : shouldAutoStart
      ? 0
      : undefined;
    const autoPlay =
      startIndex !== undefined && (hasManualStart || shouldAutoStart)
        ? canStartPlaybackAtIndex(startIndex)
        : undefined;
    const payload = buildQueuePayload(startIndex, autoPlay, hasManualStart);

    if (!payload) {
      return;
    }

    if (lastQueueSyncKeyRef.current === queueSyncKey) {
      return;
    }

    lastQueueSyncKeyRef.current = queueSyncKey;
    currentChapterAssetIdRef.current = payload.chapterAssetId;
    VideoPlayerController.loadQueue(payload);
  }, [
    buildQueuePayload,
    canStartPlaybackAtIndex,
    chapterMeta,
    listenState,
    queueSyncKey,
    requestSegmentCache,
    segments,
  ]);

  return {
    isPlaying,
    currentSegIdx,
    currentProgress,
    totalDuration,
    togglePlayPause,
    stopPlayback,
    playFromIndex,
  };
};
