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
    <View style={styles.toolbarContainer}>
      {/* 顶部通栏状态卡片 */}
      <View style={styles.statusCard}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`已收集 ${count} 页，点击查看管理清单`}
          disabled={count === 0}
          onPress={onOpen}
          style={({pressed}) => [
            styles.statusLeftChip,
            count > 0 && styles.statusLeftChipActive,
            pressed && count > 0 && styles.chipPressed,
          ]}>
          <View
            style={[
              styles.docIconMini,
              count === 0 && styles.docIconMiniDisabled,
            ]}>
            <View
              style={[
                styles.docIconMiniLine,
                count === 0 && styles.docIconMiniLineDisabled,
              ]}
            />
          </View>
          <Text style={[styles.countText, count > 0 && styles.countTextActive]}>
            已收集 {count} 页
          </Text>
          {count > 0 && <Text style={styles.countChevron}>管理 ›</Text>}
        </Pressable>

        <Text
          accessibilityLiveRegion="polite"
          numberOfLines={1}
          style={styles.statusMessage}>
          {message || (count ? '可翻页后继续收集' : '展开全文后收集')}
        </Text>
      </View>

      {/* 底部主次分明操作双按钮 */}
      <View style={styles.actionRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="收集当前页"
          disabled={loading || collecting}
          onPress={onCollect}
          style={({pressed}) => [
            styles.action,
            styles.collect,
            (loading || collecting) && styles.disabled,
            pressed && !(loading || collecting) && styles.actionPressed,
          ]}>
          {collecting ? (
            <ActivityIndicator size="small" color="#B45309" />
          ) : (
            <View style={styles.btnContentRow}>
              <Text style={styles.collectText}>收集当前页</Text>
            </View>
          )}
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            count > 0 ? `导入章节，共 ${count} 页` : '导入章节'
          }
          disabled={unavailable}
          onPress={onImport}
          style={({pressed}) => [
            styles.action,
            styles.import,
            unavailable && styles.importDisabled,
            pressed && !unavailable && styles.actionPressed,
          ]}>
          <Text
            style={[
              styles.importText,
              unavailable && styles.importTextDisabled,
            ]}>
            {count > 0 ? `导入章节 (${count}页)` : '导入章节'}
          </Text>
        </Pressable>
      </View>
    </View>
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
  toolbarContainer: {
    width: '100%',
  },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FAF5ED',
    borderWidth: 1,
    borderColor: '#EFE8DE',
    borderRadius: 14,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginBottom: 10,
  },
  statusLeftChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: 'transparent',
  },
  statusLeftChipActive: {
    backgroundColor: 'rgba(217, 119, 6, 0.1)',
  },
  chipPressed: {
    opacity: 0.7,
  },
  docIconMini: {
    width: 12,
    height: 14,
    borderWidth: 1.2,
    borderColor: '#B45309',
    borderRadius: 2,
    marginRight: 6,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 1,
  },
  docIconMiniDisabled: {
    borderColor: '#A8A29E',
  },
  docIconMiniLine: {
    width: 6,
    height: 1.2,
    backgroundColor: '#B45309',
    borderRadius: 0.6,
  },
  docIconMiniLineDisabled: {
    backgroundColor: '#A8A29E',
  },
  countText: {
    color: '#78716C',
    fontSize: 12.5,
    fontWeight: '600',
  },
  countTextActive: {
    color: '#B45309',
    fontWeight: '700',
  },
  countChevron: {
    color: '#D97706',
    fontSize: 11,
    fontWeight: '700',
    marginLeft: 4,
  },
  statusMessage: {
    marginLeft: 8,
    flex: 1,
    color: '#78716C',
    fontSize: 12,
    textAlign: 'right',
    paddingRight: 4,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  action: {
    flex: 1,
    minHeight: 46,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
  },
  actionPressed: {
    opacity: 0.85,
    transform: [{scale: 0.985}],
  },
  btnContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  collect: {
    borderWidth: 1.2,
    borderColor: '#D97706',
    backgroundColor: '#FAF5ED',
    shadowColor: '#D97706',
    shadowOffset: {width: 0, height: 1.5},
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 1,
  },
  collectText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#B45309',
  },
  import: {
    backgroundColor: '#D97706',
    shadowColor: '#D97706',
    shadowOffset: {width: 0, height: 3},
    shadowOpacity: 0.28,
    shadowRadius: 6,
    elevation: 4,
  },
  importDisabled: {
    backgroundColor: '#E7E2DA',
    shadowOpacity: 0,
    elevation: 0,
  },
  importText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  importTextDisabled: {
    color: '#A8A29E',
  },
  disabled: {
    opacity: 0.45,
  },
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
