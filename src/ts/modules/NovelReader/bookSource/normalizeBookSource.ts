import {
  LegadoBookSource,
  LegadoRuleBookInfo,
  LegadoRuleContent,
  LegadoRuleSearch,
  LegadoRuleToc,
} from './types';

const mergeRule = <T extends object>(
  legacyRule: T | undefined,
  currentRule: T | undefined,
): T | undefined => {
  if (!legacyRule && !currentRule) {
    return undefined;
  }
  return {
    ...(legacyRule || ({} as T)),
    ...(currentRule || ({} as T)),
  } as T;
};

const cleanText = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

const normalizeTocRule = (
  rule: LegadoRuleToc | undefined,
): LegadoRuleToc | undefined => {
  if (!rule) {
    return undefined;
  }
  return {
    ...rule,
    chapterName: rule.chapterName || rule.ruleChapterName,
  };
};

export const normalizeLegadoBookSource = (
  value: LegadoBookSource,
): LegadoBookSource => {
  const ruleSearch = mergeRule<LegadoRuleSearch>(
    value.searchRule,
    value.ruleSearch,
  );
  const ruleBookInfo = mergeRule<LegadoRuleBookInfo>(
    value.bookInfoRule,
    value.ruleBookInfo,
  );
  const ruleToc = normalizeTocRule(
    mergeRule<LegadoRuleToc>(value.tocRule, value.ruleToc),
  );
  const ruleContent = mergeRule<LegadoRuleContent>(
    value.contentRule,
    value.ruleContent,
  );

  return {
    ...value,
    bookSourceName: cleanText(value.bookSourceName),
    bookSourceUrl: cleanText(value.bookSourceUrl),
    enabled: value.enabled !== false,
    ruleSearch,
    ruleBookInfo,
    ruleToc,
    ruleContent,
  };
};

export const getUnsupportedBookSourceFeatures = (
  source: LegadoBookSource,
): string[] => {
  const features: string[] = [];
  if (cleanText(source.loginUrl) || cleanText(source.loginJs)) {
    features.push('login');
  }
  if (source.ruleContent?.webJs) {
    features.push('webJs');
  }
  if (source.enabledCookieJar) {
    features.push('cookieJar');
  }
  return features;
};

export const requiresUnsupportedLogin = (source: LegadoBookSource) =>
  getUnsupportedBookSourceFeatures(source).includes('login');
