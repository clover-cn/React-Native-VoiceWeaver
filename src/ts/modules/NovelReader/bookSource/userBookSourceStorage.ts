import {Platform} from 'react-native';
import {
  BookSourceValidationResult,
  BookSourceValidationStatus,
  LegadoBookSource,
} from './types';
import {normalizeLegadoBookSource} from './normalizeBookSource';

const PREF_NAME = 'novel_reader_pref';
const USER_BOOK_SOURCES_KEY = 'novel_reader_user_book_sources';

export interface UserBookSourceRecord {
  source: LegadoBookSource;
  importedAt: number;
  lastValidatedAt?: number;
  validationStatus?: BookSourceValidationStatus;
  validationMessage?: string;
  validationResultCount?: number;
}

export interface ParsedBookSourceImport {
  sources: LegadoBookSource[];
  invalidCount: number;
  duplicateCount: number;
}

export interface ImportUserBookSourcesResult {
  records: UserBookSourceRecord[];
  importedCount: number;
  updatedCount: number;
  skippedCount: number;
}

type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

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
    console.warn(`[userBookSourceStorage] 读取 ${key} 失败`, error);
    return fallback;
  }
};

const writeJson = (key: string, value: unknown) => {
  try {
    getStorage().setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`[userBookSourceStorage] 写入 ${key} 失败`, error);
  }
};

const getBridge = () => {
  return require('../../base/utils/bridge')
    .default as typeof import('../../base/utils/bridge').default;
};

const readPrefJson = <T>(key: string, fallback: T): Promise<T> => {
  return new Promise(resolve => {
    try {
      const bridge = getBridge();
      bridge.getOhPrefData(
        res => {
          if (typeof res === 'string') {
            try {
              resolve(JSON.parse(res) as T);
              return;
            } catch (error) {
              console.warn(`[userBookSourceStorage] 解析 ${key} 失败`, error);
            }
          }
          resolve(fallback);
        },
        key,
        null,
        PREF_NAME,
      );
    } catch (error) {
      resolve(fallback);
    }
  });
};

const writePrefJson = (key: string, value: unknown): Promise<void> => {
  return new Promise(resolve => {
    try {
      const bridge = getBridge();
      bridge.setOhPrefData(key, JSON.stringify(value), PREF_NAME, resolve);
    } catch (error) {
      resolve();
    }
  });
};

const isHarmonyBridgeAvailable = () => {
  if ((Platform.OS as string) !== 'harmony') {
    return false;
  }

  try {
    const bridge = getBridge();
    return (
      typeof bridge?.getOhPrefData === 'function' &&
      typeof bridge?.setOhPrefData === 'function'
    );
  } catch (_error) {
    return false;
  }
};

const normalizeSource = (value: unknown): LegadoBookSource | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Partial<LegadoBookSource>;
  const bookSourceName = String(candidate.bookSourceName || '').trim();
  const bookSourceUrl = String(candidate.bookSourceUrl || '').trim();

  if (!bookSourceName || !bookSourceUrl) {
    return null;
  }

  return {
    ...normalizeLegadoBookSource(candidate as LegadoBookSource),
    bookSourceName,
    bookSourceUrl,
  };
};

const normalizeRecord = (
  record: Partial<UserBookSourceRecord> | null | undefined,
): UserBookSourceRecord | null => {
  const source = normalizeSource(record?.source);
  if (!source) {
    return null;
  }

  const lastValidatedAt = Number(record?.lastValidatedAt);
  const validationResultCount = Number(record?.validationResultCount);
  const importedAt = Number(record?.importedAt);
  const validationStatus = record?.validationStatus;

  return {
    source,
    importedAt: Number.isFinite(importedAt) ? importedAt : Date.now(),
    ...(Number.isFinite(lastValidatedAt) && lastValidatedAt > 0
      ? {lastValidatedAt}
      : {}),
    ...(validationStatus ? {validationStatus} : {}),
    ...(record?.validationMessage
      ? {validationMessage: String(record.validationMessage)}
      : {}),
    ...(Number.isFinite(validationResultCount) ? {validationResultCount} : {}),
  };
};

const mergeDefinedSourceFields = (
  previous: LegadoBookSource,
  next: LegadoBookSource,
): LegadoBookSource => {
  const merged = {...previous};
  Object.entries(next).forEach(([key, value]) => {
    if (value !== undefined) {
      (merged as Record<string, unknown>)[key] = value;
    }
  });
  return normalizeLegadoBookSource(merged);
};

export const parseBookSourceJson = (
  content: string,
): ParsedBookSourceImport => {
  const parsed = JSON.parse(content);
  const rawList = Array.isArray(parsed) ? parsed : [parsed];
  const sourceMap = new Map<string, LegadoBookSource>();
  let invalidCount = 0;
  let duplicateCount = 0;

  rawList.forEach(item => {
    const source = normalizeSource(item);
    if (!source) {
      invalidCount += 1;
      return;
    }

    if (sourceMap.has(source.bookSourceUrl)) {
      duplicateCount += 1;
      sourceMap.set(
        source.bookSourceUrl,
        mergeDefinedSourceFields(
          sourceMap.get(source.bookSourceUrl) as LegadoBookSource,
          source,
        ),
      );
      return;
    }
    sourceMap.set(source.bookSourceUrl, source);
  });

  return {
    sources: Array.from(sourceMap.values()),
    invalidCount,
    duplicateCount,
  };
};

export const loadUserBookSourceRecords = async (): Promise<
  UserBookSourceRecord[]
> => {
  const fallback: UserBookSourceRecord[] = [];
  const records = isHarmonyBridgeAvailable()
    ? await readPrefJson<UserBookSourceRecord[]>(
        USER_BOOK_SOURCES_KEY,
        fallback,
      )
    : readJson<UserBookSourceRecord[]>(USER_BOOK_SOURCES_KEY, fallback);

  if (!Array.isArray(records)) {
    return [];
  }

  return records
    .map(record => normalizeRecord(record))
    .filter(Boolean) as UserBookSourceRecord[];
};

export const saveUserBookSourceRecords = async (
  records: UserBookSourceRecord[],
): Promise<void> => {
  const normalizedRecords = records
    .map(record => normalizeRecord(record))
    .filter(Boolean) as UserBookSourceRecord[];

  if (isHarmonyBridgeAvailable()) {
    await writePrefJson(USER_BOOK_SOURCES_KEY, normalizedRecords);
    return;
  }
  writeJson(USER_BOOK_SOURCES_KEY, normalizedRecords);
};

export const importUserBookSourcesFromJson = async (
  content: string,
): Promise<ImportUserBookSourcesResult> => {
  const parsed = parseBookSourceJson(content);
  const currentRecords = await loadUserBookSourceRecords();
  const recordMap = new Map<string, UserBookSourceRecord>();

  currentRecords.forEach(record => {
    recordMap.set(record.source.bookSourceUrl, record);
  });

  let importedCount = 0;
  let updatedCount = 0;
  const now = Date.now();

  parsed.sources.forEach(source => {
    if (recordMap.has(source.bookSourceUrl)) {
      updatedCount += 1;
    } else {
      importedCount += 1;
    }

    recordMap.set(source.bookSourceUrl, {
      source,
      importedAt: now,
    });
  });

  const records = Array.from(recordMap.values());
  await saveUserBookSourceRecords(records);

  return {
    records,
    importedCount,
    updatedCount,
    skippedCount: parsed.invalidCount + parsed.duplicateCount,
  };
};

export const deleteUserBookSource = async (
  bookSourceUrl: string,
): Promise<UserBookSourceRecord[]> => {
  const records = await loadUserBookSourceRecords();
  const nextRecords = records.filter(
    record => record.source.bookSourceUrl !== bookSourceUrl,
  );
  await saveUserBookSourceRecords(nextRecords);
  return nextRecords;
};

export const updateUserBookSource = async (
  bookSourceUrl: string,
  updater: (
    record: UserBookSourceRecord,
  ) => UserBookSourceRecord | null | undefined,
): Promise<UserBookSourceRecord[]> => {
  const records = await loadUserBookSourceRecords();
  let matched = false;
  const nextRecords = records
    .map(record => {
      if (record.source.bookSourceUrl !== bookSourceUrl) {
        return record;
      }
      matched = true;
      const nextRecord = updater(record);
      return nextRecord ? normalizeRecord(nextRecord) : null;
    })
    .filter(Boolean) as UserBookSourceRecord[];

  if (!matched) {
    return records;
  }

  await saveUserBookSourceRecords(nextRecords);
  return nextRecords;
};

export const setUserBookSourceEnabled = async (
  bookSourceUrl: string,
  enabled: boolean,
): Promise<UserBookSourceRecord[]> => {
  return updateUserBookSource(bookSourceUrl, record => ({
    ...record,
    source: {
      ...record.source,
      enabled,
    },
  }));
};

export const saveUserBookSourceValidation = async (
  bookSourceUrl: string,
  result: BookSourceValidationResult,
): Promise<UserBookSourceRecord[]> => {
  return updateUserBookSource(bookSourceUrl, record => ({
    ...record,
    lastValidatedAt: result.validatedAt,
    validationStatus: result.status,
    validationMessage: result.message,
    validationResultCount: result.resultCount,
  }));
};

export const buildExportBookSourceJson = (source: LegadoBookSource) => {
  return JSON.stringify(source, null, 2);
};

export const buildBookSourceExportFileName = (source: LegadoBookSource) => {
  const safeName =
    source.bookSourceName
      ?.trim()
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, '_') || 'book_source';
  return `${safeName}.json`;
};

export const __resetUserBookSourceStorageForTests = () => {
  memoryStorage.clear();
};
