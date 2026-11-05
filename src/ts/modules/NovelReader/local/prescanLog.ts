import {logModelProgress} from './native';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
/** 只打印预扫描结构字段，排除额外响应字段、正文及凭证。 */
const text = (value: unknown): string =>
  typeof value === 'string'
    ? value
        .replace(/Bearer\s+[^\s"'<>]+/gi, 'Bearer [已隐藏]')
        .replace(/\bsk-[A-Za-z0-9_-]+/g, '[已隐藏]')
        .replace(/[\r\n\t]/g, ' ')
        .slice(0, 160)
    : '';

/** 逐角色输出，避免整个响应写在一条原生日志中被截断。 */
export function logPrescanResult(
  value: unknown,
  chapterIndexes: number[],
): void {
  const result = record(value);
  const characters = list(result.characters);
  const activity = list(result.roleActivity);
  logModelProgress(
    `预扫描结果：章节=${chapterIndexes
      .map(index => index + 1)
      .join(',')}，角色=${characters.length}，活动记录=${activity.length}`,
  );
  // for (const item of characters) {
  //   const character = record(item);
  //   logModelProgress(
  //     `预扫描角色：${JSON.stringify({
  //       standardName: text(character.standardName),
  //       gender: text(character.gender),
  //       aliases: list(character.aliases).slice(0, 50).map(text),
  //       description: text(character.description),
  //     })}`,
  //   );
  // }
  // for (const item of activity) {
  //   const role = record(item);
  //   logModelProgress(
  //     `预扫描活动：${JSON.stringify({
  //       standardName: text(role.standardName),
  //       importance: text(role.importance),
  //       chapterStats: list(role.chapterStats)
  //         .slice(0, 100)
  //         .map(item => {
  //           const stat = record(item);
  //           return Object.fromEntries(
  //             ['chapterIndex', 'dialogueCount', 'mentionCount'].map(key => [
  //               key,
  //               typeof stat[key] === 'number' && Number.isFinite(stat[key])
  //                 ? stat[key]
  //                 : null,
  //             ]),
  //           );
  //         }),
  //     })}`,
  //   );
  // }
}
