import {useState, useEffect, useCallback, useRef} from 'react';
import {DeviceEventEmitter} from 'react-native';
import {ConfigurationError} from '../local/config';
import {ListenBookGeneratePayload, ListenSegment} from '../types/reader';
import {
  areListenSegmentsFullyPlayable,
  createTextHash,
  createListenSessionId,
  hasPlayableListenAudio,
  normalizeChapterTextForRequest,
  translateListenPhase,
} from '../utils/listenBook';
import {
  generateChapter,
  checkChapter,
  cancelGeneration,
  subscribeTasks,
  getTask,
  TaskSnapshot,
  getActiveChapterTask,
} from '../local/engine';

export type AbortSignalLike = {
  aborted?: boolean;
  addEventListener?: (type: 'abort', listener: () => void) => void;
  removeEventListener?: (type: 'abort', listener: () => void) => void;
};
export type TimeoutRequestInit = RequestInit & {signal?: AbortSignalLike};
/** 超时与用户取消均真正中止底层请求。 */
export async function fetchWithTimeout(
  url: string,
  options?: TimeoutRequestInit,
  timeoutMs = 15000,
): Promise<Response> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (options?.signal?.aborted) {
    throw new Error('请求已取消');
  }
  options?.signal?.addEventListener?.('abort', cancel);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(url, {...options, signal: controller.signal});
  } catch (error) {
    if (timedOut) {
      throw new Error('请求超时');
    }
    throw error;
  } finally {
    clearTimeout(timer);
    options?.signal?.removeEventListener?.('abort', cancel);
  }
}
export interface UseListenBookReturn {
  getListenerId: (projectName?: string) => string;
  taskPhase: string;
  listenState: 'idle' | 'loading' | 'ready' | 'error';
  listenPhase: string;
  listenError: string;
  segments: ListenSegment[];
  isGenerationComplete: boolean;
  startListening: (
    project: string,
    index: number,
    payload: ListenBookGeneratePayload,
    continueActiveTask?: boolean,
  ) => Promise<void>;
  resetListen: (skipCancel?: boolean) => void;
  checkListenCache: (
    project: string,
    index: number,
    chapterText?: string,
  ) => Promise<{cached: boolean; inProgress: boolean}>;
  replaceSegments: (nextSegments: ListenSegment[]) => void;
  restoreListenCache: (nextSegments: ListenSegment[]) => void;
  updateListenRuntime: (
    nextState: 'idle' | 'loading' | 'ready' | 'error',
    generationComplete?: boolean,
    phase?: string,
  ) => void;
  cancelListenTask: (projectName?: string) => Promise<void>;
}

export const useListenBook = (): UseListenBookReturn => {
  const [taskPhase, setTaskPhase] = useState('');
  const [listenState, setListenState] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle');
  const [listenPhase, setListenPhase] = useState('');
  const [listenError, setListenError] = useState('');
  const [segments, setSegments] = useState<ListenSegment[]>([]);
  const [isGenerationComplete, setIsGenerationComplete] = useState(false);
  const context = useRef({
    project: '',
    chapter: -1,
    taskId: '',
    epoch: 0,
    stopped: true,
    listener: createListenSessionId(),
  });
  const apply = useCallback((task: TaskSnapshot) => {
    if (context.current.taskId !== task.id) {
      if (
        task.projectName === context.current.project &&
        task.chapterIndex === context.current.chapter &&
        getTask(context.current.taskId)?.phase === 'paused'
      ) {
        context.current.taskId = task.id;
      } else {
        return;
      }
    }
    setTaskPhase(task.phase);
    setListenPhase(translateListenPhase(task.phase));
    setSegments(task.segments);
    const playable = task.segments.some(hasPlayableListenAudio);
    setIsGenerationComplete(
      task.phase === 'done' && areListenSegmentsFullyPlayable(task.segments),
    );
    if (
      task.phase === 'error' ||
      task.phase === 'cancelled' ||
      task.phase === 'paused'
    ) {
      setListenState(playable ? 'ready' : 'error');
      setListenError(task.error || '生成已中断，重新开始可继续未完成片段。');
    } else if (task.phase === 'done') {
      setListenState(playable ? 'ready' : 'error');
      setListenError(playable ? '' : '生成结束，但没有可播放片段。');
    } else {
      setListenState(playable ? 'ready' : 'loading');
      setListenError('');
    }
  }, []);
  useEffect(() => subscribeTasks(apply), [apply]);
  const getListenerId = useCallback((project?: string) => {
    if (project) {
      context.current.project = project;
    }
    return context.current.listener;
  }, []);
  const cancelListenTask = useCallback(async (project?: string) => {
    context.current.stopped = true;
    context.current.epoch++;
    cancelGeneration(
      project || context.current.project || undefined,
      undefined,
      '页面重置、章节切换或停止听书',
    );
    context.current.taskId = '';
    context.current.listener = createListenSessionId();
  }, []);
  const resetListen = useCallback(
    (skipCancel = false) => {
      if (!skipCancel) {
        void cancelListenTask();
      }
      setListenState('idle');
      setListenPhase('');
      setListenError('');
      setSegments([]);
      setIsGenerationComplete(false);
      setTaskPhase('');
    },
    [cancelListenTask],
  );
  const replaceSegments = useCallback(
    (value: ListenSegment[]) => setSegments(value),
    [],
  );
  const restoreListenCache = useCallback((value: ListenSegment[]) => {
    setSegments(value);
    setListenState('ready');
    setListenError('');
    setIsGenerationComplete(areListenSegmentsFullyPlayable(value));
  }, []);
  const updateListenRuntime = useCallback(
    (
      state: 'idle' | 'loading' | 'ready' | 'error',
      complete = false,
      phase = '',
    ) => {
      setListenState(state);
      setIsGenerationComplete(complete);
      setListenPhase(phase);
      if (state !== 'error') {
        setListenError('');
      }
    },
    [],
  );
  const checkListenCache = useCallback(
    async (project: string, chapter: number, text?: string) => {
      const epoch = context.current.epoch;
      const data = await checkChapter(
        project,
        chapter,
        text ? createTextHash(normalizeChapterTextForRequest(text)) : undefined,
      );
      if (epoch !== context.current.epoch) {
        return {cached: false, inProgress: false};
      }
      context.current.project = project;
      context.current.chapter = chapter;
      context.current.taskId = data.taskId || '';
      setSegments(data.segments);
      setIsGenerationComplete(data.exists);
      return {cached: data.exists, inProgress: data.inProgress};
    },
    [],
  );
  const startListening = useCallback(
    async (
      project: string,
      chapter: number,
      payload: ListenBookGeneratePayload,
      continueActiveTask = false,
    ) => {
      // 退出后到达的原生 waiting 回调不得重新启动听书。
      if (continueActiveTask && context.current.stopped) {
        return;
      }
      if (!continueActiveTask) {
        context.current.stopped = false;
      }
      if (
        continueActiveTask &&
        getActiveChapterTask(project, chapter)?.id === context.current.taskId
      ) {
        return;
      }
      const epoch = ++context.current.epoch;
      context.current.project = project;
      context.current.chapter = chapter;
      setListenState('loading');
      setListenError('');
      try {
        const running = continueActiveTask
          ? getActiveChapterTask(project, chapter)
          : undefined;
        const task =
          running || (await generateChapter(project, chapter, payload));
        if (epoch !== context.current.epoch) {
          return;
        }
        context.current.taskId = task.id;
        apply(getTask(task.id) || task);
      } catch (error) {
        if (epoch === context.current.epoch) {
          setListenState('error');
          setListenError(error instanceof Error ? error.message : '启动失败');
          if (error instanceof ConfigurationError) {
            DeviceEventEmitter.emit('VoiceWeaverOpenSettings', error.group);
          }
        }
      }
    },
    [apply],
  );
  return {
    getListenerId,
    taskPhase,
    listenState,
    listenPhase,
    listenError,
    segments,
    isGenerationComplete,
    startListening,
    resetListen,
    checkListenCache,
    replaceSegments,
    restoreListenCache,
    updateListenRuntime,
    cancelListenTask,
  };
};
