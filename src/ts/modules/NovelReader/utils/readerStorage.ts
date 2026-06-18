import {Book, Chapter} from '../types/reader';
import bridge from '../../base/utils/bridge';

const SEARCH_HISTORY_KEY = 'novel_reader_search_history';
const READING_RECORD_KEY = 'novel_reader_reading_record';
const MAX_SEARCH_HISTORY = 10;
// 首页"继续阅读"区最多保留的记录数
export const MAX_READING_RECORDS = 3;
const PREF_NAME = 'novel_reader_pref';

type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

type RequestSnapshot = {
  url: string;
  options?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string | null;
  };
};

export interface ReadingRecord {
  book: Book;
  chapterList: Chapter[];
  currentChapterIndex: number;
  currentChapter?: Chapter;
  contentRequest: RequestSnapshot;
  updatedAt: number;
}

const memoryStorage = new Map<string, string>();

const getStorage = (): StorageLike => {
  const candidate = (
    globalThis as typeof globalThis & {
      localStorage?: StorageLike;
    }
  ).localStorage;

  if (
    candidate &&
    typeof candidate.getItem === 'function' &&
    typeof candidate.setItem === 'function' &&
    typeof candidate.removeItem === 'function'
  ) {
    return candidate;
  }

  return {
    getItem: key => memoryStorage.get(key) ?? null,
    setItem: (key, value) => {
      memoryStorage.set(key, value);
    },
    removeItem: key => {
      memoryStorage.delete(key);
    },
  };
};

const readJson = <T>(key: string, fallback: T): T => {
  try {
    const raw = getStorage().getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch (error) {
    console.warn(`[readerStorage] 读取 ${key} 失败`, error);
    return fallback;
  }
};

const writeJson = (key: string, value: unknown) => {
  try {
    getStorage().setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`[readerStorage] 写入 ${key} 失败`, error);
  }
};

const readPrefJson = <T>(key: string, fallback: T): Promise<T> => {
  return new Promise(resolve => {
    try {
      bridge.getOhPrefData(
        res => {
          if (typeof res === 'string') {
            try {
              resolve(JSON.parse(res) as T);
              return;
            } catch (error) {
              console.warn(`[readerStorage] 解析 ${key} 失败`, error);
            }
          }
          resolve(fallback);
        },
        key,
        null,
        PREF_NAME,
      );
    } catch (error) {
      console.warn(`[readerStorage] 读取偏好 ${key} 失败`, error);
      resolve(fallback);
    }
  });
};

const writePrefJson = (key: string, value: unknown): Promise<void> => {
  return new Promise(resolve => {
    try {
      bridge.setOhPrefData(key, JSON.stringify(value), PREF_NAME, resolve);
    } catch (error) {
      console.warn(`[readerStorage] 写入偏好 ${key} 失败`, error);
      resolve();
    }
  });
};

const removePrefData = (key: string): Promise<void> => {
  return new Promise(resolve => {
    try {
      bridge.delOhPrefData(key, PREF_NAME, resolve);
    } catch (error) {
      console.warn(`[readerStorage] 删除偏好 ${key} 失败`, error);
      resolve();
    }
  });
};

const isHarmonyBridgeAvailable = () => {
  return (
    typeof bridge?.getOhPrefData === 'function' &&
    typeof bridge?.setOhPrefData === 'function' &&
    typeof bridge?.delOhPrefData === 'function'
  );
};

export const loadSearchHistory = async (): Promise<string[]> => {
  if (isHarmonyBridgeAvailable()) {
    return readPrefJson<string[]>(SEARCH_HISTORY_KEY, []);
  }
  return readJson<string[]>(SEARCH_HISTORY_KEY, []);
};

export const addSearchHistory = async (keyword: string): Promise<string[]> => {
  const normalizedKeyword = keyword.trim();
  if (!normalizedKeyword) {
    return loadSearchHistory();
  }

  const currentHistory = await loadSearchHistory();
  const nextHistory = [
    normalizedKeyword,
    ...currentHistory.filter(item => item !== normalizedKeyword),
  ].slice(0, MAX_SEARCH_HISTORY);

  if (isHarmonyBridgeAvailable()) {
    await writePrefJson(SEARCH_HISTORY_KEY, nextHistory);
  } else {
    writeJson(SEARCH_HISTORY_KEY, nextHistory);
  }
  return nextHistory;
};

export const clearSearchHistory = async (): Promise<void> => {
  try {
    if (isHarmonyBridgeAvailable()) {
      await removePrefData(SEARCH_HISTORY_KEY);
      return;
    }
    getStorage().removeItem(SEARCH_HISTORY_KEY);
  } catch (error) {
    console.warn('[readerStorage] 清空搜索历史失败', error);
  }
};

export const loadReadingRecords = async (): Promise<ReadingRecord[]> => {
  const raw = isHarmonyBridgeAvailable()
    ? await readPrefJson<unknown>(READING_RECORD_KEY, null)
    : readJson<unknown>(READING_RECORD_KEY, null);

  return normalizeReadingRecords(raw);
};

export const saveReadingRecords = async (
  records: ReadingRecord[],
): Promise<void> => {
  const trimmed = records.slice(0, MAX_READING_RECORDS);

  if (trimmed.length === 0) {
    try {
      if (isHarmonyBridgeAvailable()) {
        await removePrefData(READING_RECORD_KEY);
        return;
      }
      getStorage().removeItem(READING_RECORD_KEY);
    } catch (error) {
      console.warn('[readerStorage] 清空阅读记录失败', error);
    }
    return;
  }

  if (isHarmonyBridgeAvailable()) {
    await writePrefJson(READING_RECORD_KEY, trimmed);
  } else {
    writeJson(READING_RECORD_KEY, trimmed);
  }
};

// 写入/更新一条阅读记录：按 bookUrl 去重，最新置顶，超过上限则截断
export const upsertReadingRecord = async (
  record: ReadingRecord,
): Promise<ReadingRecord[]> => {
  const current = await loadReadingRecords();
  const next = [
    record,
    ...current.filter(item => item.book.bookUrl !== record.book.bookUrl),
  ].slice(0, MAX_READING_RECORDS);
  await saveReadingRecords(next);
  return next;
};

// 按 bookUrl 删除一条阅读记录，返回更新后的列表
export const removeReadingRecord = async (
  bookUrl: string,
): Promise<ReadingRecord[]> => {
  const current = await loadReadingRecords();
  const next = current.filter(item => item.book.bookUrl !== bookUrl);
  if (next.length === current.length) {
    return current;
  }
  await saveReadingRecords(next);
  return next;
};

// 兼容旧版（单对象）持久化数据：读取时归一为数组形式
const normalizeReadingRecords = (raw: unknown): ReadingRecord[] => {
  if (!raw) {
    return [];
  }
  if (Array.isArray(raw)) {
    return raw.filter(isValidReadingRecord);
  }
  if (isValidReadingRecord(raw)) {
    return [raw];
  }
  return [];
};

const isValidReadingRecord = (value: unknown): value is ReadingRecord => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<ReadingRecord>;
  return (
    !!candidate.book &&
    typeof candidate.book === 'object' &&
    typeof (candidate.book as Book).bookUrl === 'string' &&
    Array.isArray(candidate.chapterList) &&
    typeof candidate.currentChapterIndex === 'number' &&
    !!candidate.contentRequest &&
    typeof candidate.contentRequest.url === 'string'
  );
};

// ──── 听书进度持久化 ────

const LISTEN_PROGRESS_KEY = 'novel_reader_listen_progress';

export interface ListenProgress {
  segmentIndex: number;   // 当前播放段落序号
  currentTime: number;    // 当前段落播放到的秒数
  chapterIndex: number;   // 当前章节序号
  projectName: string;    // 项目名
  updatedAt: number;      // 时间戳
}

export const saveListenProgress = async (
  progress: ListenProgress,
): Promise<void> => {
  // 使用复合 key，区分不同书的不同章节
  const compositeKey = `${LISTEN_PROGRESS_KEY}_${progress.projectName}_${progress.chapterIndex}`;
  if (isHarmonyBridgeAvailable()) {
    await writePrefJson(compositeKey, progress);
  } else {
    writeJson(compositeKey, progress);
  }
};

export const loadListenProgress = async (
  projectName: string,
  chapterIndex: number,
): Promise<ListenProgress | null> => {
  const compositeKey = `${LISTEN_PROGRESS_KEY}_${projectName}_${chapterIndex}`;
  if (isHarmonyBridgeAvailable()) {
    return readPrefJson<ListenProgress | null>(compositeKey, null);
  }
  return readJson<ListenProgress | null>(compositeKey, null);
};

export const clearListenProgress = async (
  projectName: string,
  chapterIndex: number,
): Promise<void> => {
  const compositeKey = `${LISTEN_PROGRESS_KEY}_${projectName}_${chapterIndex}`;
  try {
    if (isHarmonyBridgeAvailable()) {
      await removePrefData(compositeKey);
    } else {
      getStorage().removeItem(compositeKey);
    }
  } catch (error) {
    console.warn('[readerStorage] 清除听书进度失败', error);
  }
};
