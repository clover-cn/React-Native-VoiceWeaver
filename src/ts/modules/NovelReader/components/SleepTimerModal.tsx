import React, {memo, useCallback} from 'react';
import {
  Modal,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {SleepTimerInfo, SleepTimerMode} from '../hooks/useSleepTimer';

interface SleepTimerModalProps {
  visible: boolean;
  info: SleepTimerInfo;
  onClose: () => void;
  onSelectDuration: (ms: number) => void;
  onClear: () => void;
}

interface OptionDef {
  key: string;
  label: string;
  description?: string;
  mode: SleepTimerMode;
  /** duration 模式下的毫秒数，匹配选中态用 */
  ms?: number;
}

const OPTIONS: ReadonlyArray<OptionDef> = [
  {key: '1', label: '1 分钟', mode: 'duration', ms: 1 * 60 * 1000},
  {key: '15', label: '15 分钟', mode: 'duration', ms: 15 * 60 * 1000},
  {key: '30', label: '30 分钟', mode: 'duration', ms: 30 * 60 * 1000},
  {key: '60', label: '60 分钟', mode: 'duration', ms: 60 * 60 * 1000},
];

const formatRemaining = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const isOptionActive = (info: SleepTimerInfo, opt: OptionDef): boolean => {
  if (opt.mode !== info.mode) {
    return false;
  }
  if (opt.mode === 'duration') {
    return opt.ms === info.totalMs;
  }
  return true;
};

/**
 * 定时关闭弹窗 —— 视觉与交互结构对齐 SourceSwitchModal:
 * 底部 75% sheet,白色头部带居中标题 + 右上角关闭按钮,卡片式选项列表。
 */
const SleepTimerModal: React.FC<SleepTimerModalProps> = ({
  visible,
  info,
  onClose,
  onSelectDuration,
  onClear,
}) => {
  const handleSelect = useCallback(
    (opt: OptionDef) => {
      if (isOptionActive(info, opt)) {
        // 再次点击当前选中项 => 取消定时
        onClear();
        return;
      }
      if (opt.mode === 'duration' && typeof opt.ms === 'number') {
        onSelectDuration(opt.ms);
      }
    },
    [info, onClear, onSelectDuration],
  );

  const renderStatusText = (): string | null => {
    if (info.mode === 'duration' && info.remainingMs > 0) {
      return `剩余 ${formatRemaining(info.remainingMs)}`;
    }
    return null;
  };

  const statusText = renderStatusText();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}>
      <View style={styles.modalBg}>
        <TouchableOpacity
          style={styles.bgTouch}
          activeOpacity={1}
          onPress={onClose}
        />
        <View style={styles.modalContent}>
          <SafeAreaView style={styles.safeArea}>
            <View style={styles.header}>
              <Text style={styles.title}>定时关闭</Text>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <Text style={styles.closeText}>关闭</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.listContent}>
              {statusText && (
                <View style={styles.statusBox}>
                  <Text style={styles.statusText}>{statusText}</Text>
                </View>
              )}

              {OPTIONS.map(opt => {
                const active = isOptionActive(info, opt);
                return (
                  <TouchableOpacity
                    key={opt.key}
                    style={[styles.optionItem, active && styles.activeOptionItem]}
                    onPress={() => handleSelect(opt)}>
                    <View style={styles.optionHeader}>
                      <Text
                        style={[styles.optionLabel, active && styles.activeText]}>
                        {opt.label}
                      </Text>
                      {active && <Text style={styles.currentTag}>当前</Text>}
                    </View>
                    {opt.description ? (
                      <Text style={styles.optionDesc} numberOfLines={1}>
                        {opt.description}
                      </Text>
                    ) : null}
                  </TouchableOpacity>
                );
              })}

              {info.mode !== 'off' && (
                <TouchableOpacity style={styles.clearBtn} onPress={onClear}>
                  <Text style={styles.clearBtnText}>关闭定时</Text>
                </TouchableOpacity>
              )}
            </View>
          </SafeAreaView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'flex-end',
  },
  bgTouch: {
    flex: 1,
  },
  modalContent: {
    backgroundColor: '#F5F5F9',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    height: '75%',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: -2},
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 8,
  },
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#D1D1D6',
    backgroundColor: '#FFF',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    position: 'relative',
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000',
  },
  closeBtn: {
    position: 'absolute',
    right: 16,
    padding: 8,
  },
  closeText: {
    fontSize: 16,
    color: '#007AFF',
  },
  listContent: {
    padding: 16,
  },
  statusBox: {
    backgroundColor: 'rgba(0, 122, 255, 0.08)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
  },
  statusText: {
    fontSize: 13,
    color: '#007AFF',
    fontWeight: '600',
  },
  optionItem: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  activeOptionItem: {
    borderColor: '#007AFF',
    borderWidth: 1.5,
    backgroundColor: '#F0F8FF',
  },
  optionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  optionLabel: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  activeText: {
    color: '#007AFF',
  },
  currentTag: {
    fontSize: 12,
    color: '#FFF',
    backgroundColor: '#007AFF',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: 'hidden',
  },
  optionDesc: {
    fontSize: 13,
    color: '#8E8E93',
  },
  clearBtn: {
    marginTop: 4,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 59, 48, 0.1)',
    alignItems: 'center',
  },
  clearBtnText: {
    color: '#FF3B30',
    fontSize: 15,
    fontWeight: '600',
  },
});

export default memo(SleepTimerModal);
