/**
 * 调试模式全局配置
 * 集中管理所有可调参数，方便后续修改
 */
export const DEBUG_CONFIG = {
  /** 触发密码弹窗所需的连续点击次数 */
  TAP_COUNT: 5,
  /** 点击计数重置时间窗口（毫秒），超过此时间未点击则计数器归零 */
  TAP_WINDOW_MS: 3000,
  /** 调试模式访问密码（可修改） */
  PASSWORD: 'admin',
  /** 日志缓冲区最大条目数，超出后自动丢弃最旧记录 */
  MAX_LOG_ENTRIES: 100,
  /** 合并日志面板刷新，避免每条日志触发 React 状态更新 */
  LOG_REFRESH_INTERVAL_MS: 250,
  /** 单条日志消息最大字符数，超出部分截断 */
  MAX_MESSAGE_LENGTH: 2000,
} as const;
