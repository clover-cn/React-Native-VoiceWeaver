import {deleteBookProject} from './engine';
import {
  ReadingRecord,
  clearBookListeningData,
  removeReadingRecord,
  updateWebNovelRecords,
} from '../utils/readerStorage';
import {buildListenProjectName} from '../utils/listenBook';
import {
  deleteLocalTxtBookFile,
  isLocalTxtBook,
} from '../utils/localBookStorage';

async function deleteBookFiles(record: ReadingRecord): Promise<void> {
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
}

/** 书架条目最后删除，清理失败时保留入口以便重试。 */
export async function deleteBookData(
  record: ReadingRecord,
): Promise<ReadingRecord[]> {
  if (record.book.sourceType === 'local_web_novel') {
    return updateWebNovelRecords(async records => {
      const current = records.find(
        item => item.book.bookUrl === record.book.bookUrl,
      );
      if (!current) {
        return records;
      }
      await deleteBookFiles(current);
      return records.filter(item => item !== current);
    });
  }
  await deleteBookFiles(record);
  return removeReadingRecord(record.book.bookUrl);
}
