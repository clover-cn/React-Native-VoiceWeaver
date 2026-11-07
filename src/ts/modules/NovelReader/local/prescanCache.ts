import type {EngineConfig} from './config';
import type {ListenBookPrescanText} from '../types/reader';
import {
  createTextHash,
  normalizeChapterTextForRequest,
} from '../utils/listenBook';
import {prescanPrompt} from './prompts';

export interface PrescanRecord {
  configHash: string;
  chapterHashes: Record<string, string>;
}

/** 只用影响角色预扫描的配置建立身份，语音合成设置变化不触发重扫。 */
function identity(config: EngineConfig): string {
  return createTextHash(
    JSON.stringify({
      model: config.prescan.independent
        ? config.prescan
        : {...config.llm, model: config.prescan.model || config.llm.model},
      count: config.generation.prescanCount,
      prompt: prescanPrompt(''),
    }),
  );
}

export function createPrescanRecord(
  config: EngineConfig,
  texts: ListenBookPrescanText[],
): PrescanRecord {
  return {
    configHash: identity(config),
    chapterHashes: Object.fromEntries(
      texts.map(item => [
        item.chapterIndex,
        createTextHash(normalizeChapterTextForRequest(item.text)),
      ]),
    ),
  };
}

/** 页面先校验当前章；若调用方已提供其他章节正文，也一并检查。 */
export function canReusePrescan(
  record: PrescanRecord | undefined,
  config: EngineConfig,
  chapterIndex: number,
  contentHash?: string,
  texts: ListenBookPrescanText[] = [],
): boolean {
  return Boolean(
    contentHash &&
      record?.configHash === identity(config) &&
      record.chapterHashes[chapterIndex] === contentHash &&
      texts
        .slice(0, config.generation.prescanCount)
        .every(
          item =>
            record.chapterHashes[item.chapterIndex] ===
            createTextHash(normalizeChapterTextForRequest(item.text)),
        ),
  );
}
