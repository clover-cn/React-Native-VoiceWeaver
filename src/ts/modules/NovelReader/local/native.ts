import {BridgeTurboModule} from '../../../../../turboModules';

/** 仅接收已脱敏的错误摘要，同时输出到调试控制台和原生日志。 */
export function logModelFailure(message: string): void {
  console.warn('[VoiceWeaverLocal] 模型请求失败', message);
  try {
    BridgeTurboModule?.hiLog?.('warn', 'VoiceWeaverLocal', message);
  } catch (_) {
    // 原生日志能力不可用时，保留控制台日志，不影响错误回传。
  }
}

/** 仅记录阶段与计数等运行信息，不包含小说正文、请求头或密钥。 */
export function logModelProgress(message: string): void {
  console.log('[VoiceWeaverLocal] 生成进度', message);
  try {
    BridgeTurboModule?.hiLog?.('info', 'VoiceWeaverLocal', message);
  } catch (_) {
    // 原生日志能力不可用时保留调试控制台输出。
  }
}

/** 端侧文件、密钥和网络操作统一入口；原生失败时不降级为明文存储。 */
export function nativeCall<T>(
  operation: string,
  payload: object = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!BridgeTurboModule?.voiceWeaver) {
      reject(new Error('当前安装包不支持端侧引擎，请重新构建安装。'));
      return;
    }
    BridgeTurboModule.voiceWeaver(
      JSON.stringify({operation, ...payload}),
      result => {
        try {
          const value = JSON.parse(result);
          if (!value.success) {
            reject(new Error(value.error || '端侧操作失败'));
          } else {
            resolve(value.data as T);
          }
        } catch (_error) {
          reject(new Error('端侧结果解析失败'));
        }
      },
    );
  });
}

export const readDocument = async <T>(key: string, fallback: T): Promise<T> => {
  const text = await nativeCall<string | null>('read', {key});
  return text === null ? fallback : JSON.parse(text);
};
export const writeDocument = (key: string, data: unknown) =>
  nativeCall<void>('write', {key, text: JSON.stringify(data)});
