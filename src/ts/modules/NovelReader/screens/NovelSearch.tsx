import React, {useEffect, useState} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  SafeAreaView,
  Platform,
  Image,
} from 'react-native';
import {Book} from '../types/reader';
import {
  addSearchHistory,
  clearSearchHistory,
  loadSearchHistory,
} from '../utils/readerStorage';
import LocalBookSourceService from '../bookSource/LocalBookSourceService';
import {BookSourceDiagnostic} from '../bookSource/types';

interface NovelSearchProps {
  onBack: () => void;
  onBookSelect: (book: Book) => void;
}

const NovelSearch: React.FC<NovelSearchProps> = ({onBack, onBookSelect}) => {
  const [keyword, setKeyword] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [results, setResults] = useState<Book[]>([]);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchDiagnostics, setSearchDiagnostics] = useState<
    BookSourceDiagnostic[]
  >([]);

  useEffect(() => {
    loadSearchHistory().then(setSearchHistory);
  }, []);

  const handleSearch = async (customKeyword?: string) => {
    const term = (customKeyword ?? keyword).trim();
    if (!term) {
      return;
    }

    setIsSearching(true);
    setHasSearched(false);
    setResults([]);
    setSearchError(null);
    setSearchDiagnostics([]);

    try {
      const {books, diagnostics} =
        await LocalBookSourceService.searchBooksWithDiagnostics(term);
      setResults(books);
      setSearchDiagnostics(diagnostics);
      if (books.length === 0) {
        const failedCount = diagnostics.filter(item => !item.ok).length;
        const summary = diagnostics
          .map(item => `${item.sourceName}: ${item.message}`)
          .join('\n');
        setSearchError(
          failedCount === diagnostics.length
            ? `所有书源搜索失败。\n${summary}`
            : `没有解析到有效搜索结果。\n${summary}`,
        );
      }
      const nextHistory = await addSearchHistory(term);
      setSearchHistory(nextHistory);
    } catch (e) {
      console.error('搜索失败:', e);
      setSearchError(e instanceof Error ? e.message : String(e));
      setResults([]);
    } finally {
      setIsSearching(false);
      setHasSearched(true);
    }
  };

  const handleHistoryPress = (term: string) => {
    setKeyword(term);
    handleSearch(term);
  };

  const handleClearHistory = async () => {
    await clearSearchHistory();
    setSearchHistory([]);
  };

  const renderItem = ({item}: {item: Book}) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => onBookSelect(item)}
      activeOpacity={0.8}>
      {item.coverUrl ? (
        <Image
          source={{uri: item.coverUrl}}
          style={styles.coverImage}
          resizeMode="cover"
        />
      ) : (
        <View style={styles.coverPlaceholder}>
          <Text style={styles.coverText}>{item.name[0]}</Text>
        </View>
      )}
      <View style={styles.infoCol}>
        <Text style={styles.title} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.author}>{item.author}</Text>
        <Text style={styles.intro} numberOfLines={2}>
          {item.intro}
        </Text>
        <View style={styles.tagsRow}>
          <View style={styles.tagWrap}>
            <Text style={styles.tagText}>{item.originName}</Text>
          </View>
          <Text style={styles.latest} numberOfLines={1}>
            最新: {item.latestChapterTitle}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerBar}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <View style={styles.searchBox}>
          <TextInput
            style={styles.input}
            placeholder="搜索你想阅读的小说..."
            placeholderTextColor="#8E8E93"
            value={keyword}
            onChangeText={setKeyword}
            onSubmitEditing={() => {
              handleSearch();
            }}
            returnKeyType="search"
            autoFocus
          />
          {isSearching ? (
            <ActivityIndicator
              style={styles.searchIcon}
              size="small"
              color="#007AFF"
            />
          ) : (
            <TouchableOpacity
              style={styles.searchIcon}
              onPress={() => {
                handleSearch();
              }}>
              <Text style={styles.searchIconText}>搜索</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {searchHistory.length > 0 && !hasSearched && (
        <View style={styles.historySection}>
          <View style={styles.historyHeader}>
            <Text style={styles.historyTitle}>搜索历史</Text>
            <TouchableOpacity onPress={handleClearHistory}>
              <Text style={styles.clearHistoryText}>清空</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.historyList}>
            {searchHistory.map(item => (
              <TouchableOpacity
                key={item}
                style={styles.historyChip}
                onPress={() => handleHistoryPress(item)}
                activeOpacity={0.8}>
                <Text style={styles.historyChipText}>{item}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {hasSearched && results.length === 0 && !isSearching && (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>未找到相关作品，换个关键词试试？</Text>
          {searchError ? (
            <Text style={styles.debugText}>{searchError}</Text>
          ) : null}
          {searchDiagnostics.length > 0 ? (
            <View style={styles.debugPanel}>
              {searchDiagnostics.map(item => (
                <Text key={item.sourceUrl} style={styles.debugLine} selectable>
                  {item.ok ? 'OK' : 'FAIL'} {item.sourceName} | 阶段:
                  {item.stage} | 列表:
                  {item.listCount ?? '-'} | 结果:
                  {item.resultCount ?? '-'}
                </Text>
              ))}
            </View>
          ) : null}
        </View>
      )}

      <FlatList
        data={results}
        keyExtractor={(item, idx) => item.bookUrl + idx}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 10 : 20,
    paddingBottom: 16,
  },
  backBtn: {
    padding: 8,
    marginRight: 8,
  },
  backText: {
    fontSize: 24,
    color: '#007AFF',
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    alignItems: 'center',
    paddingHorizontal: 12,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  input: {
    flex: 1,
    height: 44,
    fontSize: 16,
    color: '#000',
  },
  searchIcon: {
    padding: 8,
  },
  searchIconText: {
    color: '#007AFF',
    fontWeight: 'bold',
    fontSize: 15,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  historySection: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  historyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1C1C1E',
  },
  clearHistoryText: {
    fontSize: 13,
    color: '#007AFF',
  },
  historyList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  historyChip: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    marginBottom: 8,
  },
  historyChipText: {
    fontSize: 13,
    color: '#3A3A3C',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: '#8E8E93',
    fontSize: 16,
  },
  debugText: {
    color: '#FF3B30',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 12,
    paddingHorizontal: 20,
    textAlign: 'left',
  },
  debugPanel: {
    marginTop: 12,
    paddingHorizontal: 20,
    width: '100%',
  },
  debugLine: {
    color: '#636366',
    fontSize: 11,
    lineHeight: 17,
    marginBottom: 4,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 2,
  },
  coverPlaceholder: {
    width: 68,
    height: 90,
    borderRadius: 8,
    backgroundColor: '#E5E5EA',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  coverImage: {
    width: 68,
    height: 90,
    borderRadius: 8,
    marginRight: 16,
    backgroundColor: '#E5E5EA',
  },
  coverText: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#AEAEB2',
  },
  infoCol: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    fontSize: 17,
    fontWeight: 'bold',
    color: '#1C1C1E',
    marginBottom: 4,
  },
  author: {
    fontSize: 14,
    color: '#8E8E93',
    marginBottom: 6,
  },
  intro: {
    fontSize: 13,
    color: '#636366',
    lineHeight: 18,
    marginBottom: 8,
  },
  tagsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tagWrap: {
    backgroundColor: 'rgba(0,122,255,0.1)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: 8,
  },
  tagText: {
    color: '#007AFF',
    fontSize: 11,
    fontWeight: '500',
  },
  latest: {
    flex: 1,
    color: '#8E8E93',
    fontSize: 11,
  },
});

export default NovelSearch;
