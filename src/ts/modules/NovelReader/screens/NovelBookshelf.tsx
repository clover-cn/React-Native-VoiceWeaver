import React, {useMemo, useState} from 'react';
import {
  Image,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import {AppImages} from '../../../../assets';
import bridge from '../../base/utils/bridge';
import {
  BOOKSHELF_ACCENT_PURPLE,
  BOOKSHELF_BANNER_TOP_BG,
  BOOKSHELF_PAGE_BG,
  BookshelfFilterPills,
  BookshelfGridCard,
  BookshelfListCard,
  BookshelfViewToggle,
} from '../components/BookshelfShared';
import {
  BookshelfFilterTab,
  BookshelfViewMode,
  confirmRemoveBookRecord,
  filterBookshelfRecords,
  getBookshelfTabCounts,
} from '../utils/bookshelfUtils';
import {ReadingRecord} from '../utils/readerStorage';

type SortMode = 'recent' | 'name';

const booksBannerSource = Image.resolveAssetSource(AppImages.booksBanner);
const BOOKS_BANNER_ASPECT_RATIO =
  booksBannerSource.width / booksBannerSource.height;
/** 渐变图在 40% 处转为 100% 不透明暖粉色，与横幅底边精准对齐以完全消除底边黑线 */
const BANNER_FADE_OVERLAP = 0.4;
const GRID_HORIZONTAL_PADDING = 18;
const GRID_GAP = 10;

interface NovelBookshelfProps {
  readingRecords: ReadingRecord[];
  isBusy?: boolean;
  onBack: () => void;
  onResumeReading: (record: ReadingRecord) => void;
  onRemoveRecord: (bookUrl: string) => void;
}

/**
 * 全部书籍页面：顶部采用 books_banner.png 暖橙紫光视觉横幅，支持状态筛选、排序与网格/列表切换
 */
const NovelBookshelf: React.FC<NovelBookshelfProps> = ({
  readingRecords,
  isBusy = false,
  onBack,
  onResumeReading,
  onRemoveRecord,
}) => {
  const {width: windowWidth} = useWindowDimensions();
  const bannerHeight = Math.round(windowWidth / BOOKS_BANNER_ASPECT_RATIO);
  const bannerFadeHeight = Math.min(72, Math.round(bannerHeight * 0.48));
  const filterBannerOverlap = Math.min(14, Math.round(bannerFadeHeight * 0.22));
  const nativeTop =
    Platform.OS !== 'android' && Platform.OS !== 'ios'
      ? Number(bridge.getOhASData('topRectHeight', 0))
      : 0;
  const topInset = Number.isFinite(nativeTop) ? Math.max(0, nativeTop) : 0;

  const [activeFilter, setActiveFilter] = useState<BookshelfFilterTab>('all');
  const [viewMode, setViewMode] = useState<BookshelfViewMode>('grid');
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const [isManaging, setIsManaging] = useState(false);

  const tabCounts = useMemo(
    () => getBookshelfTabCounts(readingRecords),
    [readingRecords],
  );

  const lastListenedUrl =
    readingRecords.length > 0 ? readingRecords[0].book.bookUrl : null;

  const displayedRecords = useMemo(() => {
    const filtered = filterBookshelfRecords(readingRecords, activeFilter);
    if (sortMode === 'name') {
      return [...filtered].sort((a, b) =>
        a.book.name.localeCompare(b.book.name, 'zh-Hans-CN'),
      );
    }
    return filtered;
  }, [readingRecords, activeFilter, sortMode]);

  const cardWidth = Math.floor(
    (windowWidth - GRID_HORIZONTAL_PADDING * 2 - GRID_GAP * 3) / 4,
  );

  return (
    <View style={styles.container}>
      {Platform.OS === 'ios' && (
        <>
          <StatusBar barStyle="light-content" />
          <SafeAreaView style={styles.iosTopSafeArea} />
        </>
      )}

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        bounces={false}
        overScrollMode="never"
        showsVerticalScrollIndicator={false}>
        {/* 1. 顶部横幅与底部渐变过渡区（置于独立图层，确保下方筛选胶囊始终绘制在其上方） */}
        <View style={styles.headerArea}>
          <View
            style={[
              styles.bannerContainer,
              topInset > 0 && {paddingTop: topInset},
            ]}>
            <Image
              source={AppImages.booksBanner}
              style={{width: windowWidth, height: bannerHeight}}
              resizeMode="cover"
            />
          </View>

          {/* 渐变图跨过横幅底边（40% 处不透明点正好盖住横幅底边，消除分界黑线） */}
          <View
            style={[
              styles.bannerFadeOverlay,
              {
                top:
                  topInset +
                  bannerHeight -
                  Math.round(bannerFadeHeight * BANNER_FADE_OVERLAP),
              },
            ]}
            pointerEvents="none"
            accessible={false}>
            <Image
              source={AppImages.homeBannerFade}
              style={{width: windowWidth, height: bannerFadeHeight}}
              resizeMode="stretch"
            />
          </View>

          <View
            style={[styles.topNavOverlay, {top: topInset + 4}]}
            pointerEvents="box-none">
            <TouchableOpacity
              style={styles.navActionBtn}
              onPress={onBack}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel="返回首页">
              <Text style={styles.navBackText}>‹</Text>
            </TouchableOpacity>

            <View style={styles.navTitleWrap} pointerEvents="none">
              <Text style={styles.navTitle} numberOfLines={1}>
                全部书籍 ({readingRecords.length})
              </Text>
            </View>

            <TouchableOpacity
              style={[
                styles.navManagePill,
                isManaging && styles.navManagePillActive,
              ]}
              onPress={() => setIsManaging(prev => !prev)}
              activeOpacity={0.78}>
              <Text style={styles.navManageText}>
                {isManaging ? '完成' : '管理'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 2. 状态筛选胶囊栏（绘制在渐变层上方，无黑线且不遮挡） */}
        <View
          style={[
            styles.filterSection,
            {marginTop: -filterBannerOverlap},
          ]}>
          <BookshelfFilterPills
            activeFilter={activeFilter}
            onChangeFilter={setActiveFilter}
            counts={tabCounts}
          />
        </View>

        {/* 3. 排序与视图切换栏 */}
        <View style={styles.toolbarRow}>
          <TouchableOpacity
            style={styles.sortButton}
            onPress={() =>
              setSortMode(prev => (prev === 'recent' ? 'name' : 'recent'))
            }
            activeOpacity={0.75}>
            <Text style={styles.sortText}>
              {sortMode === 'recent' ? '最近收听 ▾' : '按书名排序 ▾'}
            </Text>
          </TouchableOpacity>

          <BookshelfViewToggle
            viewMode={viewMode}
            onChangeViewMode={setViewMode}
          />
        </View>

        {/* 4. 全部书籍列表 / 4 列网格 */}
        {displayedRecords.length > 0 ? (
          viewMode === 'grid' ? (
            <View style={styles.gridWrap}>
              {displayedRecords.map(record => (
                <BookshelfGridCard
                  key={record.book.bookUrl}
                  record={record}
                  width={cardWidth}
                  isLastListened={record.book.bookUrl === lastListenedUrl}
                  isManaging={isManaging}
                  disabled={isBusy}
                  subtitleMode="percent"
                  onPress={onResumeReading}
                  onLongPress={item =>
                    confirmRemoveBookRecord(item, onRemoveRecord)
                  }
                />
              ))}
            </View>
          ) : (
            <View style={styles.listWrap}>
              {displayedRecords.map(record => (
                <BookshelfListCard
                  key={record.book.bookUrl}
                  record={record}
                  isLastListened={record.book.bookUrl === lastListenedUrl}
                  isManaging={isManaging}
                  disabled={isBusy}
                  onPress={onResumeReading}
                  onLongPress={item =>
                    confirmRemoveBookRecord(item, onRemoveRecord)
                  }
                />
              ))}
            </View>
          )
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>当前分类暂无书籍</Text>
            <Text style={styles.emptyDesc}>
              切换上方筛选标签，或返回首页导入小说与文章。
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BOOKSHELF_PAGE_BG,
  },
  iosTopSafeArea: {
    flex: 0,
    backgroundColor: BOOKSHELF_BANNER_TOP_BG,
  },
  scrollContent: {
    paddingBottom: 48,
  },
  headerArea: {
    width: '100%',
    position: 'relative',
  },
  bannerContainer: {
    width: '100%',
    backgroundColor: BOOKSHELF_BANNER_TOP_BG,
    overflow: 'hidden',
  },
  topNavOverlay: {
    position: 'absolute',
    left: 12,
    right: 12,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 5,
  },
  navActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(26, 20, 44, 0.36)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBackText: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '400',
    lineHeight: 28,
    marginTop: -2,
  },
  navTitleWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 72,
  },
  navTitle: {
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '800',
    color: '#FFFFFF',
    textShadowColor: 'rgba(18, 12, 32, 0.55)',
    textShadowOffset: {width: 0, height: 1},
    textShadowRadius: 4,
  },
  navManagePill: {
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: 'rgba(26, 20, 44, 0.42)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.24)',
  },
  navManagePillActive: {
    backgroundColor: BOOKSHELF_ACCENT_PURPLE,
    borderColor: '#FFFFFF',
  },
  navManageText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  bannerFadeOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  filterSection: {
    paddingHorizontal: GRID_HORIZONTAL_PADDING,
    marginBottom: 12,
    zIndex: 1,
  },
  toolbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: GRID_HORIZONTAL_PADDING,
    marginBottom: 14,
  },
  sortButton: {
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  sortText: {
    fontSize: 13.5,
    fontWeight: '600',
    color: '#4E414C',
  },
  gridWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: GRID_HORIZONTAL_PADDING,
    gap: GRID_GAP,
  },
  listWrap: {
    paddingHorizontal: GRID_HORIZONTAL_PADDING,
  },
  emptyCard: {
    marginHorizontal: GRID_HORIZONTAL_PADDING,
    marginTop: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#EDE3E6',
    borderStyle: 'dashed',
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#241B29',
    marginBottom: 6,
  },
  emptyDesc: {
    fontSize: 12.5,
    color: '#7D6E78',
    textAlign: 'center',
  },
});

export default NovelBookshelf;
