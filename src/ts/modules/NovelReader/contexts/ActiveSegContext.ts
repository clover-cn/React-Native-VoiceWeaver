import { createContext } from 'react';

/** 低频上下文：段落索引 + 监听状态。在段落切换时变化（大约每隔几秒）。 */
export interface ActiveSegCtx {
  currentSegIdx: number;
  listenState: 'idle' | 'loading' | 'ready' | 'error';
}

export const ActiveSegContext = createContext<ActiveSegCtx>({
  currentSegIdx: -1,
  listenState: 'idle',
});

/** 高频上下文：播放进度。播放时大约每秒变化四次。 */
export interface PlaybackProgressCtx {
  currentProgress: number;
  totalDuration: number;
}

export const PlaybackProgressContext = createContext<PlaybackProgressCtx>({
  currentProgress: 0,
  totalDuration: 0,
});
