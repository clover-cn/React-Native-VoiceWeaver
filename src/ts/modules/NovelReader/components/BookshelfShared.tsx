import React, {memo} from 'react';
import {Image, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {AppImages} from '../../../../assets';
import {ReadingRecord} from '../utils/readerStorage';
import {
  BookshelfFilterTab,
  BookshelfViewMode,
  getBookProgressMeta,
} from '../utils/bookshelfUtils';

/** 书架主强调色（呼应 books_banner.png 暖橙紫光风格） */
export const BOOKSHELF_ACCENT_PURPLE = '#6D4C9E';
export const BOOKSHELF_ACCENT_ORANGE = '#F59E0B';
export const BOOKSHELF_PAGE_BG = '#F7EFED';
export const BOOKSHELF_BANNER_TOP_BG = '#3C335C';

interface FilterPillsProps {
  activeFilter: BookshelfFilterTab;
  onChangeFilter: (next: BookshelfFilterTab) => void;
  counts: {all: number; listening: number; finished: number};
}

/**
 * 书架状态筛选胶囊栏（全部 / 在听 / 已听完）
 */
export const BookshelfFilterPills: React.FC<FilterPillsProps> = memo(
  ({activeFilter, onChangeFilter, counts}) => {
    const tabs: Array<{key: BookshelfFilterTab; label: string}> = [
      {key: 'all', label: `全部(${counts.all})`},
      {key: 'listening', label: `在听(${counts.listening})`},
      {key: 'finished', label: `已听完(${counts.finished})`},
    ];

    return (
      <View style={styles.filterRow}>
        {tabs.map(tab => {
          const isActive = activeFilter === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[styles.filterPill, isActive && styles.filterPillActive]}
              onPress={() => onChangeFilter(tab.key)}
              activeOpacity={0.82}>
              <Text
                style={[
                  styles.filterPillText,
                  isActive && styles.filterPillTextActive,
                ]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  },
);

interface ViewToggleProps {
  viewMode: BookshelfViewMode;
  onChangeViewMode: (next: BookshelfViewMode) => void;
  showListOption?: boolean;
}

/**
 * 网格 / 列表视图切换图标按钮
 */
export const BookshelfViewToggle: React.FC<ViewToggleProps> = memo(
  ({viewMode, onChangeViewMode, showListOption = true}) => {
    const gridActive = viewMode === 'grid';
    const listActive = viewMode === 'list';

    return (
      <View style={styles.viewToggleGroup}>
        <TouchableOpacity
          style={[
            styles.viewToggleBtn,
            gridActive && styles.viewToggleBtnActive,
          ]}
          onPress={() => onChangeViewMode('grid')}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel="网格视图">
          <View style={styles.gridIcon}>
            <View style={styles.gridIconRow}>
              <View
                style={[
                  styles.gridCell,
                  gridActive && styles.gridCellActive,
                ]}
              />
              <View
                style={[
                  styles.gridCell,
                  gridActive && styles.gridCellActive,
                ]}
              />
            </View>
            <View style={styles.gridIconRow}>
              <View
                style={[
                  styles.gridCell,
                  gridActive && styles.gridCellActive,
                ]}
              />
              <View
                style={[
                  styles.gridCell,
                  gridActive && styles.gridCellActive,
                ]}
              />
            </View>
          </View>
        </TouchableOpacity>
        {showListOption && (
          <TouchableOpacity
            style={[
              styles.viewToggleBtn,
              listActive && styles.viewToggleBtnActive,
            ]}
            onPress={() => onChangeViewMode('list')}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="列表视图">
            <View style={styles.listIcon}>
              <View
                style={[
                  styles.listBar,
                  listActive && styles.listBarActive,
                ]}
              />
              <View
                style={[
                  styles.listBar,
                  listActive && styles.listBarActive,
                ]}
              />
              <View
                style={[
                  styles.listBar,
                  listActive && styles.listBarActive,
                ]}
              />
            </View>
          </TouchableOpacity>
        )}
      </View>
    );
  },
);

interface GridCardProps {
  record: ReadingRecord;
  width: number;
  isLastListened: boolean;
  isManaging?: boolean;
  disabled?: boolean;
  subtitleMode?: 'chapter' | 'percent';
  onPress: (record: ReadingRecord) => void;
  onLongPress: (record: ReadingRecord) => void;
}

/**
 * 4 列书架网格单本书籍卡片
 */
export const BookshelfGridCard: React.FC<GridCardProps> = memo(
  ({
    record,
    width,
    isLastListened,
    isManaging = false,
    disabled = false,
    subtitleMode = 'chapter',
    onPress,
    onLongPress,
  }) => {
    const {book} = record;
    const meta = getBookProgressMeta(record, isLastListened);
    const coverHeight = Math.round(width * 1.18);

    const subtitle =
      subtitleMode === 'percent'
        ? meta.isFinished
          ? '已听完'
          : meta.totalChapters > 0
          ? `已听 ${meta.percent}%`
          : '准备聆听'
        : meta.subtitleText;

    return (
      <TouchableOpacity
        style={[styles.gridCard, {width}]}
        disabled={disabled}
        onPress={() => (isManaging ? onLongPress(record) : onPress(record))}
        onLongPress={() => onLongPress(record)}
        delayLongPress={400}
        activeOpacity={0.84}>
        <View style={[styles.gridCoverBox, {width, height: coverHeight}]}>
          <Image
            source={
              book.coverUrl ? {uri: book.coverUrl} : AppImages.defaultCover
            }
            style={styles.gridCoverImg}
            resizeMode="cover"
          />
          {/* 底部进度/上次收听半透明胶囊 */}
          <View style={styles.gridBadgeOverlay}>
            {isLastListened && (
              <View style={styles.miniWaveGroup}>
                <View style={[styles.miniWaveBar, styles.miniWave1]} />
                <View style={[styles.miniWaveBar, styles.miniWave2]} />
                <View style={[styles.miniWaveBar, styles.miniWave3]} />
              </View>
            )}
            <Text style={styles.gridBadgeText} numberOfLines={1}>
              {meta.badgeText}
            </Text>
          </View>
          {/* 管理模式删除角标 */}
          {isManaging && (
            <View style={styles.manageDeleteBadge}>
              <Text style={styles.manageDeleteText}>×</Text>
            </View>
          )}
        </View>
        <Text style={styles.gridBookTitle} numberOfLines={1}>
          {book.name}
        </Text>
        <Text style={styles.gridBookSub} numberOfLines={1}>
          {subtitle}
        </Text>
      </TouchableOpacity>
    );
  },
);

interface ListCardProps {
  record: ReadingRecord;
  isLastListened: boolean;
  isManaging?: boolean;
  disabled?: boolean;
  onPress: (record: ReadingRecord) => void;
  onLongPress: (record: ReadingRecord) => void;
}

/**
 * 书架列表模式单本书籍卡片
 */
export const BookshelfListCard: React.FC<ListCardProps> = memo(
  ({
    record,
    isLastListened,
    isManaging = false,
    disabled = false,
    onPress,
    onLongPress,
  }) => {
    const book = record.book;
    const chapter = record.currentChapter;
    const isLocal = book.sourceType === 'local_txt';
    const meta = getBookProgressMeta(record, isLastListened);

    return (
      <TouchableOpacity
        disabled={disabled}
        style={styles.listCard}
        onPress={() => (isManaging ? onLongPress(record) : onPress(record))}
        onLongPress={() => onLongPress(record)}
        delayLongPress={400}
        activeOpacity={0.82}>
        <View style={styles.listCoverWrapper}>
          <Image
            source={
              book.coverUrl ? {uri: book.coverUrl} : AppImages.defaultCover
            }
            style={styles.listCoverImage}
            resizeMode="cover"
          />
          <View style={styles.listCoverSpine} />
        </View>

        <View style={styles.listBookInfo}>
          <View style={styles.listHeaderRow}>
            <Text style={styles.listBookTitle} numberOfLines={1}>
              {book.name}
            </Text>
            <View
              style={[
                styles.sourceTag,
                isLocal ? styles.sourceTagLocal : styles.sourceTagOnline,
              ]}>
              <Text
                style={[
                  styles.sourceTagText,
                  isLocal
                    ? styles.sourceTagTextLocal
                    : styles.sourceTagTextOnline,
                ]}>
                {book.contentType === 'article'
                  ? '文章快照'
                  : isLocal
                  ? '本地 TXT'
                  : book.sourceType === 'local_web_novel'
                  ? '网页导入'
                  : '网络源'}
              </Text>
            </View>
          </View>

          <Text style={styles.listBookAuthor} numberOfLines={1}>
            {book.author || '未知作者'}
          </Text>

          <Text style={styles.listBookIntro} numberOfLines={1}>
            {chapter?.title
              ? `上次听至: ${chapter.title}`
              : book.intro || '准备开启聆听'}
          </Text>

          <View style={styles.listMetaRow}>
            <View style={styles.listProgressPill}>
              <Text style={styles.listProgressText}>{meta.badgeText}</Text>
            </View>
            <View style={styles.audioFeatBadge}>
              <Text style={styles.audioFeatText}>
                {book.contentType === 'article'
                  ? '原文单音色朗读'
                  : isLocal
                  ? '支持离线演播'
                  : '多角色配音演播'}
              </Text>
            </View>
          </View>
        </View>

        {isManaging ? (
          <View style={styles.listDeleteBtn}>
            <Text style={styles.listDeleteBtnText}>删除</Text>
          </View>
        ) : (
          <View style={styles.quickPlayBtn}>
            <Image
              source={AppImages.play}
              style={styles.quickPlayIcon}
              resizeMode="contain"
            />
          </View>
        )}
      </TouchableOpacity>
    );
  },
);

const styles = StyleSheet.create({
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  filterPill: {
    paddingHorizontal: 13,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#EFE7EA',
  },
  filterPillActive: {
    backgroundColor: BOOKSHELF_ACCENT_PURPLE,
    shadowColor: BOOKSHELF_ACCENT_PURPLE,
    shadowOffset: {width: 0, height: 3},
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  filterPillText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#5E525B',
  },
  filterPillTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },

  viewToggleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  viewToggleBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: '#F3ECEE',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E8DDE1',
  },
  viewToggleBtnActive: {
    backgroundColor: '#F2EAFB',
    borderColor: BOOKSHELF_ACCENT_PURPLE,
  },
  gridIcon: {
    gap: 2.5,
  },
  gridIconRow: {
    flexDirection: 'row',
    gap: 2.5,
  },
  gridCell: {
    width: 5,
    height: 5,
    borderRadius: 1.2,
    borderWidth: 1.2,
    borderColor: '#6D616A',
  },
  gridCellActive: {
    borderColor: BOOKSHELF_ACCENT_PURPLE,
  },
  listIcon: {
    gap: 3,
    width: 13,
  },
  listBar: {
    height: 1.6,
    borderRadius: 1,
    backgroundColor: '#6D616A',
  },
  listBarActive: {
    backgroundColor: BOOKSHELF_ACCENT_PURPLE,
  },

  gridCard: {
    marginBottom: 14,
  },
  gridCoverBox: {
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#E9DFE3',
    position: 'relative',
    borderWidth: 0.5,
    borderColor: 'rgba(60, 51, 92, 0.12)',
    shadowColor: '#2B1F33',
    shadowOffset: {width: 0, height: 3},
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 2,
  },
  gridCoverImg: {
    width: '100%',
    height: '100%',
  },
  gridBadgeOverlay: {
    position: 'absolute',
    left: 4,
    right: 4,
    bottom: 5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(38, 28, 48, 0.78)',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  miniWaveGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 4,
    height: 9,
  },
  miniWaveBar: {
    width: 1.8,
    borderRadius: 1,
    backgroundColor: BOOKSHELF_ACCENT_ORANGE,
    marginHorizontal: 0.8,
  },
  miniWave1: {
    height: 5,
  },
  miniWave2: {
    height: 9,
  },
  miniWave3: {
    height: 6,
  },
  gridBadgeText: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  manageDeleteBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(220, 38, 38, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  manageDeleteText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 15,
  },
  gridBookTitle: {
    marginTop: 6,
    fontSize: 12.5,
    fontWeight: '700',
    color: '#241B29',
  },
  gridBookSub: {
    marginTop: 2,
    fontSize: 10.5,
    color: '#7D6E78',
  },

  listCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 13,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#EDE3E6',
    shadowColor: '#2B1F33',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  listCoverWrapper: {
    width: 58,
    height: 76,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#E9DFE3',
    marginRight: 13,
    position: 'relative',
  },
  listCoverImage: {
    width: '100%',
    height: '100%',
  },
  listCoverSpine: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 2.5,
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
  },
  listBookInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  listHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 3,
  },
  listBookTitle: {
    fontSize: 15.5,
    fontWeight: '800',
    color: '#241B29',
    flex: 1,
    marginRight: 8,
  },
  sourceTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  sourceTagLocal: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
  },
  sourceTagOnline: {
    backgroundColor: 'rgba(109, 76, 158, 0.1)',
  },
  sourceTagText: {
    fontSize: 10,
    fontWeight: '600',
  },
  sourceTagTextLocal: {
    color: '#065F46',
  },
  sourceTagTextOnline: {
    color: BOOKSHELF_ACCENT_PURPLE,
  },
  listBookAuthor: {
    fontSize: 12,
    color: '#7D6E78',
    marginBottom: 4,
  },
  listBookIntro: {
    fontSize: 12,
    color: '#4E414C',
    lineHeight: 16,
    marginBottom: 6,
  },
  listMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  listProgressPill: {
    backgroundColor: '#F3ECF9',
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 6,
  },
  listProgressText: {
    fontSize: 10,
    fontWeight: '700',
    color: BOOKSHELF_ACCENT_PURPLE,
  },
  audioFeatBadge: {
    backgroundColor: '#FAF2ED',
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 6,
    borderWidth: 0.5,
    borderColor: '#EFE3DA',
  },
  audioFeatText: {
    fontSize: 10,
    color: '#9A5B36',
    fontWeight: '600',
  },
  quickPlayBtn: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  quickPlayIcon: {
    width: 28,
    height: 28,
  },
  listDeleteBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#FEE2E2',
    marginLeft: 8,
  },
  listDeleteBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#DC2626',
  },
});
