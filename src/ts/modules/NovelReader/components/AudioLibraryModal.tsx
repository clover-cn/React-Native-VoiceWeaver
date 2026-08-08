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
import {fetchWithTimeout, TimeoutRequestInit} from '../hooks/useListenBook';
import {AudioOption, VoicePool} from '../types/audio';

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

interface AudioVoiceActorGroup {
  key: string;
  voiceActor: string;
  records: AudioOption[];
  configuredPool: VoicePool;
  mixedPool: boolean;
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

const VOICE_POOL_OPTIONS: ReadonlyArray<{
  value: VoicePool;
  label: string;
}> = [
  {value: 'general', label: '通用池'},
  {value: 'bystander', label: '路人池'},
  {value: 'protected', label: '保护池'},
];

const normalizeVoicePool = (value?: string): VoicePool => {
  if (value === 'bystander' || value === 'protected') {
    return value;
  }
  return 'general';
};

const getAudioNameParts = (record?: AudioOption) => {
  return String(record?.name || '')
    .split('-')
    .map(item => item.trim())
    .filter(Boolean);
};

const getVoiceActor = (record?: AudioOption) => {
  const parts = getAudioNameParts(record);
  return parts.length >= 2 ? parts[0] : '';
};

const getAudioEmotion = (record?: AudioOption) => {
  return getAudioNameParts(record)[1] || '未识别情绪';
};

const getAudioGroupKey = (record: AudioOption) => {
  const voiceActor = getVoiceActor(record);
  return voiceActor ? `voiceActor:${voiceActor}` : `unparsed:${record.id}`;
};

const buildAudioVoiceActorGroups = (
  records: AudioOption[],
): AudioVoiceActorGroup[] => {
  const groups = new Map<string, AudioVoiceActorGroup>();

  records.forEach(record => {
    const key = getAudioGroupKey(record);
    const voiceActor = getVoiceActor(record);
    const current = groups.get(key);
    if (current) {
      current.records.push(record);
      return;
    }

    groups.set(key, {
      key,
      voiceActor,
      records: [record],
      configuredPool: normalizeVoicePool(record.voicePool),
      mixedPool: false,
    });
  });

  return Array.from(groups.values()).map(group => {
    const pools = Array.from(
      new Set(group.records.map(record => normalizeVoicePool(record.voicePool))),
    );
    return {
      ...group,
      configuredPool: pools.length === 1 ? pools[0] : 'general',
      mixedPool: pools.length > 1,
    };
  });
};

const buildPoolDrafts = (records: AudioOption[]) => {
  return buildAudioVoiceActorGroups(records).reduce<Record<string, VoicePool>>(
    (drafts, group) => {
      drafts[group.key] = group.configuredPool;
      return drafts;
    },
    {},
  );
};

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
  options?: TimeoutRequestInit,
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
    voicePool: normalizeVoicePool(item.voicePool),
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
  const [searchKeyword, setSearchKeyword] = useState('');
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<Set<string>>(
    new Set(),
  );
  const [poolDrafts, setPoolDrafts] = useState<Record<string, VoicePool>>({});
  const [savingPoolKeys, setSavingPoolKeys] = useState<Set<string>>(
    new Set(),
  );

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
      setPoolDrafts(buildPoolDrafts(normalizedList));
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
      setSearchKeyword('');
      return;
    }

    fetchProvider();
    fetchAudioList();
  }, [fetchAudioList, fetchProvider, visible]);

  const trimmedSearchKeyword = searchKeyword.trim();
  const filteredAudioGroups = useMemo(() => {
    const matchedRecords = trimmedSearchKeyword
      ? audioList.filter(item => {
          const lowerKeyword = trimmedSearchKeyword.toLowerCase();
          return [
            getVoiceActor(item),
            item.name,
            getAudioEmotion(item),
            item.sampleText,
            item.remark,
            item.createTime,
          ]
            .filter(Boolean)
            .some(value =>
              String(value).toLowerCase().includes(lowerKeyword),
            );
        })
      : audioList;

    return buildAudioVoiceActorGroups(matchedRecords);
  }, [audioList, trimmedSearchKeyword]);

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

  const setGroupPool = useCallback((groupKey: string, voicePool: VoicePool) => {
    setPoolDrafts(current => ({
      ...current,
      [groupKey]: voicePool,
    }));
  }, []);

  const toggleGroupExpanded = useCallback((groupKey: string) => {
    setExpandedGroupKeys(current => {
      const next = new Set(current);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  }, []);

  const saveAudioPool = useCallback(
    async (group: AudioVoiceActorGroup) => {
      if (!group.voiceActor || savingPoolKeys.has(group.key)) {
        return;
      }

      setSavingPoolKeys(current => new Set(current).add(group.key));
      try {
        const data = await requestJson<{
          success?: boolean;
          error?: string;
          data?: {affectedCount?: number};
        }>(
          `${apiBase}/api/audio/voice-actor/${encodeURIComponent(
            group.voiceActor,
          )}/pool`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              voicePool: poolDrafts[group.key] || group.configuredPool,
            }),
          },
        );

        if (!data.success) {
          throw new Error(data.error || '更新音频池失败');
        }

        await fetchAudioList();
      } catch (err) {
        console.warn('[AudioLibraryModal] 更新音频池失败', err);
        Alert.alert(
          '更新失败',
          err instanceof Error ? err.message : '更新音频池失败，请稍后重试。',
        );
      } finally {
        setSavingPoolKeys(current => {
          const next = new Set(current);
          next.delete(group.key);
          return next;
        });
      }
    },
    [apiBase, fetchAudioList, poolDrafts, savingPoolKeys],
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
    if ((Platform.OS as string) !== 'harmony') {
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
          <Text style={styles.infoDesc}>
            列表按声线聚合显示，音频池设置会同步整套情绪音频。
          </Text>
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
        {audioList.length > 0 ? (
          <View style={styles.searchCard}>
            <TextInput
              style={styles.searchInput}
              placeholder="搜索声线、情绪或参考文本"
              placeholderTextColor="#8E8E93"
              value={searchKeyword}
              onChangeText={setSearchKeyword}
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
            {searchKeyword ? (
              <TouchableOpacity
                style={styles.searchClearBtn}
                onPress={() => setSearchKeyword('')}>
                <Text style={styles.searchClearText}>清空</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </View>
    ),
    [
      audioList.length,
      fetchAudioList,
      handleUploadPress,
      isSiliconflow,
      searchKeyword,
      uploading,
    ],
  );

  const renderAudioRecord = (record: AudioOption) => {
    const previewUri = record.url
      ? record.url.startsWith('http')
        ? record.url
        : `${apiBase}${record.url}`
      : '';
    const isPending = pendingId === record.id;

    return (
      <View key={record.id} style={styles.audioDetailCard}>
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderMain}>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {record.name || '未命名音频'}
            </Text>
            <Text style={styles.cardTime}>{formatDate(record.createTime)}</Text>
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
              value={record.sampleText || ''}
              onChangeText={value =>
                updateAudioField(record.id, 'sampleText', value)
              }
            />
          </View>
        ) : null}

        <View style={styles.itemActionRow}>
          <TouchableOpacity
            style={styles.itemGhostBtn}
            disabled={isPending}
            onPress={() => deleteAudioItem(record)}>
            <Text style={styles.itemGhostBtnText}>删除</Text>
          </TouchableOpacity>
          {isSiliconflow ? (
            <TouchableOpacity
              style={styles.itemPrimaryBtn}
              disabled={isPending}
              onPress={() => saveAudioItem(record)}>
              <Text style={styles.itemPrimaryBtnText}>保存参考文本</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    );
  };

  const renderItem = ({item}: {item: AudioVoiceActorGroup}) => {
    const isExpanded = expandedGroupKeys.has(item.key);
    const isSavingPool = savingPoolKeys.has(item.key);
    const selectedPool = poolDrafts[item.key] || item.configuredPool;

    return (
      <View style={styles.voiceActorCard}>
        <TouchableOpacity
          style={styles.voiceActorHeader}
          activeOpacity={0.8}
          onPress={() => toggleGroupExpanded(item.key)}>
          <View style={styles.cardHeaderMain}>
            <Text style={styles.voiceActorTitle} numberOfLines={1}>
              {item.voiceActor || '未识别声线'}
            </Text>
            <Text style={styles.voiceActorMeta}>
              {item.records.length} 条情绪音频
            </Text>
          </View>
          <Text style={styles.expandText}>{isExpanded ? '收起' : '展开'}</Text>
        </TouchableOpacity>

        <View style={styles.groupPoolBlock}>
          <View style={styles.groupPoolHeader}>
            <Text style={styles.fieldLabel}>音频池</Text>
            {item.mixedPool ? (
              <Text style={styles.mixedPoolText}>配置不一致</Text>
            ) : null}
          </View>
          <View style={styles.poolOptionRow}>
            {VOICE_POOL_OPTIONS.map(option => {
              const active = selectedPool === option.value;
              return (
                <TouchableOpacity
                  key={option.value}
                  style={[styles.poolOption, active && styles.poolOptionActive]}
                  disabled={!item.voiceActor || isSavingPool}
                  onPress={() => setGroupPool(item.key, option.value)}>
                  <Text
                    style={[
                      styles.poolOptionText,
                      active && styles.poolOptionTextActive,
                    ]}>
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <TouchableOpacity
            style={styles.savePoolButton}
            disabled={!item.voiceActor || isSavingPool}
            onPress={() => saveAudioPool(item)}>
            {isSavingPool ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.savePoolButtonText}>保存音频池</Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.emotionsRow}>
          {item.records.map(record => (
            <View key={record.id} style={styles.emotionChip}>
              <Text style={styles.emotionChipText} numberOfLines={1}>
                {getAudioEmotion(record)}
              </Text>
            </View>
          ))}
        </View>

        {isExpanded ? (
          <View style={styles.expandedRecords}>
            {item.records.map(renderAudioRecord)}
          </View>
        ) : null}
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
                  data={filteredAudioGroups}
                  keyExtractor={item => item.key}
                  renderItem={renderItem}
                  ListHeaderComponent={listHeader}
                  ListEmptyComponent={
                    <View style={styles.searchEmptyWrap}>
                      <Text style={styles.emptyTitle}>没有找到匹配声线</Text>
                      <Text style={styles.emptyDesc}>
                        换个声线、情绪或参考文本关键词试试。
                      </Text>
                    </View>
                  }
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
  searchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: '#FFF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
  },
  searchInput: {
    flex: 1,
    color: '#1C1C1E',
    fontSize: 14,
    paddingHorizontal: 0,
    paddingVertical: 8,
  },
  searchClearBtn: {
    borderRadius: 12,
    backgroundColor: 'rgba(0,122,255,0.12)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginLeft: 8,
  },
  searchClearText: {
    color: '#007AFF',
    fontSize: 12,
    fontWeight: '700',
  },
  voiceActorCard: {
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
  voiceActorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  voiceActorTitle: {
    color: '#1C1C1E',
    fontSize: 17,
    fontWeight: '700',
  },
  voiceActorMeta: {
    color: '#8E8E93',
    fontSize: 12,
    marginTop: 4,
  },
  expandText: {
    color: '#007AFF',
    fontSize: 13,
    fontWeight: '600',
  },
  groupPoolBlock: {
    marginBottom: 12,
  },
  groupPoolHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  mixedPoolText: {
    color: '#9A5B00',
    fontSize: 11,
    marginBottom: 8,
  },
  savePoolButton: {
    minHeight: 38,
    borderRadius: 10,
    backgroundColor: '#007AFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  savePoolButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  emotionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 4,
  },
  emotionChip: {
    maxWidth: 110,
    borderRadius: 12,
    backgroundColor: '#F2F2F7',
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  emotionChipText: {
    color: '#636366',
    fontSize: 11,
  },
  expandedRecords: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#D1D1D6',
    marginTop: 12,
  },
  audioDetailCard: {
    paddingTop: 12,
    marginTop: 12,
    borderRadius: 12,
    backgroundColor: '#F8F8FA',
    paddingHorizontal: 12,
    paddingBottom: 12,
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
  poolOptionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  poolOption: {
    flex: 1,
    borderRadius: 10,
    backgroundColor: '#F2F2F7',
    borderWidth: 1,
    borderColor: 'transparent',
    paddingVertical: 10,
    alignItems: 'center',
  },
  poolOptionActive: {
    backgroundColor: 'rgba(0,122,255,0.12)',
    borderColor: 'rgba(0,122,255,0.35)',
  },
  poolOptionText: {
    color: '#636366',
    fontSize: 13,
    fontWeight: '600',
  },
  poolOptionTextActive: {
    color: '#007AFF',
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
  searchEmptyWrap: {
    borderRadius: 12,
    backgroundColor: '#FFF',
    paddingHorizontal: 20,
    paddingVertical: 24,
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
