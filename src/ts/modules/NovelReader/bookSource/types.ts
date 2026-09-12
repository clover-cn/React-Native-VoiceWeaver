import {Book, Chapter} from '../types/reader';

export interface LegadoRuleSearch {
  bookList?: string;
  name?: string;
  author?: string;
  kind?: string;
  wordCount?: string;
  lastChapter?: string;
  intro?: string;
  coverUrl?: string;
  bookUrl?: string;
  checkKeyWord?: string;
}

export interface LegadoRuleBookInfo {
  init?: string;
  bookInfoInit?: string;
  name?: string;
  author?: string;
  kind?: string;
  wordCount?: string;
  lastChapter?: string;
  intro?: string;
  coverUrl?: string;
  tocUrl?: string;
}

export interface LegadoRuleToc {
  chapterList?: string;
  chapterName?: string;
  ruleChapterName?: string;
  chapterUrl?: string;
  isVip?: string;
  updateTime?: string;
  chapterInfo?: string;
  nextTocUrl?: string;
}

export interface LegadoRuleContent {
  content?: string;
  nextContentUrl?: string;
  replaceRegex?: string;
  webJs?: string;
  sourceRegex?: string;
}

export interface LegadoBookSource {
  bookSourceComment?: string;
  bookSourceGroup?: string;
  bookSourceName: string;
  bookSourceType?: number;
  bookSourceUrl: string;
  customOrder?: number;
  enabled?: boolean;
  enabledCookieJar?: boolean;
  enabledExplore?: boolean;
  exploreUrl?: string | unknown[];
  header?: string | Record<string, string>;
  jsLib?: string;
  lastUpdateTime?: string | number;
  loginUrl?: string;
  loginJs?: string;
  respondTime?: number;
  ruleBookInfo?: LegadoRuleBookInfo;
  ruleContent?: LegadoRuleContent;
  ruleExplore?: unknown;
  ruleSearch?: LegadoRuleSearch;
  ruleToc?: LegadoRuleToc;
  searchRule?: LegadoRuleSearch;
  bookInfoRule?: LegadoRuleBookInfo;
  exploreRule?: unknown;
  tocRule?: LegadoRuleToc;
  contentRule?: LegadoRuleContent;
  bookUrlPattern?: string;
  key?: string;
  tag?: string;
  variable?: string;
  searchUrl?: string;
  weight?: number;
}

export interface ResolvedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  charset: string;
  webView: boolean;
  retry: number;
}

export interface BookSourceCancelToken {
  cancelled: boolean;
  signal?: unknown;
  cancel?: () => void;
}

export interface BookSourceSearchResult extends Book {
  sourceId: string;
}

export interface BookSourceSearchGroup extends Book {
  sourceId: string;
  primary: BookSourceSearchResult;
  sources: BookSourceSearchResult[];
  sourceCount: number;
  sourceNames: string[];
}

export interface ChapterListResult {
  book: Book;
  chapters: Chapter[];
  diagnostic?: BookSourceDiagnostic;
}

export interface ContentResult {
  text: string;
  paragraphs: string[];
  requestUrl: string;
  diagnostic?: BookSourceDiagnostic;
}

export interface BookSourceDiagnostic {
  sourceName: string;
  sourceUrl: string;
  ok: boolean;
  stage: string;
  message: string;
  rule?: string;
  unsupportedFeatures?: string[];
  requestUrl?: string;
  requestMethod?: string;
  requestBodyLength?: number;
  requestHeaderKeys?: string[];
  htmlLength?: number;
  listCount?: number;
  resultCount?: number;
  sample?: string;
  page?: number;
}

export type BookSourceValidationStatus =
  | 'unknown'
  | 'checking'
  | 'ok'
  | 'failed';

export interface BookSourceValidationResult {
  sourceId: string;
  sourceName: string;
  ok: boolean;
  status: Exclude<BookSourceValidationStatus, 'unknown' | 'checking'>;
  message: string;
  stage: string;
  resultCount: number;
  validatedAt: number;
}

export interface SearchBooksResult {
  books: BookSourceSearchResult[];
  diagnostics: BookSourceDiagnostic[];
}
