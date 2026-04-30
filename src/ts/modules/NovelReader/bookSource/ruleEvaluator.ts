import {selectAll} from 'css-select';
import serialize from 'dom-serializer';
import {parseDocument} from 'htmlparser2';
import {getAttributeValue, getChildren, textContent} from 'domutils';
import {JSONPath} from 'jsonpath-plus';
import {DOMParser} from '@xmldom/xmldom';
import xpath from 'xpath';
import {Buffer} from 'buffer';
import {
  applyRegexTail,
  htmlToText,
  normalizeWhitespace,
  renderJsonPathPlaceholders,
  renderTemplate,
  resolveUrl,
  splitRegexTail,
} from './ruleUtils';

type RegexMatchContext = {
  __regexMatch: string[];
};

type XPathNodeContext = {
  __xpathNode: any;
};

type AnyNode = any;
type Element = any;
type Text = {data: string};

export type RuleItem =
  | AnyNode
  | XPathNodeContext
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

const EXTRACTOR_NAMES = new Set([
  'text',
  'textNodes',
  'ownText',
  'html',
  'all',
]);

const isRegexContext = (value: unknown): value is RegexMatchContext =>
  Boolean(value && typeof value === 'object' && '__regexMatch' in value);

const isXPathContext = (value: unknown): value is XPathNodeContext =>
  Boolean(value && typeof value === 'object' && '__xpathNode' in value);

const isNode = (value: unknown): value is AnyNode =>
  Boolean(value && typeof value === 'object' && 'type' in value);

const parseHtml = (raw: string) => parseDocument(raw, {decodeEntities: false});

const stringifyXPathNode = (node: any, attr = 'text') => {
  if (node == null) {
    return '';
  }
  if (typeof node !== 'object' || typeof node.nodeType !== 'number') {
    return String(node);
  }

  if (node.nodeType === 2 || node.nodeType === 3) {
    return String(node.nodeValue || '');
  }

  if (attr && !EXTRACTOR_NAMES.has(attr)) {
    return String(node.getAttribute?.(attr) || '');
  }

  if (attr === 'html' || attr === 'all') {
    return String(node);
  }

  return String(node.textContent || '');
};

const getSearchRoots = (context: RuleContext): AnyNode[] => {
  if (context.item && isNode(context.item)) {
    return [context.item];
  }
  if (context.item && isXPathContext(context.item)) {
    return parseHtml(String(context.item.__xpathNode)).children;
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
  if (!/^[\w:-]+$/.test(tail)) {
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
    case 'html':
      return innerHtml(node);
    case 'all':
      return serialize(node as never, {decodeEntities: false});
    case 'ownText':
    case 'textNodes':
      return directText(node);
    case 'text':
    case '':
      return textContent(node);
    default:
      return getAttributeValue(element, attr) || '';
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

const normalizeJsonPath = (rule: string) =>
  rule.replace(/^@json:/i, '').replace(/\.\[\*\]/g, '[*]');

const SIMPLE_JSON_PATH = /^\$(?:\.[A-Za-z_$][\w$]*)+$/;

const readSimpleJsonPath = (data: unknown, path: string) => {
  const cleanPath = normalizeJsonPath(path);
  if (!SIMPLE_JSON_PATH.test(cleanPath)) {
    return {matched: false, value: undefined as unknown};
  }

  const keys = cleanPath.slice(2).split('.');
  let value = data;
  for (const key of keys) {
    if (value == null || typeof value !== 'object') {
      return {matched: true, value: undefined as unknown};
    }
    value = (value as Record<string, unknown>)[key];
  }

  return {matched: true, value};
};

const readSimpleJsonArrayPath = (rule: string, data: unknown) => {
  const cleanRule = normalizeJsonPath(rule);
  if (!cleanRule.endsWith('[*]')) {
    return undefined;
  }

  const basePath = cleanRule.slice(0, -3);
  const result = readSimpleJsonPath(data, basePath);
  if (!result.matched) {
    return undefined;
  }

  return Array.isArray(result.value) ? (result.value as RuleItem[]) : [];
};

const evalJsonPath = (rule: string, context: RuleContext): RuleItem[] => {
  const data =
    context.item && !isNode(context.item) && !isRegexContext(context.item)
      ? context.item
      : context.json;
  if (!data) {
    return [];
  }

  try {
    const simpleList = readSimpleJsonArrayPath(rule, data);
    if (simpleList) {
      return simpleList;
    }

    const result = JSONPath({
      path: normalizeJsonPath(rule),
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

const parseXPathDocument = (raw: string) => {
  const wrapped = `<root>${raw}</root>`;
  return new DOMParser().parseFromString(wrapped, 'text/xml');
};

const evalXPath = (rule: string, context: RuleContext): RuleItem[] => {
  try {
    let expression = rule.replace(/^@xpath:/i, '').replace(/^@XPath:/, '');
    const hasXPathItem = isXPathContext(context.item);
    if (hasXPathItem && expression.startsWith('//')) {
      expression = `.${expression}`;
    }
    const base = hasXPathItem
      ? context.item.__xpathNode
      : parseXPathDocument(context.raw);
    const result = xpath.select(expression, base) as unknown[];
    return result.map(item =>
      item && typeof item === 'object' && 'nodeType' in item
        ? ({__xpathNode: item} as XPathNodeContext)
        : (String(item) as RuleItem),
    );
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

const withDescendants = (node: AnyNode): AnyNode[] => {
  const list: AnyNode[] = [];
  const walk = (current: AnyNode) => {
    if (!current) {
      return;
    }
    if (current.type === 'tag' || current.type === 'root') {
      list.push(current);
    }
    getChildren(current).forEach(walk);
  };
  walk(node);
  return list;
};

const directElementChildren = (node: AnyNode): AnyNode[] =>
  getChildren(node).filter(child => child.type === 'tag');

const resolveIndex = (length: number, index: number) =>
  index < 0 ? length + index : index;

const applyIndexSpec = (nodes: AnyNode[], spec?: string) => {
  if (!spec) {
    return nodes;
  }
  const body = spec.slice(1, -1).trim();
  if (!body) {
    return nodes;
  }

  const exclude = body.startsWith('!');
  const parts = (exclude ? body.slice(1) : body)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  const selected = new Set<number>();

  parts.forEach(part => {
    if (part.includes(':')) {
      const [rawStart, rawEnd, rawStep] = part.split(':');
      const start =
        rawStart === '' ? 0 : resolveIndex(nodes.length, Number(rawStart));
      const end =
        rawEnd === ''
          ? nodes.length - 1
          : resolveIndex(nodes.length, Number(rawEnd));
      const step = Math.abs(Number(rawStep || 1)) || 1;
      const direction = start <= end ? 1 : -1;
      for (
        let index = start;
        direction > 0 ? index <= end : index >= end;
        index += step * direction
      ) {
        if (index >= 0 && index < nodes.length) {
          selected.add(index);
        }
      }
      return;
    }

    const index = resolveIndex(nodes.length, Number(part));
    if (index >= 0 && index < nodes.length) {
      selected.add(index);
    }
  });

  if (exclude) {
    return nodes.filter((_node, index) => !selected.has(index));
  }
  return nodes.filter((_node, index) => selected.has(index));
};

const takeSegmentIndex = (segment: string) => {
  const match = segment.match(/(\[[^\]]+\])$/);
  if (!match) {
    return {base: segment, indexSpec: undefined as string | undefined};
  }
  return {
    base: segment.slice(0, -match[1].length),
    indexSpec: match[1],
  };
};

const parseDefaultSelector = (segment: string) => {
  const {base, indexSpec} = takeSegmentIndex(segment.trim());
  if (!base || base === 'children') {
    return {type: 'children', name: '', position: undefined, indexSpec};
  }

  if (/^\.?-?\d+$/.test(base)) {
    const index = Number(base.replace(/^\./, ''));
    return {type: 'children', name: '', position: index, indexSpec};
  }

  if (base.startsWith('.')) {
    return {type: 'class', name: base.slice(1), position: undefined, indexSpec};
  }
  if (base.startsWith('#')) {
    return {type: 'id', name: base.slice(1), position: undefined, indexSpec};
  }

  const parts = base.split('.');
  if (['class', 'id', 'tag', 'text'].includes(parts[0])) {
    return {
      type: parts[0],
      name: parts[1] || '',
      position: parts[2] == null ? undefined : Number(parts[2]),
      indexSpec,
    };
  }

  return {
    type: 'tag',
    name: parts[0],
    position: parts[1] == null ? undefined : Number(parts[1]),
    indexSpec,
  };
};

const applyDefaultSegment = (nodes: AnyNode[], segment: string) => {
  const selector = parseDefaultSelector(segment);
  let result: AnyNode[] = [];

  nodes.forEach(node => {
    const candidates =
      selector.type === 'children'
        ? directElementChildren(node)
        : withDescendants(node).filter(candidate => candidate.type === 'tag');

    const matched = candidates.filter(candidate => {
      if (selector.type === 'children') {
        return true;
      }
      if (selector.type === 'tag') {
        return candidate.name === selector.name;
      }
      if (selector.type === 'class') {
        return String(getAttributeValue(candidate, 'class') || '')
          .split(/\s+/)
          .includes(selector.name);
      }
      if (selector.type === 'id') {
        return getAttributeValue(candidate, 'id') === selector.name;
      }
      if (selector.type === 'text') {
        return textContent(candidate).includes(selector.name);
      }
      return false;
    });

    result.push(...matched);
  });

  if (selector.position != null && Number.isFinite(selector.position)) {
    const index = resolveIndex(result.length, selector.position);
    result = index >= 0 && index < result.length ? [result[index]] : [];
  }

  return applyIndexSpec(result, selector.indexSpec);
};

const isSimpleExtractor = (segment: string) =>
  EXTRACTOR_NAMES.has(segment) || /^[\w:-]+$/.test(segment);

const isDefaultSegment = (segment: string) =>
  EXTRACTOR_NAMES.has(segment) ||
  segment === 'children' ||
  /^\.[\w-]+(?:\[[^\]]+\])?$/.test(segment) ||
  /^#[\w-]+(?:\[[^\]]+\])?$/.test(segment) ||
  segment.startsWith('class.') ||
  segment.startsWith('id.') ||
  segment.startsWith('tag.') ||
  segment.startsWith('text.') ||
  /^\[!?[-\d:, ]+\]$/.test(segment) ||
  /^\.?-?\d+$/.test(segment) ||
  /^[a-zA-Z][\w-]*(?:\.-?\d+)?(?:\[[^\]]+\])?$/.test(segment);

const isDefaultRule = (rule: string) => {
  const clean = rule.trim();
  if (
    !clean ||
    clean.startsWith('@css:') ||
    clean.startsWith('@json:') ||
    clean.startsWith('@xpath:') ||
    clean.startsWith('@XPath:') ||
    clean.startsWith('@js:') ||
    clean.startsWith('$') ||
    clean.startsWith('//')
  ) {
    return false;
  }
  if (/[>,: ]/.test(clean)) {
    return false;
  }
  return clean.split('@').every(part => isDefaultSegment(part.trim()));
};

const evalDefaultNodes = (rule: string, context: RuleContext) => {
  const parts = rule
    .split('@')
    .map(item => item.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return {nodes: [] as AnyNode[], attr: ''};
  }

  const tail = parts[parts.length - 1];
  if (parts.length > 1 && isSimpleExtractor(tail)) {
    parts.pop();
  }
  const finalAttr = parts.length === rule.split('@').length ? '' : tail;
  let nodes = getSearchRoots(context);
  parts.forEach(part => {
    nodes = applyDefaultSegment(nodes, part);
  });
  return {
    nodes,
    attr: parts.length === rule.split('@').length ? '' : finalAttr,
  };
};

const selectAllCompat = (selector: string, roots: AnyNode[]): RuleItem[] => {
  const eqMatch = selector.match(/:eq\((-?\d+)\)/);
  if (!eqMatch || eqMatch.index == null) {
    return selectAll(selector, roots) as RuleItem[];
  }

  const before = selector.slice(0, eqMatch.index).trim() || '*';
  const after = selector.slice(eqMatch.index + eqMatch[0].length).trim();
  const candidates = selectAll(before, roots) as AnyNode[];
  const index = resolveIndex(candidates.length, Number(eqMatch[1]));
  const picked =
    index >= 0 && index < candidates.length ? [candidates[index]] : [];
  if (!after) {
    return picked;
  }

  return selectAllCompat(after.replace(/^>\s*/, ''), picked);
};

const evaluateCssString = (
  rule: string,
  context: RuleContext,
  asUrl: boolean,
) => {
  const {selector, attr} = splitExtractor(rule);
  const roots = getSearchRoots(context);
  const nodes = selector
    ? (selectAllCompat(selector, roots) as AnyNode[])
    : roots;
  const values = nodes.map(node => {
    const value = normalizeWhitespace(extractFromNode(node, attr || 'text'));
    return asUrl && attr && !EXTRACTOR_NAMES.has(attr)
      ? resolveUrlWithOption(value, context.baseUrl)
      : value;
  });
  const filteredValues = values.filter(Boolean);
  return asUrl ? filteredValues[0] || '' : filteredValues.join('\n');
};

const evaluateDefaultString = (
  rule: string,
  context: RuleContext,
  asUrl: boolean,
) => {
  const {nodes, attr} = evalDefaultNodes(rule, context);
  const values = nodes.map(node =>
    normalizeWhitespace(extractFromNode(node, attr || 'text')),
  );
  const filteredValues = values.filter(Boolean);
  const value = asUrl ? filteredValues[0] || '' : filteredValues.join('\n');
  return asUrl ? resolveUrlWithOption(value, context.baseUrl) : value;
};

const parseCombinator = (rule: string) => {
  if (rule.includes('@js:') || rule.includes('<js>')) {
    return undefined;
  }

  let quote = '';
  let escaped = false;
  let depth = 0;
  for (let index = 0; index < rule.length; index += 1) {
    const char = rule[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = '';
      }
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if ('({['.includes(char)) {
      depth += 1;
      continue;
    }
    if (')}]'.includes(char)) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0) {
      const op = ['&&', '||', '%%'].find(item => rule.startsWith(item, index));
      if (op) {
        return {
          op,
          parts: rule
            .split(op)
            .map(item => item.trim())
            .filter(Boolean),
        };
      }
    }
  }
  return undefined;
};

const combineLists = (parts: RuleItem[][], op: string) => {
  if (op === '||') {
    return parts.find(item => item.length > 0) || [];
  }
  if (op === '%%') {
    const result: RuleItem[] = [];
    const max = Math.max(...parts.map(item => item.length), 0);
    for (let index = 0; index < max; index += 1) {
      parts.forEach(list => {
        if (list[index] != null) {
          result.push(list[index]);
        }
      });
    }
    return result;
  }
  return parts.flat();
};

const resolveUrlWithOption = (value: string, baseUrl: string) => {
  const marker = ',{';
  const index = value.lastIndexOf(marker);
  if (index >= 0 && value.endsWith('}')) {
    return `${resolveUrl(value.slice(0, index), baseUrl)}${value.slice(index)}`;
  }
  return resolveUrl(value, baseUrl);
};

export const createRuleContext = (
  raw: string,
  baseUrl: string,
  item?: RuleItem,
  vars?: Record<string, unknown>,
  json?: unknown,
): RuleContext => ({
  raw,
  baseUrl,
  item,
  json: json === undefined ? parseJson(raw) : json,
  vars,
});

export const evaluateList = (
  rule: string | undefined,
  context: RuleContext,
): RuleItem[] => {
  let cleanRule = String(rule || '').trim();
  if (!cleanRule) {
    return [] as RuleItem[];
  }

  const combinator = parseCombinator(cleanRule);
  if (combinator) {
    return combineLists(
      combinator.parts.map(part => evaluateList(part, context)),
      combinator.op,
    );
  }

  if (cleanRule.startsWith(':') || cleanRule.startsWith('-:')) {
    return evalRegexList(cleanRule, context);
  }

  const shouldReverse = cleanRule.startsWith('-');
  if (shouldReverse) {
    cleanRule = cleanRule.slice(1).trim();
  }

  let result: RuleItem[] = [];
  const legadoJs = cleanRule.match(/^<js>([\s\S]*)<\/js>$/i);
  if (legadoJs) {
    result = normalizeJsListResult(
      executeRuleJsValue(legadoJs[1], defaultRuleResult(context), context),
    );
  } else if (cleanRule.startsWith('@js:')) {
    result = normalizeJsListResult(
      executeRuleJsValue(
        cleanRule.slice(4),
        defaultRuleResult(context),
        context,
      ),
    );
  } else if (cleanRule.startsWith('@json:') || cleanRule.startsWith('$')) {
    result = evalJsonPath(cleanRule, context);
  } else if (
    cleanRule.startsWith('@XPath:') ||
    cleanRule.startsWith('@xpath:') ||
    cleanRule.startsWith('//')
  ) {
    result = evalXPath(cleanRule, context);
  } else if (isDefaultRule(cleanRule)) {
    result = evalDefaultNodes(cleanRule, context).nodes;
  } else {
    const {selector} = splitExtractor(cleanRule);
    try {
      result = selectAllCompat(selector, getSearchRoots(context));
    } catch (error) {
      console.warn('[bookSource] CSS 列表解析失败', cleanRule, error);
      result = [];
    }
  }

  return shouldReverse ? result.reverse() : result;
};

const readJsonPath = (data: unknown, path: string): string => {
  try {
    const simpleResult = readSimpleJsonPath(data, path);
    if (simpleResult.matched) {
      const value = simpleResult.value;
      if (value == null) {
        return '';
      }
      return typeof value === 'object' ? JSON.stringify(value) : String(value);
    }

    const result = JSONPath({
      path: normalizeJsonPath(path),
      json: data as any,
      wrap: true,
    });
    const first = Array.isArray(result) ? result[0] : result;
    if (first == null) {
      return '';
    }
    return typeof first === 'object' ? JSON.stringify(first) : String(first);
  } catch (_error) {
    return '';
  }
};

const renderLegadoTemplate = (template: string, context: RuleContext) => {
  return template.replace(/\{\{([\s\S]*?)\}\}/g, (_match, rawExpr) => {
    const expr = String(rawExpr).trim();
    if (!expr) {
      return '';
    }
    if (expr.startsWith('@@')) {
      return evaluateString(expr.slice(2), context);
    }
    if (
      expr.startsWith('@css:') ||
      expr.startsWith('@json:') ||
      expr.startsWith('@xpath:') ||
      expr.startsWith('@XPath:') ||
      expr.startsWith('//') ||
      expr.startsWith('$')
    ) {
      return evaluateString(expr, context);
    }
    return renderTemplate(`{{${expr}}}`, {
      ...(context.vars || {}),
      $: context.item && !isNode(context.item) ? context.item : context.json,
      result: context.raw,
      baseUrl: context.baseUrl,
    });
  });
};

const evaluatePutRule = (rule: string, context: RuleContext) => {
  const vars = context.vars || {};
  context.vars = vars;
  const body = rule.replace(/^@put:/i, '').trim();
  const content =
    body.startsWith('{') && body.endsWith('}') ? body.slice(1, -1) : body;

  const pairRegex = /([\w$]+)\s*:\s*("[^"]*"|'[^']*'|[^,}]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pairRegex.exec(content))) {
    const key = match[1];
    const rawRule = match[2].trim();
    const valueRule =
      (rawRule.startsWith('"') && rawRule.endsWith('"')) ||
      (rawRule.startsWith("'") && rawRule.endsWith("'"))
        ? rawRule.slice(1, -1)
        : rawRule;
    vars[key] = evaluateString(valueRule, context);
  }

  return '';
};

const evaluateRawString = (rule: string, context: RuleContext): string => {
  const item = context.item;
  if (isRegexContext(item)) {
    if (/^\$(\d+)$/.test(rule)) {
      return item.__regexMatch[Number(rule.slice(1))] || '';
    }
    return rule.replace(
      /\$(\d+)/g,
      (_match, index) => item.__regexMatch[Number(index)] || '',
    );
  }

  if (isNode(item) && isSimpleExtractor(rule)) {
    return extractFromNode(item, rule);
  }

  if (isXPathContext(item) && isSimpleExtractor(rule)) {
    return stringifyXPathNode(item.__xpathNode, rule);
  }

  if (item && !isNode(item) && !isRegexContext(item) && !isXPathContext(item)) {
    if (rule.startsWith('$.')) {
      return readJsonPath(item, rule);
    }
    const value = (item as Record<string, unknown>)[rule];
    if (value != null) {
      return typeof value === 'object' ? JSON.stringify(value) : String(value);
    }
  }

  if (rule === 'all') {
    return context.raw;
  }

  if (rule.includes('{') && rule.includes('}') && !rule.includes('{{')) {
    return renderJsonPathPlaceholders(
      rule,
      item && !isNode(item) && !isXPathContext(item) ? item : context.json,
    );
  }

  if (rule.includes('{{')) {
    return renderLegadoTemplate(rule, context);
  }

  return rule;
};

const defaultRuleResult = (context: RuleContext): string => {
  const item = context.item;
  if (isRegexContext(item)) {
    return item.__regexMatch[0] || '';
  }
  if (isXPathContext(item)) {
    return stringifyXPathNode(item.__xpathNode);
  }
  if (isNode(item)) {
    return normalizeWhitespace(extractFromNode(item, 'text'));
  }
  if (item != null) {
    return typeof item === 'string' ? item : JSON.stringify(item);
  }
  return context.raw;
};

type RuleJsFunction = (
  result: string,
  java: Record<string, unknown>,
  baseUrl: string,
  src: string,
  chapter: unknown,
  book: unknown,
  vars: Record<string, unknown>,
) => unknown;

const ruleExpressionJsCache = new Map<string, RuleJsFunction>();
const ruleStatementJsCache = new Map<string, RuleJsFunction>();

const stringifyRuleJsValue = (value: unknown): string =>
  value == null
    ? ''
    : typeof value === 'string'
    ? value
    : JSON.stringify(value);

const isRuleJsExpression = (script: string) => {
  const trimmed = script.trim();
  return (
    /^[\[{]/.test(trimmed) ||
    /^\(?\s*(function|\(\s*\)|[\w$]+\s*=>)/.test(trimmed)
  );
};

const executeRuleJsValue = (
  script: string,
  result: string,
  context: RuleContext,
): unknown => {
  try {
    const vars = context.vars || {};
    context.vars = vars;
    const java = {
      ajax: () => '',
      base64Encode: (value: string) =>
        typeof btoa === 'function'
          ? btoa(String(value))
          : Buffer.from(String(value), 'utf8').toString('base64'),
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

    const trimmed = script.trim();
    if (isRuleJsExpression(trimmed)) {
      let exprFn = ruleExpressionJsCache.get(script);
      try {
        if (!exprFn) {
          // eslint-disable-next-line no-new-func
          exprFn = new Function(
            'result',
            'java',
            'baseUrl',
            'src',
            'chapter',
            'book',
            'vars',
            `return (${script});`,
          ) as RuleJsFunction;
          ruleExpressionJsCache.set(script, exprFn);
        }
        return exprFn(
          result,
          java,
          context.baseUrl,
          context.raw,
          vars.chapter || {},
          vars.book || {},
          vars,
        );
      } catch (_error) {
        // 不是所有以 { 开头的脚本都是表达式，失败后按语句规则继续执行。
      }
    }

    // 书源 JS 只在内置或用户信任的规则中执行，并且只暴露本地白名单对象。
    let fn = ruleStatementJsCache.get(script);
    if (!fn) {
      // eslint-disable-next-line no-new-func
      fn = new Function(
        'result',
        'java',
        'baseUrl',
        'src',
        'chapter',
        'book',
        'vars',
        `${script}; return result;`,
      ) as RuleJsFunction;
      ruleStatementJsCache.set(script, fn);
    }
    const value = fn(
      result,
      java,
      context.baseUrl,
      context.raw,
      vars.chapter || {},
      vars.book || {},
      vars,
    );
    return value;
  } catch (error) {
    console.warn('[bookSource] JS 规则执行失败', script, error);
    return '';
  }
};

const executeRuleJs = (
  script: string,
  result: string,
  context: RuleContext,
): string => stringifyRuleJsValue(executeRuleJsValue(script, result, context));

const normalizeJsListResult = (value: unknown): RuleItem[] => {
  if (value == null || value === '') {
    return [];
  }
  if (Array.isArray(value)) {
    return value as RuleItem[];
  }
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) {
      return [];
    }
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed as RuleItem[];
      }
      if (parsed && typeof parsed === 'object') {
        return [parsed as RuleItem];
      }
    } catch (_error) {
      return [value];
    }
  }
  return [value as RuleItem];
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

  const combinator = parseCombinator(cleanRule);
  if (combinator) {
    const values = combinator.parts
      .map(part => evaluateString(part, context, asUrl))
      .filter(Boolean);
    if (combinator.op === '||') {
      return values[0] || '';
    }
    if (combinator.op === '%%') {
      const lines = values.map(value => value.split('\n'));
      const result: string[] = [];
      const max = Math.max(...lines.map(item => item.length), 0);
      for (let index = 0; index < max; index += 1) {
        lines.forEach(list => {
          if (list[index]) {
            result.push(list[index]);
          }
        });
      }
      return result.join('\n');
    }
    return values.join('\n');
  }

  const {baseRule, regex, replacement, onlyOne} = splitRegexTail(cleanRule);
  const targetRule = baseRule.trim() || 'all';
  let value = '';

  try {
    const legadoJs = targetRule.match(/^<js>([\s\S]*)<\/js>$/i);
    if (legadoJs) {
      value = executeRuleJs(legadoJs[1], defaultRuleResult(context), context);
    } else if (targetRule.startsWith('@put:')) {
      value = evaluatePutRule(targetRule, context);
    } else if (targetRule.startsWith('@get:')) {
      value = String(
        context.vars?.[targetRule.replace(/^@get:/i, '').trim()] ?? '',
      );
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
      } else if (isRegexContext(context.item)) {
        value = evaluateRawString(targetRule, context);
      } else if (
        targetRule.startsWith('@json:') ||
        targetRule.startsWith('$')
      ) {
        const result = evalJsonPath(targetRule, context)[0];
        value =
          result == null
            ? ''
            : typeof result === 'object'
            ? JSON.stringify(result)
            : String(result);
      } else if (
        targetRule.startsWith('@XPath:') ||
        targetRule.startsWith('@xpath:') ||
        targetRule.startsWith('//')
      ) {
        const result = evalXPath(targetRule, context)[0];
        value = isXPathContext(result)
          ? stringifyXPathNode(result.__xpathNode)
          : result == null
          ? ''
          : String(result);
      } else if (
        (targetRule === 'all' || isSimpleExtractor(targetRule)) &&
        (isNode(context.item) ||
          isXPathContext(context.item) ||
          targetRule === 'all')
      ) {
        value = evaluateRawString(targetRule, context);
      } else if (
        context.item &&
        !isNode(context.item) &&
        !isRegexContext(context.item) &&
        !isXPathContext(context.item) &&
        isSimpleExtractor(targetRule)
      ) {
        value = evaluateRawString(targetRule, context);
      } else if (isDefaultRule(targetRule)) {
        value = evaluateDefaultString(targetRule, context, asUrl);
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

  const replaced = applyRegexTail(value, regex, replacement, onlyOne);
  return asUrl
    ? resolveUrlWithOption(replaced, context.baseUrl)
    : normalizeWhitespace(replaced);
};

export const normalizeContentText = (raw: string): string => {
  if (/<[a-z][\s\S]*>/i.test(raw)) {
    return htmlToText(raw);
  }
  return normalizeWhitespace(raw);
};
