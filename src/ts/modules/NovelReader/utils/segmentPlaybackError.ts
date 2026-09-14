/** 在进入播放器前识别确定不可播放的片段，普通网络缓存失败仍可回退远端。 */
export const getSegmentPlaybackError = (
  text: string,
  cacheErrorCode?: string,
): string | undefined => {
  if (!text.replace(/[\p{P}\p{S}\p{Z}\p{Cf}\s]/gu, '').length) {
    return '片段仅含标点、符号或空白';
  }
  if (cacheErrorCode === 'EMPTY_FILE') {
    return '音频文件为空';
  }
  return undefined;
};
