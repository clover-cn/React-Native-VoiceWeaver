import React, {memo, useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Video from 'react-native-video';
import bridge from '../../base/utils/bridge';
import {fetchWithTimeout} from '../hooks/useListenBook';
import {AudioOption} from '../types/audio';

interface AudioLibraryModalProps {
  visible: boolean;
  apiBase: string;
  onClose: () => void;
  onRecordsChanged?: (records: AudioOption[]) => void;
}

interface AudioListResponse {
  success?: boolean;
  list?: AudioOption[];
  error?: string;
}

interface ProviderResponse {
  success?: boolean;
  provider?: string;
}

interface SelectedAudioFile {
  uri: string;
  fileName: string;
  uploadName: string;
  size: number;
  mimeType: string;
}

interface NativeAudioSelectionResult {
  cancelled?: boolean;
  error?: string;
  uri?: string;
  name?: string;
  size?: number;
}

interface NativeUploadResult {
  success?: boolean;
  error?: string;
  message?: string;
  responseCode?: number;
}

const buildNativeUploadErrorMessage = (result?: NativeUploadResult) => {
  const errorText = result?.error?.trim() || '';
  if (errorText) {
    return errorText;
  }

  const messageText = result?.message?.trim() || '';
  if (messageText) {
    return messageText;
  }

  if (typeof result?.responseCode === 'number') {
    return `上传失败(${result.responseCode})`;
  }

  return '上传音频失败';
};

const sleep = (ms: number) =>
  new Promise(resolve => {
    setTimeout(resolve, ms);
  });

const requestJson = async <T,>(
  url: string,
  options?: RequestInit,
): Promise<T> => {
  let retried = false;

  while (true) {
    try {
      const response = await fetchWithTimeout(url, options);
      if (response.status === 429 && !retried) {
        retried = true;
        await sleep(20000);
        continue;
      }

      if (response.status >= 500 && response.status < 600 && !retried) {
        retried = true;
        await sleep(2000);
        continue;
      }

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || `请求失败(${response.status})`);
      }
      return data as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('请求超时') && !retried) {
        retried = true;
        await sleep(2000);
        continue;
      }
      throw error;
    }
  }
};

const normalizeAudioList = (list?: AudioOption[]) => {
  if (!Array.isArray(list)) {
    return [];
  }

  return list.map(item => ({
    ...item,
    sampleText: item.sampleText || '',
    remark: item.remark || '',
  }));
};

const formatDate = (isoStr?: string) => {
  if (!isoStr) {
    return '未知时间';
  }

  const date = new Date(isoStr);
  if (Number.isNaN(date.getTime())) {
    return '未知时间';
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}`;
};

const formatTime = (seconds: number) => {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const total = Math.floor(safeSeconds);
  const minutes = Math.floor(total / 60);
  const remainSeconds = total % 60;
  return `${minutes}:${String(remainSeconds).padStart(2, '0')}`;
};

const MAX_UPLOAD_FILE_SIZE = 5 * 1024 * 1024;

const getFileNameFromUri = (uri: string) => {
  const safeUri = uri.split('?')[0];
  const fileName = safeUri.slice(safeUri.lastIndexOf('/') + 1);
  return decodeURIComponent(fileName || 'audio');
};

const getBaseName = (fileName: string) => {
  const safeName = fileName.trim();
  const dotIndex = safeName.lastIndexOf('.');
  if (dotIndex <= 0) {
    return safeName || '未命名音频';
  }
  return safeName.slice(0, dotIndex) || '未命名音频';
};

const getAudioMimeType = (fileName: string) => {
  const extension = fileName.split('.').pop()?.toLowerCase() || '';
  switch (extension) {
    case 'mp3':
      return 'audio/mpeg';
    case 'wav':
      return 'audio/wav';
    case 'm4a':
      return 'audio/mp4';
    case 'aac':
      return 'audio/aac';
    case 'ogg':
      return 'audio/ogg';
    case 'flac':
      return 'audio/flac';
    default:
      return 'application/octet-stream';
  }
};

const getUriScheme = (uri?: string) => {
  const safeUri = uri?.trim() || '';
  const schemeSeparatorIndex = safeUri.indexOf('://');
  if (schemeSeparatorIndex > 0) {
    return safeUri.slice(0, schemeSeparatorIndex);
  }

  const colonIndex = safeUri.indexOf(':');
  if (colonIndex > 0) {
    return safeUri.slice(0, colonIndex);
  }

  return '';
};

const buildUploadDraftDebugInfo = (draft?: SelectedAudioFile | null) => ({
  uri: draft?.uri || '',
  uriScheme: getUriScheme(draft?.uri),
  uriEmpty: !(draft?.uri || '').trim(),
  fileName: draft?.fileName || '',
  fileNameEmpty: !(draft?.fileName || '').trim(),
  uploadName: draft?.uploadName || '',
  uploadNameEmpty: !(draft?.uploadName || '').trim(),
  uploadNameLength: (draft?.uploadName || '').trim().length,
  mimeType: draft?.mimeType || '',
  mimeTypeEmpty: !(draft?.mimeType || '').trim(),
  size: draft?.size ?? 0,
});

const formatFileSize = (size?: number) => {
  const safeSize = Number.isFinite(size) ? Math.max(0, size || 0) : 0;
  if (safeSize >= 1024 * 1024) {
    return `${(safeSize / (1024 * 1024)).toFixed(2)} MB`;
  }
  if (safeSize >= 1024) {
    return `${(safeSize / 1024).toFixed(1)} KB`;
  }
  return `${safeSize} B`;
};

interface PreviewPlayerProps {
  uri: string;
}

const PreviewPlayer = memo(({uri}: PreviewPlayerProps) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPlayerMounted, setIsPlayerMounted] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [instanceKey, setInstanceKey] = useState(0);

  useEffect(() => {
    setIsPlaying(false);
    setIsPlayerMounted(false);
    setDuration(0);
    setCurrentTime(0);
    setInstanceKey(prev => prev + 1);
  }, [uri]);

  const progressRatio = duration > 0 ? Math.min(currentTime / duration, 1) : 0;

  const togglePlayback = () => {
    if (isPlaying) {
      setIsPlaying(false);
      setIsPlayerMounted(false);
      return;
    }

    if (duration > 0 && currentTime >= duration) {
      setInstanceKey(prev => prev + 1);
      setCurrentTime(0);
    }

    setIsPlayerMounted(true);
    setIsPlaying(true);
  };

  return (
    <View style={styles.previewWrap}>
      {isPlayerMounted ? (
        <Video
          key={`${uri}_${instanceKey}`}
          source={{uri}}
          paused={false}
          audioOnly
          playInBackground={false}
          playWhenInactive={false}
          ignoreSilentSwitch="ignore"
          onLoad={event => {
            setDuration(event.duration || 0);
            setCurrentTime(0);
          }}
          onProgress={event => {
            setCurrentTime(event.currentTime || 0);
          }}
          onEnd={() => {
            setIsPlaying(false);
            setIsPlayerMounted(false);
            setCurrentTime(0);
            setInstanceKey(prev => prev + 1);
          }}
          onError={error => {
            console.warn('[AudioLibraryModal] 音频预览失败', error);
            setIsPlaying(false);
            setIsPlayerMounted(false);
          }}
          style={styles.previewPlayer}
        />
      ) : null}
      <View style={styles.previewControls}>
        <TouchableOpacity style={styles.previewButton} onPress={togglePlayback}>
          <Text style={styles.previewButtonText}>
            {isPlaying ? '暂停' : '试听'}
          </Text>
        </TouchableOpacity>
        <View style={styles.previewMeta}>
          <View style={styles.previewTrack}>
            <View
              style={[styles.previewFill, {width: `${progressRatio * 100}%`}]}
            />
          </View>
          <Text style={styles.previewTime}>
            {formatTime(currentTime)} / {formatTime(duration)}
          </Text>
        </View>
      </View>
    </View>
  );
});

const AudioLibraryModal: React.FC<AudioLibraryModalProps> = ({
  visible,
  apiBase,
  onClose,
  onRecordsChanged,
}) => {
  const [audioList, setAudioList] = useState<AudioOption[]>([]);
  const [initialAudioMap, setInitialAudioMap] = useState<
    Record<string, string>
  >({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSiliconflow, setIsSiliconflow] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [uploadDraft, setUploadDraft] = useState<SelectedAudioFile | null>(
    null,
  );
  const [uploading, setUploading] = useState(false);

  const fetchProvider = useCallback(async () => {
    try {
      const data = await requestJson<ProviderResponse>(
        `${apiBase}/api/tts/provider`,
      );
      setIsSiliconflow((data.provider || 'siliconflow') === 'siliconflow');
    } catch (err) {
      console.warn(
        '[AudioLibraryModal] 获取 TTS 提供商失败，默认使用 siliconflow',
        err,
      );
      setIsSiliconflow(true);
    }
  }, [apiBase]);

  const fetchAudioList = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await requestJson<AudioListResponse>(
        `${apiBase}/api/audio/list`,
      );
      if (!data.success) {
        throw new Error(data.error || '获取音频列表失败');
      }

      const normalizedList = normalizeAudioList(data.list);
      setAudioList(normalizedList);
      setInitialAudioMap(
        normalizedList.reduce<Record<string, string>>((acc, item) => {
          acc[item.id] = item.sampleText || '';
          return acc;
        }, {}),
      );
      onRecordsChanged?.(normalizedList);
    } catch (err) {
      console.warn('[AudioLibraryModal] 获取音频列表失败', err);
      setError(err instanceof Error ? err.message : '获取音频列表失败');
    } finally {
      setLoading(false);
    }
  }, [apiBase, onRecordsChanged]);

  useEffect(() => {
    if (!visible) {
      setUploadDraft(null);
      setUploading(false);
      return;
    }

    fetchProvider();
    fetchAudioList();
  }, [fetchAudioList, fetchProvider, visible]);

  const pickHarmonyAudio = useCallback(async () => {
    const payload = await new Promise<string>((resolve, reject) => {
      try {
        bridge.selectAudio(result => {
          resolve(result || '');
        });
      } catch (err) {
        reject(err);
      }
    });

    if (!payload) {
      return null;
    }

    let parsed: NativeAudioSelectionResult;
    try {
      parsed = JSON.parse(payload) as NativeAudioSelectionResult;
    } catch (err) {
      throw new Error('音频选择结果解析失败');
    }

    if (parsed.cancelled) {
      if (parsed.error) {
        throw new Error(parsed.error);
      }
      return null;
    }

    const selectedUri = parsed.uri || '';
    if (!selectedUri) {
      throw new Error('未获取到可上传的音频地址');
    }

    const fileName = parsed.name?.trim() || getFileNameFromUri(selectedUri);
    const fileSize = Number.isFinite(parsed.size)
      ? Math.max(0, Number(parsed.size))
      : 0;

    return {
      uri: selectedUri,
      fileName,
      uploadName: getBaseName(fileName),
      size: fileSize,
      mimeType: getAudioMimeType(fileName),
    };
  }, []);

  const updateAudioField = useCallback(
    (id: string, field: keyof AudioOption, value: string) => {
      setAudioList(prev =>
        prev.map(item => (item.id === id ? {...item, [field]: value} : item)),
      );
    },
    [],
  );

  const saveAudioItem = useCallback(
    async (item: AudioOption) => {
      setPendingId(item.id);

      try {
        const originalSampleText = initialAudioMap[item.id] || '';
        const nextSampleText = item.sampleText || '';
        const sampleTextChanged = nextSampleText !== originalSampleText;

        if (!sampleTextChanged) {
          Alert.alert('无需保存', '当前没有检测到新的修改。');
          return;
        }

        if (!isSiliconflow) {
          Alert.alert(
            '当前不可保存',
            '当前 TTS 不是 siliconflow，无需维护参考文本。',
          );
          return;
        }

        const sampleRes = await requestJson<{
          success?: boolean;
          error?: string;
        }>(`${apiBase}/api/audio/${item.id}/sample-text`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            sampleText: nextSampleText,
          }),
        });

        if (!sampleRes.success) {
          throw new Error(sampleRes.error || '保存参考文本失败');
        }

        setInitialAudioMap(prev => ({
          ...prev,
          [item.id]: nextSampleText,
        }));
        Alert.alert('保存成功', '当前音频资料已更新。');
      } catch (err) {
        console.warn('[AudioLibraryModal] 保存音频失败', err);
        Alert.alert(
          '保存失败',
          err instanceof Error ? err.message : '保存失败，请稍后重试。',
        );
      } finally {
        setPendingId(null);
      }
    },
    [apiBase, initialAudioMap, isSiliconflow],
  );

  const deleteAudioItem = useCallback(
    (item: AudioOption) => {
      Alert.alert(
        '删除音频',
        '确定删除这段音频吗？删除后会同时清理它在角色上的绑定。',
        [
          {text: '取消', style: 'cancel'},
          {
            text: '删除',
            style: 'destructive',
            onPress: async () => {
              setPendingId(item.id);
              try {
                const data = await requestJson<{
                  success?: boolean;
                  error?: string;
                }>(`${apiBase}/api/audio/${item.id}`, {
                  method: 'DELETE',
                });

                if (!data.success) {
                  throw new Error(data.error || '删除音频失败');
                }

                await fetchAudioList();
              } catch (err) {
                Alert.alert(
                  '删除失败',
                  err instanceof Error ? err.message : '删除失败，请稍后重试。',
                );
              } finally {
                setPendingId(null);
              }
            },
          },
        ],
      );
    },
    [apiBase, fetchAudioList],
  );

  const handleUploadPress = useCallback(async () => {
    if (Platform.OS !== 'harmony') {
      Alert.alert('暂未实现', '当前仅支持鸿蒙端上传音频。');
      return;
    }

    if (uploading) {
      return;
    }

    try {
      const selectedFile = await pickHarmonyAudio();
      if (!selectedFile) {
        return;
      }

      console.log(
        '[AudioLibraryModal] 选中上传音频',
        buildUploadDraftDebugInfo(selectedFile),
      );

      if (selectedFile.size > MAX_UPLOAD_FILE_SIZE) {
        Alert.alert('文件过大', '当前仅支持上传 5MB 以内的音频，请重新选择。');
        return;
      }

      setUploadDraft(selectedFile);
    } catch (err) {
      console.warn('[AudioLibraryModal] 选择上传音频失败', err);
      Alert.alert(
        '选择失败',
        err instanceof Error ? err.message : '选择音频失败，请稍后重试。',
      );
    }
  }, [pickHarmonyAudio, uploading]);

  const confirmUpload = useCallback(async () => {
    if (!uploadDraft) {
      return;
    }

    const finalName = uploadDraft.uploadName.trim();
    if (!finalName) {
      Alert.alert('名称不能为空', '请先输入音频名称。');
      return;
    }

    setUploading(true);
    try {
      const draftDebugInfo = buildUploadDraftDebugInfo(uploadDraft);
      console.log('[AudioLibraryModal] 上传音频入参摘要', {
        ...draftDebugInfo,
        apiBase,
        uploadUrl: `${apiBase}/api/audio/upload`,
      });

      const payload = JSON.stringify({
        url: `${apiBase}/api/audio/upload`,
        uri: uploadDraft.uri,
        fileName: uploadDraft.fileName,
        uploadName: finalName,
        mimeType: uploadDraft.mimeType,
      });
      console.log('[AudioLibraryModal] 上传音频原始 payload', payload);
      const nativeResult = await new Promise<NativeUploadResult>(
        (resolve, reject) => {
          try {
            bridge.uploadAudio(payload, result => {
              if (!result) {
                reject(new Error('上传结果为空'));
                return;
              }

              try {
                const parsedResult = JSON.parse(result) as NativeUploadResult;
                console.log(
                  '[AudioLibraryModal] 上传音频原生返回',
                  parsedResult,
                );
                resolve(parsedResult);
              } catch (_parseError) {
                reject(new Error('上传结果解析失败'));
              }
            });
          } catch (nativeError) {
            reject(nativeError);
          }
        },
      );

      if (!nativeResult.success) {
        throw new Error(buildNativeUploadErrorMessage(nativeResult));
      }

      setUploadDraft(null);
      await fetchAudioList();
      Alert.alert('上传成功', nativeResult.message || '音频已上传。');
    } catch (err) {
      console.warn('[AudioLibraryModal] 上传音频失败', err, {
        apiBase,
        uploadDraft: buildUploadDraftDebugInfo(uploadDraft),
      });
      Alert.alert(
        '上传失败',
        err instanceof Error ? err.message : '上传失败，请稍后重试。',
      );
    } finally {
      setUploading(false);
    }
  }, [apiBase, fetchAudioList, uploadDraft]);

  const listHeader = useMemo(
    () => (
      <View style={styles.listHeaderWrap}>
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>参考音频管理</Text>
          <Text style={styles.infoDesc}>这里的音频用于角色自动配音</Text>
          {!isSiliconflow ? (
            <Text style={styles.providerTip}>
              当前 TTS 不是 siliconflow，参考文本字段已自动隐藏。
            </Text>
          ) : null}
        </View>
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={fetchAudioList}>
            <Text style={styles.secondaryBtnText}>刷新列表</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.primaryBtn}
            disabled={uploading}
            onPress={handleUploadPress}>
            {uploading ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryBtnText}>上传音频</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    ),
    [fetchAudioList, handleUploadPress, isSiliconflow, uploading],
  );

  const renderItem = ({item}: {item: AudioOption}) => {
    const previewUri = item.url
      ? item.url.startsWith('http')
        ? item.url
        : `${apiBase}${item.url}`
      : '';
    const isPending = pendingId === item.id;

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderMain}>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {item.name || '未命名音频'}
            </Text>
            <Text style={styles.cardTime}>{formatDate(item.createTime)}</Text>
          </View>
          {isPending ? (
            <ActivityIndicator size="small" color="#007AFF" />
          ) : null}
        </View>

        {previewUri ? (
          <PreviewPlayer uri={previewUri} />
        ) : (
          <View style={styles.missingPreview}>
            <Text style={styles.missingPreviewText}>
              当前音频缺少可试听地址
            </Text>
          </View>
        )}

        {isSiliconflow ? (
          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>参考文本</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              multiline
              placeholder="输入该音频对应的参考文本"
              placeholderTextColor="#8E8E93"
              textAlignVertical="top"
              value={item.sampleText || ''}
              onChangeText={value =>
                updateAudioField(item.id, 'sampleText', value)
              }
            />
          </View>
        ) : null}

        <View style={styles.itemActionRow}>
          <TouchableOpacity
            style={styles.itemGhostBtn}
            disabled={isPending}
            onPress={() => deleteAudioItem(item)}>
            <Text style={styles.itemGhostBtnText}>删除</Text>
          </TouchableOpacity>
          {isSiliconflow ? (
            <TouchableOpacity
              style={styles.itemPrimaryBtn}
              disabled={isPending}
              onPress={() => saveAudioItem(item)}>
              <Text style={styles.itemPrimaryBtnText}>保存参考文本</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <>
      <Modal
        visible={visible}
        animationType="slide"
        transparent
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
                <Text style={styles.title}>音频管理</Text>
                <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                  <Text style={styles.closeText}>关闭</Text>
                </TouchableOpacity>
              </View>

              {loading ? (
                <View style={styles.centerContainer}>
                  <ActivityIndicator size="large" color="#007AFF" />
                  <Text style={styles.statusText}>正在加载音频列表...</Text>
                </View>
              ) : error ? (
                <View style={styles.centerContainer}>
                  <Text style={styles.errorText}>{error}</Text>
                  <TouchableOpacity
                    style={styles.retryBtn}
                    onPress={fetchAudioList}>
                    <Text style={styles.retryText}>重新获取</Text>
                  </TouchableOpacity>
                </View>
              ) : audioList.length === 0 ? (
                <View style={styles.centerContainer}>
                  {listHeader}
                  <View style={styles.emptyWrap}>
                    <Text style={styles.emptyTitle}>暂无参考音频</Text>
                    <Text style={styles.emptyDesc}>
                      点击上方上传音频，上传成功后这里会自动展示。
                    </Text>
                  </View>
                </View>
              ) : (
                <FlatList
                  data={audioList}
                  keyExtractor={item => item.id}
                  renderItem={renderItem}
                  ListHeaderComponent={listHeader}
                  contentContainerStyle={styles.listContent}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                />
              )}
            </SafeAreaView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={!!uploadDraft}
        animationType="fade"
        transparent
        onRequestClose={() => {
          if (!uploading) {
            setUploadDraft(null);
          }
        }}>
        <View style={styles.uploadMask}>
          <View style={styles.uploadDialog}>
            <Text style={styles.uploadTitle}>上传音频</Text>
            <Text style={styles.uploadMeta}>
              文件：{uploadDraft?.fileName || '-'}
            </Text>
            <Text style={styles.uploadMeta}>
              大小：{formatFileSize(uploadDraft?.size)}
            </Text>
            <View style={styles.uploadFieldBlock}>
              <Text style={styles.fieldLabel}>音频名称</Text>
              <TextInput
                style={styles.input}
                value={uploadDraft?.uploadName || ''}
                editable={!uploading}
                placeholder="请输入音频名称"
                placeholderTextColor="#8E8E93"
                onChangeText={value =>
                  setUploadDraft(prev =>
                    prev
                      ? {
                          ...prev,
                          uploadName: value,
                        }
                      : prev,
                  )
                }
              />
              <View style={styles.uploadRuleCard}>
                <Text style={styles.uploadRuleTitle}>重要提示</Text>
                <Text style={styles.uploadRuleText}>
                  音频命名必须严格按照：名字-情绪-性别
                </Text>
                <Text style={styles.uploadRuleExample}>
                  例：小明-高兴-男
                </Text>
                <Text style={styles.uploadRuleTitle}>目前支持的情绪有</Text>
                <Text style={styles.uploadRuleText}>高兴、愤怒、悲伤、害怕、厌恶、忧郁、惊讶、平静</Text>
                <Text style={styles.uploadRuleText}>
                  旁白必须使用：名字-旁白-性别
                </Text>
              </View>
            </View>
            <View style={styles.uploadActionRow}>
              <TouchableOpacity
                style={styles.uploadCancelBtn}
                disabled={uploading}
                onPress={() => setUploadDraft(null)}>
                <Text style={styles.uploadCancelText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.uploadConfirmBtn}
                disabled={uploading}
                onPress={confirmUpload}>
                {uploading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.uploadConfirmText}>确认上传</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
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
    height: '82%',
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
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  listHeaderWrap: {
    width: '100%',
    paddingTop: 16,
    paddingBottom: 8,
  },
  infoCard: {
    borderRadius: 12,
    backgroundColor: '#FFF',
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 12,
  },
  infoTitle: {
    color: '#1C1C1E',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  infoDesc: {
    color: '#636366',
    fontSize: 13,
    lineHeight: 20,
  },
  providerTip: {
    color: '#8E8E93',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 8,
  },
  secondaryBtn: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#D1D1D6',
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: '#1C1C1E',
    fontSize: 14,
    fontWeight: '600',
  },
  primaryBtn: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
  },
  card: {
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
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  cardHeaderMain: {
    flex: 1,
    marginRight: 12,
  },
  cardTitle: {
    color: '#1C1C1E',
    fontSize: 16,
    fontWeight: '700',
  },
  cardTime: {
    color: '#8E8E93',
    fontSize: 12,
    marginTop: 4,
  },
  previewWrap: {
    marginBottom: 12,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#F2F2F7',
  },
  previewPlayer: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0.01,
    top: 0,
    left: 0,
  },
  previewControls: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  previewButton: {
    minWidth: 56,
    borderRadius: 16,
    backgroundColor: 'rgba(0,122,255,0.12)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  previewButtonText: {
    color: '#007AFF',
    fontSize: 13,
    fontWeight: '700',
  },
  previewMeta: {
    flex: 1,
  },
  previewTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(0,0,0,0.05)',
    overflow: 'hidden',
  },
  previewFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: '#007AFF',
  },
  previewTime: {
    color: '#8E8E93',
    fontSize: 12,
    marginTop: 8,
  },
  missingPreview: {
    borderRadius: 12,
    backgroundColor: '#F2F2F7',
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 12,
  },
  missingPreviewText: {
    color: '#8E8E93',
    fontSize: 13,
  },
  fieldBlock: {
    marginBottom: 12,
  },
  fieldLabel: {
    color: '#1C1C1E',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  input: {
    borderRadius: 12,
    backgroundColor: '#F2F2F7',
    color: '#1C1C1E',
    fontSize: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  inputMultiline: {
    minHeight: 88,
  },
  itemActionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 4,
  },
  itemGhostBtn: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: '#FFF5F5',
    paddingVertical: 12,
    alignItems: 'center',
  },
  itemGhostBtnText: {
    color: '#FF3B30',
    fontSize: 14,
    fontWeight: '700',
  },
  itemPrimaryBtn: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    alignItems: 'center',
  },
  itemPrimaryBtnText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  statusText: {
    marginTop: 16,
    fontSize: 14,
    color: '#8E8E93',
  },
  errorText: {
    fontSize: 15,
    color: '#FF3B30',
    marginBottom: 16,
    textAlign: 'center',
  },
  retryBtn: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  emptyWrap: {
    borderRadius: 12,
    backgroundColor: '#FFF',
    paddingHorizontal: 20,
    paddingVertical: 24,
    width: '100%',
    alignItems: 'center',
  },
  emptyTitle: {
    color: '#1C1C1E',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  emptyDesc: {
    color: '#8E8E93',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
  },
  uploadMask: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  uploadDialog: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 20,
  },
  uploadTitle: {
    color: '#1C1C1E',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 10,
  },
  uploadMeta: {
    color: '#636366',
    fontSize: 13,
    lineHeight: 20,
  },
  uploadFieldBlock: {
    marginTop: 16,
    marginBottom: 18,
  },
  uploadRuleCard: {
    borderRadius: 12,
    backgroundColor: '#FFF7E8',
    borderWidth: 1,
    borderColor: '#F3D19C',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 10,
  },
  uploadRuleTitle: {
    color: '#9A5B00',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
    letterSpacing: 0.4,
  },
  uploadRuleText: {
    color: '#6B4A12',
    fontSize: 13,
    lineHeight: 19,
  },
  uploadRuleExample: {
    color: 'red',
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
    marginBottom: 12,
  },
  uploadActionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  uploadCancelBtn: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: '#F2F2F7',
    paddingVertical: 12,
    alignItems: 'center',
  },
  uploadCancelText: {
    color: '#1C1C1E',
    fontSize: 14,
    fontWeight: '600',
  },
  uploadConfirmBtn: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    alignItems: 'center',
  },
  uploadConfirmText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});

export default AudioLibraryModal;
