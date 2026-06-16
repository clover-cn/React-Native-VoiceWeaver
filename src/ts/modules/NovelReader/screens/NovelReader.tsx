import React, {
  memo,
  useCallback,
  useEffect,
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
} from 'react-native';
import {Chapter, ListenSegment} from '../types/reader';
import ReaderHeader from '../components/ReaderHeader';
import ReaderFooter from '../components/ReaderFooter';
import SegmentEditorModal, {
  SegmentEditPayload,
} from '../components/SegmentEditorModal';
import ReaderCatalog from '../components/ReaderCatalog';
import {AudioOption} from '../types/audio';

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
      </Pressable>
    );
  },
  (prevProps, nextProps) =>
    prevProps.index === nextProps.index &&
    prevProps.item === nextProps.item &&
    prevProps.onLongPress === nextProps.onLongPress &&
    prevProps.onPressIn === nextProps.onPressIn &&
    prevProps.onSingleTap === nextProps.onSingleTap &&
    prevProps.onDoubleTap === nextProps.onDoubleTap &&
    prevProps.isActive === nextProps.isActive,
);

const PlainParagraphRow = memo(({item}: {item: string}) => (
  <View style={styles.segmentWrapper}>
    <Text style={styles.paragraphText}>{item}</Text>
  </View>
));

interface ReaderContentListProps {
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
    const canHighlight = listenState !== 'idle' && listenState !== 'error';
    const renderSegmentItem = useCallback(
      ({item, index}: {item: ListenSegment; index: number}) => {
        return (
          <SegmentRow
            index={index}
            item={item}
            onLongPress={onSegmentLongPress}
            onPressIn={onSegmentPressIn}
            onSingleTap={onSegmentSingleTap}
            onDoubleTap={onPlaySegment}
            isActive={canHighlight && index === activeSegIdx}
          />
        );
      },
      [
        activeSegIdx,
        canHighlight,
        onPlaySegment,
        onSegmentPressIn,
        onSegmentLongPress,
        onSegmentSingleTap,
      ],
    );

    const renderPlainParagraph = useCallback(
      ({item}: {item: string}) => <PlainParagraphRow item={item} />,
      [],
    );

    const keyExtractor = useCallback(
      (_: ListenSegment, idx: number) => `seg_${idx}`,
      [],
    );
    const plainKeyExtractor = useCallback(
      (_: string, idx: number) => `para_${idx}`,
      [],
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
      <FlatList
        key="plain-content-list"
        data={contentParagraphs}
        keyExtractor={plainKeyExtractor}
        renderItem={renderPlainParagraph}
        contentContainerStyle={styles.listPadding}
        showsVerticalScrollIndicator={false}
        onScrollBeginDrag={onScrollBeginDrag}
        onScrollEndDrag={onScrollEnd}
        onMomentumScrollBegin={onScrollBeginDrag}
        onMomentumScrollEnd={onScrollEnd}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        initialNumToRender={8}
        maxToRenderPerBatch={6}
        windowSize={6}
        removeClippedSubviews
        scrollEventThrottle={16}
      />
    );
  },
  (prevProps, nextProps) =>
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
  const [showOverlay, setShowOverlay] = useState(false);
  const [catalogVisible, setCatalogVisible] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const flatListRef = useRef<FlatList>(null);
  const touchStartRef = useRef({x: 0, y: 0, time: 0});
  const isScrollGestureRef = useRef(false);
  const suppressOverlayTapRef = useRef(false);
  const autoFollowPlaybackRef = useRef(true);
  const currentSegIdxRef = useRef(currentSegIdx);
  const scrollUnlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const autoFollowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const [editorVisible, setEditorVisible] = useState(false);
  const [editingSegIndex, setEditingSegIndex] = useState(-1);

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
    Animated.timing(fadeAnim, {
      toValue,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim, showOverlay]);

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
        style={[styles.overlayContainer, {opacity: fadeAnim}]}
        pointerEvents={showOverlay ? 'box-none' : 'none'}>
        <View style={styles.headerWrapper}>
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
        </View>
        <View style={styles.footerWrapper}>
          <ReaderFooter
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
        </View>
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
        onSelectChapter={onSelectChapter}
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
