import {Platform} from 'react-native';
import iconv from 'iconv-lite';
import {Buffer} from 'buffer';
import bridge from '../../base/utils/bridge';
import {Book, Chapter} from '../types/reader';
import {createTextHash, normalizeChapterTextForRequest} from './listenBook';

interface NativeTxtBookResult {
  cancelled?: boolean;
  success?: boolean;
  localBookId?: string;
  name?: string;
  size?: number;
  content?: string;
  contentBase64?: string;
  error?: string;
}

interface ParsedLocalChapter {
  title: string;
  text: string;
  paragraphs: string[];
}

export interface LocalTxtBookImport {
  book: Book;
  chapters: Chapter[];
  fileName: string;
  fileSize: number;
  contentHash: string;
}

const MAX_TITLE_LENGTH = 80;
const CHAPTER_NUMBER = '[0-9零〇一二三四五六七八九十百千万两]+';
const CHAPTER_PATTERNS = [
  new RegExp(
    `^第\\s*${CHAPTER_NUMBER}\\s*(?:章|回|节|集|篇|卷|部)(?:\\s|[:：.．、-]|$)`,
  ),
  /^chapter\s+\d+(?:\s|[:：.．、-]|$)/i,
  /^\d{1,5}[、.．]\s*\S+/,
];
const localTextCache = new Map<string, string>();

interface TxtDecodeResult {
  content: string;
  encoding: string;
  repaired: boolean;
  score: number;
  originalScore: number;
}

const callNative = (
  invoke: (callback: (result: string) => void) => void,
): Promise<string> => {
  return new Promise((resolve, reject) => {
    try {
      invoke(result => resolve(result || ''));
    } catch (error) {
      reject(error);
    }
  });
};

// 部分下载器生成的 TXT 可能包含孤立 UTF-16 代理字符。
// 这类字符无法安全通过 URI/RN Bridge，保留合法代理对（例如 emoji），移除孤立字符。
export const sanitizeUtf16 = (value: string): string => {
  const source = String(value || '');
  let result = '';

  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    const isHighSurrogate = code >= 0xd800 && code <= 0xdbff;
    const isLowSurrogate = code >= 0xdc00 && code <= 0xdfff;

    if (isHighSurrogate) {
      const nextCode = source.charCodeAt(index + 1);
      if (nextCode >= 0xdc00 && nextCode <= 0xdfff) {
        result += source.slice(index, index + 2);
        index += 1;
      }
      continue;
    }

    if (isLowSurrogate) {
      continue;
    }

    result += source[index];
  }

  return result;
};

const parseNativeResult = (result: string, fallbackMessage: string) => {
  if (!result) {
    throw new Error(fallbackMessage);
  }

  try {
    return JSON.parse(result) as NativeTxtBookResult;
  } catch (_error) {
    throw new Error(fallbackMessage);
  }
};

const normalizeText = (content: string) =>
  sanitizeUtf16(content)
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n');

const scoreTxtContent = (content: string): number => {
  let score = 0;
  let cjkCount = 0;
  let suspiciousLatin1Count = 0;

  for (let index = 0; index < content.length; index += 1) {
    const code = content.charCodeAt(index);
    if (
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x4e00 && code <= 0x9fff)
    ) {
      cjkCount += 1;
    }
    if ((code >= 0x00a1 && code <= 0x00ff) || code === 0x0080) {
      suspiciousLatin1Count += 1;
    }
    if (code === 0xfffd) {
      score -= 500;
    }
    if (code === 0 || (code < 0x20 && code !== 0x09 && code !== 0x0a)) {
      score -= 80;
    }
  }

  score += cjkCount * 4;
  score -= suspiciousLatin1Count;
  if (content.indexOf('《') >= 0) {
    score += 300;
  }
  if (content.indexOf('》') >= 0) {
    score += 300;
  }
  if (content.indexOf('第') >= 0) {
    score += 120;
  }
  if (content.indexOf('章') >= 0 || content.indexOf('回') >= 0) {
    score += 100;
  }
  if (CHAPTER_PATTERNS.some(pattern => pattern.test(content))) {
    score += 160;
  }
  return score;
};

const buildLatin1Bytes = (content: string): Buffer | null => {
  const bytes = Buffer.allocUnsafe(content.length);
  for (let index = 0; index < content.length; index += 1) {
    const code = content.charCodeAt(index);
    if (code > 0xff) {
      return null;
    }
    bytes[index] = code;
  }
  return bytes;
};

const decodeTxtContentWithMeta = (content: string): TxtDecodeResult => {
  const source = normalizeText(content);
  const originalScore = scoreTxtContent(source);
  let best: TxtDecodeResult = {
    content: source,
    encoding: 'native',
    repaired: false,
    score: originalScore,
    originalScore,
  };

  const latin1Bytes = buildLatin1Bytes(source);
  if (!latin1Bytes) {
    return best;
  }

  ['gb18030', 'gbk'].forEach(encoding => {
    const decoded = normalizeText(iconv.decode(latin1Bytes, encoding));
    const score = scoreTxtContent(decoded);
    if (score > best.score + 50) {
      best = {
        content: decoded,
        encoding,
        repaired: true,
        score,
        originalScore,
      };
    }
  });

  return best;
};

export const decodeTxtContent = (content: string) =>
  decodeTxtContentWithMeta(content).content;

const decodeTxtBytesWithMeta = (
  contentBase64: string,
  fallbackContent: string,
): TxtDecodeResult => {
  const bytes = Buffer.from(contentBase64 || '', 'base64');
  if (bytes.length === 0) {
    return decodeTxtContentWithMeta(fallbackContent);
  }

  const fallback = decodeTxtContentWithMeta(fallbackContent);
  let best: TxtDecodeResult = {
    content: fallback.content,
    encoding: `${fallback.encoding}-fallback`,
    repaired: fallback.repaired,
    score: fallback.score,
    originalScore: fallback.originalScore,
  };

  ['utf8', 'gb18030', 'gbk', 'utf16le', 'utf16be'].forEach(encoding => {
    const decoded = normalizeText(iconv.decode(bytes, encoding));
    const score = scoreTxtContent(decoded);
    if (score > best.score + 50) {
      best = {
        content: decoded,
        encoding,
        repaired: encoding !== 'utf8',
        score,
        originalScore: fallback.originalScore,
      };
    }
  });

  return best;
};

const decodeNativeTxtPayload = (result: NativeTxtBookResult) => {
  if (result.contentBase64) {
    return decodeTxtBytesWithMeta(result.contentBase64, result.content || '');
  }
  return decodeTxtContentWithMeta(result.content || '');
};

const normalizeContent = decodeTxtContent;

const normalizeLine = (line: string) =>
  line.replace(/^[ \t\u3000]+/, '').replace(/[ \t\u3000]+$/, '');

const isChapterHeading = (line: string) => {
  const value = normalizeLine(line);
  return (
    value.length > 0 &&
    value.length <= MAX_TITLE_LENGTH &&
    CHAPTER_PATTERNS.some(pattern => pattern.test(value))
  );
};

const toParagraphs = (text: string): string[] => {
  const normalized = text
    .split('\n')
    .map(normalizeLine)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!normalized) {
    return [];
  }

  return normalized
    .split(/\n\s*\n+/)
    .map(paragraph => paragraph.replace(/\n+/g, ' ').trim())
    .filter(Boolean);
};

const getFallbackTitle = (fileName: string) => {
  const value = sanitizeUtf16(fileName)
    .replace(/\.[^.]+$/, '')
    .trim();
  return value || '未命名书籍';
};

const getBookTitle = (line: string, fileName: string) => {
  const value = normalizeLine(line);
  const bracketed = value.match(/^《(.+?)》$/);
  if (bracketed?.[1]?.trim()) {
    return bracketed[1].trim();
  }

  return value && !isChapterHeading(value)
    ? value.replace(/^书名[：:]/, '').trim()
    : getFallbackTitle(fileName);
};

const isExplicitTitleLine = (line: string) => {
  const value = normalizeLine(line);
  return /^《.+》$/.test(value) || /^书名[：:]/.test(value);
};

const getAuthor = (lines: string[]) => {
  const authorLine = lines
    .slice(0, 12)
    .map(normalizeLine)
    .find(line => /^作者[：:]/.test(line));
  return authorLine?.replace(/^作者[：:]/, '').trim() || '未知作者';
};

export const parseTxtNovel = (
  content: string,
  fileName: string,
): {
  title: string;
  author: string;
  intro?: string;
  chapters: ParsedLocalChapter[];
} => {
  const normalized = normalizeContent(content);
  const safeFileName = sanitizeUtf16(fileName);
  const lines = normalized.split('\n');
  const firstContentIndex = lines.findIndex(
    line => normalizeLine(line).length > 0,
  );
  const title = getBookTitle(
    firstContentIndex >= 0 ? lines[firstContentIndex] : '',
    safeFileName,
  );
  const bodyStart =
    firstContentIndex >= 0 && isExplicitTitleLine(lines[firstContentIndex])
      ? firstContentIndex + 1
      : Math.max(firstContentIndex, 0);
  const author = getAuthor(lines);
  const headingIndexes: number[] = [];

  lines.forEach((line, index) => {
    if (isChapterHeading(line)) {
      headingIndexes.push(index);
    }
  });

  const chapterRanges: Array<{title: string; start: number; end: number}> = [];
  if (headingIndexes.length === 0) {
    const body = lines.slice(bodyStart).join('\n');
    chapterRanges.push({title: '全文', start: 0, end: lines.length});
    const paragraphs = toParagraphs(body);
    return {
      title:
        firstContentIndex >= 0 && isExplicitTitleLine(lines[firstContentIndex])
          ? title
          : getFallbackTitle(safeFileName),
      author,
      intro: paragraphs[0]?.slice(0, 160),
      chapters: [{title: '全文', text: body, paragraphs}],
    };
  }

  const firstHeading = headingIndexes[0];
  const preface = lines.slice(bodyStart, firstHeading).join('\n');
  if (toParagraphs(preface).length > 0) {
    chapterRanges.push({
      title: '前言',
      start: bodyStart,
      end: firstHeading,
    });
  }

  headingIndexes.forEach((headingIndex, index) => {
    const end = headingIndexes[index + 1] ?? lines.length;
    chapterRanges.push({
      title: normalizeLine(lines[headingIndex]),
      start: headingIndex + 1,
      end,
    });
  });

  const chapters = chapterRanges
    .map(range => {
      const text = lines.slice(range.start, range.end).join('\n');
      return {
        title: range.title,
        text,
        paragraphs: toParagraphs(text),
      };
    })
    .filter(
      chapter => chapter.paragraphs.length > 0 || chapter.title === '全文',
    );

  return {
    title,
    author,
    intro: chapters
      .find(chapter => chapter.paragraphs.length > 0)
      ?.paragraphs[0]?.slice(0, 160),
    chapters:
      chapters.length > 0
        ? chapters
        : [
            {
              title: '全文',
              text: normalized,
              paragraphs: toParagraphs(normalized),
            },
          ],
  };
};

export const buildLocalTxtBook = (
  result: NativeTxtBookResult,
): LocalTxtBookImport => {
  const localBookId = String(result.localBookId || '').trim();
  const fileName =
    sanitizeUtf16(String(result.name || '未命名.txt')).trim() || '未命名.txt';
  const decoded = decodeNativeTxtPayload(result);
  console.info(
    `[localBookStorage] import phase=decode encoding=${
      decoded.encoding
    } repaired=${decoded.repaired} originalScore=${
      decoded.originalScore
    } score=${decoded.score} hasBase64=${Boolean(result.contentBase64)}`,
  );
  const content = decoded.content;
  if (!localBookId || !content.trim()) {
    throw new Error('TXT 文件内容为空或本地保存失败');
  }

  const parsed = parseTxtNovel(content, fileName);
  const contentHash = createTextHash(normalizeChapterTextForRequest(content));
  const bookUrl = `local://book/${localBookId}`;
  const chapters = parsed.chapters.map((chapter, index) => ({
    title: chapter.title,
    bookUrl: `${bookUrl}/chapter/${index}`,
    index,
    sourceId: localBookId,
    baseUrl: bookUrl,
  }));

  return {
    fileName,
    fileSize: Number(result.size || 0),
    contentHash,
    chapters,
    book: {
      name: parsed.title,
      author: parsed.author,
      intro: parsed.intro,
      latestChapterTitle: chapters[chapters.length - 1]?.title,
      bookUrl,
      tocUrl: bookUrl,
      origin: 'local_txt',
      originName: '本地 TXT',
      sourceType: 'local_txt',
      localBookId,
      contentHash,
    },
  };
};

export const importLocalTxtBook =
  async (): Promise<LocalTxtBookImport | null> => {
    if ((Platform.OS as string) !== 'harmony') {
      throw new Error('当前仅支持鸿蒙端导入 TXT 文件');
    }

    console.info('[localBookStorage] import phase=select-start');
    let nativeResult = '';
    try {
      nativeResult = await callNative(callback =>
        bridge.selectTxtDocument(callback),
      );
      console.info(
        `[localBookStorage] import phase=native-result length=${nativeResult.length}`,
      );
    } catch (error) {
      console.warn('[localBookStorage] import phase=native-call-failed', error);
      throw error;
    }

    const payload = parseNativeResult(nativeResult, 'TXT 文件选择失败');
    console.info(
      `[localBookStorage] import phase=native-parsed cancelled=${Boolean(
        payload.cancelled,
      )} contentLength=${String(payload.content || '').length}`,
    );
    if (payload.cancelled) {
      if (payload.error) {
        throw new Error(payload.error);
      }
      return null;
    }

    try {
      console.info('[localBookStorage] import phase=parse-start');
      const imported = buildLocalTxtBook(payload);
      console.info(
        `[localBookStorage] import phase=parse-success chapters=${imported.chapters.length}`,
      );
      return imported;
    } catch (error) {
      if (payload.localBookId) {
        try {
          await deleteLocalTxtBookFile(payload.localBookId);
        } catch (cleanupError) {
          console.warn(
            '[localBookStorage] 清理导入失败的 TXT 文件失败',
            cleanupError,
          );
        }
      }
      throw error;
    }
  };

export const readLocalTxtBookContent = async (
  localBookId: string,
): Promise<string> => {
  const cachedContent = localTextCache.get(localBookId);
  if (cachedContent !== undefined) {
    return cachedContent;
  }

  const payload = parseNativeResult(
    await callNative(callback =>
      bridge.readLocalTxtBook(localBookId, callback),
    ),
    '读取本地 TXT 失败',
  );
  if (!payload.success || !payload.content) {
    if (!payload.contentBase64) {
      throw new Error(payload.error || '本地 TXT 内容为空');
    }
  }
  const decoded = decodeNativeTxtPayload(payload);
  const content = decoded.content;
  localTextCache.set(localBookId, content);
  return content;
};

export const deleteLocalTxtBookFile = async (localBookId: string) => {
  const payload = parseNativeResult(
    await callNative(callback =>
      bridge.deleteLocalTxtBook(localBookId, callback),
    ),
    '删除本地 TXT 失败',
  );
  if (!payload.success) {
    throw new Error(payload.error || '删除本地 TXT 失败');
  }
  localTextCache.delete(localBookId);
};

export const isLocalTxtBook = (book?: Book | null) =>
  book?.sourceType === 'local_txt' && Boolean(book.localBookId);

export const isSameLocalBook = (left: Book, right: Book) => {
  if (!isLocalTxtBook(left) || !isLocalTxtBook(right)) {
    return false;
  }

  if (left.contentHash && right.contentHash === left.contentHash) {
    return true;
  }

  return (
    left.name.trim().toLowerCase() === right.name.trim().toLowerCase() &&
    left.author.trim().toLowerCase() === right.author.trim().toLowerCase()
  );
};

export const getLocalChapterContent = (
  content: string,
  fileName: string,
  chapterIndex: number,
) => {
  const parsed = parseTxtNovel(content, fileName);
  const chapter = parsed.chapters[chapterIndex];
  if (!chapter) {
    throw new Error('本地 TXT 章节不存在');
  }

  return {
    text: chapter.text,
    paragraphs: chapter.paragraphs,
  };
};
