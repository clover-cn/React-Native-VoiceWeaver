import React, {useEffect, useRef, useState} from 'react';
import {
  AppState,
  Linking,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {nativeCall} from '../local/native';
import {
  prepareRecording,
  RecordedAudio,
  recordedAudio,
  RecordingResult,
} from '../local/recording';
import VideoSessionController from '../controllers/VideoSessionController';

interface Props {
  onClose: () => void;
  onUse: (audio: RecordedAudio) => void;
  renderPreview: (uri: string) => React.ReactNode;
}

/** 手势状态独立于异步原生启动，松手和退出后不会留下采集任务。 */
export default function ReferenceRecordingModal({
  onClose,
  onUse,
  renderPreview,
}: Props) {
  const [authorized, setAuthorized] = useState(false);
  const [permissionBusy, setPermissionBusy] = useState(true);
  const [recording, setRecording] = useState(false);
  const [cancelHint, setCancelHint] = useState(false);
  const [duration, setDuration] = useState(0);
  const [message, setMessage] = useState('正在准备麦克风权限…');
  const [result, setResult] = useState<RecordedAudio | null>(null);
  const id = useRef<string | null>(null);
  const alive = useRef(true);
  const handedOff = useRef(false);
  const held = useRef(false);
  const cancel = useRef(false);
  const origin = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const starting = useRef(false);
  const completed = useRef(false);
  const polling = useRef(false);

  const clearHold = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    held.current = false;
  };

  const discard = () => {
    clearHold();
    const current = id.current;
    id.current = null;
    if (current) {
      nativeCall('recordingCancel', {id: current}).catch(() => {});
    }
  };

  const requestPermission = async () => {
    setPermissionBusy(true);
    try {
      const granted = await prepareRecording();
      if (alive.current) {
        setAuthorized(granted);
        setMessage(
          granted
            ? '长按开始录音，松手结束；至少1秒，最多20秒。'
            : '未获得麦克风权限，请重新授权或到系统设置开启。',
        );
      }
    } catch (error) {
      if (alive.current) {
        setMessage(
          error instanceof Error ? error.message : '麦克风准备失败，请重试',
        );
      }
    } finally {
      if (alive.current) {
        setPermissionBusy(false);
      }
    }
  };

  useEffect(() => {
    alive.current = true;
    requestPermission();
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') {
        discard();
        setResult(null);
        setRecording(false);
        setDuration(0);
        setCancelHint(false);
        setMessage('已停止并丢弃未确认录音，请重新长按录制。');
      }
    });
    return () => {
      alive.current = false;
      subscription.remove();
      clearHold();
      if (!handedOff.current) {
        discard();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const interval = setInterval(async () => {
      const current = id.current;
      if (!current || polling.current || starting.current || result) {
        return;
      }
      polling.current = true;
      try {
        const state = await nativeCall<RecordingResult>('recordingStatus', {
          id: current,
        });
        if (!alive.current || id.current !== current) {
          return;
        }
        setDuration(state.durationMs);
        if (state.state === 'ready') {
          held.current = false;
          setRecording(false);
          if (cancel.current) {
            discard();
            setMessage('已取消录音');
          } else {
            const audio = recordedAudio(current, state);
            completed.current = true;
            setResult(audio);
            setMessage('录音完成，可以试听、重录或确认使用。');
          }
        } else if (state.state === 'error' || state.state === 'cancelled') {
          discard();
          setRecording(false);
          setMessage(state.error || '录音已取消或被系统打断，请重录。');
        }
      } catch (error) {
        if (alive.current && id.current === current) {
          discard();
          setRecording(false);
          setMessage(
            error instanceof Error ? error.message : '录音失败，请重试',
          );
        }
      } finally {
        polling.current = false;
      }
    }, 100);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const begin = async () => {
    if (!held.current || id.current || starting.current) {
      return;
    }
    const current = `record-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;
    id.current = current;
    completed.current = false;
    starting.current = true;
    setRecording(true);
    setDuration(0);
    setResult(null);
    setMessage('正在启动麦克风…');
    VideoSessionController.pauseNative();
    try {
      await nativeCall('recordingStart', {id: current});
      if (id.current !== current || !alive.current) {
        await nativeCall('recordingCancel', {id: current});
        return;
      }
      setMessage('正在录音，松手结束，上滑取消');
      if (!held.current) {
        await nativeCall(cancel.current ? 'recordingCancel' : 'recordingStop', {
          id: current,
        });
      }
    } catch (error) {
      if (alive.current && id.current === current) {
        discard();
        setRecording(false);
        setMessage(error instanceof Error ? error.message : '无法启动录音');
      }
    } finally {
      starting.current = false;
    }
  };

  const end = (terminate = false) => {
    if (completed.current) {
      return;
    }
    clearHold();
    if (terminate) {
      cancel.current = true;
    }
    const current = id.current;
    if (current && !starting.current && !result) {
      nativeCall(cancel.current ? 'recordingCancel' : 'recordingStop', {
        id: current,
      }).catch(() => {
        if (alive.current && id.current === current) {
          discard();
          setRecording(false);
          setMessage('结束录音失败，请重试');
        }
      });
    }
  };

  const reset = () => {
    discard();
    completed.current = false;
    setResult(null);
    setRecording(false);
    setDuration(0);
    setCancelHint(false);
    setMessage('长按重新录音，至少1秒，最多20秒。');
  };

  const currentSeconds = (duration / 1000).toFixed(1);
  const progressRatio = Math.min(1, Math.max(0, duration / 20000));

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={() => {
        if (!recording) {
          onClose();
        }
      }}>
      <View style={styles.mask}>
        {/* 底部抽屉面板 */}
        <View style={styles.panel}>
          {/* 顶栏把手修饰 */}
          <View style={styles.handleBar} />

          {/* 标题栏 */}
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.title}>现场录音</Text>
              <Text style={styles.subtitle}>
                {result
                  ? '录音已生成，可试听满意后确认使用'
                  : '录制 1～20 秒清晰人声作为参考音频'}
              </Text>
            </View>
          </View>

          {/* 状态与指引卡片（仅录制准备和进行中显示） */}
          {!result && (
            <View
              style={[
                styles.noticeCard,
                !authorized && !permissionBusy
                  ? styles.noticeCardError
                  : cancelHint
                  ? styles.noticeCardCancel
                  : recording
                  ? styles.noticeCardActive
                  : styles.noticeCardNormal,
              ]}>
              <Text
                style={[
                  styles.text,
                  !authorized && !permissionBusy
                    ? styles.textError
                    : cancelHint
                    ? styles.textCancel
                    : styles.textNormal,
                ]}
                numberOfLines={2}>
                {message}
              </Text>
            </View>
          )}

          {/* 录音进度与时间展示区（仅录制准备和进行中显示） */}
          {!result && (
            <View style={styles.timerCard}>
              <View style={styles.timeRow}>
                <Text style={styles.timeNumber}>{currentSeconds}</Text>
                <Text style={styles.timeUnit}>/ 20.0 秒</Text>
              </View>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressBar,
                    {width: `${Math.max(2, progressRatio * 100)}%`},
                    cancelHint && styles.progressBarCancel,
                    recording && !cancelHint && styles.progressBarActive,
                  ]}
                />
              </View>
            </View>
          )}

          {/* 长按录音主操作区（仅录音中显示） */}
          {!result && (
            <View style={styles.recorderArea}>
              <View
                accessible
                accessibilityLabel="长按录音，松手结束，上滑取消"
                accessibilityRole="button"
                accessibilityState={{disabled: !authorized || permissionBusy}}
                style={[
                  styles.hold,
                  recording && styles.active,
                  cancelHint && styles.cancel,
                  (!authorized || permissionBusy) && styles.holdDisabled,
                ]}
                onStartShouldSetResponder={() =>
                  authorized &&
                  !permissionBusy &&
                  !held.current &&
                  !id.current &&
                  !starting.current
                }
                onResponderGrant={event => {
                  held.current = true;
                  cancel.current = false;
                  setCancelHint(false);
                  origin.current = event.nativeEvent.pageY;
                  timer.current = setTimeout(begin, 300);
                }}
                onResponderMove={event => {
                  cancel.current = origin.current - event.nativeEvent.pageY > 80;
                  setCancelHint(cancel.current);
                }}
                onResponderRelease={() => end()}
                onResponderTerminate={() => end(true)}
                onResponderTerminationRequest={() => true}>
                <View style={styles.holdInnerContent}>
                  <Text style={styles.holdText}>
                    {cancelHint
                      ? '松手取消'
                      : recording
                      ? '松手结束 · 上滑取消'
                      : '长按录音'}
                  </Text>
                </View>
              </View>
              <Text style={styles.holdHint}>
                {recording
                  ? cancelHint
                    ? '松手将放弃本次录音'
                    : '手指向上滑动 80 像素可取消'
                  : '按住开始录音，说话完毕松开即可'}
              </Text>
            </View>
          )}

          {/* 录音完成试听一体化卡片 */}
          {result && (
            <View style={styles.resultCard}>
              <View style={styles.resultHeader}>
                <View style={styles.resultBadge}>
                  <Text style={styles.resultBadgeIcon}>✨</Text>
                  <Text style={styles.resultBadgeText}>现场录音已就绪</Text>
                </View>
                <View style={styles.durationTag}>
                  <Text style={styles.durationTagText}>
                    时长: {(result.durationMs / 1000).toFixed(1)} 秒
                  </Text>
                </View>
              </View>

              <View style={styles.previewPlayerWrapper}>
                {renderPreview(result.uri)}
              </View>

              <Text style={styles.resultHintText}>
                💡 试听满意可点击「确认使用」，不满意可点击「重录」
              </Text>
            </View>
          )}

          {/* 权限受限操作栏 */}
          {!authorized && !permissionBusy && (
            <View style={styles.permissionRow}>
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={requestPermission}>
                <Text style={styles.secondaryButtonText}>重新授权</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={() =>
                  Linking.openSettings().catch(() =>
                    setMessage('请在系统设置中为应用开启麦克风权限'),
                  )
                }>
                <Text style={styles.primaryButtonText}>系统设置</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* 底部通用操作栏 */}
          <View style={styles.bottomBar}>
            <TouchableOpacity
              style={[
                styles.bottomSecondaryBtn,
                !result && styles.bottomFullCloseBtn,
              ]}
              disabled={recording}
              onPress={onClose}>
              <Text style={styles.bottomSecondaryBtnText}>关闭</Text>
            </TouchableOpacity>

            {result && (
              <TouchableOpacity
                style={styles.bottomOutlineBtn}
                onPress={reset}>
                <Text style={styles.bottomOutlineBtnText}>重录</Text>
              </TouchableOpacity>
            )}

            {result && (
              <TouchableOpacity
                style={styles.bottomPrimaryBtn}
                onPress={() => {
                  handedOff.current = true;
                  onUse(result);
                }}>
                <Text style={styles.bottomPrimaryBtnText}>确认使用</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  mask: {
    flex: 1,
    backgroundColor: 'rgba(28, 25, 23, 0.45)',
    justifyContent: 'flex-end',
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
  noticeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingVertical: 9,
    paddingHorizontal: 12,
    marginBottom: 14,
    borderWidth: 1,
    gap: 8,
  },
  noticeCardNormal: {
    backgroundColor: '#FFFFFF',
    borderColor: '#EFE8DE',
  },
  noticeCardActive: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  noticeCardCancel: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  noticeCardError: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  text: {
    fontSize: 12,
    flex: 1,
    lineHeight: 17,
  },
  textNormal: {
    color: '#57534E',
  },
  textActive: {
    color: '#065F46',
  },
  textCancel: {
    color: '#991B1B',
  },
  textError: {
    color: '#92400E',
  },
  timerCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#EFE8DE',
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginBottom: 16,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    marginBottom: 10,
  },
  timeNumber: {
    fontSize: 32,
    fontWeight: '700',
    color: '#292524',
    fontVariant: ['tabular-nums'],
    letterSpacing: 1,
  },
  timeUnit: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8C857B',
  },
  progressTrack: {
    width: '100%',
    height: 6,
    backgroundColor: '#F5EFE8',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#D97706',
    borderRadius: 3,
  },
  progressBarActive: {
    backgroundColor: '#059669',
  },
  progressBarCancel: {
    backgroundColor: '#DC2626',
  },
  recorderArea: {
    alignItems: 'center',
    marginVertical: 6,
  },
  hold: {
    width: '100%',
    paddingVertical: 22,
    backgroundColor: '#D97706',
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#D97706',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  holdDisabled: {
    backgroundColor: '#D6CCC2',
    shadowOpacity: 0,
    elevation: 0,
  },
  active: {
    backgroundColor: '#059669',
    shadowColor: '#059669',
    transform: [{scale: 0.98}],
  },
  cancel: {
    backgroundColor: '#DC2626',
    shadowColor: '#DC2626',
  },
  holdInnerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  holdText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  holdHint: {
    fontSize: 11,
    color: '#8C857B',
    marginTop: 10,
    textAlign: 'center',
  },
  resultCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EFE8DE',
    padding: 16,
    marginBottom: 6,
    shadowColor: '#292524',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  resultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  resultBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  resultBadgeIcon: {
    fontSize: 16,
  },
  resultBadgeText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#15803D',
  },
  durationTag: {
    backgroundColor: '#FAF5ED',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 0.5,
    borderColor: '#EFE8DE',
  },
  durationTagText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#78716C',
  },
  previewPlayerWrapper: {
    width: '100%',
    marginVertical: 4,
  },
  resultHintText: {
    fontSize: 11,
    color: '#8C857B',
    textAlign: 'center',
    marginTop: 8,
  },
  permissionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
    marginBottom: 6,
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: '#EFE8DE',
    paddingVertical: 11,
    borderRadius: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#57534E',
  },
  primaryButton: {
    flex: 1,
    backgroundColor: '#D97706',
    paddingVertical: 11,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  bottomBar: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  bottomSecondaryBtn: {
    flex: 1,
    backgroundColor: '#EFE8DE',
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomFullCloseBtn: {
    flex: 1,
  },
  bottomSecondaryBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#57534E',
  },
  bottomOutlineBtn: {
    flex: 1,
    backgroundColor: '#FAF5ED',
    borderWidth: 1,
    borderColor: '#E7DFD5',
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomOutlineBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#78716C',
  },
  bottomPrimaryBtn: {
    flex: 2,
    backgroundColor: '#D97706',
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#D97706',
    shadowOffset: {width: 0, height: 3},
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 3,
  },
  bottomPrimaryBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
