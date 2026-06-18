import {useCallback, useEffect, useRef, useState} from 'react';

/**
 * 定时关闭模式：
 *  - 'off'       关闭（默认）
 *  - 'duration'  固定时长，到点暂停
 */
export type SleepTimerMode = 'off' | 'duration';

export interface SleepTimerInfo {
  mode: SleepTimerMode;
  /** duration 模式下：剩余毫秒数（每秒递减） */
  remainingMs: number;
  /** duration 模式下：用户最初选择的总毫秒数（用于 UI 选中态匹配） */
  totalMs: number;
}

export interface UseSleepTimerOptions {
  /** 触发暂停的回调（duration 到点时调用）。 */
  onTrigger: () => void;
  /** 当前是否在播放；duration 模式下仅播放时计时。 */
  isPlaying: boolean;
}

export interface UseSleepTimerReturn {
  info: SleepTimerInfo;
  setDuration: (ms: number) => void;
  clear: () => void;
}

const TICK_INTERVAL_MS = 1000;

/**
 * 听书定时关闭 hook（仅时长模式）。
 *
 * - 用 setInterval 每秒递减 remainingMs，到 0 触发 onTrigger 并自动关闭。
 *   仅在 isPlaying=true 时计时，pause 时停摆，恢复后续算（与主流听书 App 一致）。
 *
 * 注意：本 hook 仅在 App 进程存活期间计时，行业惯例不做跨进程持久化。
 */
export const useSleepTimer = ({
  onTrigger,
  isPlaying,
}: UseSleepTimerOptions): UseSleepTimerReturn => {
  const [info, setInfo] = useState<SleepTimerInfo>({
    mode: 'off',
    remainingMs: 0,
    totalMs: 0,
  });

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onTriggerRef = useRef(onTrigger);

  useEffect(() => {
    onTriggerRef.current = onTrigger;
  }, [onTrigger]);

  const stopInterval = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const clear = useCallback(() => {
    stopInterval();
    setInfo({mode: 'off', remainingMs: 0, totalMs: 0});
  }, [stopInterval]);

  const setDuration = useCallback(
    (ms: number) => {
      stopInterval();
      if (ms <= 0) {
        setInfo({mode: 'off', remainingMs: 0, totalMs: 0});
        return;
      }
      setInfo({mode: 'duration', remainingMs: ms, totalMs: ms});
    },
    [stopInterval],
  );

  // duration 模式：每秒递减；仅播放时计时
  useEffect(() => {
    if (info.mode !== 'duration') {
      stopInterval();
      return;
    }
    if (!isPlaying) {
      stopInterval();
      return;
    }
    intervalRef.current = setInterval(() => {
      setInfo(prev => {
        if (prev.mode !== 'duration') {
          return prev;
        }
        const next = prev.remainingMs - TICK_INTERVAL_MS;
        if (next <= 0) {
          onTriggerRef.current();
          return {mode: 'off', remainingMs: 0, totalMs: 0};
        }
        return {...prev, remainingMs: next};
      });
    }, TICK_INTERVAL_MS);

    return stopInterval;
  }, [info.mode, isPlaying, stopInterval]);

  // 卸载时清理 interval
  useEffect(() => stopInterval, [stopInterval]);

  return {
    info,
    setDuration,
    clear,
  };
};
