import {BridgeTurboModule} from '../../../../../turboModules';
import {LegadoBookSource} from './types';

export interface BookSourceLoginResult {
  status: 'authenticated' | 'cancelled' | 'failed';
  message?: string;
}

interface NativeSessionResult {
  success?: boolean;
  session?: Record<string, string>;
  message?: string;
}

/** 会话只通过专用原生接口读取，不落入普通偏好设置或日志。 */
export const getBookSourceSession = async (
  sourceId: string,
): Promise<Record<string, string>> => {
  const bridge = BridgeTurboModule;
  if (!sourceId || !bridge?.getBookSourceSession) {
    return {};
  }
  return new Promise(resolve => {
    try {
      bridge.getBookSourceSession(sourceId, raw => {
        try {
          const result = JSON.parse(raw) as NativeSessionResult;
          const session = result.session;
          resolve(
            result.success &&
              typeof session?.Authorization === 'string' &&
              typeof session?.['X-Device-ID'] === 'string'
              ? {
                  Authorization: session.Authorization,
                  'X-Device-ID': session['X-Device-ID'],
                }
              : {},
          );
        } catch (_error) {
          resolve({});
        }
      });
    } catch (_error) {
      resolve({});
    }
  });
};

/** 用户在原生网页中登录，完成回调仅包含状态。 */
export const openBookSourceLogin = async (
  source: LegadoBookSource,
): Promise<BookSourceLoginResult> => {
  const bridge = BridgeTurboModule;
  if (!bridge?.openBookSourceLogin) {
    return {status: 'failed', message: '当前平台尚不支持书源网页登录'};
  }
  if (!source.bookSourceUrl || !/^https?:\/\//i.test(source.loginUrl || '')) {
    return {status: 'failed', message: '书源没有有效的网页登录地址'};
  }
  return new Promise(resolve => {
    try {
      bridge.openBookSourceLogin(
        source.bookSourceUrl,
        source.loginUrl!,
        raw => {
          try {
            const result = JSON.parse(raw) as BookSourceLoginResult;
            resolve(
              ['authenticated', 'cancelled', 'failed'].includes(result.status)
                ? result
                : {status: 'failed', message: '登录结果无效'},
            );
          } catch (_error) {
            resolve({status: 'failed', message: '登录结果无效'});
          }
        },
      );
    } catch (_error) {
      resolve({status: 'failed', message: '无法打开书源登录页'});
    }
  });
};

export const clearBookSourceSession = async (
  sourceId: string,
): Promise<void> => {
  const bridge = BridgeTurboModule;
  if (!bridge?.clearBookSourceSession) {
    return;
  }
  return new Promise((resolve, reject) => {
    try {
      bridge.clearBookSourceSession(sourceId, raw => {
        try {
          const result = JSON.parse(raw) as NativeSessionResult;
          if (!result.success) {
            reject(new Error('清除书源会话失败，请重试'));
            return;
          }
          resolve();
        } catch (_error) {
          reject(new Error('清除书源会话失败，请重试'));
        }
      });
    } catch (_error) {
      reject(new Error('无法清除书源会话'));
    }
  });
};
