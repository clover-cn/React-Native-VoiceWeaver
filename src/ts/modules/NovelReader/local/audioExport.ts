import {ListenSegment} from '../types/reader';

/** 导出输入仅包含本机音频与角色，不携带正文或模型配置。 */
export function exportSegments(segments: ListenSegment[]) {
  return segments.map(segment => ({
    uri: segment.localAudioUrl || segment.audioUrl || '',
    role: segment.role || '旁白',
  }));
}

export function parseExportGap(value: string): number | null {
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(value)) {
    return null;
  }
  const seconds = Number(value);
  return seconds <= 30 ? seconds : null;
}

export function exportFileName(
  book: string,
  chapter: string,
  mode: 'zip' | 'wav',
) {
  const clean = (text: string) =>
    text
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
      .replace(/[. ]+$/g, '')
      .slice(0, 60);
  return `${clean(book) || '书籍'}_${clean(chapter) || '章节'}${
    mode === 'zip' ? '_分段.zip' : '.wav'
  }`;
}

export interface ExportStatus {
  stage:
    | 'checking'
    | 'processing'
    | 'ready'
    | 'saving'
    | 'saved'
    | 'cancelled'
    | 'error';
  done: number;
  total: number;
  error?: string;
}
