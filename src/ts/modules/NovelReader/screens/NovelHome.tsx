import React, {useEffect, useState} from 'react';
import {
  ActivityIndicator,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Platform,
  Image,
  Alert,
  ScrollView,
} from 'react-native';
import {ReadingRecord} from '../utils/readerStorage';
import {useDebug} from '../debug';

interface NovelHomeProps {
  onNavigateSearch: () => void;
  onImportBook: () => void;
  onManageBookSources: () => void;
  isImporting?: boolean;
  readingRecords: ReadingRecord[];
  onResumeReading: (record: ReadingRecord) => void;
  onRemoveRecord: (bookUrl: string) => void;
}

const NovelHome: React.FC<NovelHomeProps> = ({
  onNavigateSearch,
  onImportBook,
  onManageBookSources,
  isImporting = false,
  readingRecords,
  onResumeReading,
  onRemoveRecord,
}) => {
  const debugCtx = useDebug();
  const [isFloatingMenuOpen, setIsFloatingMenuOpen] = useState(false);

  useEffect(() => {
    if (isImporting) {
      setIsFloatingMenuOpen(false);
    }
  }, [isImporting]);

  const handleLongPress = (record: ReadingRecord) => {
    Alert.alert('从书架删除', `确定要从书架中删除《${record.book.name}》吗？`, [
      {text: '取消', style: 'cancel'},
      {
        text: '删除',
        style: 'destructive',
        onPress: () => onRemoveRecord(record.book.bookUrl),
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => debugCtx.registerTap()}
            activeOpacity={1.0}>
            <Text style={styles.greeting}>下午好，阅读爱好者</Text>
          </TouchableOpacity>
          <Text style={styles.subGreeting}>今天想听点什么？</Text>
        </View>

        <TouchableOpacity
          style={styles.searchBar}
          onPress={onNavigateSearch}
          activeOpacity={0.9}>
          <Text style={styles.searchPlaceholder}>
            🔍 搜索你想阅读或听书的小说...
          </Text>
        </TouchableOpacity>

        <Text style={styles.sectionTitle}>我的书架</Text>
        {readingRecords.length > 0 ? (
          readingRecords.map(record => {
            const book = record.book;
            const chapter = record.currentChapter;
            return (
              <TouchableOpacity
                key={book.bookUrl}
                style={styles.bookCard}
                onPress={() => onResumeReading(record)}
                onLongPress={() => handleLongPress(record)}
                delayLongPress={400}
                activeOpacity={0.8}>
                {book.coverUrl ? (
                  <Image
                    source={{uri: book.coverUrl}}
                    style={styles.coverImage}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={styles.coverPlaceholder}>
                    <Text style={styles.coverText}>{book.name[0]}</Text>
                  </View>
                )}
                <View style={styles.bookInfo}>
                  <Text style={styles.bookTitle} numberOfLines={1}>
                    {book.name}
                  </Text>
                  <Text style={styles.bookAuthor}>{book.author}</Text>
                  <Text style={styles.bookIntro} numberOfLines={2}>
                    {chapter?.title || book.intro || '已记录上次阅读进度'}
                  </Text>
                  <Text style={styles.recordMeta} numberOfLines={1}>
                    {book.sourceType === 'local_txt'
                      ? '本地 TXT · 支持离线观看'
                      : `上次阅读地址: ${record.contentRequest.url}`}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>书架还是空的</Text>
            <Text style={styles.emptyDesc}>
              点击右下角菜单导入 TXT 小说，或搜索一本书开始阅读。
            </Text>
          </View>
        )}
      </ScrollView>

      {isFloatingMenuOpen && (
        <TouchableOpacity
          style={styles.menuBackdrop}
          activeOpacity={1}
          onPress={() => setIsFloatingMenuOpen(false)}
          accessibilityLabel="关闭悬浮菜单"
        />
      )}

      <View style={styles.floatingMenu}>
        {isFloatingMenuOpen ? (
          <View style={styles.menuItemsWrap}>
            <TouchableOpacity
              style={styles.menuItem}
              activeOpacity={0.8}
              onPress={() => {
                setIsFloatingMenuOpen(false);
                onManageBookSources();
              }}
              accessibilityRole="button"
              accessibilityLabel="书源管理">
              <Text style={styles.menuItemIcon}>源</Text>
              <Text style={styles.menuItemText}>书源管理</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              activeOpacity={0.8}
              onPress={() => {
                setIsFloatingMenuOpen(false);
                onImportBook();
              }}
              disabled={isImporting}
              accessibilityRole="button"
              accessibilityLabel="导入书籍">
              <Text style={styles.menuItemIcon}>＋</Text>
              <Text style={styles.menuItemText}>
                {isImporting ? '导入中…' : '导入书籍'}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <TouchableOpacity
          style={styles.floatingButton}
          activeOpacity={0.85}
          disabled={isImporting}
          onPress={() => setIsFloatingMenuOpen(open => !open)}
          accessibilityRole="button"
          accessibilityLabel={isFloatingMenuOpen ? '关闭菜单' : '打开菜单'}>
          <Text
            style={[
              styles.floatingButtonText,
              isFloatingMenuOpen && styles.floatingButtonTextOpen,
            ]}>
            {isFloatingMenuOpen ? '×' : '＋'}
          </Text>
        </TouchableOpacity>
      </View>

      {isImporting ? (
        <View
          style={styles.importingOverlay}
          accessibilityRole="progressbar"
          accessibilityLabel="导入中">
          <View style={styles.importingPanel}>
            <ActivityIndicator size="large" color="#007AFF" />
            <Text style={styles.importingTitle}>导入中</Text>
            <Text style={styles.importingDesc}>正在解析本地 TXT 小说…</Text>
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7', // iOS系统级灰白底层
  },
  scrollContent: {
    paddingBottom: 112,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'ios' ? 20 : 40,
    paddingBottom: 16,
  },
  greeting: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#000',
  },
  subGreeting: {
    fontSize: 16,
    color: '#8E8E93',
    marginTop: 4,
  },
  searchBar: {
    marginHorizontal: 24,
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 20,
    marginBottom: 32,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 3,
  },
  searchPlaceholder: {
    color: '#8E8E93',
    fontSize: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginHorizontal: 24,
    marginBottom: 16,
    color: '#1C1C1E',
  },
  bookCard: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 24,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  coverPlaceholder: {
    width: 64,
    height: 84,
    borderRadius: 8,
    backgroundColor: '#E5E5EA',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  coverImage: {
    width: 64,
    height: 84,
    borderRadius: 8,
    marginRight: 16,
    backgroundColor: '#E5E5EA',
  },
  coverText: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#AEAEB2',
  },
  bookInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  bookTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1C1C1E',
    marginBottom: 4,
  },
  bookAuthor: {
    fontSize: 14,
    color: '#8E8E93',
    marginBottom: 8,
  },
  bookIntro: {
    fontSize: 14,
    color: '#636366',
    lineHeight: 20,
  },
  recordMeta: {
    fontSize: 11,
    color: '#8E8E93',
    marginTop: 8,
  },
  emptyCard: {
    marginHorizontal: 24,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1C1C1E',
    marginBottom: 6,
  },
  emptyDesc: {
    fontSize: 14,
    color: '#8E8E93',
    lineHeight: 20,
  },
  menuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
  floatingMenu: {
    position: 'absolute',
    right: 24,
    bottom: 24,
    alignItems: 'flex-end',
    zIndex: 2,
  },
  menuItemsWrap: {
    alignItems: 'flex-end',
    marginBottom: 12,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 136,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 3},
    shadowOpacity: 0.14,
    shadowRadius: 8,
    elevation: 5,
  },
  menuItemIcon: {
    marginRight: 8,
    color: '#007AFF',
    fontSize: 20,
    lineHeight: 22,
  },
  menuItemText: {
    color: '#1C1C1E',
    fontSize: 15,
    fontWeight: '600',
  },
  floatingButton: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#007AFF',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  floatingButtonText: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '300',
    lineHeight: 34,
    marginTop: -2,
  },
  floatingButtonTextOpen: {
    fontSize: 34,
    marginTop: -1,
  },
  importingOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: 'rgba(242, 242, 247, 0.72)',
  },
  importingPanel: {
    minWidth: 180,
    maxWidth: 280,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 22,
    paddingVertical: 20,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.14,
    shadowRadius: 12,
    elevation: 6,
  },
  importingTitle: {
    marginTop: 12,
    fontSize: 17,
    fontWeight: '600',
    color: '#1C1C1E',
  },
  importingDesc: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 18,
    color: '#636366',
    textAlign: 'center',
  },
});

export default NovelHome;
