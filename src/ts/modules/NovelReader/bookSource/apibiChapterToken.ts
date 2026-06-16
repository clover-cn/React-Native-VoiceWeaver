import {Book, Chapter} from '../types/reader';
import {LegadoBookSource} from './types';

const CryptoJS = require('crypto-js');

const APIBI_SOURCE_URL = 'https://apibi.cc';
const APIBI_SOURCE_NAME = '笔趣阁阁楼API';
const TOKEN_SEED = 'book@token.html';
const APIBI_CHAPTER_REQUEST_OPTION =
  ',{"headers":{"Referer":"https://apibi.cc/"}}';

const normalizeSourceUrl = (value?: string) =>
  String(value || '').replace(/\/+$/, '');

export const isApibiBookSource = (source: LegadoBookSource) =>
  normalizeSourceUrl(source.bookSourceUrl) === APIBI_SOURCE_URL ||
  source.bookSourceName === APIBI_SOURCE_NAME;

export const generateApibiChapterToken = (
  bookId: string | number,
  chapterId: string | number,
): string => {
  const hash = CryptoJS.MD5(TOKEN_SEED).toString(CryptoJS.enc.Hex);
  const iv = CryptoJS.enc.Utf8.parse(hash.slice(0, 16));
  const key = CryptoJS.enc.Utf8.parse(hash.slice(16));
  const payload = JSON.stringify({
    id: Number(bookId),
    chapterid: Number(chapterId),
  });
  const encrypted = CryptoJS.AES.encrypt(payload, key, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });

  return encrypted.ciphertext.toString(CryptoJS.enc.Base64);
};

const readQueryParam = (rawUrl: string | undefined, key: string) => {
  const value = String(rawUrl || '').trim();
  if (!value) {
    return '';
  }

  try {
    return new URL(value, APIBI_SOURCE_URL).searchParams.get(key) || '';
  } catch (_error) {
    const match = value.match(new RegExp(`[?&]${key}=([^&#]+)`));
    return match ? decodeURIComponent(match[1]) : '';
  }
};

const firstTruthy = (...values: string[]) =>
  values.find(value => String(value || '').trim()) || '';

export const buildApibiTokenChapterUrl = (
  source: LegadoBookSource,
  book: Book,
  chapter: Chapter,
  rawUrl: string,
): string => {
  if (!isApibiBookSource(source)) {
    return rawUrl;
  }

  const bookId = firstTruthy(
    readQueryParam(rawUrl, 'id'),
    readQueryParam(chapter.bookUrl, 'id'),
    readQueryParam(chapter.baseUrl, 'id'),
    readQueryParam(book.tocUrl, 'id'),
  );
  const chapterId =
    firstTruthy(
      readQueryParam(rawUrl, 'chapterid'),
      readQueryParam(chapter.bookUrl, 'chapterid'),
    ) || String(Number(chapter.index) + 1);

  if (!bookId || !chapterId) {
    return rawUrl;
  }

  const token = generateApibiChapterToken(bookId, chapterId);
  return `/api/chapter?token=${encodeURIComponent(
    token,
  )}${APIBI_CHAPTER_REQUEST_OPTION}`;
};
