import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Platform,
  Image,
  Alert,
} from 'react-native';
import {ReadingRecord} from '../utils/readerStorage';

interface NovelHomeProps {
  onNavigateSearch: () => void;
  readingRecords: ReadingRecord[];
  onResumeReading: (record: ReadingRecord) => void;
  onRemoveRecord: (bookUrl: string) => void;
}

const NovelHome: React.FC<NovelHomeProps> = ({
  onNavigateSearch,
  readingRecords,
  onResumeReading,
  onRemoveRecord,
}) => {
  const handleLongPress = (record: ReadingRecord) => {
    Alert.alert(
      '删除阅读记录',
      `确定要从"继续阅读"中删除《${record.book.name}》吗？`,
      [
        {text: '取消', style: 'cancel'},
        {
          text: '删除',
          style: 'destructive',
          onPress: () => onRemoveRecord(record.book.bookUrl),
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.greeting}>下午好，阅读爱好者</Text>
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

      <Text style={styles.sectionTitle}>继续阅读</Text>
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
                  上次阅读地址: {record.contentRequest.url}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })
      ) : (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>还没有阅读记录</Text>
          <Text style={styles.emptyDesc}>
            阅读任意章节后，这里会继续显示你的上次进度。
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7', // iOS系统级灰白底层
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
});

export default NovelHome;
