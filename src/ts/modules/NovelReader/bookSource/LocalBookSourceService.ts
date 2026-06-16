import {Book, Chapter} from '../types/reader';
import {BUILTIN_BOOK_SOURCES} from './builtinBookSources';
import {
  createRuleContext,
  evaluateList,
  evaluateString,
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
  ChapterListResult,
  ContentResult,
  LegadoBookSource,
  SearchBookGroupsResult,
  SearchBooksResult,
} from './types';
import {bookSourceLogger} from './bookSourceLogger';
import {loadUserBookSourceRecords} from './userBookSourceStorage';
import {buildApibiTokenChapterUrl} from './apibiChapterToken';

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
      sourceMap.set(source.bookSourceUrl, source);
    }
  });

  userSources.forEach(source => {
    if (source.bookSourceUrl) {
      sourceMap.set(source.bookSourceUrl, source);
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

const readRuleField = (
  rule: string | undefined,
  raw: string,
  baseUrl: string,
  item?: RuleItem,
  key?: string,
  vars?: Record<string, unknown>,
  json?: unknown,
) => {
  return evaluateString(
    rule,
    createRuleContext(raw, baseUrl, item, vars, json),
    key ? URL_RULE_KEYS.has(key) : false,
  );
};

const readBookInfoInit = (
  rule: string | undefined,
  raw: string,
  baseUrl: string,
  vars: Record<string, unknown>,
): RuleItem | undefined => {
  const cleanRule = String(rule || '').trim();
  if (!cleanRule) {
    return undefined;
  }

  const context = createRuleContext(raw, baseUrl, undefined, vars);
  if (cleanRule.startsWith(':') || cleanRule.startsWith('-:')) {
    return evaluateList(cleanRule, context)[0];
  }

  const text = readRuleField(
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
) => {
  return URL_RULE_KEYS.has(key) ? source.bookSourceUrl : requestUrl;
};

const getBookInfoFieldBaseUrl = (
  source: LegadoBookSource,
  requestUrl: string,
  key: string,
) => {
  return URL_RULE_KEYS.has(key) ? source.bookSourceUrl : requestUrl;
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

  if (!source.searchUrl || !source.ruleSearch?.bookList) {
    const diagnostic = {
      ...baseDiagnostic,
      ok: false,
      stage: 'config',
      message: '书源缺少 searchUrl 或 ruleSearch.bookList',
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
  bookSourceLogger.log('search', '搜索 URL 已解析', {
    sourceName: source.bookSourceName,
    requestUrl: request.url,
    method: request.method,
    body: request.body,
  });
  const raw = await requestText(request, source.respondTime || 20000);
  const context = createRuleContext(raw, request.url);
  const list = evaluateList(source.ruleSearch.bookList, context);
  bookSourceLogger.log('search', '搜索列表规则匹配完成', {
    sourceName: source.bookSourceName,
    requestUrl: request.url,
    htmlLength: raw.length,
    bookListRule: source.ruleSearch.bookList,
    listCount: list.length,
  });

  const books = list
    .map(item => {
      const rules = source.ruleSearch || {};
      const bookUrl = readRuleField(
        rules.bookUrl,
        raw,
        getSearchFieldBaseUrl(source, request.url, 'bookUrl'),
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
        name: readRuleField(rules.name, raw, request.url, item, 'name'),
        author: readRuleField(rules.author, raw, request.url, item, 'author'),
        coverUrl: readRuleField(
          rules.coverUrl,
          raw,
          getSearchFieldBaseUrl(source, request.url, 'coverUrl'),
          item,
          'coverUrl',
        ),
        intro: readRuleField(rules.intro, raw, request.url, item, 'intro'),
        latestChapterTitle: readRuleField(
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
    })
    .filter(Boolean) as BookSourceSearchResult[];

  const diagnostic = {
    ...baseDiagnostic,
    ok: true,
    stage: 'done',
    message:
      books.length > 0
        ? `搜索成功，解析到 ${books.length} 本书`
        : `请求成功，但 bookList 只匹配到 ${list.length} 项，最终有效书籍为 0`,
    requestUrl: request.url,
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
  const initItem = readBookInfoInit(rules.bookInfoInit, raw, request.url, vars);

  const nextBook: Book = {
    ...book,
    name:
      readRuleField(rules.name, raw, request.url, initItem, 'name', vars) ||
      book.name,
    author:
      readRuleField(rules.author, raw, request.url, initItem, 'author', vars) ||
      book.author,
    coverUrl:
      readRuleField(
        rules.coverUrl,
        raw,
        getBookInfoFieldBaseUrl(source, request.url, 'coverUrl'),
        initItem,
        'coverUrl',
        vars,
      ) || book.coverUrl,
    intro:
      readRuleField(rules.intro, raw, request.url, initItem, 'intro', vars) ||
      book.intro,
    latestChapterTitle:
      readRuleField(
        rules.lastChapter,
        raw,
        request.url,
        initItem,
        'lastChapter',
        vars,
      ) || book.latestChapterTitle,
    tocUrl:
      readRuleField(
        rules.tocUrl,
        raw,
        getBookInfoFieldBaseUrl(source, request.url, 'tocUrl'),
        initItem,
        'tocUrl',
        vars,
      ) ||
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
): Promise<{chapters: Chapter[]; nextUrl: string}> => {
  const request = resolveRequest(source, tocUrl, {}, tocUrl);
  const raw = await requestText(
    request,
    source.respondTime || 20000,
    cancelToken,
  );
  throwIfCancelled(cancelToken);
  const rules = source.ruleToc || {};
  const context = createRuleContext(raw, request.url, undefined, vars);
  throwIfCancelled(cancelToken);
  const list = evaluateList(rules.chapterList, context);
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
    const title = readRuleField(
      rules.chapterName,
      raw,
      request.url,
      item,
      'chapterName',
      ruleVars,
      context.json,
    );
    const chapterUrl = readRuleField(
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
  const nextUrl = readRuleField(
    rules.nextTocUrl,
    raw,
    request.url,
    undefined,
    'nextTocUrl',
    vars,
  );

  return {chapters, nextUrl};
};

export const LocalBookSourceService = {
  async getSources(): Promise<LegadoBookSource[]> {
    return enabledSources();
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
    const vars: Record<string, unknown> = {};
    const detailedBook = await getBookInfo(source, book, vars, cancelToken);
    throwIfCancelled(cancelToken);
    const firstTocUrl = detailedBook.tocUrl || detailedBook.bookUrl;
    const visited = new Set<string>();
    const chapters: Chapter[] = [];
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
    const vars: Record<string, unknown> = {book, chapter, title: chapter.title};
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
      const content = readRuleField(
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

      nextUrl = readRuleField(
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
    };
  },
};

export default LocalBookSourceService;
