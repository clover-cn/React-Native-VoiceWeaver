import {Book, Chapter} from '../types/reader';
import {buildListenProjectName} from './listenBook';
import {loadProject, updateProject} from '../local/repository';
import {
  buildArticleBook,
  MAX_ARTICLE_LENGTH,
  normalizeArticleText,
} from './article';
import {ReadingRecord} from './readerStorage';
import {assertArticleReferenceAvailable} from '../local/preflight';

/** 正文快照与听书项目共用私有文件，随现有书籍删除流程一起清理。 */
export async function saveArticle(
  title: string,
  input: string,
  sourceUrl?: string,
  referenceAudioId?: string,
): Promise<ReadingRecord> {
  const text = normalizeArticleText(input);
  if (!text || text.length > MAX_ARTICLE_LENGTH) {
    throw new Error(`正文不能为空，且不能超过 ${MAX_ARTICLE_LENGTH} 字符。`);
  }
  const book = buildArticleBook(title, text, sourceUrl);
  if (referenceAudioId) {
    await assertArticleReferenceAvailable(referenceAudioId);
  }
  await updateProject(buildListenProjectName(book), project => {
    project.listenMode = 'plain';
    project.articleReferenceAudioId = referenceAudioId || undefined;
    project.articleSnapshot = {
      title: book.name,
      text,
      sourceUrl,
      savedAt: Date.now(),
    };
  });
  const chapter: Chapter = {
    title: book.name,
    bookUrl: `${book.bookUrl}/chapter/0`,
    index: 0,
  };
  return {
    book,
    chapterList: [chapter],
    currentChapterIndex: 0,
    currentChapter: chapter,
    contentRequest: {url: chapter.bookUrl, options: {method: 'LOCAL'}},
    updatedAt: Date.now(),
  };
}

export async function readArticle(book: Book) {
  const snapshot = (await loadProject(buildListenProjectName(book)))
    .articleSnapshot;
  if (!snapshot?.text) {
    throw new Error('本地文章快照不存在，请重新导入。');
  }
  return {
    text: snapshot.text,
    paragraphs: snapshot.text.split(/\n+/).filter(Boolean),
    requestUrl: `${book.bookUrl}/chapter/0`,
  };
}
