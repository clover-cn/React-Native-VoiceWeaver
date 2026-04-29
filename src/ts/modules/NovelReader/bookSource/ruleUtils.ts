import {decode} from 'he';

export const normalizeWhitespace = (value: string) =>
  value
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

export const safeJsonParse = <T>(raw: string | undefined, fallback: T): T => {
  if (!raw) {
    return fallback;
  }

  try {
    return JSON.parse(raw) as T;
  } catch (_error) {
    return fallback;
  }
};

const collapseDuplicatedNumericPathSegment = (resolvedUrl: string): string => {
  try {
    const parsed = new URL(resolvedUrl);
    parsed.pathname = parsed.pathname.replace(
      /\/(\d+)\/[^/]+\.html\/\1(?=\/)/g,
      '/$1',
    );
    const segments = parsed.pathname.split('/');
    const collapsed: string[] = [];
    for (const segment of segments) {
      const previous = collapsed[collapsed.length - 1];
      if (segment && /^\d+$/.test(segment) && previous === segment) {
        continue;
      }
      collapsed.push(segment);
    }
    parsed.pathname = collapsed.join('/') || '/';
    return parsed.toString();
  } catch (_error) {
    return resolvedUrl
      .replace(/\/(\d+)\/[^/]+\.html\/\1(?=\/)/g, '/$1')
      .replace(/\/(\d+)\/\1(?=\/)/g, '/$1');
  }
};

const resolveRootLikeRelativeUrl = (
  cleanUrl: string,
  baseUrl: string,
): string | null => {
  if (cleanUrl.startsWith('/') || cleanUrl.startsWith('./')) {
    return null;
  }

  const baseMatch = baseUrl.match(/^(https?:\/\/[^/?#]+)([^?#]*)/i);
  if (!baseMatch) {
    return null;
  }

  const firstRelativeSegment = cleanUrl.split('/').find(Boolean);
  const firstBaseSegment = (baseMatch[2] || '/').split('/').find(Boolean);
  if (
    firstRelativeSegment &&
    firstBaseSegment &&
    firstRelativeSegment === firstBaseSegment
  ) {
    return collapseDuplicatedNumericPathSegment(
      `${baseMatch[1]}/${cleanUrl.replace(/^\/+/, '')}`,
    );
  }

  return null;
};

export const resolveUrl = (value: string, baseUrl: string): string => {
  const url = value.trim();
  if (!url) {
    return '';
  }

  const cleanUrl = url.replace(/&amp;/g, '&');
  if (/^(https?:)?\/\//i.test(cleanUrl)) {
    return cleanUrl.startsWith('//') ? `https:${cleanUrl}` : cleanUrl;
  }

  const rootLikeUrl = resolveRootLikeRelativeUrl(cleanUrl, baseUrl);
  if (rootLikeUrl) {
    return rootLikeUrl;
  }

  try {
    return collapseDuplicatedNumericPathSegment(
      new URL(cleanUrl, baseUrl).toString(),
    );
  } catch (_error) {
    const match = baseUrl.match(/^(https?:\/\/[^/?#]+)([^?#]*)/i);
    if (!match) {
      return cleanUrl;
    }

    const origin = match[1];
    const rawPath = match[2] || '/';
    if (cleanUrl.startsWith('/')) {
      return collapseDuplicatedNumericPathSegment(`${origin}${cleanUrl}`);
    }

    const baseDir = rawPath.endsWith('/')
      ? rawPath
      : rawPath.slice(0, rawPath.lastIndexOf('/') + 1) || '/';
    return collapseDuplicatedNumericPathSegment(
      `${origin}${baseDir}${cleanUrl.replace(/^\/+/, '')}`,
    );
  }
};

export const stripUrlHash = (url: string): string => {
  const hashIndex = url.indexOf('#');
  return hashIndex >= 0 ? url.slice(0, hashIndex) : url;
};

export const getContentPageGroupKey = (url: string): string => {
  const cleanUrl = stripUrlHash(url);
  try {
    const parsed = new URL(cleanUrl);
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    const filename = pathParts[pathParts.length - 1] || '';
    const match = filename.match(/^(.+?)(?:-\d+)?(\.[a-z0-9]+)$/i);
    if (!match) {
      return `${parsed.origin}${parsed.pathname}`;
    }

    const dir = pathParts.slice(0, -1).join('/');
    return `${parsed.origin}/${dir ? `${dir}/` : ''}${match[1]}${match[2]}`;
  } catch (_error) {
    return cleanUrl.replace(/-\d+(\.[a-z0-9]+)$/i, '$1');
  }
};

export const isSameContentPageGroup = (firstUrl: string, nextUrl: string) =>
  getContentPageGroupKey(firstUrl) === getContentPageGroupKey(nextUrl);

export const htmlToText = (html: string): string => {
  const withBreaks = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|section|article|dd|dt|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '');

  return normalizeWhitespace(decode(withBreaks));
};

export const splitParagraphs = (text: string): string[] =>
  text
    .split(/\n+/)
    .map(item => normalizeWhitespace(item))
    .filter(Boolean);

export const renderTemplate = (
  template: string,
  vars: Record<string, unknown>,
): string => {
  return template.replace(/\{\{([\s\S]*?)\}\}/g, (_match, rawExpr) => {
    const expr = String(rawExpr).trim();
    if (!expr) {
      return '';
    }

    if (/^[a-zA-Z_$][\w$]*$/.test(expr)) {
      const value = vars[expr];
      return value == null ? '' : String(value);
    }

    if (expr.startsWith('$.')) {
      const json = vars.$;
      return readJsonPathLite(json, expr);
    }

    try {
      const keys = Object.keys(vars);
      const values = keys.map(key => vars[key]);
      // 书源是用户确认导入或内置的受信配置；这里只提供白名单上下文。
      // eslint-disable-next-line no-new-func
      const fn = new Function(...keys, `return (${expr});`);
      const result = fn(...values);
      return result == null ? '' : String(result);
    } catch (error) {
      console.warn('[bookSource] 模板执行失败', expr, error);
      return '';
    }
  });
};

export const readJsonPathLite = (data: unknown, path: string): string => {
  if (!path.startsWith('$.')) {
    return '';
  }

  const parts = path
    .slice(2)
    .split('.')
    .map(item => item.trim())
    .filter(Boolean);
  let current: any = data;
  for (const part of parts) {
    if (current == null) {
      return '';
    }
    current = current[part];
  }

  if (Array.isArray(current)) {
    return current.join(',');
  }
  return current == null ? '' : String(current);
};

export interface RegexTail {
  baseRule: string;
  regex?: string;
  replacement: string;
}

export const splitRegexTail = (rule: string): RegexTail => {
  const first = rule.indexOf('##');
  if (first < 0) {
    return {baseRule: rule, replacement: ''};
  }

  const second = rule.indexOf('##', first + 2);
  if (second < 0) {
    return {
      baseRule: rule.slice(0, first),
      regex: rule.slice(first + 2),
      replacement: '',
    };
  }

  const third = rule.indexOf('###', second + 2);
  const end = third >= 0 ? third : rule.length;
  return {
    baseRule: rule.slice(0, first),
    regex: rule.slice(first + 2, second),
    replacement: rule.slice(second + 2, end),
  };
};

export const applyRegexTail = (
  value: string,
  regex?: string,
  replacement = '',
): string => {
  if (!regex) {
    return value;
  }

  try {
    return value.replace(new RegExp(regex, 'g'), replacement);
  } catch (error) {
    console.warn('[bookSource] 正则处理失败', regex, error);
    return value;
  }
};
