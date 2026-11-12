import {Book, ListenSegment} from '../types/reader';
import {createTextHash} from './listenBook';
import {sanitizeUtf16} from './localBookStorage';

export const MAX_ARTICLE_LENGTH = 200000;

/** 网页入口只接受普通网络地址，不允许脚本、本地文件和带凭据的地址。 */
export function normalizeArticleUrl(input: string): string {
  const value = input.trim();
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(value);
  const hostWithPort = /^[^/?#:\s]+:\d+(?:[/?#]|$)/.test(value);
  const url = hasScheme && !hostWithPort ? value : `https://${value}`;
  if (!/^https?:\/\/[^\s/?#@:]+(?::\d{1,5})?(?:[/?#][^\s]*)?$/i.test(url)) {
    throw new Error('请输入有效的 HTTP 或 HTTPS 网页地址。');
  }
  return url;
}

export function normalizeArticleText(text: string): string {
  return sanitizeUtf16(text)
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 按句末标点和长度切分，不改写原文；长句保持代理字符完整。 */
export function buildPlainSegments(text: string): ListenSegment[] {
  const normalized = normalizeArticleText(text);
  if (!normalized || normalized.length > MAX_ARTICLE_LENGTH) {
    throw new Error(`正文不能为空，且不能超过 ${MAX_ARTICLE_LENGTH} 字符。`);
  }
  const pieces: string[] = [];
  for (const paragraph of normalized.split(/\n+/).filter(Boolean)) {
    let chunk = '';
    for (const char of Array.from(paragraph)) {
      chunk += char;
      if (
        (chunk.length >= 80 && /[。！？!?；;…]/.test(char)) ||
        chunk.length >= 300
      ) {
        pieces.push(chunk);
        chunk = '';
      }
    }
    if (chunk.trim()) {
      pieces.push(chunk);
    }
  }
  return pieces.map((piece, index) => ({
    index,
    text: piece,
    type: 'narration',
    role: '旁白',
    emotion: 'neutral',
  }));
}

/** 内容、标题和来源共同确定快照标识；重复导入不会覆盖其他文章。 */
export function buildArticleBook(
  title: string,
  text: string,
  sourceUrl?: string,
): Book {
  const name = sanitizeUtf16(title).trim().slice(0, 200) || '未命名文章';
  const id = createTextHash(JSON.stringify([name, text, sourceUrl || '']));
  return {
    name,
    author: '文章',
    bookUrl: `local://article/${id}`,
    sourceType: 'local_article',
    contentType: 'article',
    listenMode: 'plain',
    sourceUrl,
    originName: sourceUrl ? '网页文章' : '本地文章',
    intro: text.slice(0, 160),
    contentHash: createTextHash(text),
  };
}
