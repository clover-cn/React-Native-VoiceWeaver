import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {BridgeTurboModule} from '../../../../../turboModules';
import {clearGeneratedAudio, isGenerationBusy} from '../local/engine';
import {
  clearDiagnosticLogs,
  flushDiagnosticLogs,
  nativeCall,
} from '../local/native';

interface Props {
  canClearStorage: boolean;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  setError: (err: string) => void;
}

type LogLevel = 'ALL' | 'ERROR' | 'WARN' | 'INFO';

interface ParsedLogLine {
  id: string;
  timestamp: string;
  level: 'ERROR' | 'WARN' | 'INFO' | 'OTHER';
  event: string;
  message: string;
  raw: string;
}

/** 解析单行日志文本，提取时间戳、日志级别与事件内容 */
function parseLogLine(line: string, index: number): ParsedLogLine {
  const trimmed = line.trim();
  const match = trimmed.match(
    /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)?\s*(?:\[(ERROR|WARN|INFO|DEBUG)\])?\s*([a-zA-Z0-9_.-]+)?\s*(.*)$/,
  );

  if (!match) {
    return {
      id: `line-${index}`,
      timestamp: '',
      level: 'OTHER',
      event: '',
      message: trimmed,
      raw: trimmed,
    };
  }

  const [, rawTime, rawLevel, rawEvent, rawMessage] = match;
  let level: ParsedLogLine['level'] = 'OTHER';

  if (rawLevel === 'ERROR' || trimmed.includes('[ERROR]')) {
    level = 'ERROR';
  } else if (rawLevel === 'WARN' || trimmed.includes('[WARN]')) {
    level = 'WARN';
  } else if (rawLevel === 'INFO' || trimmed.includes('[INFO]')) {
    level = 'INFO';
  }

  // 格式化时间戳展示，只显示时分秒毫秒
  let formattedTime = '';
  if (rawTime) {
    const timePart = rawTime.split('T')[1];
    if (timePart) {
      formattedTime = timePart.replace('Z', '');
    }
  }

  return {
    id: `line-${index}`,
    timestamp: formattedTime || rawTime || '',
    level,
    event: rawEvent || '',
    message: rawMessage || '',
    raw: trimmed,
  };
}

/** 本地存储与诊断日志管理组件 */
export default function LocalStorageSection({
  canClearStorage,
  busy,
  setBusy,
  setError,
}: Props) {
  const [logs, setLogs] = useState<{
    text: string;
    bytes: number;
    path: string;
  } | null>(null);
  const [audioSize, setAudioSize] = useState(0);
  const [activeLevel, setActiveLevel] = useState<LogLevel>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [loadingLogs, setLoadingLogs] = useState(false);

  // 初始化加载音频占用和诊断日志
  const loadStats = useCallback(async () => {
    try {
      const size = await nativeCall<number>('stats');
      setAudioSize(size);
    } catch (_) {
      // 容错处理
    }
  }, []);

  const readLogs = useCallback(
    async (silent = false) => {
      if (!silent) {
        setLoadingLogs(true);
      }
      try {
        await flushDiagnosticLogs();
        const data = await nativeCall<{
          text: string;
          bytes: number;
          path: string;
        }>('logRead');
        setLogs(data);
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : '读取日志失败，请确认已安装新版应用。',
        );
      } finally {
        if (!silent) {
          setLoadingLogs(false);
        }
      }
    },
    [setError],
  );

  useEffect(() => {
    loadStats();
    readLogs(true);
  }, [loadStats, readLogs]);

  // 复制日志到剪贴板
  const handleCopyLogs = () => {
    if (!logs?.text) {
      Alert.alert('提示', '暂无日志内容可复制。');
      return;
    }
    try {
      if (BridgeTurboModule?.copyText) {
        BridgeTurboModule.copyText(logs.text, () => {
          Alert.alert('已复制', '诊断日志已完整复制到剪贴板。');
        });
      } else {
        Alert.alert(
          '提示',
          '当前设备未提供剪贴板能力，可长按下方日志手动选择复制。',
        );
      }
    } catch (_) {
      Alert.alert('复制失败', '请长按下方日志内容进行手动复制。');
    }
  };

  // 导出日志为 TXT 文件
  const handleExportLogs = async () => {
    setBusy(true);
    try {
      await flushDiagnosticLogs();
      const savedLog = await nativeCall<boolean>('logExport');
      if (savedLog !== false) {
        Alert.alert('导出完成', '诊断日志已保存为 TXT 文件。');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '日志导出失败');
    } finally {
      setBusy(false);
    }
  };

  // 清空日志功能
  const handleClearLogs = () => {
    Alert.alert(
      '清理诊断日志',
      '确定要清空全部本地诊断日志吗？\n清空后将无法找回历史模型调用与报错记录。',
      [
        {text: '取消', style: 'cancel'},
        {
          text: '清空日志',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await clearDiagnosticLogs();
              setLogs({
                text: '',
                bytes: 0,
                path: logs?.path || '',
              });
              Alert.alert('清理成功', '诊断日志已全部清空。');
            } catch (e) {
              setError(e instanceof Error ? e.message : '清理日志失败');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  // 清理生成音频
  const handleClearAudio = () => {
    Alert.alert(
      '清理生成音频',
      '将清理本机生成的音频缓存，参考录音和阅读进度保留。请先停止播放与生成。',
      [
        {text: '取消', style: 'cancel'},
        {
          text: '确定清理',
          style: 'destructive',
          onPress: async () => {
            if (!canClearStorage || isGenerationBusy()) {
              setError('请先停止播放和生成任务，再清理音频。');
              return;
            }
            setBusy(true);
            try {
              await clearGeneratedAudio();
              const size = await nativeCall<number>('stats');
              setAudioSize(size);
              Alert.alert('清理完成', '已清空生成的本地音频缓存。');
            } catch (_) {
              setError('清理失败，请停止播放与生成后重试。');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  // 解析与过滤日志
  const {parsedLines, counts} = useMemo(() => {
    if (!logs?.text) {
      return {
        parsedLines: [],
        counts: {ALL: 0, ERROR: 0, WARN: 0, INFO: 0},
      };
    }
    const lines = logs.text.split('\n').filter(l => l.trim().length > 0);
    const parsed: ParsedLogLine[] = [];
    const stats = {ALL: lines.length, ERROR: 0, WARN: 0, INFO: 0};

    for (let i = 0; i < lines.length; i++) {
      const item = parseLogLine(lines[i], i);
      parsed.push(item);
      if (item.level === 'ERROR') {
        stats.ERROR++;
      } else if (item.level === 'WARN') {
        stats.WARN++;
      } else if (item.level === 'INFO') {
        stats.INFO++;
      }
    }

    return {parsedLines: parsed, counts: stats};
  }, [logs?.text]);

  const displayedLines = useMemo(() => {
    return parsedLines.filter(item => {
      if (activeLevel !== 'ALL' && item.level !== activeLevel) {
        return false;
      }
      if (searchQuery.trim()) {
        const query = searchQuery.trim().toLowerCase();
        return (
          item.raw.toLowerCase().includes(query) ||
          item.event.toLowerCase().includes(query) ||
          item.message.toLowerCase().includes(query)
        );
      }
      return true;
    });
  }, [parsedLines, activeLevel, searchQuery]);

  const logKb = logs ? (logs.bytes / 1024).toFixed(1) : '0.0';
  const audioMb = (audioSize / 1024 / 1024).toFixed(1);
  const hasLogs = (logs?.bytes || 0) > 0 && parsedLines.length > 0;

  return (
    <View style={styles.container}>
      {/* 卡片 1：诊断日志模块 */}
      <View style={styles.card}>
        {/* 卡片头部：左侧标题与副标题，右侧容量与刷新操作 */}
        <View style={styles.cardHeader}>
          <View style={styles.headerLeft}>
            <View style={styles.iconTag}>
              <Text style={styles.iconTagText}>LOG</Text>
            </View>
            <View style={styles.headerTitles}>
              <Text style={styles.cardTitle}>运行诊断日志</Text>
              <Text style={styles.cardSubtitle} numberOfLines={1}>
                存储上限 5 MB
              </Text>
            </View>
          </View>
          <View style={styles.headerRight}>
            <View style={styles.badge}>
              <View
                style={[
                  styles.statusDot,
                  hasLogs ? styles.statusDotActive : styles.statusDotInactive,
                ]}
              />
              <Text style={styles.badgeText}>{logKb} KB</Text>
            </View>
            <TouchableOpacity
              style={styles.refreshBtn}
              disabled={busy || loadingLogs}
              activeOpacity={0.7}
              onPress={() => {
                readLogs();
              }}>
              {loadingLogs ? (
                <ActivityIndicator size="small" color="#B45309" />
              ) : (
                <Text style={styles.refreshBtnText}>刷新</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* 仅在有日志时呈现轻量化的搜索与分级 Chips，避免无日志时堆叠控件产生拥挤感 */}
        {hasLogs && (
          <View style={styles.filterSection}>
            {/* 紧凑搜索栏 */}
            <View style={styles.searchBar}>
              <TextInput
                style={styles.searchInput}
                placeholder="搜索事件、模型名、关键词..."
                placeholderTextColor="#9CA3AF"
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="while-editing"
              />
              {!!searchQuery && (
                <TouchableOpacity
                  onPress={() => setSearchQuery('')}
                  hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
                  <Text style={styles.searchClear}>✕</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* 轻量分级 Chips */}
            <View style={styles.tabsRow}>
              {(
                [
                  {key: 'ALL', label: `全部 (${counts.ALL})`},
                  {key: 'ERROR', label: `错误 (${counts.ERROR})`},
                  {key: 'WARN', label: `警告 (${counts.WARN})`},
                  {key: 'INFO', label: `信息 (${counts.INFO})`},
                ] as const
              ).map(tab => {
                const active = activeLevel === tab.key;
                const isError = tab.key === 'ERROR' && counts.ERROR > 0;
                return (
                  <TouchableOpacity
                    key={tab.key}
                    style={[
                      styles.tabItem,
                      active && styles.tabItemActive,
                      isError && !active && styles.tabItemErrorOutline,
                    ]}
                    onPress={() => setActiveLevel(tab.key)}>
                    <Text
                      style={[
                        styles.tabItemText,
                        active && styles.tabItemTextActive,
                        isError && !active && styles.tabItemTextError,
                      ]}>
                      {tab.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {/* 现代终端风格日志视窗，内置专业控制台工具栏（复制、导出、清空） */}
        <View style={styles.terminalContainer}>
          <View style={styles.terminalHeader}>
            <View style={styles.terminalHeaderLeft}>
              <View style={styles.terminalDots}>
                <View style={[styles.terminalDot, styles.dotRed]} />
                <View style={[styles.terminalDot, styles.dotYellow]} />
                <View style={[styles.terminalDot, styles.dotGreen]} />
              </View>
            </View>

            {/* 控制台内置操作组，极简集成，无需在外部排布大按钮 */}
            <View style={styles.terminalActions}>
              <TouchableOpacity
                disabled={!hasLogs || busy}
                onPress={handleCopyLogs}
                hitSlop={{top: 8, bottom: 8, left: 6, right: 6}}>
                <Text
                  style={[
                    styles.termActionText,
                    !hasLogs && styles.termActionDisabled,
                  ]}>
                  复制
                </Text>
              </TouchableOpacity>
              <Text style={styles.termDivider}>|</Text>
              <TouchableOpacity
                disabled={!hasLogs || busy}
                onPress={() => {
                  handleExportLogs();
                }}
                hitSlop={{top: 8, bottom: 8, left: 6, right: 6}}>
                <Text
                  style={[
                    styles.termActionText,
                    !hasLogs && styles.termActionDisabled,
                  ]}>
                  导出
                </Text>
              </TouchableOpacity>
              <Text style={styles.termDivider}>|</Text>
              <TouchableOpacity
                disabled={!hasLogs || busy}
                onPress={handleClearLogs}
                hitSlop={{top: 8, bottom: 8, left: 6, right: 6}}>
                <Text
                  style={[
                    styles.termActionDanger,
                    !hasLogs && styles.termActionDisabled,
                  ]}>
                  清空
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView
            style={styles.terminalScroll}
            nestedScrollEnabled
            showsVerticalScrollIndicator
            contentContainerStyle={styles.terminalScrollContent}>
            {displayedLines.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>
                  {logs?.text
                    ? '未找到与当前筛选条件匹配的日志'
                    : '暂无诊断日志。模型调用与系统错误将自动记录于此。'}
                </Text>
              </View>
            ) : (
              displayedLines.map(item => {
                return (
                  <View key={item.id} style={styles.logRow}>
                    {/* 时间 */}
                    {!!item.timestamp && (
                      <Text style={styles.logTime}>{item.timestamp}</Text>
                    )}

                    {/* 级别徽章 */}
                    {item.level === 'ERROR' && (
                      <View style={[styles.logTag, styles.logTagError]}>
                        <Text style={styles.logTagErrorText}>ERROR</Text>
                      </View>
                    )}
                    {item.level === 'WARN' && (
                      <View style={[styles.logTag, styles.logTagWarn]}>
                        <Text style={styles.logTagWarnText}>WARN</Text>
                      </View>
                    )}
                    {item.level === 'INFO' && (
                      <View style={[styles.logTag, styles.logTagInfo]}>
                        <Text style={styles.logTagInfoText}>INFO</Text>
                      </View>
                    )}

                    {/* 事件名称 */}
                    {!!item.event && (
                      <Text style={styles.logEvent}>{item.event}</Text>
                    )}

                    {/* 消息正文 */}
                    <Text selectable style={styles.logMessage}>
                      {item.message || item.raw}
                    </Text>
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>

        <Text style={styles.cardHint}>
          💡 诊断日志仅存储于本机，不包含小说正文或敏感密钥。导出 TXT
          可获取全部历史保留记录。
        </Text>
      </View>

      {/* 卡片 2：生成音频缓存管理模块 */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.headerLeft}>
            <View style={[styles.iconTag, styles.audioIconTag]}>
              <Text style={[styles.iconTagText, styles.audioIconText]}>
                AUD
              </Text>
            </View>
            <View>
              <Text style={styles.cardTitle}>生成音频缓存</Text>
              <Text style={styles.cardSubtitle}>预取与合成的离线音频片段</Text>
            </View>
          </View>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{audioMb} MB</Text>
          </View>
        </View>

        <View style={styles.audioStorageBox}>
          <View style={styles.audioStorageInfo}>
            <Text style={styles.audioStorageValue}>{audioMb}</Text>
            <Text style={styles.audioStorageUnit}>MB 已使用</Text>
          </View>
          <Text style={styles.audioStorageDesc}>
            清理生成音频将释放本机空间，不影响音色库参考录音及小说阅读进度。
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.actionBtn, styles.clearAudioBtn]}
          disabled={busy}
          onPress={handleClearAudio}>
          <Text style={styles.clearAudioBtnText}>清理全部生成音频</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const monoFont = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

const styles = StyleSheet.create({
  container: {
    gap: 16,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#EFECE6',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
    marginBottom: 4,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    marginRight: 8,
  },
  headerTitles: {
    flex: 1,
  },
  iconTag: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  audioIconTag: {
    backgroundColor: '#FEF3C7',
  },
  audioIconText: {
    color: '#B45309',
  },
  iconTagText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4B5563',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1C1917',
  },
  cardSubtitle: {
    fontSize: 12,
    color: '#78716C',
    marginTop: 2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F5F4',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 12,
    gap: 5,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusDotActive: {
    backgroundColor: '#10B981',
  },
  statusDotInactive: {
    backgroundColor: '#9CA3AF',
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#44403C',
  },
  refreshBtn: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#B45309',
  },
  filterSection: {
    marginBottom: 12,
    gap: 8,
  },
  tabsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  tabItem: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#F5F5F4',
  },
  tabItemActive: {
    backgroundColor: '#1C1917',
  },
  tabItemErrorOutline: {
    borderWidth: 1,
    borderColor: '#FCA5A5',
    backgroundColor: '#FEF2F2',
  },
  tabItemText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#57534E',
  },
  tabItemTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  tabItemTextError: {
    color: '#DC2626',
    fontWeight: '600',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FAFAF9',
    borderWidth: 1,
    borderColor: '#E7E5E4',
    borderRadius: 8,
    paddingHorizontal: 9,
    height: 34,
  },
  searchInput: {
    flex: 1,
    fontSize: 12,
    color: '#1C1917',
    paddingVertical: 0,
  },
  searchClear: {
    fontSize: 12,
    color: '#A8A29E',
    paddingHorizontal: 4,
  },
  terminalContainer: {
    backgroundColor: '#18181B',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#27272A',
  },
  terminalHeader: {
    height: 36,
    backgroundColor: '#27272A',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  terminalHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  terminalDots: {
    flexDirection: 'row',
    gap: 5,
  },
  terminalDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotRed: {
    backgroundColor: '#EF4444',
  },
  dotYellow: {
    backgroundColor: '#F59E0B',
  },
  dotGreen: {
    backgroundColor: '#10B981',
  },
  terminalActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  termActionText: {
    fontSize: 11,
    color: '#D4D4D8',
    fontWeight: '500',
    fontFamily: monoFont,
  },
  termActionDanger: {
    fontSize: 11,
    color: '#F87171',
    fontWeight: '600',
    fontFamily: monoFont,
  },
  termActionDisabled: {
    color: '#52525B',
  },
  termDivider: {
    fontSize: 10,
    color: '#3F3F46',
  },
  terminalScroll: {
    maxHeight: 340,
    minHeight: 180,
  },
  terminalScrollContent: {
    padding: 12,
  },
  emptyContainer: {
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyText: {
    fontSize: 12,
    color: '#71717A',
    textAlign: 'center',
    lineHeight: 18,
  },
  logRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    paddingVertical: 3,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#27272A',
  },
  logTime: {
    fontSize: 11,
    color: '#71717A',
    fontFamily: monoFont,
    marginRight: 6,
    lineHeight: 18,
  },
  logTag: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    marginRight: 6,
    alignSelf: 'center',
  },
  logTagError: {
    backgroundColor: '#451A1A',
  },
  logTagErrorText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#F87171',
    fontFamily: monoFont,
  },
  logTagWarn: {
    backgroundColor: '#452A1A',
  },
  logTagWarnText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#FBBF24',
    fontFamily: monoFont,
  },
  logTagInfo: {
    backgroundColor: '#1E2E4A',
  },
  logTagInfoText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#60A5FA',
    fontFamily: monoFont,
  },
  logEvent: {
    fontSize: 11,
    color: '#34D399',
    fontFamily: monoFont,
    marginRight: 6,
    lineHeight: 18,
  },
  logMessage: {
    fontSize: 11,
    color: '#E4E4E7',
    fontFamily: monoFont,
    lineHeight: 18,
    flexShrink: 1,
  },
  cardHint: {
    fontSize: 12,
    lineHeight: 18,
    color: '#78716C',
    marginTop: 10,
  },
  audioStorageBox: {
    backgroundColor: '#FAFAF9',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  audioStorageInfo: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    marginBottom: 6,
  },
  audioStorageValue: {
    fontSize: 26,
    fontWeight: '700',
    color: '#1C1917',
  },
  audioStorageUnit: {
    fontSize: 14,
    color: '#78716C',
    fontWeight: '500',
  },
  audioStorageDesc: {
    fontSize: 12,
    color: '#78716C',
    lineHeight: 18,
  },
  actionBtn: {
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearAudioBtn: {
    backgroundColor: '#FFF1F2',
    borderWidth: 1,
    borderColor: '#FECDD3',
    paddingVertical: 12,
  },
  clearAudioBtnText: {
    color: '#E11D48',
    fontSize: 14,
    fontWeight: '600',
  },
});
