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
  BookSourceDiagnostic,
  BookSourceSearchResult,
  ChapterListResult,
  ContentResult,
  LegadoBookSource,
  SearchBooksResult,
} from './types';
import {bookSourceLogger} from './bookSourceLogger';

const MAX_TOC_PAGES = 30;
const MAX_CONTENT_PAGES = 10;

const URL_RULE_KEYS = new Set([
  'bookUrl',
  'coverUrl',
  'tocUrl',
  'chapterUrl',
  'nextTocUrl',
  'nextContentUrl',
]);

const enabledSources = () =>
  BUILTIN_BOOK_SOURCES.filter(
    source => source.enabled !== false && source.bookSourceType !== 1,
  );

const sourceById = (sourceId?: string) => {
  return (
    enabledSources().find(source => source.bookSourceUrl === sourceId) ||
    enabledSources()[0]
  );
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
  const {regex, replacement} = splitRegexTail(replaceRegex);
  return applyRegexTail(text, regex, replacement);
};

const readRuleField = (
  rule: string | undefined,
  raw: string,
  baseUrl: string,
  item?: RuleItem,
  key?: string,
) => {
  return evaluateString(
    rule,
    createRuleContext(raw, baseUrl, item),
    key ? URL_RULE_KEYS.has(key) : false,
  );
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
): Promise<Book> => {
  const request = resolveRequest(source, book.bookUrl, {}, book.bookUrl);
  const raw = await requestText(request, source.respondTime || 20000);
  const rules = source.ruleBookInfo || {};

  const nextBook: Book = {
    ...book,
    name:
      readRuleField(rules.name, raw, request.url, undefined, 'name') ||
      book.name,
    author:
      readRuleField(rules.author, raw, request.url, undefined, 'author') ||
      book.author,
    coverUrl:
      readRuleField(
        rules.coverUrl,
        raw,
        getBookInfoFieldBaseUrl(source, request.url, 'coverUrl'),
        undefined,
        'coverUrl',
      ) || book.coverUrl,
    intro:
      readRuleField(rules.intro, raw, request.url, undefined, 'intro') ||
      book.intro,
    latestChapterTitle:
      readRuleField(
        rules.lastChapter,
        raw,
        request.url,
        undefined,
        'lastChapter',
      ) || book.latestChapterTitle,
    tocUrl:
      readRuleField(
        rules.tocUrl,
        raw,
        getBookInfoFieldBaseUrl(source, request.url, 'tocUrl'),
        undefined,
        'tocUrl',
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
): Promise<{chapters: Chapter[]; nextUrl: string}> => {
  const request = resolveRequest(source, tocUrl, {}, tocUrl);
  const raw = await requestText(request, source.respondTime || 20000);
  const rules = source.ruleToc || {};
  const context = createRuleContext(raw, request.url);
  const list = evaluateList(rules.chapterList, context);
  const seen = new Set<string>();
  bookSourceLogger.log('toc', '目录列表规则匹配完成', {
    sourceName: source.bookSourceName,
    requestUrl: request.url,
    chapterListRule: rules.chapterList,
    listCount: list.length,
  });

  const chapters = list
    .map((item, offset) => {
      const title = readRuleField(
        rules.chapterName,
        raw,
        request.url,
        item,
        'chapterName',
      );
      const chapterUrl = readRuleField(
        rules.chapterUrl,
        raw,
        request.url,
        item,
        'chapterUrl',
      );

      if (!title || !chapterUrl || seen.has(chapterUrl)) {
        bookSourceLogger.warn('toc', '目录项被丢弃', {
          sourceName: source.bookSourceName,
          title,
          chapterUrl,
          duplicated: chapterUrl ? seen.has(chapterUrl) : false,
        });
        return null;
      }
      seen.add(chapterUrl);

      return {
        title,
        bookUrl: chapterUrl,
        baseUrl: request.url,
        sourceId: source.bookSourceUrl,
        index: startIndex + offset,
      } as Chapter;
    })
    .filter(Boolean) as Chapter[];

  const nextUrl = readRuleField(
    rules.nextTocUrl,
    raw,
    request.url,
    undefined,
    'nextTocUrl',
  );

  return {chapters, nextUrl};
};

export const LocalBookSourceService = {
  getSources(): LegadoBookSource[] {
    return enabledSources();
  },

  async searchBooksWithDiagnostics(
    keyword: string,
    page = 1,
  ): Promise<SearchBooksResult> {
    const sources = enabledSources();
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

  async searchBooks(
    keyword: string,
    page = 1,
  ): Promise<BookSourceSearchResult[]> {
    return (await this.searchBooksWithDiagnostics(keyword, page)).books;
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

  async getChapterList(book: Book): Promise<ChapterListResult> {
    const source = sourceById(book.origin);
    if (!source) {
      throw new Error('未找到可用书源');
    }

    bookSourceLogger.log('toc', '开始解析目录', {
      sourceName: source.bookSourceName,
      bookName: book.name,
      bookUrl: book.bookUrl,
    });
    const detailedBook = await getBookInfo(source, book);
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
      );
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

  async getBookContent(book: Book, chapter: Chapter): Promise<ContentResult> {
    const source = sourceById(book.origin || chapter.sourceId);
    if (!source) {
      throw new Error('未找到可用书源');
    }

    const visited = new Set<string>();
    const chunks: string[] = [];
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

      const request = resolveRequest(
        source,
        nextUrl,
        {},
        chapter.baseUrl || nextUrl,
      );
      if (page === 0) {
        firstRequestUrl = request.url;
      }
      const raw = await requestText(request, source.respondTime || 20000);
      const rules = source.ruleContent || {};
      const content = readRuleField(
        rules.content,
        raw,
        request.url,
        undefined,
        'content',
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
