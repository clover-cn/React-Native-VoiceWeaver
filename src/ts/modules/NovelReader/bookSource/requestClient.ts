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
  renderPageChoices,
  resolveUrl,
  safeJsonParse,
  stripUrlHash,
} from './ruleUtils';
import {bookSourceLogger} from './bookSourceLogger';
import {createRuleContext, evaluateStringAsync} from './ruleEvaluator';

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36';

export const splitUrlOption = (rawUrl: string) => {
  const text = rawUrl.trim();
  const match = text.match(/,\s*(\{[\s\S]*\})\s*$/);
  if (!match || match.index == null) {
    return {url: text, option: {} as Record<string, unknown>};
  }

  const url = text.slice(0, match.index).trim();
  const option = safeJsonParse<Record<string, unknown>>(match[1], {});
  return {url, option};
};

/** URL options 的 headers 在阅读书源中允许使用 JSON 字符串。 */
export const parseRequestHeaders = (
  headers: unknown,
): Record<string, string> => {
  const value =
    typeof headers === 'string' ? safeJsonParse(headers, {}) : headers;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, String(item ?? '')]),
  );
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
  const templated = renderTemplate(
    renderPageChoices(rawUrl, vars.page).replace(/\{\{\s*key\s*\}\}/g, () =>
      encodeURIComponent(String(vars.key ?? '')),
    ),
    templateVars,
  );
  const {url, option} = splitUrlOption(templated);
  const method = String(option.method || 'GET').toUpperCase();
  const optionHeaders = parseRequestHeaders(option.headers);
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
    headers['Content-Type'] =
      'application/x-www-form-urlencoded; charset=UTF-8';
  }

  return {
    url: /^data:/i.test(url)
      ? templated
      : encodeRequestUrl(stripUrlHash(resolvedUrl)),
    method,
    headers,
    body,
    charset,
    webView: Boolean(option.webView),
    retry: Number(option.retry || 0),
  };
};

/** 所有请求地址与字段规则使用同一脚本运行时，保留同步纯 URL 入口供 java 桥调用。 */
export const resolveRequestAsync = async (
  source: LegadoBookSource,
  rawUrl: string,
  vars: Record<string, unknown> = {},
  baseUrl = source.bookSourceUrl,
): Promise<ResolvedRequest> =>
  bookSourceLogger.trace(
    'request',
    '解析请求地址',
    {
      sourceName: source.bookSourceName,
      baseUrl,
      rawUrl,
    },
    () => resolveRequestAsyncInternal(source, rawUrl, vars, baseUrl),
  );

const resolveRequestAsyncInternal = async (
  source: LegadoBookSource,
  rawUrl: string,
  vars: Record<string, unknown> = {},
  baseUrl = source.bookSourceUrl,
): Promise<ResolvedRequest> => {
  if (!/<js>|@js:/i.test(rawUrl)) {
    return resolveRequest(source, rawUrl, vars, baseUrl);
  }
  const template = renderTemplate(
    rawUrl.replace(/\{\{\s*key\s*\}\}/g, () =>
      encodeURIComponent(String(vars.key ?? '')),
    ),
    createRequestTemplateVars({...vars, baseUrl}),
  );
  const context = createRuleContext('', baseUrl, undefined, {...vars, source});
  const value = await evaluateStringAsync(template, context);
  if (!value) {
    throw new Error('书源请求地址规则返回空值');
  }
  return resolveRequest(source, value, vars, baseUrl);
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

/** 认证失败不能进入书源的“错误消息作为正文/搜索项”规则。 */
export const checkBookSourceAuthentication = (text: string) => {
  let response: {code?: unknown; message?: unknown; msg?: unknown};
  try {
    response = JSON.parse(text);
  } catch {
    return;
  }
  if (!response || typeof response !== 'object') {
    return;
  }
  const code = Number(response.code);
  const message = String(response.message || response.msg || '');
  if (
    [401, 403].includes(code) ||
    (response.code != null &&
      ![0, 200].includes(code) &&
      /登录|登陆|未认证|令牌.*(失效|过期)|unauthenticated|unauthorized|token.*expired/i.test(
        message,
      ))
  ) {
    throw new Error('书源需要登录或登录已过期，请在书源管理中登录后重试');
  }
};

export const requestText = async (
  request: ResolvedRequest,
  timeoutMs = 20000,
  cancelToken?: BookSourceCancelToken,
): Promise<string> =>
  bookSourceLogger.trace(
    'request',
    '请求与响应解码',
    {
      url: request.url,
      method: request.method,
      timeoutMs,
    },
    () => requestTextInternal(request, timeoutMs, cancelToken),
  );

const requestTextInternal = async (
  request: ResolvedRequest,
  timeoutMs = 20000,
  cancelToken?: BookSourceCancelToken,
): Promise<string> => {
  throwIfCancelled(cancelToken);
  if (/^data:/i.test(request.url)) {
    const {url} = splitUrlOption(request.url);
    const match = url.match(/^data:([^,]*),([\s\S]*)$/i);
    if (!match) {
      throw new Error('书源 data 地址格式不正确');
    }
    const bytes = /;base64(?:;|$)/i.test(match[1])
      ? Buffer.from(match[2], 'base64')
      : Buffer.from(decodeURIComponent(match[2]), 'utf8');
    // 阅读把二进制 data 响应作为十六进制 result 交给初始化/正文规则。
    return bytes.toString('hex');
  }
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
        throw new Error(`HTTP ${response.status}`);
      }
      const text = decodeArrayBuffer(buffer, request.charset);
      checkBookSourceAuthentication(text);
      bookSourceLogger.log('request', '响应解码完成', {
        url: request.url,
        textLength: text.length,
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
