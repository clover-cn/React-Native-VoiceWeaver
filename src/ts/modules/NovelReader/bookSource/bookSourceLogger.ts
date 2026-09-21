const PREFIX = '[bookSource]';
let stepId = 0;

/** 日志只保留诊断摘要，避免请求凭据和正文进入日志。 */
const sanitizeDetail = (value: unknown, key = '', depth = 0): unknown => {
  if (
    /^(body|headers|cookie|authorization|password|token|preview|raw)$/i.test(
      key,
    )
  ) {
    return '[已隐藏]';
  }
  if (typeof value === 'string') {
    return value
      .replace(/data:[^\s]+/gi, 'data:[已隐藏]')
      .replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/gi, '$1[已隐藏]@')
      .replace(/([?&][^=\s&]+)=([^\s&#]*)/g, '$1=[已隐藏]')
      .replace(
        /((?:token|password|cookie|authorization)\s*[=:]\s*)[^\s,;]+/gi,
        '$1[已隐藏]',
      )
      .slice(0, 600);
  }
  if (depth >= 3) {
    return '[已省略]';
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map(item => sanitizeDetail(item, key, depth + 1));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [
        name,
        sanitizeDetail(item, name, depth + 1),
      ]),
    );
  }
  return value;
};

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
  const text = `${PREFIX}[${tag}] ${message}`;
  if (detail === undefined) {
    console[level](text);
    return;
  }
  console[level](text, sanitizeDetail(detail));
};

export const bookSourceLogger = {
  async trace<T>(
    tag: 'request' | 'toc' | 'content',
    message: string,
    detail: unknown,
    action: () => Promise<T>,
  ): Promise<T> {
    const id = ++stepId;
    const startedAt = Date.now();
    emit('log', tag, `${message} 开始 #${id}`, detail);
    try {
      const result = await action();
      emit('log', tag, `${message} 完成 #${id}`, {
        elapsedMs: Date.now() - startedAt,
        resultLength:
          typeof result === 'string' || Array.isArray(result)
            ? result.length
            : undefined,
      });
      return result;
    } catch (error) {
      emit('error', tag, `${message} 失败 #${id}`, {
        detail,
        elapsedMs: Date.now() - startedAt,
        error: toErrorMessage(error),
      });
      throw error;
    }
  },
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
