import iconv from 'iconv-lite';
import {Buffer} from 'buffer';
import {fetchWithTimeout} from '../hooks/useListenBook';
import {LegadoBookSource, ResolvedRequest} from './types';
import {
  renderTemplate,
  resolveUrl,
  safeJsonParse,
  stripUrlHash,
} from './ruleUtils';
import {bookSourceLogger} from './bookSourceLogger';

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36';

const splitUrlOption = (rawUrl: string) => {
  const marker = ',{';
  const index = rawUrl.lastIndexOf(marker);
  if (index < 0 || !rawUrl.endsWith('}')) {
    return {url: rawUrl, option: {} as Record<string, unknown>};
  }

  const url = rawUrl.slice(0, index);
  const option = safeJsonParse<Record<string, unknown>>(
    rawUrl.slice(index + 1),
    {},
  );
  return {url, option};
};

const encodeRequestUrl = (url: string): string => {
  try {
    return encodeURI(url);
  } catch (_error) {
    return url;
  }
};

export const buildHeaders = (
  source: LegadoBookSource,
  baseUrl: string,
): Record<string, string> => {
  const headerText = renderTemplate(source.header || '{}', {
    baseUrl,
    key: '',
    page: 1,
  });
  const sourceHeaders = safeJsonParse<Record<string, string>>(headerText, {});
  return {
    'User-Agent': DEFAULT_USER_AGENT,
    ...sourceHeaders,
  };
};

export const resolveRequest = (
  source: LegadoBookSource,
  rawUrl: string,
  vars: Record<string, unknown>,
  baseUrl = source.bookSourceUrl,
): ResolvedRequest => {
  const templated = renderTemplate(rawUrl, {
    ...vars,
    baseUrl,
  });
  const {url, option} = splitUrlOption(templated);
  const method = String(option.method || 'GET').toUpperCase();
  const optionHeaders =
    typeof option.headers === 'object' && option.headers
      ? (option.headers as Record<string, string>)
      : {};
  const charset = String(option.charset || 'utf-8').toLowerCase();

  const resolvedUrl = resolveUrl(url, baseUrl);

  return {
    url: encodeRequestUrl(stripUrlHash(resolvedUrl)),
    method,
    headers: {
      ...buildHeaders(source, baseUrl),
      ...optionHeaders,
    },
    body: option.body == null ? undefined : String(option.body),
    charset,
    webView: Boolean(option.webView),
    retry: Number(option.retry || 0),
  };
};

const decodeArrayBuffer = (buffer: ArrayBuffer, charset: string) => {
  const bytes = Buffer.from(buffer);
  if (!charset || charset === 'utf-8' || charset === 'utf8') {
    return bytes.toString('utf8');
  }

  try {
    return iconv.decode(bytes, charset);
  } catch (error) {
    console.warn('[bookSource] 字符集解码失败，降级 utf-8', charset, error);
    return bytes.toString('utf8');
  }
};

export const requestText = async (
  request: ResolvedRequest,
  timeoutMs = 20000,
): Promise<string> => {
  let attempt = 0;
  const maxAttempt = Math.max(1, request.retry + 1);

  while (attempt < maxAttempt) {
    try {
      bookSourceLogger.log('request', `开始请求 ${request.method}`, {
        url: request.url,
        charset: request.charset,
        attempt: attempt + 1,
        maxAttempt,
      });
      const response = await fetchWithTimeout(
        request.url,
        {
          method: request.method,
          headers: request.headers,
          body: request.method === 'GET' ? undefined : request.body,
        },
        timeoutMs,
      );
      const buffer = await response.arrayBuffer();
      bookSourceLogger.log('request', `收到响应 HTTP ${response.status}`, {
        url: request.url,
        bytes: buffer.byteLength,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${request.url}`);
      }
      const text = decodeArrayBuffer(buffer, request.charset);
      bookSourceLogger.log('request', '响应解码完成', {
        url: request.url,
        textLength: text.length,
        preview: text.slice(0, 120),
      });
      return text;
    } catch (error) {
      attempt += 1;
      bookSourceLogger.warn('request', '请求失败', {
        url: request.url,
        attempt,
        error: bookSourceLogger.errorMessage(error),
      });
      if (attempt >= maxAttempt) {
        throw error;
      }
    }
  }

  return '';
};
