import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
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
  ScrollView,
  Keyboard,
} from 'react-native';
import {Book} from '../types/reader';
import {
  addSearchHistory,
  clearSearchHistory,
  loadSearchHistory,
} from '../utils/readerStorage';
import LocalBookSourceService, {
  mergeBookSourceSearchResults,
} from '../bookSource/LocalBookSourceService';
import {useBookSourceSearch} from '../hooks/useBookSourceSearch';
import {SearchResultsFooter} from '../components/SearchResultsFooter';
import {BookSourceSearchGroup, LegadoBookSource} from '../bookSource/types';

interface NovelSearchProps {
  isActive: boolean;
  onBack: () => void;
  onBookSelect: (book: Book) => void;
  sourceRefreshVersion?: number;
}

// 热门搜索推荐词
const POPULAR_SEARCH_TAGS = [
  '我的郁金香小姐',
  '雪中悍刀行',
  '诡秘之主',
  '剑来',
  '大奉打更人',
  '凡人修仙传',
];

const NovelSearch: React.FC<NovelSearchProps> = ({
  isActive,
  onBack,
  onBookSelect,
  sourceRefreshVersion = 0,
}) => {
  const inputRef = useRef<TextInput>(null);
  const dismissSearchKeyboard = useCallback(() => {
    inputRef.current?.blur();
    Keyboard.dismiss();
  }, []);

  useEffect(() => {
    // 搜索页会保留挂载，隐藏时必须释放输入焦点。
    if (!isActive) {
      dismissSearchKeyboard();
    }
  }, [isActive, dismissSearchKeyboard]);

  const [keyword, setKeyword] = useState('');
  const searchState = useBookSourceSearch();
  const {loading: isSearching, hasSearched, reset} = searchState;
  const results = useMemo(
    () => mergeBookSourceSearchResults(searchState.books),
    [searchState.books],
  );
  const canAutoLoad = useRef(false);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [availableSources, setAvailableSources] = useState<LegadoBookSource[]>(
    [],
  );
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);

  const refreshAvailableSources = useCallback(async () => {
    try {
      const sources = await LocalBookSourceService.getSources();
      setAvailableSources(sources);
      setSelectedSourceIds(current =>
        current.filter(sourceId =>
          sources.some(source => source.bookSourceUrl === sourceId),
        ),
      );
    } catch (error) {
      console.warn('[NovelSearch] 获取书源列表失败', error);
    }
  }, []);

  useEffect(() => {
    loadSearchHistory().then(setSearchHistory);
    refreshAvailableSources();
    reset();
  }, [refreshAvailableSources, sourceRefreshVersion, reset]);

  const toggleSource = (sourceId: string) => {
    reset();
    setSelectedSourceIds(current =>
      current.includes(sourceId)
        ? current.filter(item => item !== sourceId)
        : [...current, sourceId],
    );
  };

  const handleSearch = async (customKeyword?: string) => {
    const term = (customKeyword ?? keyword).trim();
    if (!term) {
      return;
    }

    canAutoLoad.current = false;
    const searching = searchState.search(term, selectedSourceIds);
    try {
      const nextHistory = await addSearchHistory(term);
      setSearchHistory(nextHistory);
    } catch {
      /* 历史记录写入失败不影响搜索。 */
    }
    await searching;
  };

  const handleTagPress = (term: string) => {
    setKeyword(term);
    handleSearch(term);
  };

  const handleClearHistory = async () => {
    await clearSearchHistory();
    setSearchHistory([]);
  };

  const renderSourceFilters = () => {
    if (availableSources.length === 0) {
      return null;
    }

    return (
      <View style={styles.sourceFilterSection}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.sourceFilterList}>
          <TouchableOpacity
            style={[
              styles.sourceChip,
              selectedSourceIds.length === 0 && styles.activeSourceChip,
            ]}
            onPress={() => {
              reset();
              setSelectedSourceIds([]);
            }}
            activeOpacity={0.82}>
            <Text
              style={[
                styles.sourceChipText,
                selectedSourceIds.length === 0 && styles.activeSourceChipText,
              ]}>
              全部书源
            </Text>
          </TouchableOpacity>
          {availableSources.map(source => {
            const active = selectedSourceIds.includes(source.bookSourceUrl);
            return (
              <TouchableOpacity
                key={source.bookSourceUrl}
                style={[styles.sourceChip, active && styles.activeSourceChip]}
                onPress={() => toggleSource(source.bookSourceUrl)}
                activeOpacity={0.82}>
                <Text
                  style={[
                    styles.sourceChipText,
                    active && styles.activeSourceChipText,
                  ]}
                  numberOfLines={1}>
                  {source.bookSourceName}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    );
  };

  const renderItem = ({item}: {item: BookSourceSearchGroup}) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => {
        dismissSearchKeyboard();
        onBookSelect(item.primary);
      }}
      activeOpacity={0.85}>
      {/* 精装仿真立体书封 */}
      {item.coverUrl ? (
        <View style={styles.coverWrapper}>
          <Image
            source={{uri: item.coverUrl}}
            style={styles.coverImage}
            resizeMode="cover"
          />
          <View style={styles.coverSpine} />
        </View>
      ) : (
        <View style={[styles.coverWrapper, styles.coverPlaceholder]}>
          <Text style={styles.coverText}>{item.name[0]}</Text>
          <View style={styles.coverSpine} />
        </View>
      )}

      {/* 书籍信息列 */}
      <View style={styles.infoCol}>
        <View style={styles.cardHeaderRow}>
          <Text style={styles.title} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.playHint}>准备演播 ›</Text>
        </View>

        <Text style={styles.author}>{item.author || '未知作者'}</Text>

        <Text style={styles.intro} numberOfLines={2}>
          {item.intro ? item.intro.trim() : '暂无作品简介'}
        </Text>

        <View style={styles.tagsRow}>
          <View style={styles.tagWrap}>
            <Text style={styles.tagText}>{item.originName}</Text>
          </View>
          {item.sourceCount > 1 ? (
            <View style={styles.multiSourceTag}>
              <Text style={styles.multiSourceTagText}>
                共 {item.sourceCount} 个书源
              </Text>
            </View>
          ) : null}
          {item.latestChapterTitle ? (
            <Text style={styles.latest} numberOfLines={1}>
              最新: {item.latestChapterTitle}
            </Text>
          ) : null}
        </View>

        {item.sourceCount > 1 ? (
          <Text style={styles.sourceSummary} numberOfLines={1}>
            可用来源: {item.sourceNames.join('、')}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* 顶部搜索操作栏 */}
      <View style={styles.headerBar}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => {
            dismissSearchKeyboard();
            onBack();
          }}
          accessibilityLabel="返回上一页"
          activeOpacity={0.75}>
          <Text style={styles.backText}>‹</Text>
        </TouchableOpacity>

        <View style={styles.searchBox}>
          <Text style={styles.searchPrefixIcon}>🔍</Text>
          <TextInput
            ref={inputRef}
            editable={isActive}
            showSoftInputOnFocus={isActive}
            style={styles.input}
            placeholder="输入书名、作者或关键词…"
            placeholderTextColor="#A8A29E"
            value={keyword}
            onChangeText={setKeyword}
            onSubmitEditing={() => {
              handleSearch();
            }}
            returnKeyType="search"
          />

          {keyword.length > 0 && !isSearching && (
            <TouchableOpacity
              style={styles.clearBtn}
              onPress={() => setKeyword('')}
              accessibilityLabel="清空输入">
              <Text style={styles.clearBtnText}>✕</Text>
            </TouchableOpacity>
          )}

          {isSearching ? (
            <ActivityIndicator
              style={styles.searchLoading}
              size="small"
              color="#D97706"
            />
          ) : (
            <TouchableOpacity
              style={styles.searchActionBtn}
              onPress={() => {
                handleSearch();
              }}
              activeOpacity={0.8}>
              <Text style={styles.searchActionText}>搜索</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* 书源筛选水平滑块 */}
      {renderSourceFilters()}

      {/* 搜索历史模块 */}
      {searchHistory.length > 0 && !hasSearched && (
        <View style={styles.historySection}>
          <View style={styles.historyHeader}>
            <View style={styles.historyTitleRow}>
              <Text style={styles.historyClockIcon}>🕒</Text>
              <Text style={styles.historyTitle}>搜索历史</Text>
            </View>
            <TouchableOpacity
              onPress={handleClearHistory}
              hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}>
              <Text style={styles.clearHistoryText}>清空</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.historyList}>
            {searchHistory.map(item => (
              <TouchableOpacity
                key={item}
                style={styles.historyChip}
                onPress={() => handleTagPress(item)}
                activeOpacity={0.78}>
                <Text style={styles.historyChipText}>{item}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* 热门搜索探索模块（在未搜索时展示） */}
      {!hasSearched && (
        <View style={styles.popularSection}>
          <View style={styles.historyHeader}>
            <View style={styles.historyTitleRow}>
              <Text style={styles.popularFireIcon}>🔥</Text>
              <Text style={styles.historyTitle}>大家都在搜</Text>
            </View>
          </View>
          <View style={styles.historyList}>
            {POPULAR_SEARCH_TAGS.map(tag => (
              <TouchableOpacity
                key={tag}
                style={styles.popularChip}
                onPress={() => handleTagPress(tag)}
                activeOpacity={0.78}>
                <Text style={styles.popularChipText}>{tag}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* 搜索结果为空 */}
      {hasSearched && results.length === 0 && !isSearching && (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyEmoji}>📚</Text>
          <Text style={styles.emptyTitle}>未找到相关作品</Text>
          <Text style={styles.emptyDesc}>
            换个书名、作者或检查书源连接试试看~
          </Text>
          {searchState.error ? (
            <Text style={styles.debugText}>{searchState.error}</Text>
          ) : null}
        </View>
      )}

      {/* 搜索结果列表 */}
      <FlatList
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        data={results}
        keyExtractor={item => JSON.stringify([item.sourceId, item.bookUrl])}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        onScrollBeginDrag={() => {
          canAutoLoad.current = true;
        }}
        onEndReachedThreshold={0.3}
        onEndReached={() => {
          if (canAutoLoad.current && !isSearching) {
            canAutoLoad.current = false;
            searchState.loadMore();
          }
        }}
        ListFooterComponent={
          <SearchResultsFooter
            {...searchState}
            onMore={() => searchState.loadMore()}
            onRetry={() => searchState.loadMore(true)}
          />
        }
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F6F0', // 统一温润宣纸暖白底色
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 10 : 18,
    paddingBottom: 14,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    borderWidth: 1,
    borderColor: '#EFECE6',
    shadowColor: '#1C1917',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  backText: {
    fontSize: 26,
    color: '#1C1917',
    fontWeight: '300',
    marginTop: -2,
    marginLeft: -1,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    alignItems: 'center',
    paddingLeft: 12,
    paddingRight: 6,
    height: 46,
    borderWidth: 1,
    borderColor: '#EFECE6',
    shadowColor: '#1C1917',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  searchPrefixIcon: {
    fontSize: 14,
    marginRight: 6,
  },
  input: {
    flex: 1,
    height: 44,
    fontSize: 15,
    color: '#1C1917',
    paddingVertical: 0,
  },
  clearBtn: {
    padding: 6,
    marginRight: 4,
  },
  clearBtnText: {
    fontSize: 12,
    color: '#A8A29E',
    fontWeight: '700',
  },
  searchLoading: {
    paddingHorizontal: 12,
  },
  searchActionBtn: {
    backgroundColor: '#D97706',
    borderRadius: 13,
    paddingHorizontal: 14,
    paddingVertical: 7,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchActionText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  listContent: {
    paddingHorizontal: 18,
    paddingBottom: 40,
  },
  sourceFilterSection: {
    paddingBottom: 12,
  },
  sourceFilterList: {
    paddingHorizontal: 18,
  },
  sourceChip: {
    maxWidth: 140,
    backgroundColor: '#FFFFFF',
    borderColor: '#EFECE6',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6.5,
    marginRight: 8,
    shadowColor: '#1C1917',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 1,
  },
  activeSourceChip: {
    backgroundColor: '#D97706',
    borderColor: '#D97706',
    shadowColor: '#D97706',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  sourceChipText: {
    fontSize: 12,
    color: '#78716C',
    fontWeight: '600',
  },
  activeSourceChipText: {
    color: '#FFFFFF',
  },
  historySection: {
    paddingHorizontal: 18,
    paddingBottom: 16,
  },
  popularSection: {
    paddingHorizontal: 18,
    paddingBottom: 16,
  },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  historyTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  historyClockIcon: {
    fontSize: 12,
    marginRight: 5,
  },
  popularFireIcon: {
    fontSize: 12,
    marginRight: 5,
  },
  historyTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1C1917',
  },
  clearHistoryText: {
    fontSize: 12,
    color: '#A8A29E',
  },
  historyList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  historyChip: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#EFECE6',
    shadowColor: '#1C1917',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.02,
    shadowRadius: 3,
    elevation: 1,
  },
  historyChipText: {
    fontSize: 12,
    color: '#44403C',
  },
  popularChip: {
    backgroundColor: '#FAF5ED',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#EFE8DE',
  },
  popularChipText: {
    fontSize: 12,
    color: '#8A5D3B',
    fontWeight: '500',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 24,
  },
  emptyEmoji: {
    fontSize: 40,
    marginBottom: 10,
  },
  emptyTitle: {
    color: '#1C1917',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  emptyDesc: {
    color: '#78716C',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  debugText: {
    color: '#B42318',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 12,
    textAlign: 'center',
  },
  card: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#EFECE6',
    shadowColor: '#1C1917',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  coverWrapper: {
    width: 64,
    height: 86,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#3E342D',
    marginRight: 14,
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.14,
    shadowRadius: 4,
  },
  coverImage: {
    width: '100%',
    height: '100%',
  },
  coverPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#4B3F35', // 沉稳胡桃木底色
  },
  coverSpine: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 2.5,
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
  },
  coverText: {
    fontSize: 26,
    fontWeight: '800',
    color: '#F59E0B',
  },
  infoCol: {
    flex: 1,
    justifyContent: 'center',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  title: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1C1917',
    flex: 1,
    marginRight: 6,
  },
  playHint: {
    fontSize: 11,
    color: '#B45309',
    fontWeight: '600',
  },
  author: {
    fontSize: 12,
    color: '#78716C',
    marginBottom: 4,
  },
  intro: {
    fontSize: 12,
    color: '#57534E',
    lineHeight: 16,
    marginBottom: 8,
  },
  tagsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  tagWrap: {
    backgroundColor: 'rgba(217, 119, 6, 0.08)',
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: 6,
  },
  tagText: {
    color: '#B45309',
    fontSize: 10,
    fontWeight: '600',
  },
  multiSourceTag: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: 6,
  },
  multiSourceTagText: {
    color: '#065F46',
    fontSize: 10,
    fontWeight: '600',
  },
  latest: {
    flex: 1,
    color: '#A8A29E',
    fontSize: 10,
  },
  sourceSummary: {
    color: '#A8A29E',
    fontSize: 10,
    marginTop: 4,
  },
});

export default NovelSearch;
