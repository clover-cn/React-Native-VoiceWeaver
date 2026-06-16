import React, {useEffect, useMemo, useState} from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {Dropdown} from 'react-native-element-dropdown';
import Video from 'react-native-video';
import {ListenSegment} from '../types/reader';
import {API_BASE} from '../hooks/useListenBook';
import {AudioOption} from '../types/audio';

export interface SegmentEditPayload {
  role: string;
  emotion: string;
  selectedAudioId: string | null;
}

interface SegmentEditorModalProps {
  visible: boolean;
  segment?: ListenSegment;
  availableRoles: string[];
  audioOptions: AudioOption[];
  onClose: () => void;
  onSave: (data: SegmentEditPayload) => void;
}

const EMOTIONS = [
  {label: '高兴', value: 'happy'},
  {label: '愤怒', value: 'angry'},
  {label: '悲伤', value: 'sad'},
  {label: '害怕', value: 'fearful'},
  {label: '厌恶', value: 'disgusted'},
  {label: '忧郁', value: 'melancholy'},
  {label: '惊讶', value: 'surprised'},
  {label: '平静', value: 'neutral'},
];

const getReferenceAudioId = (segment?: ListenSegment) => {
  if (!segment?.referenceAudio) {
    return null;
  }

  if (typeof segment.referenceAudio === 'string') {
    return segment.referenceAudio;
  }

  return segment.referenceAudio.id || null;
};

const SegmentEditorModal: React.FC<SegmentEditorModalProps> = ({
  visible,
  segment,
  availableRoles,
  audioOptions,
  onClose,
  onSave,
}) => {
  const [role, setRole] = useState('旁白');
  const [emotion, setEmotion] = useState('neutral');
  const [selectedAudioId, setSelectedAudioId] = useState<string | null>(null);
  const [isRoleDropdownFocus, setIsRoleDropdownFocus] = useState(false);
  const [isAudioDropdownFocus, setIsAudioDropdownFocus] = useState(false);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [isPreviewPlayerMounted, setIsPreviewPlayerMounted] = useState(false);
  const [previewDuration, setPreviewDuration] = useState(0);
  const [previewCurrentTime, setPreviewCurrentTime] = useState(0);
  const [previewInstanceKey, setPreviewInstanceKey] = useState(0);

  useEffect(() => {
    if (!visible) {
      setIsPreviewPlaying(false);
      setIsPreviewPlayerMounted(false);
      return;
    }

    const nextRole = segment?.role || '旁白';
    setRole(nextRole);
    setEmotion(segment?.emotion || 'neutral');
    setSelectedAudioId(getReferenceAudioId(segment));
    setIsRoleDropdownFocus(false);
    setIsAudioDropdownFocus(false);
    setIsPreviewPlaying(false);
    setIsPreviewPlayerMounted(false);
    setPreviewDuration(0);
    setPreviewCurrentTime(0);
  }, [segment, visible]);

  const audioNameMap = useMemo(() => {
    return audioOptions.reduce<Record<string, string>>((acc, item) => {
      acc[item.id] = item.name;
      return acc;
    }, {});
  }, [audioOptions]);

  const selectedAudioPreviewUrl = useMemo(() => {
    if (!selectedAudioId) {
      return '';
    }

    const matchedAudio = audioOptions.find(item => item.id === selectedAudioId);
    if (!matchedAudio?.url) {
      return '';
    }

    return matchedAudio.url.startsWith('http')
      ? matchedAudio.url
      : `${API_BASE}${matchedAudio.url}`;
  }, [audioOptions, selectedAudioId]);

  const effectiveRole = role || '旁白';

  useEffect(() => {
    setIsPreviewPlaying(false);
    setIsPreviewPlayerMounted(false);
    setPreviewDuration(0);
    setPreviewCurrentTime(0);
    setPreviewInstanceKey(prev => prev + 1);
  }, [selectedAudioId]);

  const audioDropdownData = useMemo(
    () => [
      {label: '清除手动指定', value: '__clear__'},
      ...audioOptions.map(item => ({
        label: item.name,
        value: item.id,
      })),
    ],
    [audioOptions],
  );

  const roleDropdownData = useMemo(
    () => [
      {label: '旁白', value: '旁白'},
      ...availableRoles.map(item => ({
        label: item,
        value: item,
      })),
    ],
    [availableRoles],
  );

  const handleSave = () => {
    onSave({
      role: effectiveRole,
      emotion,
      selectedAudioId,
    });
  };

  const formatPreviewTime = (seconds: number) => {
    const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    const total = Math.floor(safeSeconds);
    const minutes = Math.floor(total / 60);
    const remainSeconds = total % 60;
    return `${minutes}:${String(remainSeconds).padStart(2, '0')}`;
  };

  const togglePreviewPlayback = () => {
    if (!selectedAudioPreviewUrl) {
      return;
    }

    if (isPreviewPlaying) {
      setIsPreviewPlaying(false);
      setIsPreviewPlayerMounted(false);
      return;
    }

    if (previewDuration > 0 && previewCurrentTime >= previewDuration) {
      setPreviewInstanceKey(prev => prev + 1);
      setPreviewCurrentTime(0);
    }

    setIsPreviewPlayerMounted(true);
    setIsPreviewPlaying(true);
  };

  const previewProgressRatio =
    previewDuration > 0 ? Math.min(previewCurrentTime / previewDuration, 1) : 0;

  if (!visible) {
    return null;
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.header}>
            <Text style={styles.title}>
              {effectiveRole ? `编辑片段 · ${effectiveRole}` : '编辑片段'}
            </Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeTxt}>关闭</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}>
            <View style={styles.infoCard}>
              <Text style={styles.infoText}>
                这里可以修改当前片段的角色、情绪和参考音频。保存后会让当前片段及同角色相关音频失效，并按新配置重生成。
              </Text>
            </View>

            <View style={styles.section}>
              <Text style={styles.label}>角色</Text>
              <Dropdown
                style={[
                  styles.dropdown,
                  isRoleDropdownFocus && styles.dropdownFocused,
                ]}
                containerStyle={styles.dropdownContainer}
                placeholderStyle={styles.dropdownPlaceholder}
                selectedTextStyle={styles.dropdownSelectedText}
                itemTextStyle={styles.dropdownItemText}
                iconStyle={styles.dropdownIcon}
                activeColor="rgba(124,111,247,0.1)"
                data={roleDropdownData}
                search
                maxHeight={220}
                mode="default"
                dropdownPosition="bottom"
                labelField="label"
                valueField="value"
                searchField="label"
                placeholder={!isRoleDropdownFocus ? '选择角色' : '...'}
                searchPlaceholder="搜索角色"
                renderInputSearch={onSearch => (
                  <View style={styles.dropdownSearchWrap}>
                    <TextInput
                      placeholder="搜索角色"
                      placeholderTextColor="#8E8E93"
                      style={styles.dropdownSearchField}
                      onChangeText={onSearch}
                    />
                  </View>
                )}
                value={effectiveRole}
                onFocus={() => setIsRoleDropdownFocus(true)}
                onBlur={() => setIsRoleDropdownFocus(false)}
                onChange={item => {
                  setRole(item.value);
                  setIsRoleDropdownFocus(false);
                }}
              />
            </View>

            <View style={styles.section}>
              <Text style={styles.label}>情绪</Text>
              <View style={styles.roleGrid}>
                {EMOTIONS.map(item => {
                  const active = emotion === item.value;
                  return (
                    <TouchableOpacity
                      key={item.value}
                      style={[
                        styles.emotionChip,
                        active && styles.emotionChipActive,
                      ]}
                      onPress={() => setEmotion(item.value)}>
                      <Text
                        style={[
                          styles.emotionChipText,
                          active && styles.emotionChipTextActive,
                        ]}>
                        {item.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.label}>参考音频</Text>
              <Dropdown
                style={[
                  styles.dropdown,
                  isAudioDropdownFocus && styles.dropdownFocused,
                ]}
                containerStyle={styles.dropdownContainer}
                placeholderStyle={styles.dropdownPlaceholder}
                selectedTextStyle={styles.dropdownSelectedText}
                itemTextStyle={styles.dropdownItemText}
                iconStyle={styles.dropdownIcon}
                activeColor="rgba(124,111,247,0.1)"
                data={audioDropdownData}
                search
                maxHeight={300}
                mode="default"
                dropdownPosition="bottom"
                labelField="label"
                valueField="value"
                searchField="label"
                placeholder={!isAudioDropdownFocus ? '选择新的参考音频' : '...'}
                searchPlaceholder="搜索参考音频"
                renderInputSearch={onSearch => (
                  <View style={styles.dropdownSearchWrap}>
                    <TextInput
                      placeholder="搜索参考音频"
                      placeholderTextColor="#8E8E93"
                      style={styles.dropdownSearchField}
                      onChangeText={onSearch}
                    />
                  </View>
                )}
                value={selectedAudioId ?? '__clear__'}
                onFocus={() => setIsAudioDropdownFocus(true)}
                onBlur={() => setIsAudioDropdownFocus(false)}
                onChange={item => {
                  setSelectedAudioId(
                    item.value === '__clear__' ? null : item.value,
                  );
                  setIsAudioDropdownFocus(false);
                }}
              />
              <Text style={styles.helperText}>
                改情绪时会按角色映射重新匹配；你也可以在这里手动指定新的参考音频。
              </Text>
              <Text style={styles.currentAudioText}>
                当前选择：
                {selectedAudioId
                  ? audioNameMap[selectedAudioId] || selectedAudioId
                  : '未指定'}
              </Text>
              {selectedAudioPreviewUrl ? (
                <View style={styles.audioPreviewWrap}>
                  {isPreviewPlayerMounted ? (
                    <Video
                      key={`${selectedAudioId || 'none'}_${previewInstanceKey}`}
                      source={{uri: selectedAudioPreviewUrl}}
                      paused={false}
                      audioOnly
                      playInBackground={false}
                      playWhenInactive={false}
                      ignoreSilentSwitch="ignore"
                      onLoad={event => {
                        setPreviewDuration(event.duration || 0);
                        setPreviewCurrentTime(0);
                      }}
                      onProgress={event => {
                        setPreviewCurrentTime(event.currentTime || 0);
                      }}
                      onEnd={() => {
                        setIsPreviewPlaying(false);
                        setIsPreviewPlayerMounted(false);
                        setPreviewCurrentTime(0);
                        setPreviewInstanceKey(prev => prev + 1);
                      }}
                      onError={error => {
                        console.warn(
                          '[SegmentEditorModal] 参考音频预览播放失败',
                          error,
                        );
                        setIsPreviewPlaying(false);
                        setIsPreviewPlayerMounted(false);
                      }}
                      style={styles.audioPreviewPlayer}
                    />
                  ) : null}
                  <View style={styles.audioPreviewControls}>
                    <TouchableOpacity
                      style={styles.audioPreviewButton}
                      onPress={togglePreviewPlayback}>
                      <Text style={styles.audioPreviewButtonText}>
                        {isPreviewPlaying ? '暂停' : '播放'}
                      </Text>
                    </TouchableOpacity>
                    <View style={styles.audioPreviewMeta}>
                      <View style={styles.audioPreviewProgressTrack}>
                        <View
                          style={[
                            styles.audioPreviewProgressFill,
                            {width: `${previewProgressRatio * 100}%`},
                          ]}
                        />
                      </View>
                      <Text style={styles.audioPreviewTimeText}>
                        {formatPreviewTime(previewCurrentTime)} /{' '}
                        {formatPreviewTime(previewDuration)}
                      </Text>
                    </View>
                  </View>
                </View>
              ) : null}
            </View>

            <View style={styles.section}>
              <Text style={styles.label}>片段内容</Text>
              <View style={styles.previewCard}>
                <Text style={styles.previewText}>
                  {segment?.text || '暂无内容'}
                </Text>
              </View>
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelBtnText}>取消</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
              <Text style={styles.saveBtnText}>保存片段修改</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '92%',
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 24,
    paddingHorizontal: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: -2},
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  title: {
    flex: 1,
    color: '#1C1C1E',
    fontSize: 18,
    fontWeight: 'bold',
  },
  closeBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  closeTxt: {
    color: '#A0A0A5',
    fontSize: 14,
  },
  scrollView: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingBottom: 24,
  },
  infoCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(124,111,247,0.15)',
    backgroundColor: 'rgba(124,111,247,0.06)',
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 20,
  },
  infoText: {
    color: '#7c6ff7',
    lineHeight: 20,
    fontSize: 13,
  },
  section: {
    marginBottom: 20,
  },
  label: {
    color: '#1C1C1E',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 12,
  },
  roleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  emotionChip: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: '#F2F2F7',
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginRight: 10,
    marginBottom: 10,
  },
  emotionChipActive: {
    borderColor: 'rgba(124,111,247,0.3)',
    backgroundColor: 'rgba(124,111,247,0.15)',
  },
  emotionChipText: {
    color: '#636366',
    fontSize: 14,
  },
  emotionChipTextActive: {
    color: '#7c6ff7',
    fontWeight: 'bold',
  },
  dropdown: {
    height: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: '#F2F2F7',
    paddingHorizontal: 16,
  },
  dropdownFocused: {
    borderColor: '#7c6ff7',
    backgroundColor: 'rgba(124,111,247,0.05)',
  },
  dropdownContainer: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
    backgroundColor: '#ffffff',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
  },
  dropdownPlaceholder: {
    color: '#8E8E93',
    fontSize: 14,
  },
  dropdownSelectedText: {
    color: '#1C1C1E',
    fontSize: 14,
  },
  dropdownItemText: {
    color: '#1C1C1E',
    fontSize: 14,
  },
  dropdownSearchWrap: {
    marginHorizontal: 12,
    marginTop: 12,
  },
  dropdownSearchField: {
    height: 40,
    color: '#1C1C1E',
    backgroundColor: '#F2F2F7',
    borderRadius: 12,
    borderWidth: 0,
    paddingHorizontal: 16,
    fontSize: 14,
  },
  dropdownIcon: {
    width: 16,
    height: 16,
  },
  helperText: {
    color: '#8E8E93',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
  },
  currentAudioText: {
    color: '#636366',
    fontSize: 13,
    marginTop: 8,
  },
  audioPreviewWrap: {
    marginTop: 12,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#F2F2F7',
  },
  audioPreviewPlayer: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0.01,
    top: 0,
    left: 0,
  },
  audioPreviewControls: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  audioPreviewButton: {
    minWidth: 56,
    borderRadius: 16,
    backgroundColor: 'rgba(124,111,247,0.15)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  audioPreviewButtonText: {
    color: '#7c6ff7',
    fontSize: 13,
    fontWeight: 'bold',
  },
  audioPreviewMeta: {
    flex: 1,
  },
  audioPreviewProgressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(0,0,0,0.05)',
    overflow: 'hidden',
  },
  audioPreviewProgressFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: '#7c6ff7',
  },
  audioPreviewTimeText: {
    color: '#8E8E93',
    fontSize: 12,
    marginTop: 8,
  },
  previewCard: {
    borderRadius: 16,
    backgroundColor: '#F2F2F7',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  previewText: {
    color: '#1C1C1E',
    fontSize: 15,
    lineHeight: 24,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
    marginTop: 8,
  },
  cancelBtn: {
    flex: 1,
    borderRadius: 16,
    backgroundColor: '#F2F2F7',
    paddingVertical: 16,
    alignItems: 'center',
  },
  cancelBtnText: {
    color: '#1C1C1E',
    fontSize: 16,
    fontWeight: 'bold',
  },
  saveBtn: {
    flex: 1,
    borderRadius: 16,
    backgroundColor: '#7c6ff7',
    paddingVertical: 16,
    alignItems: 'center',
  },
  saveBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default SegmentEditorModal;
