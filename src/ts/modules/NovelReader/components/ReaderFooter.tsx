import React, {memo, useCallback, useContext} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  SafeAreaView,
  Image,
} from 'react-native';
import {PlaybackProgressContext} from '../contexts/ActiveSegContext';
import PlaybackRateControl from './PlaybackRateControl';
import {AppImages} from '../../../../assets';

interface ReaderFooterProps {
  showChapterControls: boolean;
  currentChapter: number;
  totalChapters: number;
  listenState: string; // 'idle' | 'loading' | 'ready' | 'error'
  listenPhaseText?: string;
  isPlaying: boolean;
  currentSegIdx?: number; // 当前播放段落序号
  totalSegments?: number; // 总段落数
  onStartListen: () => void;
  onTogglePlayPause: () => void;
  onStopListen: () => void;
  onPrevChapter: () => void;
  onNextChapter: () => void;
  onMenuItemClick?: (itemIdentifier: string) => void;
  canAppendChapters?: boolean;
  loadingMenuItemId?: string | null;
  /** 点击展开当前章节演播生成的详细进度面板 */
  onOpenPreparation?: () => void;
}

// 模块级常量：6 项功能，3 列 × 2 行完美对称
const MENU_ITEMS: ReadonlyArray<{label: string; id: string}> = [
  {label: '下载本章语音', id: 'download'},
  {label: '重新生成', id: 'regenerate'},
  {label: '定时关闭', id: 'sleep'},
  {label: '书源切换', id: 'source'},
  {label: '翻页模式', id: 'flip'},
  {label: '书籍详情', id: 'info'},
];
const APPEND_CHAPTER_ITEM = {label: '追加章节', id: 'append_chapter'};

/** 1. 下载语音：精致单色下载箭头与托盘 */
const DownloadAudioIcon = memo(() => (
  <View style={styles.iconBox}>
    <View style={styles.downloadStem} />
    <View style={styles.downloadArrow} />
    <View style={styles.downloadBase} />
  </View>
));

/** 2. 重新生成：单色琥珀暖金双向循环箭头 */
const RegenerateIcon = memo(() => (
  <Image
    source={AppImages.refresh}
    style={styles.refreshIconImg}
    resizeMode="contain"
  />
));

/** 3. 定时关闭：优雅纯净弦月 */
const SleepTimerIcon = memo(() => (
  <View style={styles.iconBox}>
    <View style={styles.moonCrescent} />
  </View>
));

/** 4. 书源切换：单色经纬线框地球仪 */
const SourceGlobeIcon = memo(() => (
  <View style={styles.globeBox}>
    <View style={styles.globeEquator} />
    <View style={styles.globeMeridian} />
  </View>
));

/** 5. 翻页模式：单色对称开卷书册 */
const FlipBookIcon = memo(() => (
  <View style={styles.bookBox}>
    <View style={[styles.bookPage, styles.bookPageLeft]} />
    <View style={styles.bookSpine} />
    <View style={[styles.bookPage, styles.bookPageRight]} />
  </View>
));

/** 6. 书籍详情：单色圆环信息 i */
const InfoDetailIcon = memo(() => (
  <View style={styles.infoBox}>
    <View style={styles.infoDot} />
    <View style={styles.infoStem} />
  </View>
));

/** 统一分发高质感单色琥珀图标 */
const renderMenuIcon = (id: string) => {
  switch (id) {
    case 'download':
      return <DownloadAudioIcon />;
    case 'regenerate':
      return <RegenerateIcon />;
    case 'sleep':
      return <SleepTimerIcon />;
    case 'source':
    case 'append_chapter':
      return <SourceGlobeIcon />;
    case 'flip':
      return <FlipBookIcon />;
    case 'info':
      return <InfoDetailIcon />;
    default:
      return <DownloadAudioIcon />;
  }
};

const formatTime = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

/**
 * 迷你进度条 —— 独立订阅高频 PlaybackProgressContext
 */
interface MiniProgressBarProps {
  currentSegIdx: number;
  totalSegments: number;
}

const MiniProgressBar: React.FC<MiniProgressBarProps> = memo(
  ({currentSegIdx, totalSegments}) => {
    const {currentProgress, totalDuration} = useContext(
      PlaybackProgressContext,
    );
    const progressPercent =
      totalDuration > 0 ? Math.min(currentProgress / totalDuration, 1) : 0;

    return (
      <View style={styles.miniProgressContainer}>
        <Text style={styles.miniProgressText}>
          {currentSegIdx + 1}/{totalSegments} 段
        </Text>
        <View style={styles.miniProgressBar}>
          <View
            style={[
              styles.miniProgressFill,
              {width: `${progressPercent * 100}%`},
            ]}
          />
        </View>
        <Text style={styles.miniProgressTime}>
          {formatTime(currentProgress)}
          {totalDuration > 0 ? ` / ${formatTime(totalDuration)}` : ''}
        </Text>
      </View>
    );
  },
);
MiniProgressBar.displayName = 'MiniProgressBar';

/**
 * grid 子项 —— memo 化避免父级 render 时整组重建
 */
interface FooterMenuItemProps {
  id: string;
  label: string;
  isLoading: boolean;
  onPress: (id: string) => void;
}

const FooterMenuItem: React.FC<FooterMenuItemProps> = memo(
  ({id, label, isLoading, onPress}) => {
    const handlePress = useCallback(() => {
      if (!isLoading) {
        onPress(id);
      }
    }, [id, isLoading, onPress]);

    return (
      <TouchableOpacity
        style={styles.gridItem}
        disabled={isLoading}
        onPress={handlePress}
        activeOpacity={0.75}>
        <View style={styles.gridIconCircle}>
          {isLoading ? (
            <ActivityIndicator size="small" color="#D97706" />
          ) : (
            renderMenuIcon(id)
          )}
        </View>
        <Text style={styles.gridLabelText} numberOfLines={1}>
          {label}
        </Text>
      </TouchableOpacity>
    );
  },
);
FooterMenuItem.displayName = 'FooterMenuItem';

const ReaderFooter: React.FC<ReaderFooterProps> = ({
  showChapterControls,
  currentChapter,
  totalChapters,
  listenState,
  listenPhaseText = '处理中…',
  isPlaying,
  currentSegIdx = -1,
  totalSegments = 0,
  onStartListen,
  onTogglePlayPause,
  onStopListen,
  onPrevChapter,
  onNextChapter,
  onMenuItemClick,
  canAppendChapters,
  loadingMenuItemId,
  onOpenPreparation,
}) => {
  const handleMenuPress = useCallback(
    (id: string) => {
      onMenuItemClick?.(id);
    },
    [onMenuItemClick],
  );
  const menuItems = canAppendChapters
    ? MENU_ITEMS.map(item =>
        item.id === 'source' ? APPEND_CHAPTER_ITEM : item,
      )
    : MENU_ITEMS;

  const renderListenControl = () => {
    switch (listenState) {
      case 'idle':
        return (
          <TouchableOpacity
            style={styles.listenBtn}
            onPress={onStartListen}
            activeOpacity={0.85}>
            <Text style={styles.listenBtnText}>开启多角色听书</Text>
          </TouchableOpacity>
        );
      case 'loading':
        return (
          <TouchableOpacity
            style={styles.loadingControl}
            onPress={onOpenPreparation}
            activeOpacity={onOpenPreparation ? 0.75 : 1}
            disabled={!onOpenPreparation}
            accessibilityRole={onOpenPreparation ? 'button' : undefined}
            accessibilityLabel={
              onOpenPreparation
                ? `${listenPhaseText || '正在解析并生成演播音频'}，点击查看生成进度`
                : undefined
            }>
            <ActivityIndicator size="small" color="#D97706" />
            <Text style={styles.loadingText} numberOfLines={1}>
              {listenPhaseText || '正在解析并生成演播音频…'}
            </Text>
            {onOpenPreparation && (
              <View style={styles.loadingActionBadge}>
                <Text style={styles.loadingActionText}>展开进度 ›</Text>
              </View>
            )}
          </TouchableOpacity>
        );
      case 'ready':
        return (
          <View style={styles.listenReadyContainer}>
            {/* 播放控制按钮行 */}
            <View style={styles.listenReadyActions}>
              <TouchableOpacity
                style={styles.listenBtnReady}
                onPress={onTogglePlayPause}
                activeOpacity={0.85}>
                <Text style={styles.listenBtnTextReady}>
                  {isPlaying ? '暂停演播' : '继续演播'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.listenBtnGhost}
                onPress={onStopListen}
                activeOpacity={0.8}>
                <Text style={styles.listenBtnGhostText}>
                  {isPlaying ? '退出听书' : '取消'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      case 'error':
        return (
          <TouchableOpacity
            style={styles.listenBtnError}
            onPress={onStartListen}
            activeOpacity={0.85}>
            <Text style={styles.listenBtnTextError}>重试演播生成</Text>
          </TouchableOpacity>
        );
      default:
        return null;
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.innerBox}>
        {/* 阅读进度与听书控制 */}
        <View style={styles.playbackControls}>{renderListenControl()}</View>

        <View style={styles.progressRow}>
          <Text style={styles.progressText}>第 {currentChapter + 1} 章</Text>
          <View style={styles.listenWrapper}>
            {listenState === 'ready' && currentSegIdx >= 0 && (
              <MiniProgressBar
                currentSegIdx={currentSegIdx}
                totalSegments={totalSegments}
              />
            )}
          </View>
          <Text style={styles.progressText}>
            {currentChapter + 1} / {totalChapters} 章
          </Text>
        </View>

        <View style={styles.rateRow}>
          <PlaybackRateControl />
        </View>

        {/* 快捷功能网格 */}
        <View style={styles.gridContainer}>
          {menuItems
            .filter(
              item =>
                showChapterControls ||
                (item.id !== 'download' && item.id !== 'regenerate'),
            )
            .map(item => (
              <FooterMenuItem
                key={item.id}
                id={item.id}
                label={item.label}
                isLoading={loadingMenuItemId === item.id}
                onPress={handleMenuPress}
              />
            ))}
        </View>

        {/* 底部换章操作 */}
        {showChapterControls && (
          <View style={styles.chapterControlRow}>
            <TouchableOpacity
              style={[
                styles.chapterBtn,
                currentChapter <= 0 && styles.chapterBtnDisabled,
              ]}
              onPress={onPrevChapter}
              disabled={currentChapter <= 0}
              activeOpacity={0.78}>
              <Text style={styles.chapterBtnText}>上一章</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.chapterBtn,
                styles.chapterBtnPrimary,
                currentChapter >= totalChapters - 1 &&
                  styles.chapterBtnDisabled,
              ]}
              onPress={onNextChapter}
              disabled={currentChapter >= totalChapters - 1}
              activeOpacity={0.85}>
              <Text style={styles.chapterBtnPrimaryText}>下一章</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#EFECE6',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    shadowColor: '#1C1917',
    shadowOffset: {width: 0, height: -4},
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 12,
  },
  innerBox: {
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 28,
  },
  playbackControls: {
    alignItems: 'center',
    marginBottom: 16,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  rateRow: {
    marginBottom: 16,
  },
  progressText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#78716C',
  },
  listenWrapper: {
    flex: 1,
    minWidth: 0,
    marginHorizontal: 10,
    alignItems: 'center',
  },
  listenReadyContainer: {
    alignItems: 'center',
  },
  listenReadyActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  listenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#D97706', // 琥珀暖金
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 20,
    shadowColor: '#D97706',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.28,
    shadowRadius: 8,
    elevation: 4,
  },
  listenBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  listenBtnReady: {
    backgroundColor: '#D97706',
    paddingHorizontal: 20,
    paddingVertical: 9,
    borderRadius: 18,
    shadowColor: '#D97706',
    shadowOffset: {width: 0, height: 3},
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  listenBtnTextReady: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  listenBtnGhost: {
    backgroundColor: '#FAF5ED',
    borderWidth: 1,
    borderColor: '#EFE8DE',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 18,
  },
  listenBtnGhostText: {
    color: '#78716C',
    fontSize: 13,
    fontWeight: '600',
  },
  listenBtnError: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 18,
  },
  listenBtnTextError: {
    color: '#DC2626',
    fontSize: 13,
    fontWeight: '600',
  },
  loadingControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 9,
    backgroundColor: '#FAF5ED',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#EFE8DE',
    shadowColor: '#1C1917',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  loadingText: {
    fontSize: 12,
    color: '#B45309',
    fontWeight: '600',
    maxWidth: 220,
  },
  loadingActionBadge: {
    backgroundColor: 'rgba(217, 119, 6, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: 'rgba(217, 119, 6, 0.25)',
  },
  loadingActionText: {
    fontSize: 11,
    color: '#B45309',
    fontWeight: '700',
  },
  miniProgressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    width: '100%',
    paddingHorizontal: 4,
  },
  miniProgressText: {
    fontSize: 10,
    color: '#B45309',
    fontWeight: '700',
    minWidth: 44,
  },
  miniProgressBar: {
    flex: 1,
    height: 4,
    backgroundColor: 'rgba(217, 119, 6, 0.15)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  miniProgressFill: {
    height: '100%',
    backgroundColor: '#D97706',
    borderRadius: 2,
  },
  miniProgressTime: {
    fontSize: 10,
    color: '#A8A29E',
    minWidth: 64,
    textAlign: 'right',
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    marginBottom: 20,
    marginHorizontal: -4,
  },
  gridItem: {
    width: '33.33%', // 3 列 × 2 行，完美对称
    alignItems: 'center',
    marginBottom: 16,
  },
  gridIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FAF5ED',
    borderWidth: 1,
    borderColor: '#EFE8DE',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 7,
    shadowColor: '#1C1917',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  gridLabelText: {
    fontSize: 12,
    color: '#44403C',
    fontWeight: '600',
    textAlign: 'center',
  },
  iconBox: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  downloadStem: {
    width: 2,
    height: 8,
    backgroundColor: '#B45309',
    borderRadius: 1,
  },
  downloadArrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 4.5,
    borderRightWidth: 4.5,
    borderTopWidth: 5.5,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#B45309',
    marginTop: -1,
  },
  downloadBase: {
    width: 15,
    height: 1.8,
    backgroundColor: '#B45309',
    borderRadius: 1,
    marginTop: 2.5,
  },
  refreshIconImg: {
    width: 20,
    height: 20,
    tintColor: '#B45309',
  },
  moonCrescent: {
    width: 17,
    height: 17,
    borderRadius: 8.5,
    borderLeftWidth: 2.2,
    borderBottomWidth: 2.2,
    borderTopWidth: 0.5,
    borderRightWidth: 0,
    borderColor: '#B45309',
    transform: [{rotate: '-45deg'}],
  },
  globeBox: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: '#B45309',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  globeEquator: {
    position: 'absolute',
    width: '100%',
    height: 1.5,
    backgroundColor: '#B45309',
  },
  globeMeridian: {
    width: 8,
    height: '100%',
    borderRadius: 4,
    borderWidth: 1.2,
    borderColor: '#B45309',
  },
  bookBox: {
    width: 20,
    height: 17,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bookPage: {
    flex: 1,
    height: 16,
    borderWidth: 1.5,
    borderColor: '#B45309',
    backgroundColor: 'transparent',
  },
  bookPageLeft: {
    borderTopLeftRadius: 3,
    borderBottomLeftRadius: 3,
    borderRightWidth: 0,
  },
  bookPageRight: {
    borderTopRightRadius: 3,
    borderBottomRightRadius: 3,
    borderLeftWidth: 0,
  },
  bookSpine: {
    width: 1.8,
    height: 16,
    backgroundColor: '#B45309',
  },
  infoBox: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: '#B45309',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 1.5,
  },
  infoDot: {
    width: 2.2,
    height: 2.2,
    borderRadius: 1.1,
    backgroundColor: '#B45309',
    marginBottom: 1.5,
  },
  infoStem: {
    width: 2,
    height: 6.5,
    borderRadius: 1,
    backgroundColor: '#B45309',
  },
  chapterControlRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 14,
  },
  chapterBtn: {
    flex: 1,
    backgroundColor: '#FAF5ED',
    borderWidth: 1,
    borderColor: '#EFE8DE',
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: 'center',
  },
  chapterBtnDisabled: {
    opacity: 0.4,
  },
  chapterBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#44403C',
  },
  chapterBtnPrimary: {
    backgroundColor: '#D97706',
    borderColor: '#D97706',
    shadowColor: '#D97706',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  chapterBtnPrimaryText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});

export default memo(ReaderFooter);
