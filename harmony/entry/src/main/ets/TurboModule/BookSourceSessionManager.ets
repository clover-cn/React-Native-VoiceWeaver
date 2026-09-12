import asset from '@ohos.security.asset';
import cryptoFramework from '@ohos.security.cryptoFramework';
import util from '@ohos.util';
import webview from '@ohos.web.webview';
import { BusinessError } from '@kit.BasicServicesKit';

export interface BookSourceSessionHeaders {
  Authorization: string;
  'X-Device-ID': string;
}

interface StoredBookSourceSession {
  sourceId: string;
  origin: string;
  headers: BookSourceSessionHeaders;
}

export interface BookSourceLoginRequest {
  id: number;
  sourceId: string;
  loginUrl: string;
  origin: string;
}

export interface BookSourceLoginResult {
  status: string;
  message?: string;
}

/** 登录页只回传状态；凭据仅经专用规则服务接口读取，禁止记录其内容。 */
export class BookSourceSessionManager {
  private static sequence: number = 0;
  private static current: BookSourceLoginRequest | undefined;
  private static callback: ((result: string) => void) | undefined;

  static originOf(value: string): string {
    const match = value.match(/^https?:\/\/[^/?#]+/i);
    if (!match || match[0].indexOf('@') >= 0) {
      return '';
    }
    return match[0].toLowerCase();
  }

  static begin(sourceId: string, loginUrl: string, callback: (result: string) => void): number {
    const origin = BookSourceSessionManager.originOf(loginUrl);
    if (!sourceId || !origin) {
      callback(JSON.stringify({ status: 'failed', message: '书源登录地址无效' } as BookSourceLoginResult));
      return 0;
    }
    if (BookSourceSessionManager.current) {
      callback(JSON.stringify({ status: 'failed', message: '已有书源登录页打开，请先关闭' } as BookSourceLoginResult));
      return 0;
    }
    BookSourceSessionManager.sequence += 1;
    BookSourceSessionManager.current = { id: BookSourceSessionManager.sequence, sourceId: sourceId, loginUrl: loginUrl, origin: origin };
    BookSourceSessionManager.callback = callback;
    return BookSourceSessionManager.sequence;
  }

  static getRequest(id: number): BookSourceLoginRequest | undefined {
    return BookSourceSessionManager.current?.id === id ? BookSourceSessionManager.current : undefined;
  }

  static finish(id: number, result: BookSourceLoginResult): void {
    if (BookSourceSessionManager.current?.id !== id) {
      return;
    }
    const callback = BookSourceSessionManager.callback;
    BookSourceSessionManager.current = undefined;
    BookSourceSessionManager.callback = undefined;
    callback?.(JSON.stringify(result));
  }

  private static bytes(text: string): Uint8Array {
    return new util.TextEncoder().encodeInto(text);
  }

  private static async alias(sourceId: string): Promise<Uint8Array> {
    const digest = cryptoFramework.createMd('SHA256');
    await digest.update({ data: BookSourceSessionManager.bytes(sourceId) });
    const result = await digest.digest();
    let hash = '';
    result.data.forEach((value: number) => {
      hash += value.toString(16).padStart(2, '0');
    });
    return BookSourceSessionManager.bytes('book-source-session-v1:' + hash);
  }

  private static async readStored(sourceId: string): Promise<StoredBookSourceSession | undefined> {
    if (!sourceId) {
      return undefined;
    }
    const query: asset.AssetMap = new Map();
    query.set(asset.Tag.ALIAS, await BookSourceSessionManager.alias(sourceId));
    query.set(asset.Tag.RETURN_TYPE, asset.ReturnType.ALL);
    try {
      const records = await asset.query(query);
      const secret = records[0]?.get(asset.Tag.SECRET);
      if (!(secret instanceof Uint8Array)) {
        return undefined;
      }
      const stored = JSON.parse(new util.TextDecoder('utf-8').decodeWithStream(secret)) as StoredBookSourceSession;
      return stored.sourceId === sourceId ? stored : undefined;
    } catch (error) {
      if ((error as BusinessError).code === asset.ErrorCode.NOT_FOUND) {
        return undefined;
      }
      throw new Error('读取书源安全会话失败');
    }
  }

  static async getSession(sourceId: string): Promise<BookSourceSessionHeaders | undefined> {
    const stored = await BookSourceSessionManager.readStored(sourceId);
    return stored?.headers;
  }

  /** Cookie 由网页编码；此处只解码一次，保持 Authorization 自带的 Bearer 前缀。 */
  private static readCookie(origin: string, name: string): string {
    const cookies = webview.WebCookieManager.fetchCookieSync(origin + '/');
    for (const item of cookies.split(';')) {
      const clean = item.trim();
      const separator = clean.indexOf('=');
      if (separator < 0 || clean.substring(0, separator) !== name) {
        continue;
      }
      try {
        return decodeURIComponent(clean.substring(separator + 1));
      } catch (_error) {
        return '';
      }
    }
    return '';
  }

  static async saveLogin(id: number, currentUrl: string): Promise<boolean> {
    const request = BookSourceSessionManager.getRequest(id);
    if (!request || BookSourceSessionManager.originOf(currentUrl) !== request.origin) {
      throw new Error('请回到书源网站完成登录');
    }
    const authorization = BookSourceSessionManager.readCookie(request.origin, 'Authorization');
    const deviceId = BookSourceSessionManager.readCookie(request.origin, 'X-Device-ID');
    if (!authorization.trim() || !deviceId.trim() || /[\r\n]/.test(authorization + deviceId)) {
      return false;
    }
    const stored: StoredBookSourceSession = {
      sourceId: request.sourceId,
      origin: request.origin,
      headers: { Authorization: authorization, 'X-Device-ID': deviceId }
    };
    const attributes: asset.AssetMap = new Map();
    attributes.set(asset.Tag.ALIAS, await BookSourceSessionManager.alias(request.sourceId));
    attributes.set(asset.Tag.SECRET, BookSourceSessionManager.bytes(JSON.stringify(stored)));
    attributes.set(asset.Tag.ACCESSIBILITY, asset.Accessibility.DEVICE_FIRST_UNLOCKED);
    attributes.set(asset.Tag.CONFLICT_RESOLUTION, asset.ConflictResolution.OVERWRITE);
    await webview.WebCookieManager.saveCookieAsync();
    await asset.add(attributes);
    return true;
  }

  static async clearSession(sourceId: string): Promise<void> {
    const stored = await BookSourceSessionManager.readStored(sourceId);
    if (stored?.origin) {
      // 仅清除该登录站点的认证 Cookie，不清空其他网站 Cookie 或全局 Web 存储。
      for (const name of ['Authorization', 'X-Device-ID']) {
        webview.WebCookieManager.configCookieSync(stored.origin + '/',
          name + '=; Path=/; Max-Age=0; SameSite=Lax' + (stored.origin.startsWith('https:') ? '; Secure' : ''));
      }
      await webview.WebCookieManager.saveCookieAsync();
    }
    const query: asset.AssetMap = new Map();
    query.set(asset.Tag.ALIAS, await BookSourceSessionManager.alias(sourceId));
    try {
      await asset.remove(query);
    } catch (error) {
      if ((error as BusinessError).code !== asset.ErrorCode.NOT_FOUND) {
        throw new Error('清除书源安全会话失败');
      }
    }
  }
}
