import {LegadoBookSource} from './types';
import {normalizeLegadoBookSource} from './normalizeBookSource';

const rawSources = require('./bookSources.json') as LegadoBookSource[];

export const BUILTIN_BOOK_SOURCES: LegadoBookSource[] = Array.isArray(
  rawSources,
)
  ? rawSources.map(source => normalizeLegadoBookSource(source))
  : [];
