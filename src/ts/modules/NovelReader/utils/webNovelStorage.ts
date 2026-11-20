import {readDocument, writeDocument} from '../local/native';
import type {Book, Chapter} from '../types/reader';
import {
  MAX_ARTICLE_LENGTH,
  normalizeArticleText,
  normalizeArticleUrl,
} from './article';
import {buildListenProjectName, createTextHash} from './listenBook';
import {
  clearChapterListeningData,
  updateWebNovelRecords,
} from './readerStorage';

type WebNovelTarget = {newBookId: string} | {bookUrl: string};

export interface WebNovelDraft {
  bookTitle: string;
  title: string;
  text: string;
  sourceUrl: string;
}

const chapterFile = (book: Book, index: number) =>
  `chapter-${createTextHash(buildListenProjectName(book))}-${index}.json`;

const urlKey = (url: string) =>
  url.replace(/^https?:\/\/[^/?#]+/i, authority => authority.toLowerCase());

/** 网页章节的文件和音频序号独立于目录位置，删章后也不复用。 */
export function chapterStorageIndex(
  book: Book | null,
  chapters: Chapter[],
  position: number,
) {
  return book?.sourceType === 'local_web_novel'
    ? chapters[position]?.index ?? -1
    : position;
}

const nextChapterIndex = (chapters: Chapter[], savedIndex?: number) =>
  savedIndex ?? (chapters[chapters.length - 1]?.index ?? -1) + 1;

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

  const records = await updateWebNovelRecords(async currentRecords => {
    const current = currentRecords.find(
      record => record.book.bookUrl === bookUrl,
    );
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
    const index = nextChapterIndex(chapters, current?.nextWebChapterIndex);
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
        ...current,
        book,
        chapterList: [...chapters, chapter],
        nextWebChapterIndex: index + 1,
        currentChapterIndex:
          chapters.length === 0 ? 0 : current?.currentChapterIndex ?? 0,
        currentChapter: current?.currentChapter ?? chapter,
        contentRequest: current?.currentChapter
          ? current.contentRequest
          : {url: chapter.bookUrl, options: {method: 'LOCAL'}},
        updatedAt: Date.now(),
      },
      ...currentRecords.filter(record => record !== current),
    ];
  });
  const record = records.find(item => item.book.bookUrl === bookUrl);
  if (!record) {
    throw new Error('未找到保存后的小说。');
  }
  return {records, record};
}

export async function removeWebNovelChapter(
  bookUrl: string,
  chapterUrl: string,
) {
  return updateWebNovelRecords(records => {
    const current = records.find(record => record.book.bookUrl === bookUrl);
    const removedPosition =
      current?.chapterList.findIndex(
        chapter => chapter.bookUrl === chapterUrl,
      ) ?? -1;
    if (!current || removedPosition < 0) {
      return records;
    }
    const chapters = current.chapterList.filter(
      chapter => chapter.bookUrl !== chapterUrl,
    );
    const retainedPosition = chapters.findIndex(
      chapter => chapter.bookUrl === current.currentChapter?.bookUrl,
    );
    const position =
      retainedPosition >= 0
        ? retainedPosition
        : Math.min(removedPosition, chapters.length - 1);
    const chapter = chapters[position];
    return records.map(record =>
      record === current
        ? {
            ...current,
            book: {
              ...current.book,
              latestChapterTitle: chapters[chapters.length - 1]?.title,
            },
            chapterList: chapters,
            nextWebChapterIndex: nextChapterIndex(
              current.chapterList,
              current.nextWebChapterIndex,
            ),
            currentChapterIndex: position,
            currentChapter: chapter,
            contentRequest: {
              url: chapter?.bookUrl ?? bookUrl,
              options: {method: 'LOCAL'},
            },
          }
        : record,
    );
  });
}

export async function clearWebNovelChapterFiles(book: Book, chapter: Chapter) {
  // 原子写入空值，避免失败时留下半截正文。
  await writeDocument(chapterFile(book, chapter.index), null);
  await clearChapterListeningData(buildListenProjectName(book), chapter.index);
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
