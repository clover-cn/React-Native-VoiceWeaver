import {Book, Chapter} from '../types/reader';
import {BUILTIN_BOOK_SOURCES} from './builtinBookSources';
import {
  createRuleContext,
  evaluateListAsync,
  evaluateStringAsync,
  normalizeContentText,
  RuleItem,
} from './ruleEvaluator';
import {requestText, resolveRequest} from './requestClient';
import {
  applyRegexTail,
  isSameContentPageGroup,
  splitParagraphs,
  splitRegexTail,
} from './ruleUtils';
import {
  BookSourceCancelToken,
  BookSourceDiagnostic,
  BookSourceSearchGroup,
  BookSourceSearchResult,
  BookSourceValidationResult,
  ChapterListResult,
  ContentResult,
  LegadoBookSource,
  SearchBookGroupsResult,
  SearchBooksResult,
} from './types';
import {bookSourceLogger} from './bookSourceLogger';
import {loadUserBookSourceRecords} from './userBookSourceStorage';
import {buildApibiTokenChapterUrl} from './apibiChapterToken';
import {
  getUnsupportedBookSourceFeatures,
  normalizeLegadoBookSource,
  requiresUnsupportedLogin,
} from './normalizeBookSource';

const MAX_TOC_PAGES = 30;
const MAX_CONTENT_PAGES = 10;
const TOC_PARSE_BATCH_SIZE = 100;

const URL_RULE_KEYS = new Set([
  'bookUrl',
  'coverUrl',
  'tocUrl',
  'chapterUrl',
  'nextTocUrl',
  'nextContentUrl',
]);

const sleepFrame = () =>
  new Promise<void>(resolve => {
    setTimeout(resolve, 0);
  });

const isCancelled = (cancelToken?: BookSourceCancelToken) => {
  const signal = cancelToken?.signal as {aborted?: boolean} | undefined;
  return Boolean(cancelToken?.cancelled || signal?.aborted);
};

const throwIfCancelled = (cancelToken?: BookSourceCancelToken) => {
  if (isCancelled(cancelToken)) {
    throw new Error('书源解析已取消');
  }
};

const mergeBookSources = (userSources: LegadoBookSource[]) => {
  const sourceMap = new Map<string, LegadoBookSource>();

  BUILTIN_BOOK_SOURCES.forEach(source => {
    if (source.bookSourceUrl) {
      sourceMap.set(source.bookSourceUrl, normalizeLegadoBookSource(source));
    }
  });

  userSources.forEach(source => {
    if (source.bookSourceUrl) {
      sourceMap.set(source.bookSourceUrl, normalizeLegadoBookSource(source));
    }
  });

  return Array.from(sourceMap.values());
};

const enabledSources = async () => {
  const userRecords = await loadUserBookSourceRecords();
  return mergeBookSources(userRecords.map(record => record.source)).filter(
    source => source.enabled !== false && source.bookSourceType !== 1,
  );
};

const allBookSources = async () => {
  const userRecords = await loadUserBookSourceRecords();
  return mergeBookSources(userRecords.map(record => record.source)).filter(
    source => source.bookSourceType !== 1,
  );
};

const sourceById = async (sourceId?: string) => {
  const sources = await enabledSources();
  return (
    sources.find(source => source.bookSourceUrl === sourceId) || sources[0]
  );
};

export const filterSearchSources = (
  sources: LegadoBookSource[],
  sourceIds?: string[],
) => {
  const selectedIds = (sourceIds || []).filter(Boolean);
  if (selectedIds.length === 0) {
    return sources;
  }

  const selectedSet = new Set(selectedIds);
  return sources.filter(source => selectedSet.has(source.bookSourceUrl));
};

const normalizeMergeText = (value: string | undefined) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[《》<>「」『』“”"'[\]【】（）()·.,，。:：;；\-_—\s]/g, '');

const normalizeAuthorForMerge = (value: string | undefined) =>
  normalizeMergeText(value).replace(/^作者/, '');

const isValidMergeAuthor = (author: string) =>
  Boolean(author) &&
  !['未知作者', '未知', '佚名', '无', 'null', 'undefined'].includes(author);

const mergeKeyForBook = (book: BookSourceSearchResult, index: number) => {
  const name = normalizeMergeText(book.name);
  const author = normalizeAuthorForMerge(book.author);
  if (name && isValidMergeAuthor(author)) {
    return `strict:${name}:${author}`;
  }
  return `single:${name}:${author}:${book.sourceId}:${book.bookUrl}:${index}`;
};

export const mergeBookSourceSearchResults = (
  books: BookSourceSearchResult[],
): BookSourceSearchGroup[] => {
  const groups = new Map<string, BookSourceSearchResult[]>();
  books.forEach((book, index) => {
    const key = mergeKeyForBook(book, index);
    const list = groups.get(key);
    if (list) {
      list.push(book);
    } else {
      groups.set(key, [book]);
    }
  });

  return Array.from(groups.values()).map(groupBooks => {
    const primary = groupBooks[0] as BookSourceSearchResult;
    const sourceNames: string[] = [];
    const sourceIds = new Set<string>();
    groupBooks.forEach(book => {
      if (!sourceIds.has(book.sourceId)) {
        sourceIds.add(book.sourceId);
        sourceNames.push(book.originName || '未知书源');
      }
    });

    return {
      ...primary,
      primary,
      sources: groupBooks,
      sourceCount: sourceIds.size,
      sourceNames,
    };
  });
};

const normalizeBook = (
  source: LegadoBookSource,
  data: Partial<Book>,
): BookSourceSearchResult => ({
  name: data.name?.trim() || '未知书名',
  author: data.author?.trim() || '未知作者',
  coverUrl: data.coverUrl,
  intro: data.intro,
  origin: source.bookSourceUrl,
  originName: source.bookSourceName,
  latestChapterTitle: data.latestChapterTitle,
  bookUrl: data.bookUrl || '',
  tocUrl: data.tocUrl,
  sourceId: source.bookSourceUrl,
});

const applyReplaceRegex = (text: string, replaceRegex?: string) => {
  if (!replaceRegex) {
    return text;
  }
  const {regex, replacement, onlyOne} = splitRegexTail(replaceRegex);
  return applyRegexTail(text, regex, replacement, onlyOne);
};

const readRuleField = async (
  rule: string | undefined,
  raw: string,
  baseUrl: string,
  item?: RuleItem,
  key?: string,
  vars?: Record<string, unknown>,
  json?: unknown,
) => {
  return evaluateStringAsync(
    rule,
    createRuleContext(raw, baseUrl, item, vars, json),
    key ? URL_RULE_KEYS.has(key) : false,
  );
};

const readBookInfoInit = async (
  rule: string | undefined,
  raw: string,
  baseUrl: string,
  vars: Record<string, unknown>,
): Promise<RuleItem | undefined> => {
  const cleanRule = String(rule || '').trim();
  if (!cleanRule) {
    return undefined;
  }

  const context = createRuleContext(raw, baseUrl, undefined, vars);
  if (cleanRule.startsWith(':') || cleanRule.startsWith('-:')) {
    return (await evaluateListAsync(cleanRule, context))[0];
  }

  const text = await readRuleField(
    cleanRule,
    raw,
    baseUrl,
    undefined,
    undefined,
    vars,
  );
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch (_error) {
    return text;
  }
};

const getSearchFieldBaseUrl = (
  source: LegadoBookSource,
  requestUrl: string,
  key: string,
  rule?: string,
) => {
  const dynamicRule = String(rule || '').includes('@js:') ||
    String(rule || '').includes('<js>');
  return URL_RULE_KEYS.has(key) && !dynamicRule ? source.bookSourceUrl : requestUrl;
};

const getBookInfoFieldBaseUrl = (
  source: LegadoBookSource,
  requestUrl: string,
  key: string,
  rule?: string,
) => {
  const dynamicRule = String(rule || '').includes('@js:') ||
    String(rule || '').includes('<js>');
  return URL_RULE_KEYS.has(key) && !dynamicRule ? source.bookSourceUrl : requestUrl;
};

const searchWithSource = async (
  source: LegadoBookSource,
  keyword: string,
  page = 1,
): Promise<{
  books: BookSourceSearchResult[];
  diagnostic: BookSourceDiagnostic;
}> => {
  const baseDiagnostic = {
    sourceName: source.bookSourceName,
    sourceUrl: source.bookSourceUrl,
  };

  if (requiresUnsupportedLogin(source)) {
    const diagnostic = {
      ...baseDiagnostic,
      ok: false,
      stage: 'unsupported',
      message: '书源依赖登录，本轮暂不支持',
      unsupportedFeatures: getUnsupportedBookSourceFeatures(source),
    };
    bookSourceLogger.warn('search', diagnostic.message, diagnostic);
    return {books: [], diagnostic};
  }

  if (!source.searchUrl || !source.ruleSearch?.bookList) {
    const diagnostic = {
      ...baseDiagnostic,
      ok: false,
      stage: 'config',
      message: '书源缺少 searchUrl 或 ruleSearch.bookList',
      unsupportedFeatures: getUnsupportedBookSourceFeatures(source),
    };
    bookSourceLogger.warn('search', diagnostic.message, diagnostic);
    return {books: [], diagnostic};
  }

  bookSourceLogger.log('search', '开始搜索书源', {
    sourceName: source.bookSourceName,
    keyword,
    page,
    searchUrl: source.searchUrl,
    bookListRule: source.ruleSearch.bookList,
  });
  const request = resolveRequest(source, source.searchUrl, {
    key: keyword,
    page,
  });
  if (request.webView) {
    const diagnostic = {
      ...baseDiagnostic,
      ok: false,
      stage: 'unsupported',
      message: '搜索请求依赖 webView，本轮暂不支持动态页面',
      requestUrl: request.url,
      rule: source.searchUrl,
      unsupportedFeatures: [
        ...new Set([...getUnsupportedBookSourceFeatures(source), 'webView']),
      ],
    };
    bookSourceLogger.warn('search', diagnostic.message, diagnostic);
    return {books: [], diagnostic};
  }
  bookSourceLogger.log('search', '搜索 URL 已解析', {
    sourceName: source.bookSourceName,
    requestUrl: request.url,
    method: request.method,
    body: request.body,
  });
  const raw = await requestText(request, source.respondTime || 20000);
  const vars: Record<string, unknown> = {source};
  const context = createRuleContext(raw, request.url, undefined, vars);
  const list = await evaluateListAsync(source.ruleSearch.bookList, context);
  bookSourceLogger.log('search', '搜索列表规则匹配完成', {
    sourceName: source.bookSourceName,
    requestUrl: request.url,
    htmlLength: raw.length,
    bookListRule: source.ruleSearch.bookList,
    listCount: list.length,
  });

  const books = (
    await Promise.all(
      list.map(async item => {
      const rules = source.ruleSearch || {};
      const bookUrl = await readRuleField(
        rules.bookUrl,
        raw,
        getSearchFieldBaseUrl(source, request.url, 'bookUrl', rules.bookUrl),
        item,
        'bookUrl',
      );
      if (!bookUrl) {
        bookSourceLogger.warn('search', '搜索项被丢弃：bookUrl 为空', {
          sourceName: source.bookSourceName,
          rules,
        });
        return null;
      }

      const book = normalizeBook(source, {
        name: await readRuleField(rules.name, raw, request.url, item, 'name'),
        author: await readRuleField(
          rules.author,
          raw,
          request.url,
          item,
          'author',
        ),
        coverUrl: await readRuleField(
          rules.coverUrl,
          raw,
          getSearchFieldBaseUrl(
            source,
            request.url,
            'coverUrl',
            rules.coverUrl,
          ),
          item,
          'coverUrl',
        ),
        intro: await readRuleField(
          rules.intro,
          raw,
          request.url,
          item,
          'intro',
        ),
        latestChapterTitle: await readRuleField(
          rules.lastChapter,
          raw,
          request.url,
          item,
          'lastChapter',
        ),
        bookUrl,
      });

      bookSourceLogger.log('search', '搜索项解析完成', {
        sourceName: source.bookSourceName,
        name: book.name,
        author: book.author,
        bookUrl: book.bookUrl,
      });

      return book;
      }),
    )
  ).filter(Boolean) as BookSourceSearchResult[];

  const diagnostic = {
    ...baseDiagnostic,
    ok: true,
    stage: 'done',
    message:
      books.length > 0
        ? `搜索成功，解析到 ${books.length} 本书`
        : `请求成功，但 bookList 只匹配到 ${list.length} 项，最终有效书籍为 0`,
    requestUrl: request.url,
    rule: source.ruleSearch.bookList,
    unsupportedFeatures: getUnsupportedBookSourceFeatures(source),
    htmlLength: raw.length,
    listCount: list.length,
    resultCount: books.length,
    sample: raw.slice(0, 160),
  };
  bookSourceLogger.log('search', diagnostic.message, diagnostic);
  return {books, diagnostic};
};

const getBookInfo = async (
  source: LegadoBookSource,
  book: Book,
  vars: Record<string, unknown>,
  cancelToken?: BookSourceCancelToken,
): Promise<Book> => {
  const request = resolveRequest(source, book.bookUrl, {}, book.bookUrl);
  const raw = await requestText(
    request,
    source.respondTime || 20000,
    cancelToken,
  );
  throwIfCancelled(cancelToken);
  const rules = source.ruleBookInfo || {};
  vars.book = book;
  vars.source = source;
  const initItem = await readBookInfoInit(
    rules.bookInfoInit,
    raw,
    request.url,
    vars,
  );

  const nextBook: Book = {
    ...book,
    name:
      (await readRuleField(rules.name, raw, request.url, initItem, 'name', vars)) ||
      book.name,
    author:
      (await readRuleField(
        rules.author,
        raw,
        request.url,
        initItem,
        'author',
        vars,
      )) ||
      book.author,
    coverUrl:
      (await readRuleField(
        rules.coverUrl,
        raw,
        getBookInfoFieldBaseUrl(
          source,
          request.url,
          'coverUrl',
          rules.coverUrl,
        ),
        initItem,
        'coverUrl',
        vars,
      )) || book.coverUrl,
    intro:
      (await readRuleField(
        rules.intro,
        raw,
        request.url,
        initItem,
        'intro',
        vars,
      )) ||
      book.intro,
    latestChapterTitle:
      (await readRuleField(
        rules.lastChapter,
        raw,
        request.url,
        initItem,
        'lastChapter',
        vars,
      )) || book.latestChapterTitle,
    tocUrl:
      (await readRuleField(
        rules.tocUrl,
        raw,
        getBookInfoFieldBaseUrl(
          source,
          request.url,
          'tocUrl',
          rules.tocUrl,
        ),
        initItem,
        'tocUrl',
        vars,
      )) ||
      book.tocUrl ||
      book.bookUrl,
  };

  bookSourceLogger.log('toc', '详情页信息解析完成', {
    sourceName: source.bookSourceName,
    bookName: nextBook.name,
    bookUrl: nextBook.bookUrl,
    tocUrl: nextBook.tocUrl,
    coverUrl: nextBook.coverUrl,
  });

  return nextBook;
};

const loadTocPage = async (
  source: LegadoBookSource,
  book: Book,
  tocUrl: string,
  startIndex: number,
  vars: Record<string, unknown>,
  cancelToken?: BookSourceCancelToken,
): Promise<{
  chapters: Chapter[];
  nextUrl: string;
  diagnostic: BookSourceDiagnostic;
}> => {
  const baseDiagnostic = {
    sourceName: source.bookSourceName,
    sourceUrl: source.bookSourceUrl,
  };
  const request = resolveRequest(source, tocUrl, {}, tocUrl);
  if (request.webView) {
    return {
      chapters: [],
      nextUrl: '',
      diagnostic: {
        ...baseDiagnostic,
        ok: false,
        stage: 'unsupported',
        message: '目录请求依赖 webView，本轮暂不支持动态页面',
        requestUrl: request.url,
        rule: source.ruleToc?.chapterList,
        unsupportedFeatures: [
          ...new Set([...getUnsupportedBookSourceFeatures(source), 'webView']),
        ],
      },
    };
  }
  const raw = await requestText(
    request,
    source.respondTime || 20000,
    cancelToken,
  );
  throwIfCancelled(cancelToken);
  const rules = source.ruleToc || {};
  vars.source = source;
  const context = createRuleContext(raw, request.url, undefined, vars);
  throwIfCancelled(cancelToken);
  const list = await evaluateListAsync(rules.chapterList, context);
  const seen = new Set<string>();
  bookSourceLogger.log('toc', '目录列表规则匹配完成', {
    sourceName: source.bookSourceName,
    requestUrl: request.url,
    chapterListRule: rules.chapterList,
    listCount: list.length,
  });

  const chapters: Chapter[] = [];
  for (let offset = 0; offset < list.length; offset += 1) {
    if (offset > 0 && offset % TOC_PARSE_BATCH_SIZE === 0) {
      await sleepFrame();
    }
    throwIfCancelled(cancelToken);

    const item = list[offset];
    const ruleVars = {
      ...vars,
      book,
      chapter: {index: startIndex + offset},
      index: startIndex + offset,
    };
    const title = await readRuleField(
      rules.chapterName,
      raw,
      request.url,
      item,
      'chapterName',
      ruleVars,
      context.json,
    );
    const chapterUrl = await readRuleField(
      rules.chapterUrl,
      raw,
      request.url,
      item,
      'chapterUrl',
      ruleVars,
      context.json,
    );

    if (!title || !chapterUrl || seen.has(chapterUrl)) {
      bookSourceLogger.warn('toc', '目录项被丢弃', {
        sourceName: source.bookSourceName,
        title,
        chapterUrl,
        duplicated: chapterUrl ? seen.has(chapterUrl) : false,
      });
      continue;
    }
    seen.add(chapterUrl);

    chapters.push({
      title,
      bookUrl: chapterUrl,
      baseUrl: request.url,
      sourceId: source.bookSourceUrl,
      index: startIndex + offset,
    } as Chapter);
  }

  throwIfCancelled(cancelToken);
  const nextUrl = await readRuleField(
    rules.nextTocUrl,
    raw,
    request.url,
    undefined,
    'nextTocUrl',
    vars,
  );

  const diagnostic = {
    ...baseDiagnostic,
    ok: chapters.length > 0,
    stage: chapters.length > 0 ? 'done' : 'parse',
    message:
      chapters.length > 0
        ? `目录解析成功，解析到 ${chapters.length} 章`
        : `请求成功，但 chapterList 只匹配到 ${list.length} 项，最终有效章节为 0`,
    requestUrl: request.url,
    requestMethod: request.method,
    requestBodyLength: request.body?.length || 0,
    requestHeaderKeys: Object.keys(request.headers),
    rule: rules.chapterList,
    unsupportedFeatures: getUnsupportedBookSourceFeatures(source),
    htmlLength: raw.length,
    listCount: list.length,
    resultCount: chapters.length,
    sample: raw.slice(0, 160),
  };

  return {chapters, nextUrl, diagnostic};
};

export const LocalBookSourceService = {
  async getSources(): Promise<LegadoBookSource[]> {
    return enabledSources();
  },

  async validateBookSource(
    sourceId: string,
    keyword: string,
  ): Promise<BookSourceValidationResult> {
    const sources = await allBookSources();
    const source = sources.find(item => item.bookSourceUrl === sourceId);
    const validatedAt = Date.now();

    if (!source) {
      return {
        sourceId,
        sourceName: '未知书源',
        ok: false,
        status: 'failed',
        stage: 'config',
        message: '未找到待校验书源',
        resultCount: 0,
        validatedAt,
      };
    }

    try {
      const {books, diagnostic} = await searchWithSource(source, keyword, 1);
      const ok = diagnostic.ok && books.length > 0;
      return {
        sourceId: source.bookSourceUrl,
        sourceName: source.bookSourceName,
        ok,
        status: ok ? 'ok' : 'failed',
        stage: diagnostic.stage,
        message: ok
          ? `校验通过，解析到 ${books.length} 本书`
          : diagnostic.message || '校验失败，未解析到有效搜索结果',
        resultCount: books.length,
        validatedAt,
      };
    } catch (error) {
      return {
        sourceId: source.bookSourceUrl,
        sourceName: source.bookSourceName,
        ok: false,
        status: 'failed',
        stage: 'exception',
        message: bookSourceLogger.errorMessage(error),
        resultCount: 0,
        validatedAt,
      };
    }
  },

  async searchBooksWithDiagnostics(
    keyword: string,
    page = 1,
    sourceIds?: string[],
  ): Promise<SearchBooksResult> {
    const sources = filterSearchSources(await enabledSources(), sourceIds);
    bookSourceLogger.log('search', '开始本地多书源搜索', {
      keyword,
      page,
      sourceCount: sources.length,
      sources: sources.map(source => source.bookSourceName),
    });

    const results = await Promise.all(
      sources.map(async source => {
        try {
          return await searchWithSource(source, keyword, page);
        } catch (error) {
          const diagnostic = {
            sourceName: source.bookSourceName,
            sourceUrl: source.bookSourceUrl,
            ok: false,
            stage: 'exception',
            message: bookSourceLogger.errorMessage(error),
          };
          bookSourceLogger.error('search', '书源搜索异常', diagnostic);
          return {
            books: [] as BookSourceSearchResult[],
            diagnostic,
          };
        }
      }),
    );

    const books = results.flatMap(item => item.books);
    const diagnostics = results.map(item => item.diagnostic);
    bookSourceLogger.log('search', '本地多书源搜索结束', {
      keyword,
      totalBooks: books.length,
      diagnostics,
    });
    return {books, diagnostics};
  },

  async searchBookGroupsWithDiagnostics(
    keyword: string,
    page = 1,
    sourceIds?: string[],
  ): Promise<SearchBookGroupsResult> {
    const result = await this.searchBooksWithDiagnostics(
      keyword,
      page,
      sourceIds,
    );
    const groupedBooks = mergeBookSourceSearchResults(result.books);
    bookSourceLogger.log('search', '本地多书源搜索结果合并完成', {
      keyword,
      totalBooks: result.books.length,
      groupedBooks: groupedBooks.length,
    });
    return {
      books: groupedBooks,
      diagnostics: result.diagnostics,
    };
  },

  async searchBooks(
    keyword: string,
    page = 1,
    sourceIds?: string[],
  ): Promise<BookSourceSearchResult[]> {
    return (await this.searchBooksWithDiagnostics(keyword, page, sourceIds))
      .books;
  },

  async searchBookSources(book: Book): Promise<BookSourceSearchResult[]> {
    const keyword = book.name || '';
    if (!keyword) {
      return [];
    }

    const results = await this.searchBooks(keyword);
    return results.filter(item => {
      const sameName = item.name === book.name || item.name.includes(book.name);
      const sameAuthor =
        !book.author ||
        !item.author ||
        item.author === book.author ||
        item.author.includes(book.author);
      return sameName && sameAuthor;
    });
  },

  async getChapterList(
    book: Book,
    cancelToken?: BookSourceCancelToken,
  ): Promise<ChapterListResult> {
    const source = await sourceById(book.origin);
    if (!source) {
      throw new Error('未找到可用书源');
    }

    bookSourceLogger.log('toc', '开始解析目录', {
      sourceName: source.bookSourceName,
      bookName: book.name,
      bookUrl: book.bookUrl,
    });
    const vars: Record<string, unknown> = {source};
    const detailedBook = await getBookInfo(source, book, vars, cancelToken);
    throwIfCancelled(cancelToken);
    const firstTocUrl = detailedBook.tocUrl || detailedBook.bookUrl;
    const visited = new Set<string>();
    const chapters: Chapter[] = [];
    const diagnostics: BookSourceDiagnostic[] = [];
    let nextUrl = firstTocUrl;

    for (let page = 0; nextUrl && page < MAX_TOC_PAGES; page += 1) {
      if (visited.has(nextUrl)) {
        break;
      }
      visited.add(nextUrl);

      const result = await loadTocPage(
        source,
        detailedBook,
        nextUrl,
        chapters.length,
        vars,
        cancelToken,
      );
      throwIfCancelled(cancelToken);
      chapters.push(...result.chapters);
      diagnostics.push(result.diagnostic);
      if (!result.diagnostic.ok) {
        bookSourceLogger.warn('toc', result.diagnostic.message, result.diagnostic);
        break;
      }
      nextUrl = result.nextUrl;
    }

    bookSourceLogger.log('toc', '目录解析完成', {
      sourceName: source.bookSourceName,
      bookName: detailedBook.name,
      chapterCount: chapters.length,
    });

    return {
      book: detailedBook,
      chapters: chapters.map((chapter, index) => ({
        ...chapter,
        index,
      })),
      diagnostic:
        diagnostics[diagnostics.length - 1] ||
        ({
          sourceName: source.bookSourceName,
          sourceUrl: source.bookSourceUrl,
          ok: chapters.length > 0,
          stage: chapters.length > 0 ? 'done' : 'parse',
          message:
            chapters.length > 0
              ? `目录解析成功，解析到 ${chapters.length} 章`
              : '目录解析为空',
          requestUrl: firstTocUrl,
          rule: source.ruleToc?.chapterList,
          unsupportedFeatures: getUnsupportedBookSourceFeatures(source),
          resultCount: chapters.length,
        } as BookSourceDiagnostic),
    };
  },

  async getBookContent(
    book: Book,
    chapter: Chapter,
    cancelToken?: BookSourceCancelToken,
  ): Promise<ContentResult> {
    const source = await sourceById(book.origin || chapter.sourceId);
    if (!source) {
      throw new Error('未找到可用书源');
    }

    const visited = new Set<string>();
    const chunks: string[] = [];
    const vars: Record<string, unknown> = {
      book,
      chapter,
      title: chapter.title,
      source,
    };
    let nextUrl = chapter.bookUrl;
    let firstRequestUrl = chapter.bookUrl;

    bookSourceLogger.log('content', '开始解析正文', {
      sourceName: source.bookSourceName,
      bookName: book.name,
      chapterTitle: chapter.title,
      chapterUrl: chapter.bookUrl,
    });

    for (let page = 0; nextUrl && page < MAX_CONTENT_PAGES; page += 1) {
      if (visited.has(nextUrl)) {
        break;
      }
      visited.add(nextUrl);

      const requestUrl = buildApibiTokenChapterUrl(
        source,
        book,
        chapter,
        nextUrl,
      );
      const request = resolveRequest(
        source,
        requestUrl,
        {},
        chapter.baseUrl || nextUrl,
      );
      if (request.webView) {
        const diagnostic = {
          sourceName: source.bookSourceName,
          sourceUrl: source.bookSourceUrl,
          ok: false,
          stage: 'unsupported',
          message: '正文请求依赖 webView，本轮暂不支持动态页面',
          requestUrl: request.url,
          rule: source.ruleContent?.content,
          unsupportedFeatures: [
            ...new Set([
              ...getUnsupportedBookSourceFeatures(source),
              'webView',
            ]),
          ],
        };
        bookSourceLogger.warn('content', diagnostic.message, diagnostic);
        return {
          text: '',
          paragraphs: [],
          requestUrl: request.url,
          diagnostic,
        };
      }
      if (page === 0) {
        firstRequestUrl = request.url;
      }
      const raw = await requestText(
        request,
        source.respondTime || 20000,
        cancelToken,
      );
      throwIfCancelled(cancelToken);
      const rules = source.ruleContent || {};
      const content = await readRuleField(
        rules.content,
        raw,
        request.url,
        undefined,
        'content',
        vars,
      );
      if (content) {
        chunks.push(content);
      }
      bookSourceLogger.log('content', '正文页规则解析完成', {
        sourceName: source.bookSourceName,
        requestUrl: request.url,
        contentRule: rules.content,
        contentLength: content.length,
      });

      nextUrl = await readRuleField(
        rules.nextContentUrl,
        raw,
        request.url,
        undefined,
        'nextContentUrl',
        vars,
      );
      if (nextUrl && !isSameContentPageGroup(chapter.bookUrl, nextUrl)) {
        bookSourceLogger.log('content', '正文下一页指向其他章节，停止跟随', {
          sourceName: source.bookSourceName,
          chapterTitle: chapter.title,
          chapterUrl: chapter.bookUrl,
          nextUrl,
        });
        nextUrl = '';
      }
    }

    const normalized = normalizeContentText(
      applyReplaceRegex(chunks.join('\n'), source.ruleContent?.replaceRegex),
    );
    const paragraphs = splitParagraphs(normalized);
    bookSourceLogger.log('content', '正文解析完成', {
      sourceName: source.bookSourceName,
      bookName: book.name,
      chapterTitle: chapter.title,
      textLength: normalized.length,
      paragraphCount: paragraphs.length,
    });

    return {
      text: normalized,
      paragraphs,
      requestUrl: firstRequestUrl,
      diagnostic: {
        sourceName: source.bookSourceName,
        sourceUrl: source.bookSourceUrl,
        ok: paragraphs.length > 0,
        stage: paragraphs.length > 0 ? 'done' : 'parse',
        message:
          paragraphs.length > 0
            ? `正文解析成功，解析到 ${paragraphs.length} 段`
            : '正文解析为空',
        requestUrl: firstRequestUrl,
        rule: source.ruleContent?.content,
        unsupportedFeatures: getUnsupportedBookSourceFeatures(source),
        resultCount: paragraphs.length,
      },
    };
  },
};

export default LocalBookSourceService;
