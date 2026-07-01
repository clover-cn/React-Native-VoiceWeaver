import {useState, useEffect, useCallback, useRef} from 'react';
import {ListenBookGeneratePayload, ListenSegment} from '../types/reader';
import {
  createTextHash,
  normalizeChapterTextForRequest,
} from '../utils/listenBook';

export type AbortSignalLike = {
  aborted?: boolean;
  addEventListener?: (type: 'abort', listener: () => void) => void;
  removeEventListener?: (type: 'abort', listener: () => void) => void;
};

export type TimeoutRequestInit = RequestInit & {
  signal?: AbortSignalLike;
};

// ⚠️ 重要：模拟器/真机上 localhost 指向设备自身，必须改为开发电脑的局域网IP
// 例如：'http://192.168.1.100:3000'
// 可以在电脑终端执行 ipconfig (Windows) 或 ifconfig (Mac/Linux) 查看
export const API_BASE = 'https://tts.webpv.cn';

// 带超时保护的 fetch，防止网络不可达时阻塞主线程导致 ANR 闪退
export const fetchWithTimeout = (
  url: string,
  options?: TimeoutRequestInit,
  timeoutMs: number = 15000,
): Promise<Response> => {
  return new Promise((resolve, reject) => {
    const signal = options?.signal;
    if (signal?.aborted) {
      reject(new Error(`请求已取消: ${url}`));
      return;
    }

    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      cleanup();
      reject(new Error(`请求超时 (${timeoutMs}ms): ${url}`));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', handleAbort);
    };

    const handleAbort = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(new Error(`请求已取消: ${url}`));
    };

    signal?.addEventListener?.('abort', handleAbort);

    fetch(url, options)
      .then(res => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(res);
      })
      .catch(err => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(err);
      });
  });
};

const mergePolledSegments = (
  prevSegments: ListenSegment[],
  nextSegments: ListenSegment[],
): ListenSegment[] => {
  if (nextSegments.length < prevSegments.length) {
    return prevSegments;
  }

  if (JSON.stringify(prevSegments) === JSON.stringify(nextSegments)) {
    return prevSegments;
  }

  return nextSegments;
};

export interface UseListenBookReturn {
  listenState: 'idle' | 'loading' | 'ready' | 'error';
  listenPhase: string;
  segments: ListenSegment[];
  isGenerationComplete: boolean;
  startListening: (
    project: string,
    index: number,
    payload: ListenBookGeneratePayload,
  ) => void;
  resetListen: (skipCancel?: boolean) => void;
  checkListenCache: (
    project: string,
    index: number,
    chapterText?: string,
  ) => void;
  replaceSegments: (nextSegments: ListenSegment[]) => void;
  updateListenRuntime: (
    nextState: 'idle' | 'loading' | 'ready' | 'error',
    generationComplete?: boolean,
    phase?: string,
  ) => void;
  cancelListenTask: (projectName?: string) => Promise<void>;
}

export const useListenBook = (): UseListenBookReturn => {
  const [listenState, setListenState] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle');
  const [listenPhase, setListenPhase] = useState<string>('');
  const [segments, setSegments] = useState<ListenSegment[]>([]);
  const [isGenerationComplete, setIsGenerationComplete] =
    useState<boolean>(false);

  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const listenTaskIdRef = useRef<string | null>(null);
  const curProjectRef = useRef<string>('');
  const cachedListenStateRef = useRef<'idle' | 'loading' | 'ready'>('idle');

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const cancelListenTask = useCallback(
    async (projectName?: string) => {
      const targetProject = projectName || curProjectRef.current;
      stopPolling();
      listenTaskIdRef.current = null;

      if (!targetProject) {
        return;
      }

      try {
        await fetchWithTimeout(`${API_BASE}/api/listen-book/cancel`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({projectName: targetProject}),
        });
      } catch (e) {
        console.warn('Cancel req failed', e);
      }
    },
    [stopPolling],
  );

  const resetListen = useCallback(
    (skipCancel = false) => {
      stopPolling();
      if (!skipCancel && curProjectRef.current) {
        fetchWithTimeout(`${API_BASE}/api/listen-book/cancel`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({projectName: curProjectRef.current}),
        }).catch(e => console.warn('Cancel req failed', e));
      }

      setListenState('idle');
      setListenPhase('');
      setSegments([]);
      setIsGenerationComplete(false);
      listenTaskIdRef.current = null;
      curProjectRef.current = '';
      cachedListenStateRef.current = 'idle';
    },
    [stopPolling],
  );

  const replaceSegments = useCallback((nextSegments: ListenSegment[]) => {
    setSegments(nextSegments);
  }, []);

  const updateListenRuntime = useCallback(
    (
      nextState: 'idle' | 'loading' | 'ready' | 'error',
      generationComplete = false,
      phase = '',
    ) => {
      setListenState(nextState);
      setIsGenerationComplete(generationComplete);
      setListenPhase(phase);
      cachedListenStateRef.current =
        nextState === 'ready'
          ? 'ready'
          : nextState === 'loading'
          ? 'loading'
          : 'idle';
    },
    [],
  );

  const startPolling = useCallback(
    (taskId: string) => {
      stopPolling();

      pollTimerRef.current = setInterval(async () => {
        try {
          const res = await fetchWithTimeout(
            `${API_BASE}/api/listen-book/status/${taskId}`,
          );
          const data = await res.json();

          const {phase, segments: segs, error} = data;
          setListenPhase(phase);

          if (Array.isArray(segs) && segs.length > 0) {
            setSegments(prev => mergePolledSegments(prev, segs));
          }

          const hasPlayableSegment =
            Array.isArray(segs) &&
            segs.some((segment: ListenSegment) => !!segment?.audioUrl);

          if (hasPlayableSegment) {
            cachedListenStateRef.current = 'ready';
            setListenState(prev => (prev === 'loading' ? 'ready' : prev));
          }

          if (phase === 'done') {
            stopPolling();
            if (Array.isArray(segs)) {
              setSegments(segs);
            }
            setIsGenerationComplete(true);
            cachedListenStateRef.current = 'ready';
            setListenState('ready'); // 确保能触发播放
          } else if (phase === 'error') {
            stopPolling();
            cachedListenStateRef.current = 'idle';
            setListenState('error');
            console.error('生成报错:', error);
          }
        } catch (err) {
          console.warn('Status poll exception', err);
        }
      }, 2000);
    },
    [stopPolling],
  );

  const checkListenCache = useCallback(
    async (projectName: string, chapterIndex: number, chapterText?: string) => {
      curProjectRef.current = projectName;
      try {
        const normalizedText = normalizeChapterTextForRequest(chapterText);
        const res = await fetchWithTimeout(
          `${API_BASE}/api/listen-book/check`,
          {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
              projectName,
              chapterIndex,
              ...(normalizedText
                ? {contentHash: createTextHash(normalizedText)}
                : {}),
            }),
          },
        );
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data?.error || `缓存检查失败(${res.status})`);
        }

        if (data.exists) {
          setSegments(data.segments);
          setIsGenerationComplete(true);
          cachedListenStateRef.current = 'ready';
        } else if (data.inProgress && data.taskId) {
          listenTaskIdRef.current = data.taskId;
          cachedListenStateRef.current = 'loading';
        }
      } catch (e) {
        console.warn('Check cache failed', e);
      }
    },
    [],
  );

  const startListening = useCallback(
    async (
      projectName: string,
      chapterIndex: number,
      payload: ListenBookGeneratePayload,
    ) => {
      curProjectRef.current = projectName;
      const chapterText = normalizeChapterTextForRequest(payload.chapterText);

      if (!chapterText) {
        setListenState('error');
        cachedListenStateRef.current = 'idle';
        console.warn('Trigger listening skipped: empty chapter text');
        return;
      }

      if (cachedListenStateRef.current === 'ready' && segments.length > 0) {
        setListenState('ready');
        return;
      }

      if (
        cachedListenStateRef.current === 'loading' &&
        listenTaskIdRef.current
      ) {
        setListenState('loading');
        setListenPhase('waiting');
        startPolling(listenTaskIdRef.current);
        return;
      }

      setListenState('loading');
      setListenPhase('waiting');
      cachedListenStateRef.current = 'loading';

      try {
        const res = await fetchWithTimeout(
          `${API_BASE}/api/listen-book/generate`,
          {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
              projectName,
              chapterIndex,
              chapterTitle: payload.chapterTitle || '',
              chapterText,
              prescanTexts: payload.prescanTexts || [],
            }),
          },
        );
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data?.error || `启动听书失败(${res.status})`);
        }

        if (data.alreadyDone) {
          listenTaskIdRef.current = data.taskId || null;
          setSegments(data.segments || []);
          setIsGenerationComplete(true);
          setListenState('ready');
          cachedListenStateRef.current = 'ready';
          return;
        }

        listenTaskIdRef.current = data.taskId;
        startPolling(data.taskId);
      } catch (e) {
        console.error('Trigger listening failed', e);
        setListenState('error');
      }
    },
    [segments.length, startPolling],
  );

  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  return {
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
  };
};
