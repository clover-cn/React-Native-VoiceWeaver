/** 听书常用档位：低倍速便于细听，1.2–1.5 提供细调。 */
export const PLAYBACK_RATES = [0.8, 1, 1.2, 1.3, 1.4, 1.5, 1.75, 2] as const;
export const normalizePlaybackRate = (value: unknown): number =>
  typeof value === 'number' && PLAYBACK_RATES.some(rate => rate === value)
    ? value
    : 1;
export const formatPlaybackRate = (value: number): string =>
  `${Number.isInteger(value) ? value.toFixed(1) : value}×`;
