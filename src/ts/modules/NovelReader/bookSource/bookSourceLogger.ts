const BOOK_SOURCE_DEBUG = true;

const PREFIX = '[bookSource]';

const toErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
};

const emit = (
  level: 'log' | 'warn' | 'error',
  tag: string,
  message: string,
  detail?: unknown,
) => {
  if (!BOOK_SOURCE_DEBUG) {
    return;
  }

  const text = `${PREFIX}[${tag}] ${message}`;
  if (detail === undefined) {
    console[level](text);
    return;
  }
  console[level](text, detail);
};

export const bookSourceLogger = {
  log(tag: string, message: string, detail?: unknown) {
    emit('log', tag, message, detail);
  },

  warn(tag: string, message: string, detail?: unknown) {
    emit('warn', tag, message, detail);
  },

  error(tag: string, message: string, detail?: unknown) {
    emit('error', tag, message, detail);
  },

  errorMessage: toErrorMessage,
};
