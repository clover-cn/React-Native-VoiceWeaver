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
  chapterUrl?: string;
  isVip?: string;
  updateTime?: string;
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
  header?: string;
  lastUpdateTime?: string | number;
  loginUrl?: string;
  respondTime?: number;
  ruleBookInfo?: LegadoRuleBookInfo;
  ruleContent?: LegadoRuleContent;
  ruleExplore?: unknown;
  ruleSearch?: LegadoRuleSearch;
  ruleToc?: LegadoRuleToc;
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

export interface BookSourceSearchResult extends Book {
  sourceId: string;
}

export interface ChapterListResult {
  book: Book;
  chapters: Chapter[];
}

export interface ContentResult {
  text: string;
  paragraphs: string[];
  requestUrl: string;
}

export interface BookSourceDiagnostic {
  sourceName: string;
  sourceUrl: string;
  ok: boolean;
  stage: string;
  message: string;
  requestUrl?: string;
  htmlLength?: number;
  listCount?: number;
  resultCount?: number;
  sample?: string;
}

export interface SearchBooksResult {
  books: BookSourceSearchResult[];
  diagnostics: BookSourceDiagnostic[];
}
