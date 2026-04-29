import {LegadoBookSource} from './types';

const rawSources = require('./bookSources.json') as LegadoBookSource[];

export const BUILTIN_BOOK_SOURCES: LegadoBookSource[] = Array.isArray(
  rawSources,
)
  ? rawSources
  : [];
