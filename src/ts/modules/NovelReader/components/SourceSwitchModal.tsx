import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  SafeAreaView,
} from 'react-native';
import { Book } from '../types/reader';

interface SourceSwitchModalProps {
  visible: boolean;
  currentBook: Book | null;
  onClose: () => void;
  onSourceSelect: (source: any) => void;
  apiBase: string;
}

export const SourceSwitchModal: React.FC<SourceSwitchModalProps> = ({
  visible,
  currentBook,
  onClose,
  onSourceSelect,
  apiBase,
}) => {
  const [sources, setSources] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible && currentBook) {
      fetchSources();
    }
  }, [visible, currentBook]);

  const fetchSources = async () => {
    setLoading(true);
    setError(null);
    try {
      const targetUrl = `${apiBase}/api/reader/searchBookSource?url=${encodeURIComponent(
        currentBook?.bookUrl || ''
      )}&lastIndex=0`;
      const response = await fetch(targetUrl);
      const data = await response.json();
      if (data.isSuccess && data.data && data.data.list) {
        setSources(data.data.list);
      } else {
        setError('获取书源失败，请稍后重试');
      }
    } catch (e) {
      console.warn('获取书源失败', e);
      setError('获取书源异常：网络错误或超时');
    } finally {
      setLoading(false);
    }
  };

  const renderItem = ({ item }: { item: any }) => {
    const isCurrent = item.bookUrl === currentBook?.bookUrl;

    return (
      <TouchableOpacity
        style={[styles.sourceItem, isCurrent && styles.activeSourceItem]}
        onPress={() => {
          if (!isCurrent) {
            onSourceSelect(item);
          }
        }}>
        <View style={styles.sourceHeader}>
          <Text style={[styles.sourceName, isCurrent && styles.activeText]}>
            {item.originName || '未知书源'}
          </Text>
          {isCurrent && <Text style={styles.currentTag}>当前正在使用</Text>}
        </View>
        <Text style={styles.latestChapter} numberOfLines={1}>
          最新章: {item.latestChapterTitle || '无'}
        </Text>
      </TouchableOpacity>
    );
  };

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
              <Text style={styles.title}>切换书源</Text>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <Text style={styles.closeText}>关闭</Text>
              </TouchableOpacity>
            </View>

            {loading ? (
              <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color="#007AFF" />
                <Text style={styles.loadingText}>正在为您搜索所有书源...</Text>
              </View>
            ) : error ? (
              <View style={styles.centerContainer}>
                <Text style={styles.errorText}>{error}</Text>
                <TouchableOpacity style={styles.retryBtn} onPress={fetchSources}>
                  <Text style={styles.retryText}>重新获取</Text>
                </TouchableOpacity>
              </View>
            ) : sources.length === 0 ? (
              <View style={styles.centerContainer}>
                <Text style={styles.emptyText}>没有找到其他可用的书源</Text>
              </View>
            ) : (
              <FlatList
                data={sources}
                keyExtractor={(item, index) => item.bookUrl || String(index)}
                renderItem={renderItem}
                contentContainerStyle={styles.listContent}
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
    height: '75%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
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
  sourceItem: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  activeSourceItem: {
    borderColor: '#007AFF',
    borderWidth: 1.5,
    backgroundColor: '#F0F8FF',
  },
  sourceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sourceName: {
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
  latestChapter: {
    fontSize: 13,
    color: '#8E8E93',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 14,
    color: '#8E8E93',
  },
  errorText: {
    fontSize: 15,
    color: '#FF3B30',
    marginBottom: 16,
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
  emptyText: {
    fontSize: 15,
    color: '#8E8E93',
  },
});

export default SourceSwitchModal;
