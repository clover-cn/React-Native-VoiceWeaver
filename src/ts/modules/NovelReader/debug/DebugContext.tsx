/**
 * 调试模式状态管理 Context
 * 提供全局调试状态：是否激活、密码弹窗、日志数据、点击计数等
 */
import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from 'react';
import {LogEntry, logCapture} from './logCapture';
import {DEBUG_CONFIG} from './debugConfig';

export interface DebugContextValue {
  /** 调试模式是否已完全激活（密码验证通过） */
  isDebugMode: boolean;
  /** 密码弹窗是否正在显示 */
  isPasswordModalVisible: boolean;
  /** 所有已捕获的日志条目 */
  logs: readonly LogEntry[];
  /** 由触发区域调用，注册一次点击（累计到阈值后弹出密码框） */
  registerTap: () => void;
  /** 提交密码验证，返回 true 表示密码正确 */
  submitPassword: (password: string) => boolean;
  /** 关闭密码弹窗（取消操作） */
  dismissPasswordModal: () => void;
  /** 完全退出调试模式 */
  exitDebugMode: () => void;
  /** 清空日志缓冲区 */
  clearLogs: () => void;
  /** 重置点击计数器 */
  resetTaps: () => void;
}

const DebugContext = createContext<DebugContextValue | null>(null);

export const DebugProvider: React.FC<{children: React.ReactNode}> = ({
  children,
}) => {
  const [isDebugMode, setIsDebugMode] = useState(false);
  const [isPasswordModalVisible, setIsPasswordModalVisible] = useState(false);
  const [logs, setLogs] = useState<readonly LogEntry[]>([]);

  const tapCountRef = useRef(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 挂载时订阅日志捕获，卸载时取消订阅
  useEffect(() => {
    const unsubscribe = logCapture.subscribe(() => {
      // 同步缓冲区快照到 React 状态
      setLogs([...logCapture.getBuffer()]);
    });

    // 初始化时加载已有日志
    setLogs([...logCapture.getBuffer()]);

    return unsubscribe;
  }, []);

  /** 注册一次点击，累计到阈值后弹出密码弹窗 */
  const registerTap = useCallback(() => {
    if (isDebugMode) {
      return; // 已激活调试模式，忽略后续点击
    }

    tapCountRef.current += 1;

    // 重置之前的超时
    if (tapTimerRef.current) {
      clearTimeout(tapTimerRef.current);
    }

    if (tapCountRef.current >= DEBUG_CONFIG.TAP_COUNT) {
      // 达到阈值：显示密码弹窗
      tapCountRef.current = 0;
      if (tapTimerRef.current) {
        clearTimeout(tapTimerRef.current);
        tapTimerRef.current = null;
      }
      setIsPasswordModalVisible(true);
      return;
    }

    // 设置超时：超过时间窗口未继续点击则重置计数
    tapTimerRef.current = setTimeout(() => {
      tapCountRef.current = 0;
    }, DEBUG_CONFIG.TAP_WINDOW_MS);
  }, [isDebugMode]);

  /** 重置点击计数器 */
  const resetTaps = useCallback(() => {
    tapCountRef.current = 0;
    if (tapTimerRef.current) {
      clearTimeout(tapTimerRef.current);
      tapTimerRef.current = null;
    }
  }, []);

  /** 验证密码 */
  const submitPassword = useCallback((password: string): boolean => {
    if (password === DEBUG_CONFIG.PASSWORD) {
      setIsPasswordModalVisible(false);
      setIsDebugMode(true);
      return true;
    }
    return false;
  }, []);

  /** 关闭密码弹窗 */
  const dismissPasswordModal = useCallback(() => {
    setIsPasswordModalVisible(false);
    resetTaps();
  }, [resetTaps]);

  /** 退出调试模式 */
  const exitDebugMode = useCallback(() => {
    setIsDebugMode(false);
  }, []);

  /** 清空日志 */
  const clearLogs = useCallback(() => {
    logCapture.clear();
    setLogs([]);
  }, []);

  const value = useMemo<DebugContextValue>(
    () => ({
      isDebugMode,
      isPasswordModalVisible,
      logs,
      registerTap,
      submitPassword,
      dismissPasswordModal,
      exitDebugMode,
      clearLogs,
      resetTaps,
    }),
    [
      isDebugMode,
      isPasswordModalVisible,
      logs,
      registerTap,
      submitPassword,
      dismissPasswordModal,
      exitDebugMode,
      clearLogs,
      resetTaps,
    ],
  );

  return (
    <DebugContext.Provider value={value}>{children}</DebugContext.Provider>
  );
};

/**
 * 获取调试模式上下文
 * 必须在 DebugProvider 内部使用，否则抛出异常
 */
export const useDebug = (): DebugContextValue => {
  const ctx = useContext(DebugContext);
  if (!ctx) {
    throw new Error('useDebug must be used within a DebugProvider');
  }
  return ctx;
};
