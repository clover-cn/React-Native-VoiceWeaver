/**
 * 调试模式浮动面板
 * 两种状态：
 * - 最小化：右下角浮动按钮，显示日志计数角标
 * - 展开：底部半屏面板，显示日志列表及过滤/清空/关闭按钮
 * 使用绝对定位 + zIndex: 100000 确保在所有界面之上
 */
import React, {useState, useRef, useCallback} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Animated,
  Platform,
} from 'react-native';
import {useDebug} from './DebugContext';
import type {LogLevel} from './logCapture';

/** 日志级别对应的显示颜色 */
const LEVEL_COLORS: Record<LogLevel, string> = {
  log: '#34C759',
  warn: '#FF9500',
  error: '#FF3B30',
};

/** 日志级别对应的标签文字 */
const LEVEL_LABELS: Record<LogLevel, string> = {
  log: 'LOG',
  warn: 'WRN',
  error: 'ERR',
};

/** 日志级别对应的背景色（浅色版） */
const LEVEL_BG: Record<LogLevel, string> = {
  log: 'rgba(52, 199, 89, 0.15)',
  warn: 'rgba(255, 149, 0, 0.15)',
  error: 'rgba(255, 59, 48, 0.15)',
};

const FILTER_OPTIONS: Array<{label: string; value: LogLevel | null}> = [
  {label: '全部', value: null},
  {label: 'Log', value: 'log'},
  {label: 'Warn', value: 'warn'},
  {label: 'Error', value: 'error'},
];

export const DebugOverlay: React.FC = () => {
  const {isDebugMode, logs, exitDebugMode, clearLogs} = useDebug();
  const [isExpanded, setIsExpanded] = useState(false);
  const [filterLevel, setFilterLevel] = useState<LogLevel | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<ScrollView>(null);
  const slideAnim = useRef(new Animated.Value(0)).current;

  // 切换面板展开/最小化，带动画
  const expand = useCallback(() => {
    setIsExpanded(true);
    Animated.timing(slideAnim, {
      toValue: 1,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [slideAnim]);

  const minimize = useCallback(() => {
    Animated.timing(slideAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      setIsExpanded(false);
    });
  }, [slideAnim]);

  // 过滤后的日志列表
  const filteredLogs = filterLevel
    ? logs.filter(l => l.level === filterLevel)
    : logs;

  // 滚动事件：用户手动上滚时关闭自动滚动
  const handleScroll = useCallback(
    (event: {nativeEvent: {contentOffset: {y: number}; contentSize: {height: number}; layoutMeasurement: {height: number}}}) => {
      const {contentOffset, contentSize, layoutMeasurement} = event.nativeEvent;
      const isAtBottom =
        contentOffset.y + layoutMeasurement.height >= contentSize.height - 20;
      setAutoScroll(isAtBottom);
    },
    [],
  );

  // 日志内容变化时自动滚动到底部
  const handleContentSizeChange = useCallback(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollToEnd({animated: false});
    }
  }, [autoScroll]);

  const handleClear = useCallback(() => {
    clearLogs();
  }, [clearLogs]);

  const handleExit = useCallback(() => {
    setIsExpanded(false);
    exitDebugMode();
  }, [exitDebugMode]);

  // 未激活调试模式时不渲染任何内容
  if (!isDebugMode) {
    return null;
  }

  // 日志计数角标
  const errorCount = logs.filter(l => l.level === 'error').length;
  const warnCount = logs.filter(l => l.level === 'warn').length;

  // --- 最小化状态：浮动按钮 ---
  if (!isExpanded) {
    return (
      <View style={styles.floatContainer} pointerEvents="box-none">
        <TouchableOpacity
          style={styles.debugButton}
          onPress={expand}
          activeOpacity={0.8}>
          <Text style={styles.debugButtonIcon}>🐞</Text>
          {logs.length > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>
                {logs.length > 99 ? '99+' : String(logs.length)}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      </View>
    );
  }

  // --- 展开状态：底部半屏面板 ---
  return (
    <View style={styles.expandedContainer} pointerEvents="box-none">
      <Animated.View
        style={[
          styles.panel,
          {
            transform: [
              {
                translateY: slideAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [400, 0],
                }),
              },
            ],
          },
        ]}>
        {/* 标题栏 */}
        <View style={styles.panelHeader}>
          <View style={styles.headerLeft}>
            <Text style={styles.panelTitle}>Debug Console</Text>
            <View style={styles.statsRow}>
              {errorCount > 0 && (
                <Text style={styles.statBadgeError}>{errorCount} ERR</Text>
              )}
              {warnCount > 0 && (
                <Text style={styles.statBadgeWarn}>{warnCount} WRN</Text>
              )}
              <Text style={styles.statBadge}>{logs.length} total</Text>
            </View>
          </View>

          <View style={styles.headerActions}>
            <TouchableOpacity onPress={handleClear} style={styles.headerBtn}>
              <Text style={styles.headerBtnText}>清空</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={minimize} style={styles.headerBtn}>
              <Text style={styles.headerBtnText}>—</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleExit} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 过滤按钮行 */}
        <View style={styles.filterRow}>
          {FILTER_OPTIONS.map(opt => {
            const isActive = filterLevel === opt.value;
            return (
              <TouchableOpacity
                key={opt.label}
                style={[styles.filterBtn, isActive && styles.filterBtnActive]}
                onPress={() => setFilterLevel(opt.value)}
                activeOpacity={0.7}>
                <Text
                  style={[
                    styles.filterBtnText,
                    isActive && styles.filterBtnTextActive,
                  ]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* 日志列表 */}
        <ScrollView
          ref={scrollRef}
          style={styles.logList}
          contentContainerStyle={styles.logListContent}
          onScroll={handleScroll}
          scrollEventThrottle={100}
          onContentSizeChange={handleContentSizeChange}>
          {filteredLogs.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>暂无日志</Text>
              <Text style={styles.emptyHint}>
                在应用中触发操作后将在此显示日志
              </Text>
            </View>
          ) : (
            filteredLogs.map(entry => (
              <View key={entry.id} style={styles.logEntry}>
                <View style={styles.logEntryHeader}>
                  <Text style={styles.logTimestamp}>
                    {new Date(entry.timestamp).toLocaleTimeString('zh-CN', {
                      hour12: false,
                    })}
                  </Text>
                  <View
                    style={[
                      styles.logLevelBadge,
                      {backgroundColor: LEVEL_BG[entry.level]},
                    ]}>
                    <Text
                      style={[
                        styles.logLevelText,
                        {color: LEVEL_COLORS[entry.level]},
                      ]}>
                      {LEVEL_LABELS[entry.level]}
                    </Text>
                  </View>
                </View>
                <Text
                  style={[
                    styles.logMessage,
                    {color: entry.level === 'error' ? '#FF3B30' : '#E5E5E7'},
                  ]}
                  selectable>
                  {entry.message}
                </Text>
              </View>
            ))
          )}
        </ScrollView>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  // 最小化状态
  floatContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100000,
    elevation: 100000,
    pointerEvents: 'box-none',
  },
  debugButton: {
    position: 'absolute',
    right: 16,
    bottom: 100,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    pointerEvents: 'auto',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: {width: 0, height: 2},
        shadowOpacity: 0.3,
        shadowRadius: 6,
      },
      default: {
        elevation: 8,
      },
    }),
  },
  debugButtonIcon: {
    fontSize: 22,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FF3B30',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 5,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#fff',
  },

  // 展开状态
  expandedContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100000,
    elevation: 100000,
    pointerEvents: 'box-none',
  },
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '55%',
    backgroundColor: '#1C1C1E',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    pointerEvents: 'auto',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: {width: 0, height: -4},
        shadowOpacity: 0.3,
        shadowRadius: 12,
      },
      default: {
        elevation: 24,
      },
    }),
  },

  // 标题栏
  panelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  headerLeft: {
    flex: 1,
  },
  panelTitle: {
    fontSize: 17,
    fontWeight: 'bold',
    color: '#fff',
  },
  statsRow: {
    flexDirection: 'row',
    marginTop: 4,
    gap: 8,
  },
  statBadge: {
    fontSize: 11,
    color: '#8E8E93',
  },
  statBadgeError: {
    fontSize: 11,
    color: '#FF3B30',
    fontWeight: '600',
  },
  statBadgeWarn: {
    fontSize: 11,
    color: '#FF9500',
    fontWeight: '600',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headerBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  headerBtnText: {
    fontSize: 14,
    color: '#8E8E93',
  },
  closeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 59, 48, 0.25)',
    marginLeft: 4,
  },
  closeBtnText: {
    fontSize: 14,
    color: '#FF453A',
    fontWeight: '600',
  },

  // 过滤按钮
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  filterBtn: {
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  filterBtnActive: {
    backgroundColor: 'rgba(0, 122, 255, 0.25)',
  },
  filterBtnText: {
    fontSize: 13,
    color: '#8E8E93',
  },
  filterBtnTextActive: {
    color: '#007AFF',
    fontWeight: '600',
  },

  // 日志列表
  logList: {
    flex: 1,
  },
  logListContent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 16,
    color: '#8E8E93',
    marginBottom: 6,
  },
  emptyHint: {
    fontSize: 13,
    color: '#636366',
  },

  // 单条日志
  logEntry: {
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  logEntryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  logTimestamp: {
    fontSize: 11,
    color: '#636366',
    fontVariant: ['tabular-nums'],
  },
  logLevelBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  logLevelText: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  logMessage: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
});

export default DebugOverlay;
