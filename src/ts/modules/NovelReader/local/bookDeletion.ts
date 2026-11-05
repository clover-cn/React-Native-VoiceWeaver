import {deleteBookProject} from './engine';
import {
  ReadingRecord,
  clearBookListeningData,
  removeReadingRecord,
} from '../utils/readerStorage';
import {buildListenProjectName} from '../utils/listenBook';
import {
  deleteLocalTxtBookFile,
  isLocalTxtBook,
} from '../utils/localBookStorage';

/** 书架条目最后删除，清理失败时保留入口以便重试。 */
export async function deleteBookData(
  record: ReadingRecord,
): Promise<ReadingRecord[]> {
  await deleteBookProject(
    buildListenProjectName(record.book),
    async savedIndexes => {
      const indexes = [
        ...savedIndexes,
        ...record.chapterList.map((_chapter, index) => index),
      ];
      await clearBookListeningData(
        buildListenProjectName(record.book),
        indexes,
      );
      if (isLocalTxtBook(record.book)) {
        await deleteLocalTxtBookFile(record.book.localBookId || '');
      }
    },
  );
  return removeReadingRecord(record.book.bookUrl);
}
