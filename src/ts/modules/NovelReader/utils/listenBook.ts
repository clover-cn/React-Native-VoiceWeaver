import {Book} from '../types/reader';

const CryptoJS = require('crypto-js');

export const createTextHash = (text: string): string => {
  return CryptoJS.SHA256(String(text || '')).toString(CryptoJS.enc.Hex);
};

export const sanitizeListenProjectPart = (value?: string | null): string => {
  return String(value || '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ');
};

export const buildListenProjectName = (book?: Book | null): string => {
  const name = sanitizeListenProjectPart(book?.name) || 'unknown';
  const author = sanitizeListenProjectPart(book?.author);
  return author ? `reader_${name}__${author}` : `reader_${name}`;
};

export const normalizeChapterTextForRequest = (text?: string | null) => {
  return String(text || '').trim();
};

// 后端 listen-book/status 返回的 phase key → 前端展示文案
// 后端返回英文 key（如 'prescan'/'parse'/'assign'/'tts'），前端翻译成中文再展示
const LISTEN_PHASE_TEXT_MAP: Record<string, string> = {
  waiting: '准备中…',
  prescan: '正在预扫描章节角色…',
  parse: '正在分析剧情对话…',
  assign: '正在分配参考音频…',
  tts: '正在生成语音…',
  done: '',
};

/** 把后端返回的英文 phase key 翻译成中文展示文案；未知 key 返回空串，交给调用方兜底。 */
export const translateListenPhase = (phase?: string): string => {
  if (!phase) return '';
  return LISTEN_PHASE_TEXT_MAP[phase] ?? '';
};
