import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  SafeAreaView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import bridge from '../../base/utils/bridge';
import LocalBookSourceService from '../bookSource/LocalBookSourceService';
import {LegadoBookSource} from '../bookSource/types';
import {
  buildBookSourceExportFileName,
  buildExportBookSourceJson,
  deleteUserBookSource,
  importUserBookSourcesFromJson,
  loadUserBookSourceRecords,
  saveUserBookSourceValidation,
  setUserBookSourceEnabled,
  UserBookSourceRecord,
} from '../bookSource/userBookSourceStorage';

interface BookSourceManagerModalProps {
  visible: boolean;
  onClose: () => void;
  onSourcesChanged?: () => void;
}

interface NativeJsonSelectionResult {
  cancelled?: boolean;
  error?: string;
  name?: string;
  size?: number;
  content?: string;
}

interface NativeJsonExportResult {
  success?: boolean;
  cancelled?: boolean;
  uri?: string;
  error?: string;
}

const formatDate = (timestamp?: number) => {
  if (!timestamp) {
    return '未知时间';
  }

  const date = new Date(timestamp);
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

const parseNativeJsonResult = <T,>(payload: string, fallbackError: string) => {
  try {
    return JSON.parse(payload) as T;
  } catch (_error) {
    throw new Error(fallbackError);
  }
};

const BookSourceManagerModal: React.FC<BookSourceManagerModalProps> = ({
  visible,
  onClose,
  onSourcesChanged,
}) => {
  const [records, setRecords] = useState<UserBookSourceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [validationKeyword, setValidationKeyword] = useState('');
  const [validatingUrls, setValidatingUrls] = useState<string[]>([]);
  const [validatingAll, setValidatingAll] = useState(false);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      setRecords(await loadUserBookSourceRecords());
    } catch (error) {
      console.warn('[BookSourceManagerModal] 获取书源列表失败', error);
      Alert.alert('加载失败', '获取已导入书源失败。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      fetchRecords();
    }
  }, [fetchRecords, visible]);

  const notifySourcesChanged = useCallback(() => {
    onSourcesChanged?.();
  }, [onSourcesChanged]);

  const setUrlValidating = useCallback(
    (bookSourceUrl: string, active: boolean) => {
      setValidatingUrls(current => {
        if (active) {
          return current.includes(bookSourceUrl)
            ? current
            : [...current, bookSourceUrl];
        }
        return current.filter(item => item !== bookSourceUrl);
      });
    },
    [],
  );

  const handleToggleEnabled = useCallback(
    async (source: LegadoBookSource, enabled: boolean) => {
      setPendingUrl(source.bookSourceUrl);
      try {
        const nextRecords = await setUserBookSourceEnabled(
          source.bookSourceUrl,
          enabled,
        );
        setRecords(nextRecords);
        notifySourcesChanged();
      } catch (error) {
        Alert.alert(
          '更新失败',
          error instanceof Error ? error.message : '更新书源状态失败。',
        );
      } finally {
        setPendingUrl(null);
      }
    },
    [notifySourcesChanged],
  );

  const validateRecord = useCallback(
    async (record: UserBookSourceRecord) => {
      const keyword = validationKeyword.trim();
      if (!keyword) {
        Alert.alert('请输入关键词', '请输入一个用于校验搜索的关键词。');
        return null;
      }

      const bookSourceUrl = record.source.bookSourceUrl;
      setUrlValidating(bookSourceUrl, true);
      try {
        const result = await LocalBookSourceService.validateBookSource(
          bookSourceUrl,
          keyword,
        );
        const nextRecords = await saveUserBookSourceValidation(
          bookSourceUrl,
          result,
        );
        setRecords(nextRecords);
        return result;
      } catch (error) {
        const result = {
          sourceId: bookSourceUrl,
          sourceName: record.source.bookSourceName,
          ok: false,
          status: 'failed' as const,
          stage: 'exception',
          message: error instanceof Error ? error.message : '书源校验失败。',
          resultCount: 0,
          validatedAt: Date.now(),
        };
        const nextRecords = await saveUserBookSourceValidation(
          bookSourceUrl,
          result,
        );
        setRecords(nextRecords);
        return result;
      } finally {
        setUrlValidating(bookSourceUrl, false);
      }
    },
    [setUrlValidating, validationKeyword],
  );

  const handleValidateAll = useCallback(async () => {
    if (!validationKeyword.trim()) {
      Alert.alert('请输入关键词', '请输入一个用于校验搜索的关键词。');
      return;
    }
    if (records.length === 0 || validatingAll) {
      return;
    }

    setValidatingAll(true);
    let okCount = 0;
    let failedCount = 0;
    try {
      for (const record of records) {
        const result = await validateRecord(record);
        if (!result) {
          continue;
        }
        if (result.ok) {
          okCount += 1;
        } else {
          failedCount += 1;
        }
      }
      Alert.alert(
        '校验完成',
        `可用 ${okCount} 个，失败 ${failedCount} 个。失败书源可在列表中手动禁用或删除。`,
      );
    } finally {
      setValidatingAll(false);
    }
  }, [records, validateRecord, validatingAll, validationKeyword]);

  const pickJsonDocument = useCallback(async () => {
    const payload = await new Promise<string>((resolve, reject) => {
      try {
        bridge.selectJsonDocument(result => {
          resolve(result || '');
        });
      } catch (error) {
        reject(error);
      }
    });

    if (!payload) {
      throw new Error('文件选择结果为空');
    }

    const result = parseNativeJsonResult<NativeJsonSelectionResult>(
      payload,
      'JSON 文件选择结果解析失败',
    );

    if (result.cancelled) {
      if (result.error) {
        throw new Error(result.error);
      }
      return null;
    }

    if (!result.content) {
      throw new Error('选中的 JSON 文件内容为空');
    }

    return result;
  }, []);

  const handleImportPress = useCallback(async () => {
    if ((Platform.OS as string) !== 'harmony') {
      Alert.alert('暂未实现', '当前仅支持鸿蒙端导入 JSON 文件。');
      return;
    }

    if (importing) {
      return;
    }

    setImporting(true);
    try {
      const selectedFile = await pickJsonDocument();
      if (!selectedFile) {
        return;
      }

      const result = await importUserBookSourcesFromJson(
        selectedFile.content || '',
      );
      setRecords(result.records);
      notifySourcesChanged();
      Alert.alert(
        '导入完成',
        `新增 ${result.importedCount} 个，更新 ${result.updatedCount} 个，跳过 ${result.skippedCount} 个。`,
      );
    } catch (error) {
      console.warn('[BookSourceManagerModal] 导入书源失败', error);
      Alert.alert(
        '导入失败',
        error instanceof Error ? error.message : '导入书源失败。',
      );
    } finally {
      setImporting(false);
    }
  }, [importing, notifySourcesChanged, pickJsonDocument]);

  const handleExportPress = useCallback(async (source: LegadoBookSource) => {
    if ((Platform.OS as string) !== 'harmony') {
      Alert.alert('暂未实现', '当前仅支持鸿蒙端导出 JSON 文件。');
      return;
    }

    const payload = JSON.stringify({
      fileName: buildBookSourceExportFileName(source),
      content: buildExportBookSourceJson(source),
    });

    setPendingUrl(source.bookSourceUrl);
    try {
      const resultText = await new Promise<string>((resolve, reject) => {
        try {
          bridge.exportJsonDocument(payload, result => {
            resolve(result || '');
          });
        } catch (error) {
          reject(error);
        }
      });

      const result = parseNativeJsonResult<NativeJsonExportResult>(
        resultText,
        '导出结果解析失败',
      );
      if (result.cancelled) {
        return;
      }
      if (!result.success) {
        throw new Error(result.error || '导出书源失败');
      }
      Alert.alert('导出成功', '书源 JSON 文件已保存。');
    } catch (error) {
      console.warn('[BookSourceManagerModal] 导出书源失败', error);
      Alert.alert(
        '导出失败',
        error instanceof Error ? error.message : '导出书源失败。',
      );
    } finally {
      setPendingUrl(null);
    }
  }, []);

  const handleDeletePress = useCallback(
    (record: UserBookSourceRecord) => {
      Alert.alert(
        '删除书源',
        `确定删除“${record.source.bookSourceName}”吗？删除后它将不再参与搜索和换源。`,
        [
          {text: '取消', style: 'cancel'},
          {
            text: '删除',
            style: 'destructive',
            onPress: async () => {
              setPendingUrl(record.source.bookSourceUrl);
              try {
                const nextRecords = await deleteUserBookSource(
                  record.source.bookSourceUrl,
                );
                setRecords(nextRecords);
                notifySourcesChanged();
              } catch (error) {
                Alert.alert(
                  '删除失败',
                  error instanceof Error ? error.message : '删除书源失败。',
                );
              } finally {
                setPendingUrl(null);
              }
            },
          },
        ],
      );
    },
    [notifySourcesChanged],
  );

  const listHeader = useMemo(
    () => (
      <View style={styles.listHeaderWrap}>
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>本地书源管理</Text>
          <Text style={styles.infoDesc}>
            导入后的书源会参与搜索、换源和章节解析。
          </Text>
        </View>
        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.secondaryBtn} onPress={fetchRecords}>
            <Text style={styles.secondaryBtnText}>刷新列表</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.primaryBtn}
            disabled={importing}
            onPress={handleImportPress}>
            {importing ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryBtnText}>导入书源</Text>
            )}
          </TouchableOpacity>
        </View>
        <View style={styles.validationCard}>
          <Text style={styles.validationTitle}>书源校验</Text>
          <TextInput
            value={validationKeyword}
            onChangeText={setValidationKeyword}
            placeholder="输入校验关键词，如 斗破苍穹"
            placeholderTextColor="#8E8E93"
            style={styles.validationInput}
            returnKeyType="search"
          />
          <View style={styles.validationActionRow}>
            <TouchableOpacity
              style={[
                styles.secondaryBtn,
                (validatingAll || records.length === 0) && styles.disabledBtn,
              ]}
              disabled={validatingAll || records.length === 0}
              onPress={handleValidateAll}>
              {validatingAll ? (
                <ActivityIndicator size="small" color="#1C1C1E" />
              ) : (
                <Text style={styles.secondaryBtnText}>校验全部</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    ),
    [
      fetchRecords,
      handleImportPress,
      handleValidateAll,
      importing,
      records.length,
      validationKeyword,
      validatingAll,
    ],
  );

  const renderItem = ({item}: {item: UserBookSourceRecord}) => {
    const source = item.source;
    const isPending = pendingUrl === source.bookSourceUrl;
    const isValidating = validatingUrls.includes(source.bookSourceUrl);
    const isEnabled = source.enabled !== false;
    const validationStatus = isValidating
      ? 'checking'
      : item.validationStatus || 'unknown';
    const validationMessage =
      validationStatus === 'checking'
        ? '正在校验...'
        : item.validationMessage || '尚未校验';
    const validationOk = validationStatus === 'ok';
    const validationFailed = validationStatus === 'failed';

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderMain}>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {source.bookSourceName || '未命名书源'}
            </Text>
            <Text style={styles.cardMeta} numberOfLines={1}>
              {source.bookSourceGroup || '未分组'} ·{' '}
              {formatDate(item.importedAt)}
            </Text>
          </View>
          <View style={styles.enabledWrap}>
            {isPending ? (
              <ActivityIndicator size="small" color="#007AFF" />
            ) : (
              <View style={styles.enabledControl}>
                <Text
                  style={[
                    styles.enabledText,
                    !isEnabled && styles.disabledText,
                  ]}>
                  {isEnabled ? '启用' : '停用'}
                </Text>
                <Switch
                  value={isEnabled}
                  disabled={isPending}
                  onValueChange={value => handleToggleEnabled(source, value)}
                  trackColor={{false: '#D1D1D6', true: '#BBD7FF'}}
                  thumbColor={isEnabled ? '#007AFF' : '#F4F4F4'}
                />
              </View>
            )}
          </View>
        </View>

        <Text style={styles.sourceUrl} numberOfLines={2}>
          {source.bookSourceUrl}
        </Text>

        <View
          style={[
            styles.validationStatus,
            validationOk && styles.validationStatusOk,
            validationFailed && styles.validationStatusFailed,
          ]}>
          <Text
            style={[
              styles.validationStatusText,
              validationOk && styles.validationStatusTextOk,
              validationFailed && styles.validationStatusTextFailed,
            ]}
            numberOfLines={2}>
            {validationOk
              ? `可用 · ${item.validationResultCount || 0} 条结果`
              : validationFailed
              ? `失败 · ${validationMessage}`
              : validationMessage}
          </Text>
          {item.lastValidatedAt && !isValidating ? (
            <Text style={styles.validationTime}>
              {formatDate(item.lastValidatedAt)}
            </Text>
          ) : null}
        </View>

        <View style={styles.itemActionRow}>
          <TouchableOpacity
            style={styles.itemGhostBtn}
            disabled={isPending}
            onPress={() => handleDeletePress(item)}>
            <Text style={styles.itemGhostBtnText}>删除</Text>
          </TouchableOpacity>
          {validationFailed && isEnabled ? (
            <TouchableOpacity
              style={styles.itemWarnBtn}
              disabled={isPending}
              onPress={() => handleToggleEnabled(source, false)}>
              <Text style={styles.itemWarnBtnText}>禁用</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={styles.itemPrimaryBtn}
            disabled={isPending || isValidating}
            onPress={() => validateRecord(item)}>
            {isValidating ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.itemPrimaryBtnText}>校验</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.itemPrimaryBtn}
            disabled={isPending}
            onPress={() => handleExportPress(source)}>
            <Text style={styles.itemPrimaryBtnText}>导出</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
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
              <Text style={styles.title}>书源管理</Text>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <Text style={styles.closeText}>关闭</Text>
              </TouchableOpacity>
            </View>

            {loading ? (
              <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color="#007AFF" />
                <Text style={styles.statusText}>正在加载书源列表...</Text>
              </View>
            ) : records.length === 0 ? (
              <View style={styles.emptyContainer}>
                {listHeader}
                <View style={styles.emptyWrap}>
                  <Text style={styles.emptyTitle}>暂无导入书源</Text>
                  <Text style={styles.emptyDesc}>
                    点击上方导入书源，导入成功后这里会自动展示。
                  </Text>
                </View>
              </View>
            ) : (
              <FlatList
                data={records}
                keyExtractor={item => item.source.bookSourceUrl}
                renderItem={renderItem}
                ListHeaderComponent={listHeader}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
              />
            )}
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
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 8,
  },
  validationCard: {
    borderRadius: 12,
    backgroundColor: '#FFF',
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 8,
  },
  validationTitle: {
    color: '#1C1C1E',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 10,
  },
  validationInput: {
    minHeight: 42,
    borderRadius: 8,
    backgroundColor: '#F2F2F7',
    color: '#1C1C1E',
    fontSize: 14,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  validationActionRow: {
    flexDirection: 'row',
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
  disabledBtn: {
    opacity: 0.55,
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
  cardMeta: {
    color: '#8E8E93',
    fontSize: 12,
    marginTop: 4,
  },
  sourceUrl: {
    borderRadius: 12,
    backgroundColor: '#F2F2F7',
    color: '#636366',
    fontSize: 12,
    lineHeight: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  enabledWrap: {
    minWidth: 82,
    alignItems: 'flex-end',
  },
  enabledControl: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  enabledText: {
    color: '#007AFF',
    fontSize: 12,
    fontWeight: '700',
  },
  disabledText: {
    color: '#8E8E93',
  },
  validationStatus: {
    borderRadius: 8,
    backgroundColor: '#F2F2F7',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  validationStatusOk: {
    backgroundColor: 'rgba(52, 199, 89, 0.12)',
  },
  validationStatusFailed: {
    backgroundColor: '#FFF5F5',
  },
  validationStatusText: {
    color: '#636366',
    fontSize: 12,
    lineHeight: 17,
  },
  validationStatusTextOk: {
    color: '#248A3D',
    fontWeight: '700',
  },
  validationStatusTextFailed: {
    color: '#FF3B30',
    fontWeight: '700',
  },
  validationTime: {
    color: '#8E8E93',
    fontSize: 11,
    marginTop: 4,
  },
  itemActionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
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
  itemWarnBtn: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: '#FFF3D6',
    paddingVertical: 12,
    alignItems: 'center',
  },
  itemWarnBtnText: {
    color: '#B76E00',
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
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  statusText: {
    marginTop: 16,
    fontSize: 14,
    color: '#8E8E93',
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
});

export default BookSourceManagerModal;
