import {selectAll} from 'css-select';
import serialize from 'dom-serializer';
import {parseDocument} from 'htmlparser2';
import {getAttributeValue, getChildren, textContent} from 'domutils';
import {JSONPath} from 'jsonpath-plus';
import {DOMParser} from '@xmldom/xmldom';
import xpath from 'xpath';
import {
  applyRegexTail,
  htmlToText,
  normalizeWhitespace,
  readJsonPathLite,
  renderJsonPathPlaceholders,
  renderTemplate,
  resolveUrl,
  splitRegexTail,
} from './ruleUtils';

type RegexMatchContext = {
  __regexMatch: string[];
};

type AnyNode = any;
type Element = any;
type Text = {data: string};

export type RuleItem =
  | AnyNode
  | Record<string, unknown>
  | RegexMatchContext
  | string
  | number
  | boolean;

export interface RuleContext {
  raw: string;
  baseUrl: string;
  item?: RuleItem;
  json?: unknown;
  vars?: Record<string, unknown>;
}

const ATTR_NAMES = new Set([
  'text',
  'textNodes',
  'ownText',
  'html',
  'all',
  'href',
  'src',
  'content',
]);

const isRegexContext = (value: unknown): value is RegexMatchContext =>
  Boolean(value && typeof value === 'object' && '__regexMatch' in value);

const isNode = (value: unknown): value is AnyNode =>
  Boolean(value && typeof value === 'object' && 'type' in value);

const parseHtml = (raw: string) => parseDocument(raw, {decodeEntities: false});

const getSearchRoots = (context: RuleContext): AnyNode[] => {
  if (context.item && isNode(context.item)) {
    return [context.item];
  }
  return parseHtml(context.raw).children;
};

const splitExtractor = (rule: string) => {
  const cleanRule = rule.replace(/^@css:/i, '').trim();
  const atIndex = cleanRule.lastIndexOf('@');
  if (atIndex < 0) {
    return {selector: cleanRule, attr: ''};
  }

  const tail = cleanRule.slice(atIndex + 1).trim();
  if (!ATTR_NAMES.has(tail)) {
    return {selector: cleanRule, attr: ''};
  }

  return {
    selector: cleanRule.slice(0, atIndex).trim(),
    attr: tail,
  };
};

const directText = (node: AnyNode) => {
  return getChildren(node)
    .filter(child => child.type === 'text')
    .map(child => (child as Text).data)
    .join('');
};

const innerHtml = (node: AnyNode) => {
  return getChildren(node)
    .map(child => serialize(child as never, {decodeEntities: false}))
    .join('');
};

const extractFromNode = (node: AnyNode, attr: string): string => {
  const element = node as Element;
  switch (attr) {
    case 'href':
    case 'src':
    case 'content':
      return getAttributeValue(element, attr) || '';
    case 'html':
      return innerHtml(node);
    case 'all':
      return serialize(node as never, {decodeEntities: false});
    case 'ownText':
    case 'textNodes':
      return directText(node);
    case 'text':
    default:
      return textContent(node);
  }
};

const parseJson = (raw: string) => {
  const text = raw.trim();
  if (!text || !/^[{[]/.test(text)) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch (_error) {
    return undefined;
  }
};

const evalJsonPath = (rule: string, context: RuleContext): RuleItem[] => {
  const data =
    context.item && !isNode(context.item) ? context.item : context.json;
  if (!data) {
    return [];
  }

  try {
    const result = JSONPath({
      path: rule.replace(/^@json:/i, ''),
      json: data as any,
      wrap: true,
    });
    return Array.isArray(result)
      ? (result as RuleItem[])
      : [result as RuleItem];
  } catch (error) {
    console.warn('[bookSource] JSONPath 解析失败', rule, error);
    return [];
  }
};

const evalXPath = (rule: string, context: RuleContext): RuleItem[] => {
  try {
    const expression = rule.replace(/^@xpath:/i, '');
    const document = new DOMParser().parseFromString(context.raw, 'text/html');
    const result = xpath.select(expression, document as any) as unknown[];
    return result.map(item => ({value: String(item)}));
  } catch (error) {
    console.warn('[bookSource] XPath 解析失败', rule, error);
    return [];
  }
};

const evalRegexList = (rule: string, context: RuleContext): RuleItem[] => {
  const shouldReverse = rule.startsWith('-:');
  const expression = shouldReverse ? rule.slice(2) : rule.slice(1);
  try {
    const regex = new RegExp(expression, 'g');
    const list: RuleItem[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(context.raw))) {
      list.push({__regexMatch: Array.from(match)});
      if (match[0] === '') {
        regex.lastIndex += 1;
      }
    }
    return shouldReverse ? list.reverse() : list;
  } catch (error) {
    console.warn('[bookSource] AllInOne 正则失败', rule, error);
    return [];
  }
};

export const createRuleContext = (
  raw: string,
  baseUrl: string,
  item?: RuleItem,
  vars?: Record<string, unknown>,
): RuleContext => ({
  raw,
  baseUrl,
  item,
  json: parseJson(raw),
  vars,
});

export const evaluateList = (
  rule: string | undefined,
  context: RuleContext,
) => {
  const cleanRule = String(rule || '').trim();
  if (!cleanRule) {
    return [] as RuleItem[];
  }

  if (cleanRule.startsWith(':') || cleanRule.startsWith('-:')) {
    return evalRegexList(cleanRule, context);
  }

  if (cleanRule.startsWith('@json:') || cleanRule.startsWith('$')) {
    return evalJsonPath(cleanRule, context);
  }

  if (
    cleanRule.startsWith('@XPath:') ||
    cleanRule.startsWith('@xpath:') ||
    cleanRule.startsWith('//')
  ) {
    return evalXPath(cleanRule, context);
  }

  const {selector} = splitExtractor(cleanRule);
  try {
    return selectAll(selector, getSearchRoots(context)) as RuleItem[];
  } catch (error) {
    console.warn('[bookSource] CSS 列表解析失败', cleanRule, error);
    return [];
  }
};

const evaluateCssString = (
  rule: string,
  context: RuleContext,
  asUrl: boolean,
) => {
  const {selector, attr} = splitExtractor(rule);
  const roots = getSearchRoots(context);
  const nodes = selector ? (selectAll(selector, roots) as AnyNode[]) : roots;
  const values = nodes.map(node => {
    const value = normalizeWhitespace(extractFromNode(node, attr || 'text'));
    return asUrl && ['href', 'src', 'content'].includes(attr)
      ? resolveUrl(value, context.baseUrl)
      : value;
  });
  const filteredValues = values.filter(Boolean);
  return asUrl ? filteredValues[0] || '' : filteredValues.join('\n');
};

const evaluateRawString = (rule: string, context: RuleContext): string => {
  const item = context.item;
  if (isRegexContext(item)) {
    const capture = rule.match(/^\$(\d+)$/);
    if (capture) {
      return item.__regexMatch[Number(capture[1])] || '';
    }
  }

  if (item && !isNode(item) && !isRegexContext(item)) {
    if (rule.startsWith('$.')) {
      return readJsonPathLite(item, rule);
    }
    const value = (item as Record<string, unknown>)[rule];
    if (value != null) {
      return String(value);
    }
  }

  if (rule === 'all') {
    return context.raw;
  }

  if (rule.includes('{') && rule.includes('}') && !rule.includes('{{')) {
    return renderJsonPathPlaceholders(
      rule,
      item && !isNode(item) ? item : context.json,
    );
  }

  if (rule.includes('{{')) {
    return renderTemplate(rule, {
      ...(context.vars || {}),
      $: item && !isNode(item) ? item : context.json,
      result: context.raw,
      baseUrl: context.baseUrl,
    });
  }

  return rule;
};

const defaultRuleResult = (context: RuleContext): string => {
  const item = context.item;
  if (isRegexContext(item)) {
    return item.__regexMatch[0] || '';
  }
  if (isNode(item)) {
    return normalizeWhitespace(extractFromNode(item, 'text'));
  }
  if (item != null) {
    return typeof item === 'string' ? item : JSON.stringify(item);
  }
  return context.raw;
};

const executeRuleJs = (
  script: string,
  result: string,
  context: RuleContext,
): string => {
  try {
    const vars = context.vars || {};
    context.vars = vars;
    const java = {
      encodeURI: (value: string) => encodeURIComponent(String(value)),
      log: (value: unknown) => console.log('[bookSource:js]', value),
      put: (key: string, value: unknown) => {
        vars[key] = value;
        return value;
      },
      get: (key: string) => vars[key],
      getString: (rule: string, isUrl = false) =>
        evaluateString(rule, context, isUrl),
      getStringList: (rule: string, isUrl = false) =>
        evaluateList(rule, context).map(item =>
          evaluateString('text', {...context, item}, isUrl),
        ),
    };
    // 书源 JS 只在内置或用户信任的规则中执行，并且只暴露本地白名单对象。
    // eslint-disable-next-line no-new-func
    const fn = new Function(
      'result',
      'java',
      'baseUrl',
      'src',
      'chapter',
      'vars',
      `${script}; return result;`,
    );
    const value = fn(
      result,
      java,
      context.baseUrl,
      context.raw,
      vars.chapter || {},
      vars,
    );
    return value == null ? '' : String(value);
  } catch (error) {
    console.warn('[bookSource] JS 规则执行失败', script, error);
    return '';
  }
};

const isUrlLiteralRule = (rule: string) =>
  /^(https?:)?\/\//i.test(rule) ||
  rule.startsWith('/') ||
  rule.startsWith('./') ||
  rule.startsWith('../') ||
  /\{\s*\$[.\w[\]*]+\s*\}/.test(rule);

export const evaluateString = (
  rule: string | undefined,
  context: RuleContext,
  asUrl = false,
): string => {
  const cleanRule = String(rule || '').trim();
  if (!cleanRule) {
    return '';
  }

  const {baseRule, regex, replacement} = splitRegexTail(cleanRule);
  const targetRule = baseRule.trim() || 'all';
  let value = '';

  try {
    const legadoJs = targetRule.match(/^<js>([\s\S]*)<\/js>$/i);
    if (legadoJs) {
      value = executeRuleJs(legadoJs[1], defaultRuleResult(context), context);
    } else {
      const jsIndex = targetRule.indexOf('@js:');
      if (jsIndex > 0) {
        const beforeJs = targetRule.slice(0, jsIndex);
        const script = targetRule.slice(jsIndex + 4);
        const result = evaluateString(beforeJs, context, false);
        value = executeRuleJs(script, result, context);
      } else if (targetRule.startsWith('@js:')) {
        value = executeRuleJs(
          targetRule.slice(4),
          defaultRuleResult(context),
          context,
        );
      } else if (
        targetRule.startsWith('@json:') ||
        targetRule.startsWith('$')
      ) {
        value =
          context.item && !isNode(context.item)
            ? readJsonPathLite(context.item, targetRule.replace(/^@json:/i, ''))
            : String(evalJsonPath(targetRule, context)[0] || '');
      } else if (
        targetRule.startsWith('@XPath:') ||
        targetRule.startsWith('@xpath:') ||
        targetRule.startsWith('//')
      ) {
        const result = evalXPath(targetRule, context)[0] as
          | {value?: string}
          | undefined;
        value = result?.value || '';
      } else if (
        targetRule.startsWith('@css:') ||
        (!isUrlLiteralRule(targetRule) && /[.#:[\]> ]/.test(targetRule)) ||
        targetRule.includes('@')
      ) {
        value = evaluateCssString(targetRule, context, asUrl);
      } else {
        value = evaluateRawString(targetRule, context);
      }
    }
  } catch (error) {
    console.warn('[bookSource] 字符串规则解析失败', cleanRule, error);
    value = '';
  }

  const replaced = applyRegexTail(value, regex, replacement);
  return asUrl
    ? resolveUrl(replaced, context.baseUrl)
    : normalizeWhitespace(replaced);
};

export const normalizeContentText = (raw: string): string => {
  if (/<[a-z][\s\S]*>/i.test(raw)) {
    return htmlToText(raw);
  }
  return normalizeWhitespace(raw);
};
