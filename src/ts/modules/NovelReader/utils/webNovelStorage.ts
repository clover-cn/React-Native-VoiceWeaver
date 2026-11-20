import {readDocument, writeDocument} from '../local/native';
import type {Book, Chapter} from '../types/reader';
import {
  MAX_ARTICLE_LENGTH,
  normalizeArticleText,
  normalizeArticleUrl,
} from './article';
import {buildListenProjectName, createTextHash} from './listenBook';
import {updateWebNovelRecords} from './readerStorage';

type WebNovelTarget = {newBookId: string} | {bookUrl: string};

interface WebNovelDraft {
  bookTitle: string;
  title: string;
  text: string;
  sourceUrl: string;
}

const chapterFile = (book: Book, index: number) =>
  `chapter-${createTextHash(buildListenProjectName(book))}-${index}.json`;

const urlKey = (url: string) =>
  url.replace(/^https?:\/\/[^/?#]+/i, authority => authority.toLowerCase());

/** 章节文件先于目录提交，重试时可重写同一个尚未发布的序号。 */
export async function saveWebNovelChapter(
  target: WebNovelTarget,
  draft: WebNovelDraft,
) {
  const creating = 'newBookId' in target;
  const bookUrl = creating
    ? `local://web-novel/${target.newBookId}`
    : target.bookUrl;
  const bookTitle = draft.bookTitle.trim();
  const title = draft.title.trim();
  const text = normalizeArticleText(draft.text);
  const sourceUrl = normalizeArticleUrl(draft.sourceUrl);
  if (!title || (creating && !bookTitle)) {
    throw new Error(creating ? '请填写书名和章节名。' : '请填写章节名。');
  }
  if (!text || text.length > MAX_ARTICLE_LENGTH) {
    throw new Error(
      `章节正文不能为空，且不能超过 ${MAX_ARTICLE_LENGTH} 字符。`,
    );
  }
  const contentHash = createTextHash(text);

  return updateWebNovelRecords(async records => {
    const current = records.find(record => record.book.bookUrl === bookUrl);
    if (!creating && !current) {
      throw new Error('目标小说已从书架删除，请重新导入。');
    }
    const chapters = current?.chapterList ?? [];
    const duplicate = chapters.find(
      chapter =>
        chapter.contentHash === contentHash ||
        (chapter.sourceUrl && urlKey(chapter.sourceUrl) === urlKey(sourceUrl)),
    );
    if (duplicate) {
      throw new Error(`「${duplicate.title}」已导入，请核对本次抓取的章节。`);
    }
    if (creating && current) {
      throw new Error('这本小说已创建，请在阅读器里追加章节。');
    }

    const book: Book = {
      ...(current?.book ?? {
        bookUrl,
        name: bookTitle,
        author: '',
        sourceType: 'local_web_novel',
        contentType: 'novel',
        originName: '网页导入',
        sourceUrl,
      }),
      latestChapterTitle: title,
    };
    const index = chapters.length;
    const chapter: Chapter = {
      title,
      index,
      bookUrl: `${bookUrl}/chapter/${index}`,
      sourceUrl,
      contentHash,
    };
    await writeDocument(chapterFile(book, index), {text});
    return [
      {
        currentChapterIndex: 0,
        currentChapter: chapter,
        contentRequest: {url: chapter.bookUrl, options: {method: 'LOCAL'}},
        ...current,
        book,
        chapterList: [...chapters, chapter],
        updatedAt: Date.now(),
      },
      ...records.filter(record => record !== current),
    ];
  });
}

export async function readWebNovelChapter(book: Book, chapter: Chapter) {
  const snapshot = await readDocument<{text: string} | null>(
    chapterFile(book, chapter.index),
    null,
  );
  if (!snapshot?.text) {
    throw new Error('此章节的本地正文不存在。');
  }
  return {
    text: snapshot.text,
    paragraphs: snapshot.text.split(/\n+/).filter(Boolean),
    requestUrl: chapter.bookUrl,
  };
}
