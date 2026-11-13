import React, {useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {ListenSegment} from '../types/reader';
import {
  exportFileName,
  exportSegments,
  ExportStatus,
  parseExportGap,
} from '../local/audioExport';
import {nativeCall, readDocument, writeDocument} from '../local/native';

interface Props {
  visible: boolean;
  bookName: string;
  chapterTitle: string;
  segments: ListenSegment[];
  complete: boolean;
  onClose: () => void;
}

const PRESET_GAPS = [0, 0.5, 1, 1.5, 2];

/** 面板关闭前等待原生任务结束，避免取消与保存相互覆盖。 */
export default function ChapterAudioExportModal(props: Props) {
  const [mode, setMode] = useState<'zip' | 'wav'>('zip');
  const [gap, setGap] = useState('1.5');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<ExportStatus | null>(null);
  const task = useRef<string | null>(null);
  const cancelRequested = useRef(false);
  const mounted = useRef(true);
  const running = useRef(false);
  const [snapshot, setSnapshot] = useState({
    bookName: '',
    chapterTitle: '',
    total: 0,
  });

  useEffect(() => {
    mounted.current = true;
    readDocument<number>('audio-export-gap.json', 1.5)
      .then(value => {
        if (mounted.current && parseExportGap(String(value)) !== null) {
          setGap(String(value));
        }
      })
      .catch(() => {});
    return () => {
      mounted.current = false;
      if (task.current) {
        nativeCall('exportCancel', {id: task.current}).catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    if (props.visible) {
      setMessage('');
      setStatus(null);
    }
  }, [props.visible]);

  const inputs = exportSegments(props.segments);
  const readyCount = inputs.filter(
    (item, index) => item.uri && !props.segments[index].generationError,
  ).length;
  const available =
    props.complete && inputs.length > 0 && readyCount === inputs.length;
  const validGap = parseExportGap(gap);

  const start = async () => {
    if (
      running.current ||
      !available ||
      (mode === 'wav' && validGap === null)
    ) {
      return;
    }
    running.current = true;
    setSnapshot({
      bookName: props.bookName,
      chapterTitle: props.chapterTitle,
      total: inputs.length,
    });
    setBusy(true);
    setMessage('');
    cancelRequested.current = false;
    setStatus({stage: 'checking', done: 0, total: inputs.length});
    try {
      const id = await nativeCall<string>('exportStart', {
        segments: inputs,
        mode,
        gap: validGap ?? 1.5,
        fileName: exportFileName(props.bookName, props.chapterTitle, mode),
      });
      task.current = id;
      if (cancelRequested.current || !mounted.current) {
        await nativeCall('exportCancel', {id});
      }
      let state: ExportStatus;
      do {
        state = await nativeCall<ExportStatus>('exportStatus', {id});
        if (mounted.current) {
          setStatus(state);
        }
        if (state.stage === 'checking' || state.stage === 'processing') {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      } while (state.stage === 'checking' || state.stage === 'processing');
      if (state.stage === 'error') {
        throw new Error(state.error || '语音导出失败');
      }
      if (
        state.stage === 'ready' &&
        !cancelRequested.current &&
        mounted.current
      ) {
        setStatus({...state, stage: 'saving'});
        const saved = await nativeCall<boolean>('exportSave', {id});
        if (saved && mode === 'wav') {
          await writeDocument('audio-export-gap.json', validGap).catch(
            () => {},
          );
        }
        if (mounted.current) {
          setMessage(saved ? '已保存到所选位置' : '已取消保存');
        }
      } else if (mounted.current) {
        setMessage('已取消下载');
      }
    } catch (error) {
      if (mounted.current) {
        setMessage(error instanceof Error ? error.message : '语音导出失败');
      }
    } finally {
      if (task.current) {
        await nativeCall('exportRelease', {id: task.current}).catch(() => {});
      }
      task.current = null;
      running.current = false;
      if (mounted.current) {
        setBusy(false);
        setStatus(null);
      }
    }
  };

  const cancel = () => {
    cancelRequested.current = true;
    if (task.current) {
      nativeCall('exportCancel', {id: task.current}).catch(() => {});
    }
  };

  const currentBookName = busy ? snapshot.bookName : props.bookName;
  const currentChapterTitle = busy ? snapshot.chapterTitle : props.chapterTitle;
  const currentTotal = busy ? snapshot.total : inputs.length;
  const currentReady = busy ? snapshot.total : readyCount;

  const progressPercent =
    status?.total && status.total > 0
      ? Math.min(100, Math.max(0, Math.round(((status.done || 0) / status.total) * 100)))
      : 0;

  const isSaving = status?.stage === 'saving';

  return (
    <Modal
      visible={props.visible}
      transparent
      animationType="slide"
      onRequestClose={() => {
        if (!busy) {
          props.onClose();
        }
      }}>
      <View style={styles.backdrop}>
        {/* 背景透明触摸层（不可在导出时意外关闭） */}
        <TouchableOpacity
          style={styles.backdropTouch}
          activeOpacity={1}
          onPress={() => {
            if (!busy) {
              props.onClose();
            }
          }}
        />

        {/* 底部卡片主面板 */}
        <View style={styles.panel}>
          {/* 顶栏把手修饰 */}
          <View style={styles.handleBar} />

          {/* 标题栏 */}
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.title}>下载本章语音</Text>
              <Text style={styles.subtitle}>导出离线音频文件至本地存储</Text>
            </View>
            <TouchableOpacity
              style={styles.closeIconBtn}
              disabled={busy}
              onPress={props.onClose}
              hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}>
              <Text style={styles.closeIconText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* 书籍与章节元信息卡片 */}
          <View style={styles.metaCard}>
            <View style={styles.metaTopLine}>
              <Text style={styles.metaBookName} numberOfLines={1}>
                {currentBookName || '未命名书籍'}
              </Text>
              <View
                style={[
                  styles.statusBadge,
                  available ? styles.statusBadgeSuccess : styles.statusBadgeWarning,
                ]}>
                <Text
                  style={[
                    styles.statusBadgeText,
                    available
                      ? styles.statusBadgeTextSuccess
                      : styles.statusBadgeTextWarning,
                  ]}>
                  {available ? '● 就绪' : '● 未就绪'}
                </Text>
              </View>
            </View>
            <View style={styles.metaBottomLine}>
              <Text style={styles.metaChapterTitle} numberOfLines={1}>
                {currentChapterTitle || '当前章节'}
              </Text>
              <Text style={styles.metaCount}>
                已完成 {currentReady}/{currentTotal} 段
              </Text>
            </View>
          </View>

          {/* 未完成提示条 */}
          {!busy && !available && (
            <View style={styles.warningBanner}>
              <Text style={styles.warningIcon}>⚠️</Text>
              <Text style={styles.warningText}>
                请先完成本章转换，失败或缺失的片段需重新生成。
              </Text>
            </View>
          )}

          {/* 导出格式选项单选卡片组 */}
          <Text style={styles.sectionLabel}>选择导出格式</Text>
          <View style={styles.optionsGroup}>
            {(['zip', 'wav'] as const).map(value => {
              const isSelected = mode === value;
              const isZip = value === 'zip';
              return (
                <TouchableOpacity
                  key={value}
                  disabled={busy}
                  accessibilityRole="radio"
                  accessibilityState={{checked: isSelected}}
                  style={[
                    styles.formatCard,
                    isSelected && styles.formatCardSelected,
                  ]}
                  onPress={() => setMode(value)}>
                  <View style={styles.formatCardContent}>
                    <View style={styles.formatCardHeader}>
                      <Text
                        style={[
                          styles.formatCardTitle,
                          isSelected && styles.formatCardTitleSelected,
                        ]}>
                        {isZip ? '分段打包 ZIP' : '合并下载 WAV'}
                      </Text>
                      {isZip && <Text style={styles.badgeTag}>保留原格式</Text>}
                    </View>
                    <Text style={styles.formatCardDesc}>
                      {isZip
                        ? '独立语音片段切片，适合备份与逐句调用'
                        : '连续无缝整轨长音频，适合离线随身听'}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.radioCircle,
                      isSelected && styles.radioCircleSelected,
                    ]}>
                    {isSelected && <View style={styles.radioDot} />}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* WAV 专属设置区 */}
          {mode === 'wav' && (
            <View style={styles.wavSettingsBox}>
              <View style={styles.gapHeaderRow}>
                <Text style={styles.gapTitle}>片段间隔静音</Text>
                <View style={styles.inputWrapper}>
                  <TextInput
                    accessibilityLabel="片段间隔秒数"
                    editable={!busy}
                    style={styles.input}
                    keyboardType="decimal-pad"
                    value={gap}
                    onChangeText={setGap}
                    maxLength={5}
                  />
                  <Text style={styles.inputUnit}>秒</Text>
                </View>
              </View>

              <View style={styles.chipsRow}>
                {PRESET_GAPS.map(value => {
                  const isCurrent = gap === String(value);
                  return (
                    <TouchableOpacity
                      key={value}
                      disabled={busy}
                      style={[
                        styles.chip,
                        isCurrent && styles.chipSelected,
                      ]}
                      onPress={() => setGap(String(value))}>
                      <Text
                        style={[
                          styles.chipText,
                          isCurrent && styles.chipTextSelected,
                        ]}>
                        {value}s
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {validGap === null ? (
                <Text style={styles.errorText}>
                  请输入 0～30 秒，最多两位小数。
                </Text>
              ) : (
                <Text style={styles.wavHintText}>
                  💡 WAV 为高品质无损波形，文件较大；播放倍速不会写入文件。
                </Text>
              )}
            </View>
          )}

          {/* 进度状态提示卡片 */}
          {busy && (
            <View style={styles.progressCard}>
              <View style={styles.progressStatusRow}>
                <View style={styles.progressLeft}>
                  <ActivityIndicator size="small" color="#D97706" />
                  <Text style={styles.progressStatusText}>
                    {status?.stage === 'checking'
                      ? '正在检查文件…'
                      : status?.stage === 'saving'
                      ? '请选择保存位置…'
                      : `${mode === 'zip' ? '正在打包' : '正在合并'} ${
                          status?.done || 0
                        }/${status?.total || inputs.length} 段`}
                  </Text>
                </View>
                {status?.stage === 'processing' && (
                  <Text style={styles.progressPercentText}>
                    {progressPercent}%
                  </Text>
                )}
              </View>
              {status?.stage === 'processing' && (
                <View style={styles.progressBarBg}>
                  <View
                    style={[
                      styles.progressBarFill,
                      {width: `${Math.max(5, progressPercent)}%`},
                    ]}
                  />
                </View>
              )}
            </View>
          )}

          {/* 结果反馈信息 */}
          {!!message && (
            <View
              style={[
                styles.messageBanner,
                message.includes('失败')
                  ? styles.messageBannerError
                  : styles.messageBannerNormal,
              ]}>
              <Text
                style={[
                  styles.messageText,
                  message.includes('失败')
                    ? styles.messageTextError
                    : styles.messageTextNormal,
                ]}>
                {message}
              </Text>
            </View>
          )}

          {/* 底部按钮栏 */}
          <View style={styles.bottomBar}>
            <TouchableOpacity
              style={styles.cancelButton}
              disabled={busy && isSaving}
              onPress={busy ? cancel : props.onClose}>
              <Text style={styles.cancelButtonText}>
                {busy ? '取消下载' : '关闭'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              accessibilityLabel="开始下载本章语音"
              accessibilityState={{
                disabled:
                  busy || !available || (mode === 'wav' && validGap === null),
              }}
              disabled={
                busy || !available || (mode === 'wav' && validGap === null)
              }
              style={[
                styles.primaryButton,
                (busy || !available || (mode === 'wav' && validGap === null)) &&
                  styles.primaryButtonDisabled,
              ]}
              onPress={start}>
              <Text style={styles.primaryButtonText}>
                {busy ? '导出处理中…' : '开始导出'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(28, 25, 23, 0.45)',
    justifyContent: 'flex-end',
  },
  backdropTouch: {
    flex: 1,
  },
  panel: {
    backgroundColor: '#FAF6F0',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 24,
    shadowColor: '#1C1917',
    shadowOffset: {width: 0, height: -4},
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 10,
  },
  handleBar: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E7DFD5',
    alignSelf: 'center',
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#292524',
    letterSpacing: 0.2,
  },
  subtitle: {
    fontSize: 12,
    color: '#857F78',
    marginTop: 2,
  },
  closeIconBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#EFE8DE',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeIconText: {
    fontSize: 13,
    color: '#57534E',
    fontWeight: '700',
  },
  metaCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#EFE8DE',
  },
  metaTopLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  metaBookName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#44403C',
    flex: 1,
    marginRight: 8,
  },
  statusBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusBadgeSuccess: {
    backgroundColor: '#DCFCE7',
  },
  statusBadgeWarning: {
    backgroundColor: '#FEF3C7',
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  statusBadgeTextSuccess: {
    color: '#15803D',
  },
  statusBadgeTextWarning: {
    color: '#B45309',
  },
  metaBottomLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  metaChapterTitle: {
    fontSize: 12,
    color: '#78716C',
    flex: 1,
    marginRight: 8,
  },
  metaCount: {
    fontSize: 12,
    color: '#78716C',
    fontWeight: '600',
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FEE2E2',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 12,
    gap: 6,
  },
  warningIcon: {
    fontSize: 13,
  },
  warningText: {
    fontSize: 12,
    color: '#B91C1C',
    flex: 1,
    lineHeight: 16,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#44403C',
    marginBottom: 8,
  },
  optionsGroup: {
    gap: 8,
    marginBottom: 12,
  },
  formatCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#EFE8DE',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  formatCardSelected: {
    borderColor: '#D97706',
    backgroundColor: '#FFFDF9',
    shadowColor: '#D97706',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  formatCardContent: {
    flex: 1,
  },
  formatCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  formatCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#292524',
  },
  formatCardTitleSelected: {
    color: '#B45309',
  },
  badgeTag: {
    fontSize: 10,
    color: '#78716C',
    backgroundColor: '#F5EFE8',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: 'hidden',
  },
  formatCardDesc: {
    fontSize: 11,
    color: '#8C857B',
    marginTop: 2,
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#D6CCC2',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  radioCircleSelected: {
    borderColor: '#D97706',
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#D97706',
  },
  wavSettingsBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#EFE8DE',
    padding: 12,
    marginBottom: 12,
  },
  gapHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  gapTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#44403C',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FAF5ED',
    borderWidth: 1,
    borderColor: '#E7DFD5',
    borderRadius: 8,
    paddingHorizontal: 8,
    height: 32,
  },
  input: {
    paddingVertical: 0,
    paddingHorizontal: 4,
    fontSize: 13,
    fontWeight: '700',
    color: '#292524',
    minWidth: 32,
    textAlign: 'center',
  },
  inputUnit: {
    fontSize: 12,
    color: '#78716C',
    marginLeft: 2,
  },
  chipsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
    marginBottom: 8,
  },
  chip: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#FAF5ED',
    borderWidth: 1,
    borderColor: '#EFE8DE',
    alignItems: 'center',
  },
  chipSelected: {
    backgroundColor: '#D97706',
    borderColor: '#D97706',
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#57534E',
  },
  chipTextSelected: {
    color: '#FFFFFF',
  },
  errorText: {
    fontSize: 11,
    color: '#DC2626',
    marginTop: 2,
  },
  wavHintText: {
    fontSize: 11,
    color: '#8C857B',
    lineHeight: 15,
  },
  progressCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#EFE8DE',
    padding: 12,
    marginBottom: 12,
  },
  progressStatusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  progressLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  progressStatusText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#44403C',
  },
  progressPercentText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#D97706',
  },
  progressBarBg: {
    height: 5,
    backgroundColor: '#F5EFE8',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#D97706',
    borderRadius: 3,
  },
  messageBanner: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 12,
  },
  messageBannerNormal: {
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#DCFCE7',
  },
  messageBannerError: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FEE2E2',
  },
  messageText: {
    fontSize: 12,
    textAlign: 'center',
    fontWeight: '600',
  },
  messageTextNormal: {
    color: '#15803D',
  },
  messageTextError: {
    color: '#DC2626',
  },
  bottomBar: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  cancelButton: {
    width: '32%',
    backgroundColor: '#EFE8DE',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#57534E',
  },
  primaryButton: {
    flex: 1,
    backgroundColor: '#D97706',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#D97706',
    shadowOffset: {width: 0, height: 3},
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  primaryButtonDisabled: {
    opacity: 0.45,
    shadowOpacity: 0,
    elevation: 0,
  },
  primaryButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
