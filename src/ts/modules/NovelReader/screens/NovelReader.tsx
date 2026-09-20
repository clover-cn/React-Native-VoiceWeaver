import React, {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  View,
  Text,
  StyleSheet,
  FlatList,
  Animated,
  Platform,
  Pressable,
  NativeSyntheticEvent,
  NativeScrollEvent,
  GestureResponderEvent,
  ViewToken,
  useWindowDimensions,
} from 'react-native';
import {Chapter, ListenSegment} from '../types/reader';
import ReaderHeader from '../components/ReaderHeader';
import ReaderFooter from '../components/ReaderFooter';
import SegmentEditorModal, {
  SegmentEditPayload,
} from '../components/SegmentEditorModal';
import ReaderCatalog from '../components/ReaderCatalog';
import {AudioOption} from '../types/audio';
import {buildListenSegmentFailureHint} from '../utils/listenBook';

export type ReaderLoadingPhase = 'toc' | 'content';

export interface ReaderLoadingState {
  phase: ReaderLoadingPhase;
  title: string;
  detail?: string;
}

interface NovelReaderProps {
  currentChapter?: Chapter;
  chapterList: Chapter[];
  currentChapterIndex: number;
  contentParagraphs: string[]; // 如果没有听书数据，降级使用的普通段落
  readerLoading?: ReaderLoadingState | null;
  listenState: 'idle' | 'loading' | 'ready' | 'error';
  listenPhase: string;
  segments: ListenSegment[];
  isListenMode: boolean;
  isGenerationComplete: boolean;
  projectName?: string; // 项目名（用于进度持久化）
  onBack: () => void;
  onPrevChapter: () => void;
  onNextChapter: () => void;
  onStartListen: () => void;
  onStopListen: () => void;
  onSegmentEditSubmit?: (index: number, payload: SegmentEditPayload) => void;
  onOpenSegmentEditor?: () => Promise<void> | void;
  audioOptions?: AudioOption[];
  isPlaying: boolean;
  currentSegIdx: number;
  onTogglePlayPause: () => void;
  onPlaySegment: (index: number) => void;
  onSelectChapter: (index: number) => void;
  onMenuItemClick: (id: string) => void;
  loadingMenuItemId?: string | null;
}

interface SegmentRowProps {
  index: number;
  item: ListenSegment;
  onLongPress: (index: number) => void;
  onPressIn: () => void;
  onSingleTap: () => void;
  onDoubleTap: (index: number) => void;
  isActive: boolean;
}

const DOUBLE_TAP_DELAY_MS = 280;
const AUTO_FOLLOW_SCROLL_DELAY_MS = 120;
const READER_HORIZONTAL_PADDING = 24;
const READER_TITLE_HEIGHT = 112;
const READER_PAGE_BOTTOM_SPACE = 64;
const READER_FONT_SIZE = 18;
const READER_LINE_HEIGHT = 32;
const READER_PARAGRAPH_GAP_LINES = 1;

type ReadingPageJump = 'first' | 'last';

type ReadingPagerItem =
  | {type: 'previous-chapter'}
  | {type: 'page'; text: string; pageIndex: number}
  | {type: 'next-chapter'};

const SegmentRow = memo(
  ({
    index,
    item,
    onLongPress,
    onPressIn,
    onSingleTap,
    onDoubleTap,
    isActive,
  }: SegmentRowProps) => {
    const lastTapTimeRef = useRef(0);
    const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
      null,
    );
    const isNarration = item.type === 'narration' || item.role === '旁白';
    const generationFailureHint =
      !item.audioUrl && item.generationError
        ? buildListenSegmentFailureHint(item.generationError)
        : '';

    useEffect(() => {
      return () => {
        if (singleTapTimerRef.current) {
          clearTimeout(singleTapTimerRef.current);
        }
      };
    }, []);

    const clearSingleTapTimer = useCallback(() => {
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
    }, []);

    const handlePress = useCallback(() => {
      const now = Date.now();
      const isDoubleTap =
        lastTapTimeRef.current > 0 &&
        now - lastTapTimeRef.current <= DOUBLE_TAP_DELAY_MS;

      if (isDoubleTap) {
        clearSingleTapTimer();
        lastTapTimeRef.current = 0;
        if (item.audioUrl) {
          onDoubleTap(index);
        }
        return;
      }

      lastTapTimeRef.current = now;
      clearSingleTapTimer();
      singleTapTimerRef.current = setTimeout(() => {
        lastTapTimeRef.current = 0;
        singleTapTimerRef.current = null;
        onSingleTap();
      }, DOUBLE_TAP_DELAY_MS);
    }, [clearSingleTapTimer, index, item.audioUrl, onDoubleTap, onSingleTap]);

    const handleLongPress = useCallback(() => {
      lastTapTimeRef.current = 0;
      clearSingleTapTimer();
      onLongPress(index);
    }, [clearSingleTapTimer, index, onLongPress]);

    return (
      <Pressable
        onPressIn={onPressIn}
        onPress={handlePress}
        onLongPress={handleLongPress}
        style={[
          styles.segmentWrapper,
          isActive && styles.segmentWrapperActive,
        ]}>
        <Text
          style={[
            styles.paragraphText,
            isNarration ? styles.paragraphNarration : null,
            isActive && styles.paragraphActiveText,
          ]}>
          {!isNarration && (
            <Text style={styles.roleTagInline}>{item.role} </Text>
          )}
          {item.text}
        </Text>
        {generationFailureHint ? (
          <Text style={styles.segmentFailureHint}>{generationFailureHint}</Text>
        ) : null}
      </Pressable>
    );
  },
  (prevProps, nextProps) =>
    prevProps.index === nextProps.index &&
    // 轮询会创建新对象；只有显示内容或双击可播放状态改变才更新行。
    prevProps.item.type === nextProps.item.type &&
    prevProps.item.role === nextProps.item.role &&
    prevProps.item.text === nextProps.item.text &&
    prevProps.item.audioUrl === nextProps.item.audioUrl &&
    prevProps.item.generationError === nextProps.item.generationError &&
    prevProps.onLongPress === nextProps.onLongPress &&
    prevProps.onPressIn === nextProps.onPressIn &&
    prevProps.onSingleTap === nextProps.onSingleTap &&
    prevProps.onDoubleTap === nextProps.onDoubleTap &&
    prevProps.isActive === nextProps.isActive,
);

const countTextUnits = (text: string) => {
  return Array.from(text).reduce((total, char) => {
    return total + (char.charCodeAt(0) <= 0x7f ? 0.55 : 1);
  }, 0);
};

const takeTextUnits = (text: string, maxUnits: number) => {
  let usedUnits = 0;
  let endIndex = 0;
  for (const char of Array.from(text)) {
    const units = char.charCodeAt(0) <= 0x7f ? 0.55 : 1;
    if (endIndex > 0 && usedUnits + units > maxUnits) {
      break;
    }
    usedUnits += units;
    endIndex += char.length;
  }
  return text.slice(0, endIndex);
};

const paginateParagraphs = (
  paragraphs: string[],
  viewportWidth: number,
  viewportHeight: number,
) => {
  const readableWidth = Math.max(
    viewportWidth - READER_HORIZONTAL_PADDING * 2,
    160,
  );
  const contentHeight = Math.max(
    viewportHeight - READER_TITLE_HEIGHT - READER_PAGE_BOTTOM_SPACE,
    240,
  );
  const charsPerLine = Math.max(
    Math.floor(readableWidth / READER_FONT_SIZE),
    8,
  );
  const linesPerPage = Math.max(
    Math.floor(contentHeight / READER_LINE_HEIGHT),
    6,
  );
  const unitsPerPage = Math.max(charsPerLine * linesPerPage, 48);
  const pages: string[] = [];
  let pageText = '';
  let usedUnits = 0;

  paragraphs
    .map(paragraph => paragraph.trim())
    .filter(Boolean)
    .forEach(paragraph => {
      let remaining = paragraph;
      while (remaining.length > 0) {
        const gapUnits = pageText
          ? charsPerLine * READER_PARAGRAPH_GAP_LINES
          : 0;
        const capacity = unitsPerPage - usedUnits - gapUnits;
        if (capacity <= Math.max(charsPerLine * 2, 16)) {
          pages.push(pageText);
          pageText = '';
          usedUnits = 0;
          continue;
        }

        const remainingUnits = countTextUnits(remaining);
        const chunk =
          remainingUnits <= capacity
            ? remaining
            : takeTextUnits(remaining, capacity);
        pageText = pageText ? `${pageText}\n\n${chunk}` : chunk;
        usedUnits += gapUnits + countTextUnits(chunk);
        remaining = remaining.slice(chunk.length).trimStart();

        if (remaining.length > 0) {
          pages.push(pageText);
          pageText = '';
          usedUnits = 0;
        }
      }
    });

  if (pageText) {
    pages.push(pageText);
  }

  return pages.length > 0 ? pages : [''];
};

interface ReaderContentListProps {
  chapterIndex: number;
  totalChapters: number;
  initialReadingPage: ReadingPageJump;
  onPreviousChapter: () => void;
  onNextChapter: () => void;
  shouldRenderListenContent: boolean;
  segments: ListenSegment[];
  contentParagraphs: string[];
  flatListRef: React.RefObject<FlatList>;
  onSegmentLongPress: (index: number) => void;
  onSegmentPressIn: () => void;
  onSegmentSingleTap: () => void;
  onPlaySegment: (index: number) => void;
  onScrollBeginDrag: () => void;
  onScrollEnd: (_event?: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onViewableItemsChanged: ({
    viewableItems,
  }: {
    viewableItems: Array<ViewToken>;
  }) => void;
  activeSegIdx: number;
  listenState: 'idle' | 'loading' | 'ready' | 'error';
}

const ReaderContentList = memo(
  ({
    chapterIndex,
    totalChapters,
    initialReadingPage,
    onPreviousChapter,
    onNextChapter,
    shouldRenderListenContent,
    segments,
    contentParagraphs,
    flatListRef,
    onSegmentLongPress,
    onSegmentPressIn,
    onSegmentSingleTap,
    onPlaySegment,
    onScrollBeginDrag,
    onScrollEnd,
    onViewableItemsChanged,
    activeSegIdx,
    listenState,
  }: ReaderContentListProps) => {
    const {width: windowWidth} = useWindowDimensions();
    const [readerHeight, setReaderHeight] = useState(0);
    const [readingPageIndex, setReadingPageIndex] = useState(0);
    const readingPagerRef = useRef<FlatList<ReadingPagerItem>>(null);
    const chapterTurnLockRef = useRef(false);
    // 播放回调随缓存窗口变化，使用稳定入口避免所有可见段落一起重新渲染。
    const actionsRef = useRef({
      onSegmentLongPress,
      onSegmentPressIn,
      onSegmentSingleTap,
      onPlaySegment,
    });
    useLayoutEffect(() => {
      actionsRef.current = {
        onSegmentLongPress,
        onSegmentPressIn,
        onSegmentSingleTap,
        onPlaySegment,
      };
    }, [
      onSegmentLongPress,
      onSegmentPressIn,
      onSegmentSingleTap,
      onPlaySegment,
    ]);
    const rowActions = useMemo(
      () => ({
        onLongPress: (index: number) =>
          actionsRef.current.onSegmentLongPress(index),
        onPressIn: () => actionsRef.current.onSegmentPressIn(),
        onSingleTap: () => actionsRef.current.onSegmentSingleTap(),
        onDoubleTap: (index: number) => actionsRef.current.onPlaySegment(index),
      }),
      [],
    );
    const canHighlight = listenState !== 'idle' && listenState !== 'error';
    const renderSegmentItem = useCallback(
      ({item, index}: {item: ListenSegment; index: number}) => {
        return (
          <SegmentRow
            index={index}
            item={item}
            onLongPress={rowActions.onLongPress}
            onPressIn={rowActions.onPressIn}
            onSingleTap={rowActions.onSingleTap}
            onDoubleTap={rowActions.onDoubleTap}
            isActive={canHighlight && index === activeSegIdx}
          />
        );
      },
      [activeSegIdx, canHighlight, rowActions],
    );

    const keyExtractor = useCallback(
      (_: ListenSegment, idx: number) => `seg_${idx}`,
      [],
    );
    const plainKeyExtractor = useCallback(
      (item: ReadingPagerItem, idx: number) => {
        if (item.type !== 'page') {
          return `${item.type}_${chapterIndex}`;
        }
        return `page_${chapterIndex}_${idx}`;
      },
      [chapterIndex],
    );

    const readingPages = useMemo(
      () => paginateParagraphs(contentParagraphs, windowWidth, readerHeight),
      [contentParagraphs, readerHeight, windowWidth],
    );

    const pageWidth = Math.max(windowWidth, 1);
    const lastPageIndex = Math.max(readingPages.length - 1, 0);
    const canTurnPreviousChapter = chapterIndex > 0;
    const canTurnNextChapter = chapterIndex < totalChapters - 1;
    const firstRealItemIndex = canTurnPreviousChapter ? 1 : 0;
    const targetPageIndex = initialReadingPage === 'last' ? lastPageIndex : 0;
    const targetItemIndex = firstRealItemIndex + targetPageIndex;
    const readingPagerItems = useMemo<ReadingPagerItem[]>(() => {
      const pageItems = readingPages.map((text, pageIndex) => ({
        type: 'page' as const,
        text,
        pageIndex,
      }));
      return [
        ...(canTurnPreviousChapter
          ? [{type: 'previous-chapter' as const}]
          : []),
        ...pageItems,
        ...(canTurnNextChapter ? [{type: 'next-chapter' as const}] : []),
      ];
    }, [canTurnNextChapter, canTurnPreviousChapter, readingPages]);

    useEffect(() => {
      chapterTurnLockRef.current = false;
      setReadingPageIndex(targetPageIndex);
      const timer = setTimeout(() => {
        readingPagerRef.current?.scrollToIndex({
          index: targetItemIndex,
          animated: false,
        });
      }, 0);
      return () => clearTimeout(timer);
    }, [chapterIndex, readingPages.length, targetItemIndex, targetPageIndex]);

    const getReadingItemLayout = useCallback(
      (
        _data: ArrayLike<ReadingPagerItem> | null | undefined,
        index: number,
      ) => ({
        length: pageWidth,
        offset: pageWidth * index,
        index,
      }),
      [pageWidth],
    );

    const renderReadingPage = useCallback(
      ({item}: {item: ReadingPagerItem}) => (
        <View style={[styles.readingPage, {width: pageWidth}]}>
          {item.type === 'page' ? (
            <Text style={styles.paragraphText}>{item.text}</Text>
          ) : (
            <View style={styles.chapterTurnPage}>
              <ActivityIndicator size="small" color="#8E7D64" />
              <Text style={styles.chapterTurnPageText}>
                {item.type === 'next-chapter'
                  ? '正在进入下一章'
                  : '正在返回上一章'}
              </Text>
            </View>
          )}
        </View>
      ),
      [pageWidth],
    );

    const handleReadingScrollEnd = useCallback(
      (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        const itemIndex = Math.round(
          event.nativeEvent.contentOffset.x / pageWidth,
        );

        if (chapterTurnLockRef.current) {
          onScrollEnd(event);
          return;
        }

        const item = readingPagerItems[itemIndex];
        if (item?.type === 'previous-chapter') {
          chapterTurnLockRef.current = true;
          onPreviousChapter();
          onScrollEnd(event);
          return;
        }
        if (item?.type === 'next-chapter') {
          chapterTurnLockRef.current = true;
          onNextChapter();
          onScrollEnd(event);
          return;
        }

        if (item?.type === 'page') {
          setReadingPageIndex(item.pageIndex);
        }
        onScrollEnd(event);
      },
      [
        onNextChapter,
        onPreviousChapter,
        onScrollEnd,
        pageWidth,
        readingPagerItems,
      ],
    );

    const handleScrollToIndexFailed = useCallback(
      (info: {
        index: number;
        highestMeasuredFrameIndex: number;
        averageItemLength: number;
      }) => {
        // 先滚动到估算位置，再延迟重试精确滚动
        flatListRef.current?.scrollToOffset({
          offset: info.averageItemLength * info.index,
          animated: false,
        });
        setTimeout(() => {
          if (flatListRef.current) {
            try {
              flatListRef.current.scrollToIndex({
                index: info.index,
                animated: true,
                viewPosition: 0.5,
              });
            } catch (_e) {
              // 忽略二次失败
            }
          }
        }, 200);
      },
      [flatListRef],
    );

    if (shouldRenderListenContent) {
      return (
        <FlatList
          key="listen-content-list"
          ref={flatListRef}
          data={segments}
          keyExtractor={keyExtractor}
          renderItem={renderSegmentItem}
          contentContainerStyle={styles.listPadding}
          showsVerticalScrollIndicator={false}
          onScrollBeginDrag={onScrollBeginDrag}
          onScrollEndDrag={onScrollEnd}
          onMomentumScrollBegin={onScrollBeginDrag}
          onMomentumScrollEnd={onScrollEnd}
          onViewableItemsChanged={onViewableItemsChanged}
          onScrollToIndexFailed={handleScrollToIndexFailed}
          viewabilityConfig={viewabilityConfig}
          initialNumToRender={10}
          maxToRenderPerBatch={6}
          windowSize={5}
          updateCellsBatchingPeriod={100}
          removeClippedSubviews
          scrollEventThrottle={16}
        />
      );
    }

    return (
      <View
        style={styles.readingPagerContainer}
        onLayout={event => setReaderHeight(event.nativeEvent.layout.height)}>
        <FlatList
          key={`reading-pager-${chapterIndex}`}
          ref={readingPagerRef}
          data={readingPagerItems}
          horizontal
          pagingEnabled
          initialScrollIndex={targetItemIndex}
          getItemLayout={getReadingItemLayout}
          keyExtractor={plainKeyExtractor}
          renderItem={renderReadingPage}
          showsHorizontalScrollIndicator={false}
          onScrollBeginDrag={onScrollBeginDrag}
          onScrollEndDrag={handleReadingScrollEnd}
          onMomentumScrollBegin={onScrollBeginDrag}
          onMomentumScrollEnd={handleReadingScrollEnd}
          initialNumToRender={2}
          maxToRenderPerBatch={2}
          windowSize={3}
          removeClippedSubviews
          scrollEventThrottle={16}
        />
        <View style={styles.readingPageIndicator} pointerEvents="none">
          <Text style={styles.readingPageIndicatorText}>
            本章第 {Math.min(readingPageIndex + 1, readingPages.length)} /{' '}
            {readingPages.length} 页
          </Text>
        </View>
      </View>
    );
  },
  (prevProps, nextProps) =>
    prevProps.chapterIndex === nextProps.chapterIndex &&
    prevProps.totalChapters === nextProps.totalChapters &&
    prevProps.initialReadingPage === nextProps.initialReadingPage &&
    prevProps.onPreviousChapter === nextProps.onPreviousChapter &&
    prevProps.onNextChapter === nextProps.onNextChapter &&
    prevProps.shouldRenderListenContent ===
      nextProps.shouldRenderListenContent &&
    prevProps.segments === nextProps.segments &&
    prevProps.contentParagraphs === nextProps.contentParagraphs &&
    prevProps.onSegmentLongPress === nextProps.onSegmentLongPress &&
    prevProps.onSegmentPressIn === nextProps.onSegmentPressIn &&
    prevProps.onSegmentSingleTap === nextProps.onSegmentSingleTap &&
    prevProps.onPlaySegment === nextProps.onPlaySegment &&
    prevProps.onScrollBeginDrag === nextProps.onScrollBeginDrag &&
    prevProps.onScrollEnd === nextProps.onScrollEnd &&
    prevProps.onViewableItemsChanged === nextProps.onViewableItemsChanged &&
    prevProps.activeSegIdx === nextProps.activeSegIdx &&
    prevProps.listenState === nextProps.listenState,
);

const viewabilityConfig = {
  itemVisiblePercentThreshold: 60,
};

const NovelReader: React.FC<NovelReaderProps> = ({
  currentChapter,
  chapterList,
  currentChapterIndex,
  contentParagraphs,
  readerLoading,
  listenState,
  listenPhase,
  segments,
  isListenMode,
  isGenerationComplete: _isGenerationComplete,
  projectName: _projectName,
  onBack,
  onPrevChapter,
  onNextChapter,
  onStartListen,
  onStopListen,
  onSegmentEditSubmit,
  onOpenSegmentEditor,
  audioOptions = [],
  isPlaying,
  currentSegIdx,
  onTogglePlayPause,
  onPlaySegment,
  onSelectChapter,
  onMenuItemClick,
  loadingMenuItemId,
}) => {
  const {height: windowHeight} = useWindowDimensions();
  const [showOverlay, setShowOverlay] = useState(false);
  const [catalogVisible, setCatalogVisible] = useState(false);
  const overlayAnim = useRef(new Animated.Value(0)).current;
  const flatListRef = useRef<FlatList>(null);
  const touchStartRef = useRef({x: 0, y: 0, time: 0});
  const isScrollGestureRef = useRef(false);
  const suppressOverlayTapRef = useRef(false);
  const autoFollowPlaybackRef = useRef(true);
  const currentSegIdxRef = useRef(currentSegIdx);
  const scrollUnlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const autoFollowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [editorVisible, setEditorVisible] = useState(false);
  const [editingSegIndex, setEditingSegIndex] = useState(-1);
  const [initialReadingPage, setInitialReadingPage] =
    useState<ReadingPageJump>('first');

  const effectiveListenState = isListenMode ? listenState : 'idle';
  const shouldRenderListenContent =
    isListenMode && (segments.length > 0 || listenState === 'loading');
  const availableRoles = useMemo(
    () =>
      Array.from(
        new Set(
          segments
            .map(segment => segment?.role)
            .filter(role => role && role !== '旁白'),
        ),
      ) as string[],
    [segments],
  );
  const editingSegment =
    editingSegIndex >= 0 ? segments[editingSegIndex] : undefined;

  useEffect(() => {
    currentSegIdxRef.current = currentSegIdx;
  }, [currentSegIdx]);

  useEffect(() => {
    autoFollowPlaybackRef.current = true;
  }, [currentChapterIndex]);

  // 如果是在听书状态，随着段落滚动
  useEffect(() => {
    if (autoFollowTimerRef.current) {
      clearTimeout(autoFollowTimerRef.current);
      autoFollowTimerRef.current = null;
    }

    if (
      !autoFollowPlaybackRef.current ||
      currentSegIdx < 0 ||
      segments.length === 0
    ) {
      return;
    }

    autoFollowTimerRef.current = setTimeout(() => {
      try {
        flatListRef.current?.scrollToIndex({
          index: currentSegIdx,
          animated: false,
          viewPosition: 0.5,
        });
      } catch (e) {
        // FlatList 未准备好时可能报错，onScrollToIndexFailed 会兜底
      }
    }, AUTO_FOLLOW_SCROLL_DELAY_MS);
  }, [currentSegIdx, segments.length]);

  useEffect(() => {
    return () => {
      if (scrollUnlockTimerRef.current) {
        clearTimeout(scrollUnlockTimerRef.current);
      }
      if (autoFollowTimerRef.current) {
        clearTimeout(autoFollowTimerRef.current);
      }
    };
  }, []);

  const toggleOverlay = useCallback(() => {
    const nextShowOverlay = !showOverlay;
    const toValue = nextShowOverlay ? 1 : 0;
    setShowOverlay(nextShowOverlay);
    Animated.timing(overlayAnim, {
      toValue,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [overlayAnim, showOverlay]);

  const headerTranslateY = overlayAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-120, 0],
  });
  const footerTranslateY = overlayAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [windowHeight, 0],
  });

  const handleSegmentLongPress = useCallback(
    async (index: number) => {
      setEditingSegIndex(index);
      await onOpenSegmentEditor?.();
      setEditorVisible(true);
    },
    [onOpenSegmentEditor],
  );

  const handleEditSubmit = useCallback(
    (data: SegmentEditPayload) => {
      if (editingSegIndex >= 0 && onSegmentEditSubmit) {
        onSegmentEditSubmit(editingSegIndex, data);
      }
      setEditorVisible(false);
    },
    [editingSegIndex, onSegmentEditSubmit],
  );

  const handleStopListen = useCallback(() => {
    onStopListen();
  }, [onStopListen]);

  const handlePreviousReadingChapter = useCallback(() => {
    setInitialReadingPage('last');
    onPrevChapter();
  }, [onPrevChapter]);

  const handleNextReadingChapter = useCallback(() => {
    setInitialReadingPage('first');
    onNextChapter();
  }, [onNextChapter]);

  const handleSelectReadingChapter = useCallback(
    (index: number) => {
      setInitialReadingPage('first');
      onSelectChapter(index);
    },
    [onSelectChapter],
  );

  const handleTouchStart = (event: GestureResponderEvent) => {
    const {pageX, pageY} = event.nativeEvent;
    touchStartRef.current = {
      x: pageX,
      y: pageY,
      time: Date.now(),
    };
  };

  const clearScrollGestureWithDelay = useCallback(() => {
    if (scrollUnlockTimerRef.current) {
      clearTimeout(scrollUnlockTimerRef.current);
    }
    scrollUnlockTimerRef.current = setTimeout(() => {
      isScrollGestureRef.current = false;
    }, 180);
  }, []);

  const markAsScrollGesture = useCallback(() => {
    if (scrollUnlockTimerRef.current) {
      clearTimeout(scrollUnlockTimerRef.current);
    }
    isScrollGestureRef.current = true;
  }, []);

  const handleTouchEnd = (event: GestureResponderEvent) => {
    if (suppressOverlayTapRef.current) {
      suppressOverlayTapRef.current = false;
      return;
    }

    const {pageX, pageY} = event.nativeEvent;
    const deltaX = Math.abs(pageX - touchStartRef.current.x);
    const deltaY = Math.abs(pageY - touchStartRef.current.y);
    const duration = Date.now() - touchStartRef.current.time;
    const isShortTap = duration <= 220 && deltaX <= 12 && deltaY <= 12;

    if (!isScrollGestureRef.current && isShortTap) {
      toggleOverlay();
    }
  };

  const handleSegmentPressIn = useCallback(() => {
    suppressOverlayTapRef.current = true;
  }, []);

  const handleScrollBeginDrag = useCallback(() => {
    markAsScrollGesture();
    if (shouldRenderListenContent) {
      autoFollowPlaybackRef.current = false;
    }
  }, [markAsScrollGesture, shouldRenderListenContent]);

  const handleScrollEnd = useCallback(
    (_event?: NativeSyntheticEvent<NativeScrollEvent>) => {
      clearScrollGestureWithDelay();
    },
    [clearScrollGestureWithDelay],
  );

  const handleViewableItemsChangedRef = useRef(
    (_info: {viewableItems: Array<ViewToken>}) => {
      // 不再自动重新开启跟随，用户手动滑动后只有切换章节才恢复
    },
  );

  return (
    <View style={styles.container}>
      {/* 内容展示区 */}
      <View
        style={styles.contentArea}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}>
        <Text style={styles.chapterTitle}>
          {currentChapter?.title || readerLoading?.detail || '正在准备章节'}
        </Text>
        <ReaderContentList
          chapterIndex={currentChapterIndex}
          totalChapters={chapterList.length}
          initialReadingPage={initialReadingPage}
          onPreviousChapter={handlePreviousReadingChapter}
          onNextChapter={handleNextReadingChapter}
          shouldRenderListenContent={shouldRenderListenContent}
          segments={segments}
          contentParagraphs={contentParagraphs}
          flatListRef={flatListRef}
          onSegmentLongPress={handleSegmentLongPress}
          onSegmentPressIn={handleSegmentPressIn}
          onSegmentSingleTap={toggleOverlay}
          onPlaySegment={onPlaySegment}
          onScrollBeginDrag={handleScrollBeginDrag}
          onScrollEnd={handleScrollEnd}
          onViewableItemsChanged={handleViewableItemsChangedRef.current}
          activeSegIdx={currentSegIdx}
          listenState={effectiveListenState}
        />
        {readerLoading ? (
          <View style={styles.readerLoadingOverlay} pointerEvents="none">
            <View style={styles.readerLoadingPanel}>
              <ActivityIndicator size="large" color="#007AFF" />
              <Text style={styles.readerLoadingTitle}>
                {readerLoading.title}
              </Text>
              {readerLoading.detail ? (
                <Text style={styles.readerLoadingDetail} numberOfLines={2}>
                  {readerLoading.detail}
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}
      </View>

      {/* 动画弹出的控制器 UI 层 */}
      <Animated.View
        style={styles.overlayContainer}
        pointerEvents={showOverlay ? 'box-none' : 'none'}>
        <Animated.View
          style={[
            styles.headerWrapper,
            {transform: [{translateY: headerTranslateY}]},
          ]}>
          <ReaderHeader
            onBack={onBack}
            title={currentChapter?.title}
            onMenuClick={menuName => {
              if (menuName === 'catalog') {
                setCatalogVisible(true);
                toggleOverlay(); // 隐藏上下控制栏
              }
            }}
          />
        </Animated.View>
        <Animated.View
          style={[
            styles.footerWrapper,
            {transform: [{translateY: footerTranslateY}]},
          ]}>
          <ReaderFooter
            showChapterControls={isListenMode}
            currentChapter={currentChapterIndex}
            totalChapters={chapterList.length}
            listenState={effectiveListenState}
            listenPhaseText={listenPhase}
            isPlaying={isPlaying}
            currentSegIdx={currentSegIdx}
            totalSegments={segments.length}
            onStartListen={onStartListen}
            onTogglePlayPause={onTogglePlayPause}
            onStopListen={handleStopListen}
            onPrevChapter={onPrevChapter}
            onNextChapter={onNextChapter}
            onMenuItemClick={onMenuItemClick}
            loadingMenuItemId={loadingMenuItemId}
          />
        </Animated.View>
      </Animated.View>

      <SegmentEditorModal
        visible={editorVisible}
        segment={editingSegment}
        availableRoles={availableRoles}
        audioOptions={audioOptions}
        onClose={() => setEditorVisible(false)}
        onSave={handleEditSubmit}
      />

      <ReaderCatalog
        visible={catalogVisible}
        chapters={chapterList}
        currentIndex={currentChapterIndex}
        onClose={() => setCatalogVisible(false)}
        onSelectChapter={handleSelectReadingChapter}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F4F1E8', // 沉浸阅读舒适黄纸色
  },
  contentArea: {
    flex: 1,
    position: 'relative',
  },
  chapterTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#000',
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'ios' ? 60 : 60,
    paddingBottom: 24,
    fontFamily: Platform.OS === 'ios' ? 'Palatino' : 'serif',
  },
  listPadding: {
    paddingHorizontal: 24,
    paddingBottom: 160,
  },
  readingPagerContainer: {
    flex: 1,
    position: 'relative',
  },
  readingPage: {
    paddingHorizontal: READER_HORIZONTAL_PADDING,
    paddingBottom: READER_PAGE_BOTTOM_SPACE,
  },
  readingPageIndicator: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 22,
    alignItems: 'center',
  },
  readingPageIndicatorText: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.06)',
    color: '#6F675A',
    fontSize: 12,
    lineHeight: 16,
  },
  readerLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: 'rgba(244, 241, 232, 0.72)',
  },
  readerLoadingPanel: {
    minWidth: 188,
    maxWidth: 280,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    paddingHorizontal: 20,
    paddingVertical: 18,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 4,
  },
  readerLoadingTitle: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: '600',
    color: '#1C1C1E',
    textAlign: 'center',
  },
  readerLoadingDetail: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 18,
    color: '#636366',
    textAlign: 'center',
  },
  segmentWrapper: {
    // marginBottom: 10,
    padding: 12,
    borderRadius: 8,
  },
  segmentWrapperActive: {
    backgroundColor: 'rgba(0,122,255,0.1)',
    borderLeftWidth: 3,
    borderLeftColor: '#007AFF',
    paddingLeft: 9,
  },
  roleTagWrap: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(124,111,247,0.1)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginBottom: 4,
  },
  roleTag: {
    fontSize: 12,
    color: '#7c6ff7',
    fontWeight: '600',
  },
  roleTagInline: {
    color: '#7c6ff7',
    fontSize: 14,
    fontWeight: '600',
  },
  paragraphText: {
    fontSize: 18,
    color: '#333333',
    lineHeight: 32,
    fontFamily: Platform.OS === 'ios' ? 'Palatino' : 'serif',
  },
  paragraphNarration: {
    paddingLeft: 0,
  },
  paragraphActiveText: {
    color: '#000',
    fontWeight: '500',
  },
  segmentFailureHint: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 18,
    color: '#C2410C',
  },
  overlayContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
  },
  headerWrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  footerWrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
});

export default memo(NovelReader);
