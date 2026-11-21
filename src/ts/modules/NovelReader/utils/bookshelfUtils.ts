import {Alert} from 'react-native';
import {ReadingRecord} from './readerStorage';

/** 书架筛选标签类型（仅保留全部、在听、已听完） */
export type BookshelfFilterTab = 'all' | 'listening' | 'finished';

/** 书架展示模式：网格或列表 */
export type BookshelfViewMode = 'grid' | 'list';

/** 书架书籍进度元数据 */
export interface BookProgressMeta {
  totalChapters: number;
  currentChapterNum: number;
  percent: number;
  isFinished: boolean;
  badgeText: string;
  subtitleText: string;
}

/**
 * 计算单本书籍的听书/阅读进度元数据
 */
export const getBookProgressMeta = (
  record: ReadingRecord,
  isLastListened: boolean,
): BookProgressMeta => {
  const totalChapters = record.chapterList?.length || 0;
  const currentIndex = Math.max(0, record.currentChapterIndex || 0);
  const currentChapterNum =
    totalChapters > 0 ? Math.min(totalChapters, currentIndex + 1) : 1;

  // 多章书籍到达最后一章视为已听完；单章书籍暂不自动判完，保留在听状态
  const isFinished = totalChapters > 1 && currentIndex >= totalChapters - 1;
  const percent =
    totalChapters > 0
      ? isFinished
        ? 100
        : Math.max(1, Math.min(99, Math.round((currentChapterNum / totalChapters) * 100)))
      : 0;

  let badgeText = '准备聆听';
  if (isLastListened) {
    badgeText = '上次收听';
  } else if (isFinished) {
    badgeText = '✓ 已听完';
  } else if (totalChapters > 0) {
    badgeText = `已听 ${percent}%`;
  }

  let subtitleText = '准备聆听';
  if (isFinished) {
    subtitleText = `已听完 · ${totalChapters}章`;
  } else if (totalChapters > 0) {
    subtitleText = `第${currentChapterNum}章 · ${percent}%`;
  } else if (record.currentChapter?.title) {
    subtitleText = record.currentChapter.title;
  }

  return {
    totalChapters,
    currentChapterNum,
    percent,
    isFinished,
    badgeText,
    subtitleText,
  };
};

/**
 * 统计各筛选标签下的书籍数量
 */
export const getBookshelfTabCounts = (records: ReadingRecord[]) => {
  let finishedCount = 0;
  records.forEach(record => {
    const {isFinished} = getBookProgressMeta(record, false);
    if (isFinished) {
      finishedCount += 1;
    }
  });
  return {
    all: records.length,
    listening: records.length - finishedCount,
    finished: finishedCount,
  };
};

/**
 * 根据筛选标签过滤书架书籍列表
 */
export const filterBookshelfRecords = (
  records: ReadingRecord[],
  filter: BookshelfFilterTab,
): ReadingRecord[] => {
  if (filter === 'all') {
    return records;
  }
  return records.filter(record => {
    const {isFinished} = getBookProgressMeta(record, false);
    return filter === 'finished' ? isFinished : !isFinished;
  });
};

/**
 * 弹出确认删除书籍及本地数据的对话框
 */
export const confirmRemoveBookRecord = (
  record: ReadingRecord,
  onRemoveRecord: (bookUrl: string) => void,
) => {
  Alert.alert(
    '删除书籍及本地数据',
    `确定删除《${record.book.name}》吗？将清理该书的正文、阅读与听书进度、角色绑定及生成音频，本地导入的 TXT 也会删除。共享音色和 API 配置保留。`,
    [
      {text: '取消', style: 'cancel'},
      {
        text: '删除',
        style: 'destructive',
        onPress: () => onRemoveRecord(record.book.bookUrl),
      },
    ],
  );
};
