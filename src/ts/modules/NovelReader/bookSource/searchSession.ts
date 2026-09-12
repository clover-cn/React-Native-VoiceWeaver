import {
  BookSourceCancelToken,
  BookSourceDiagnostic,
  BookSourceSearchResult,
  SearchBooksResult,
} from './types';

type SourceState = {
  sourceId: string;
  page: number;
  status: 'ready' | 'failed' | 'exhausted';
};
export interface SearchSnapshot {
  books: BookSourceSearchResult[];
  diagnostics: BookSourceDiagnostic[];
  hasMore: boolean;
  hasFailures: boolean;
}
export type SearchPageLoader = (
  keyword: string,
  page: number,
  sourceIds: string[],
  cancelToken: BookSourceCancelToken,
) => Promise<SearchBooksResult>;

/** 每个书源独立推进页码；失败重试不跳页，合并书籍数量不影响分页。 */
export class BookSourceSearchSession {
  private sources: SourceState[];
  private books = new Map<string, BookSourceSearchResult>();
  private diagnostics = new Map<string, BookSourceDiagnostic>();
  private pending?: Promise<SearchSnapshot>;
  private controller =
    typeof AbortController === 'function' ? new AbortController() : undefined;
  private token: BookSourceCancelToken = {
    cancelled: false,
    signal: this.controller?.signal,
  };

  constructor(
    private keyword: string,
    sourceIds: string[],
    private loadPage: SearchPageLoader,
  ) {
    this.sources = [...new Set(sourceIds)].map(sourceId => ({
      sourceId,
      page: 1,
      status: 'ready',
    }));
  }

  snapshot(): SearchSnapshot {
    return {
      books: [...this.books.values()],
      diagnostics: [...this.diagnostics.values()],
      hasMore: this.sources.some(source => source.status === 'ready'),
      hasFailures: this.sources.some(source => source.status === 'failed'),
    };
  }

  cancel() {
    this.token.cancelled = true;
    this.controller?.abort();
  }

  loadNext(retryFailed = false): Promise<SearchSnapshot> {
    if (this.pending) {
      return this.pending;
    }
    this.pending = this.load(retryFailed).finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  private async load(retryFailed: boolean): Promise<SearchSnapshot> {
    const targets = this.sources.filter(
      source => source.status === (retryFailed ? 'failed' : 'ready'),
    );
    // 限制并发，避免导入大量书源后同时发起数百个请求。
    for (
      let offset = 0;
      offset < targets.length && !this.token.cancelled;
      offset += 4
    ) {
      await Promise.all(
        targets.slice(offset, offset + 4).map(async source => {
          try {
            const result = await this.loadPage(
              this.keyword,
              source.page,
              [source.sourceId],
              this.token,
            );
            if (this.token.cancelled) {
              return;
            }
            const diagnostic = result.diagnostics.find(
              item => item.sourceUrl === source.sourceId,
            );
            if (!diagnostic) {
              throw new Error('未找到该书源的搜索结果，请重新搜索');
            }
            this.diagnostics.set(source.sourceId, {
              ...diagnostic,
              page: source.page,
            });
            if (!diagnostic.ok) {
              source.status = 'failed';
              return;
            }
            let added = 0;
            result.books.forEach(book => {
              const key = JSON.stringify([book.sourceId, book.bookUrl]);
              if (!this.books.has(key)) {
                this.books.set(key, book);
                added += 1;
              }
            });
            source.status = added === 0 ? 'exhausted' : 'ready';
            source.page += 1;
          } catch (error) {
            if (this.token.cancelled) {
              return;
            }
            source.status = 'failed';
            this.diagnostics.set(source.sourceId, {
              sourceUrl: source.sourceId,
              sourceName:
                this.diagnostics.get(source.sourceId)?.sourceName || '书源',
              ok: false,
              stage: 'request',
              message: error instanceof Error ? error.message : '搜索请求失败',
              page: source.page,
            });
          }
        }),
      );
    }
    return this.snapshot();
  }
}
