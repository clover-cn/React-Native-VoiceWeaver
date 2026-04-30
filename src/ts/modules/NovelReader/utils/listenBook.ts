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
