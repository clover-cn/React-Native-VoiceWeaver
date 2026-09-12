import {useCallback, useEffect, useRef, useState} from 'react';
import LocalBookSourceService, {
  filterSearchSources,
} from '../bookSource/LocalBookSourceService';
import {
  BookSourceSearchSession,
  SearchSnapshot,
} from '../bookSource/searchSession';

const emptySnapshot = (): SearchSnapshot => ({
  books: [],
  diagnostics: [],
  hasMore: false,
  hasFailures: false,
});

/** 搜索和换源共用会话，过期请求不能覆盖新关键词或新书源筛选。 */
export const useBookSourceSearch = () => {
  const session = useRef<BookSourceSearchSession>();
  const generation = useRef(0);
  const [snapshot, setSnapshot] = useState(emptySnapshot);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState('');

  const reset = useCallback(() => {
    generation.current += 1;
    session.current?.cancel();
    session.current = undefined;
    setSnapshot(emptySnapshot());
    setLoading(false);
    setHasSearched(false);
    setError('');
  }, []);

  useEffect(
    () => () => {
      generation.current += 1;
      session.current?.cancel();
    },
    [],
  );

  const search = useCallback(
    async (keyword: string, sourceIds?: string[]) => {
      reset();
      if (!keyword.trim()) {
        return;
      }
      const current = generation.current;
      setLoading(true);
      try {
        const sources = filterSearchSources(
          await LocalBookSourceService.getSources(),
          sourceIds,
        );
        if (current !== generation.current) {
          return;
        }
        if (sources.length === 0) {
          throw new Error('没有启用的书源，请先导入并启用书源');
        }
        const nextSession = new BookSourceSearchSession(
          keyword.trim(),
          sources.map(source => source.bookSourceUrl),
          (term, page, ids, token) =>
            LocalBookSourceService.searchBooksWithDiagnostics(
              term,
              page,
              ids,
              token,
            ),
        );
        session.current = nextSession;
        const result = await nextSession.loadNext();
        if (current === generation.current) {
          setSnapshot(result);
        }
      } catch (cause) {
        if (current === generation.current) {
          setError(cause instanceof Error ? cause.message : '搜索失败');
        }
      } finally {
        if (current === generation.current) {
          setLoading(false);
          setHasSearched(true);
        }
      }
    },
    [reset],
  );

  const loadMore = useCallback(async (retryFailed = false) => {
    const active = session.current;
    if (!active) {
      return;
    }
    const state = active.snapshot();
    if (retryFailed ? !state.hasFailures : !state.hasMore) {
      return;
    }
    const current = generation.current;
    setLoading(true);
    try {
      const result = await active.loadNext(retryFailed);
      if (current === generation.current) {
        setSnapshot(result);
      }
    } finally {
      if (current === generation.current) {
        setLoading(false);
      }
    }
  }, []);

  return {...snapshot, loading, hasSearched, error, search, loadMore, reset};
};
