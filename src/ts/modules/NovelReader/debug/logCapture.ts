/**
 * 日志拦截工具
 * 在模块加载时劫持 console.log/warn/error，将所有日志收集到缓冲区
 * 同时保留原始 console 行为，确保日志正常输出到 Metro/DevTools
 */
import {DEBUG_CONFIG} from './debugConfig';

export type LogLevel = 'log' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  level: LogLevel;
  message: string;
  timestamp: number;
}

/** 日志监听器回调 */
type LogListener = (entry: LogEntry) => void;

let logIdCounter = 0;
const listeners: Set<LogListener> = new Set();
const logBuffer: LogEntry[] = [];

/** 保留原始 console 方法的引用 */
const originalConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

/** 将参数序列化为可读字符串 */
function formatArgs(args: unknown[]): string {
  return args
    .map(arg => {
      if (typeof arg === 'string') {
        return arg;
      }
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(' ')
    .slice(0, DEBUG_CONFIG.MAX_MESSAGE_LENGTH);
}

/** 将日志条目推入缓冲区并通知监听器 */
function pushLog(level: LogLevel, args: unknown[]): void {
  const entry: LogEntry = {
    id: ++logIdCounter,
    level,
    message: formatArgs(args),
    timestamp: Date.now(),
  };

  logBuffer.push(entry);

  // 环形缓冲区：超出上限时从头部丢弃
  while (logBuffer.length > DEBUG_CONFIG.MAX_LOG_ENTRIES) {
    logBuffer.shift();
  }

  // 通知所有监听器（捕获异常防止级联故障）
  listeners.forEach(fn => {
    try {
      fn(entry);
    } catch {
      // 静默忽略监听器中的异常
    }
  });
}

// 劫持 console 方法
console.log = function (...args: unknown[]) {
  originalConsole.log(...args);
  pushLog('log', args);
};

console.warn = function (...args: unknown[]) {
  originalConsole.warn(...args);
  pushLog('warn', args);
};

console.error = function (...args: unknown[]) {
  originalConsole.error(...args);
  pushLog('error', args);
};

/** 日志捕获公共 API */
export const logCapture = {
  /** 订阅新日志条目，返回取消订阅函数 */
  subscribe(listener: LogListener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /** 获取当前日志缓冲区（只读，最新条目在末尾） */
  getBuffer(): readonly LogEntry[] {
    return logBuffer;
  },

  /** 清空日志缓冲区 */
  clear(): void {
    logBuffer.length = 0;
  },
};
