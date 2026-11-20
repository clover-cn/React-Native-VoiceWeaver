import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type {parseBrowserArticle} from '../utils/browserArticle';

export type CollectedPage = ReturnType<typeof parseBrowserArticle>;

interface ToolbarProps {
  count: number;
  message: string;
  collecting: boolean;
  loading: boolean;
  onOpen: () => void;
  onCollect: () => void;
  onImport: () => void;
}

export function NovelPageToolbar({
  count,
  message,
  collecting,
  loading,
  onOpen,
  onCollect,
  onImport,
}: ToolbarProps) {
  const unavailable = count === 0 || collecting;
  return (
    <>
      <View style={styles.statusRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`已收集 ${count} 页`}
          disabled={unavailable}
          onPress={onOpen}
          style={styles.countChip}>
          <Text style={styles.countText}>
            已收集 {count} 页{count > 0 ? ' ›' : ''}
          </Text>
        </Pressable>
        <Text accessibilityLiveRegion="polite" style={styles.statusMessage}>
          {message || (count ? '可翻页后继续收集' : '展开全文后收集')}
        </Text>
      </View>
      <View style={styles.actionRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="收集当前页"
          disabled={loading || collecting}
          onPress={onCollect}
          style={[
            styles.action,
            styles.collect,
            (loading || collecting) && styles.disabled,
          ]}>
          {collecting ? (
            <ActivityIndicator size="small" color="#92400E" />
          ) : (
            <Text style={styles.collectText}>收集当前页</Text>
          )}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="导入章节"
          disabled={unavailable}
          onPress={onImport}
          style={[
            styles.action,
            styles.import,
            unavailable && styles.disabled,
          ]}>
          <Text style={styles.importText}>导入章节</Text>
        </Pressable>
      </View>
    </>
  );
}

interface PanelProps {
  pages: CollectedPage[];
  onClose: () => void;
  onMove: (index: number, offset: number) => void;
  onRemove: (index: number) => void;
}

export function NovelPagePanel({pages, onClose, onMove, onRemove}: PanelProps) {
  return (
    <View style={styles.overlay} accessibilityViewIsModal>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="关闭收集清单"
        style={StyleSheet.absoluteFill}
        onPress={onClose}
      />
      <View style={styles.panel}>
        <View style={styles.panelHeader}>
          <Text accessibilityRole="header" style={styles.panelTitle}>
            已收集 {pages.length} 页
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={styles.rowButton}>
            <Text style={styles.link}>完成</Text>
          </Pressable>
        </View>
        <FlatList
          style={styles.list}
          data={pages}
          keyExtractor={(_, index) => String(index)}
          ListEmptyComponent={
            <Text style={styles.empty}>还没有页面，返回网页继续收集。</Text>
          }
          renderItem={({item, index}) => (
            <View style={styles.pageCard}>
              <View style={styles.pageHeading}>
                <Text style={styles.pageNumber}>{index + 1}</Text>
                <Text numberOfLines={1} style={styles.pageTitle}>
                  {item.title || '未命名网页'}
                </Text>
              </View>
              <Text numberOfLines={2} style={styles.excerpt}>
                {item.text.slice(0, 180).replace(/\s+/g, ' ')}
              </Text>
              <View style={styles.pageControls}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`上移第 ${index + 1} 页`}
                  disabled={index === 0}
                  onPress={() => onMove(index, -1)}
                  style={[styles.rowButton, index === 0 && styles.disabled]}>
                  <Text style={styles.link}>↑ 上移</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`下移第 ${index + 1} 页`}
                  disabled={index === pages.length - 1}
                  onPress={() => onMove(index, 1)}
                  style={[
                    styles.rowButton,
                    index === pages.length - 1 && styles.disabled,
                  ]}>
                  <Text style={styles.link}>↓ 下移</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`移除第 ${index + 1} 页`}
                  onPress={() => onRemove(index)}
                  style={styles.rowButton}>
                  <Text style={styles.removeText}>移除</Text>
                </Pressable>
              </View>
            </View>
          )}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  statusRow: {flexDirection: 'row', alignItems: 'center', marginBottom: 7},
  countChip: {
    minHeight: 32,
    justifyContent: 'center',
    borderRadius: 16,
    paddingHorizontal: 11,
    backgroundColor: '#F5EADD',
  },
  countText: {color: '#854014', fontSize: 13, fontWeight: '700'},
  statusMessage: {marginLeft: 9, flex: 1, color: '#655B52', fontSize: 12},
  actionRow: {flexDirection: 'row'},
  action: {
    flex: 1,
    minHeight: 44,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  collect: {
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#D8B995',
    backgroundColor: '#FFF9F1',
  },
  collectText: {fontSize: 15, fontWeight: '700', color: '#92400E'},
  import: {backgroundColor: '#B45309'},
  importText: {fontSize: 15, fontWeight: '700', color: '#FFF'},
  disabled: {opacity: 0.45},
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    elevation: 12,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(41, 31, 24, 0.42)',
  },
  panel: {
    maxHeight: '78%',
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 14,
    backgroundColor: '#F8F6F0',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  panelTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#29211C',
    flexShrink: 1,
  },
  list: {flexGrow: 0, flexShrink: 1},
  pageCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E8DED2',
    backgroundColor: '#FFF',
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  pageHeading: {flexDirection: 'row', alignItems: 'center'},
  pageNumber: {
    minWidth: 24,
    paddingHorizontal: 5,
    paddingVertical: 3,
    borderRadius: 7,
    backgroundColor: '#F5EADD',
    textAlign: 'center',
    color: '#92400E',
    fontWeight: '700',
  },
  pageTitle: {
    flex: 1,
    marginLeft: 8,
    color: '#29211C',
    fontSize: 14,
    fontWeight: '700',
  },
  excerpt: {color: '#655B52', fontSize: 13, lineHeight: 19, marginTop: 6},
  pageControls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  rowButton: {minHeight: 44, justifyContent: 'center', paddingHorizontal: 10},
  link: {color: '#92400E', fontSize: 13, fontWeight: '600'},
  removeText: {color: '#9F231C', fontSize: 13, fontWeight: '600'},
  empty: {paddingVertical: 18, color: '#655B52', fontSize: 14},
});
