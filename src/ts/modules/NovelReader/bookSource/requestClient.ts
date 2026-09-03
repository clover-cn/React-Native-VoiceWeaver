import iconv from 'iconv-lite';
import {Buffer} from 'buffer';
import {fetchWithTimeout} from '../hooks/useListenBook';
import {
  BookSourceCancelToken,
  LegadoBookSource,
  ResolvedRequest,
} from './types';
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
  const text = rawUrl.trim();
  const match = text.match(/,\s*(\{[\s\S]*\})\s*$/);
  if (!match || match.index == null) {
    return {url: text, option: {} as Record<string, unknown>};
  }

  const url = text.slice(0, match.index).trim();
  const option = safeJsonParse<Record<string, unknown>>(
    match[1],
    {},
  );
  return {url, option};
};

const createRequestTemplateVars = (vars: Record<string, unknown>) => {
  const java = {
    base64Encode: (value: unknown) =>
      Buffer.from(String(value ?? ''), 'utf8').toString('base64'),
    encodeURI: (value: unknown) => encodeURIComponent(String(value ?? '')),
  };
  return {
    ...vars,
    java,
  };
};

const encodeRequestUrl = (url: string): string => {
  try {
    return encodeURI(url).replace(/%25([0-9a-fA-F]{2})/g, '%$1');
  } catch (_error) {
    return url;
  }
};

export const buildHeaders = (
  source: LegadoBookSource,
  baseUrl: string,
  vars: Record<string, unknown> = {},
): Record<string, string> => {
  const header =
    typeof source.header === 'object' && source.header ? source.header : {};
  const headerText =
    typeof source.header === 'string'
      ? renderTemplate(
          source.header || '{}',
          createRequestTemplateVars({
            ...vars,
            baseUrl,
          }),
        )
      : '';
  const sourceHeaders = {
    ...(header as Record<string, string>),
    ...safeJsonParse<Record<string, string>>(headerText, {}),
  };
  const renderedHeaders = Object.entries(sourceHeaders).reduce<
    Record<string, string>
  >((result, [key, value]) => {
    result[key] = renderTemplate(
      String(value),
      createRequestTemplateVars({
        ...vars,
        baseUrl,
      }),
    );
    return result;
  }, {});

  return {
    'User-Agent': DEFAULT_USER_AGENT,
    ...renderedHeaders,
  };
};

const stringifyRequestBody = (body: unknown): string | undefined => {
  if (body == null) {
    return undefined;
  }
  return typeof body === 'object' ? JSON.stringify(body) : String(body);
};

const hasHeader = (headers: Record<string, string>, name: string) =>
  Object.keys(headers).some(key => key.toLowerCase() === name.toLowerCase());

export const resolveRequest = (
  source: LegadoBookSource,
  rawUrl: string,
  vars: Record<string, unknown>,
  baseUrl = source.bookSourceUrl,
): ResolvedRequest => {
  const templateVars = createRequestTemplateVars({
    ...vars,
    baseUrl,
  });
  const templated = renderTemplate(rawUrl, templateVars);
  const {url, option} = splitUrlOption(templated);
  const method = String(option.method || 'GET').toUpperCase();
  const optionHeaders =
    typeof option.headers === 'object' && option.headers
      ? (option.headers as Record<string, string>)
      : {};
  const charset = String(option.charset || 'utf-8').toLowerCase();

  const resolvedUrl = resolveUrl(url, baseUrl);
  const body = stringifyRequestBody(option.body);
  const headers = {
    ...buildHeaders(source, baseUrl, vars),
    ...optionHeaders,
  };

  if (
    method === 'POST' &&
    typeof option.body === 'string' &&
    body !== undefined &&
    !hasHeader(headers, 'Content-Type')
  ) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
  }

  return {
    url: encodeRequestUrl(stripUrlHash(resolvedUrl)),
    method,
    headers,
    body,
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

const isCancelled = (cancelToken?: BookSourceCancelToken) => {
  const signal = cancelToken?.signal as {aborted?: boolean} | undefined;
  return Boolean(cancelToken?.cancelled || signal?.aborted);
};

const throwIfCancelled = (cancelToken?: BookSourceCancelToken) => {
  if (isCancelled(cancelToken)) {
    throw new Error('书源请求已取消');
  }
};

export const requestText = async (
  request: ResolvedRequest,
  timeoutMs = 20000,
  cancelToken?: BookSourceCancelToken,
): Promise<string> => {
  let attempt = 0;
  const maxAttempt = Math.max(1, request.retry + 1);

  while (attempt < maxAttempt) {
    try {
      throwIfCancelled(cancelToken);
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
          ...(cancelToken?.signal ? {signal: cancelToken.signal as any} : {}),
        },
        timeoutMs,
      );
      const buffer = await response.arrayBuffer();
      throwIfCancelled(cancelToken);
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
      if (isCancelled(cancelToken)) {
        throw error;
      }
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
