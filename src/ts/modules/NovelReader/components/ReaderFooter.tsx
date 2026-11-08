import React, {memo, useCallback, useContext} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import {PlaybackProgressContext} from '../contexts/ActiveSegContext';
import PlaybackRateControl from './PlaybackRateControl';

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
  loadingMenuItemId?: string | null;
}

// 模块级常量与工具函数 —— 单行 4 项，超出自动换行
const MENU_ITEMS: ReadonlyArray<{label: string; id: string}> = [
  {label: '音色分配', id: 'voiceGraph'},
  {label: '定时关闭', id: 'sleep'},
  {label: '书源切换', id: 'source'},
  {label: '翻页模式', id: 'flip'},
  {label: '书籍详情', id: 'info'},
];

// 统一温润有声意象：
// 🎧 耳机替代老式麦克风（更具聆听陪伴感）
// 🌙 柔和月亮替代红白秒表（传达睡前伴眠定时心智）
// 🌐 网络地球替代蓝块箭头（更具书源规则质感）
// 📖 书卷替代单页纸
// ℹ️ 详情信息
const MENU_ICONS: Record<string, string> = {
  voiceGraph: '🕸',
  audio: '🎧',
  sleep: '🌙',
  source: '🌐',
  flip: '📖',
  info: 'ℹ️',
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
            <Text style={styles.gridIconText}>{MENU_ICONS[id] || '⚙️'}</Text>
          )}
        </View>
        <Text style={styles.gridLabelText}>{label}</Text>
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
  loadingMenuItemId,
}) => {
  const handleMenuPress = useCallback(
    (id: string) => {
      onMenuItemClick?.(id);
    },
    [onMenuItemClick],
  );

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
          <View style={styles.loadingControl}>
            <ActivityIndicator size="small" color="#D97706" />
            <Text style={styles.loadingText}>
              {listenPhaseText || '正在解析并生成演播音频…'}
            </Text>
          </View>
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
          {MENU_ITEMS.filter(
            item => item.id !== 'voiceGraph' || showChapterControls,
          ).map(item => (
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
    paddingHorizontal: 18,
    paddingVertical: 9,
    backgroundColor: '#FAF5ED',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#EFE8DE',
  },
  loadingText: {
    fontSize: 12,
    color: '#B45309',
    fontWeight: '600',
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
  },
  gridItem: {
    width: '25%', // 每行 4 项等宽排列，超出自动换行
    alignItems: 'center',
    marginBottom: 14,
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
    marginBottom: 6,
    shadowColor: '#1C1917',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 1,
  },
  gridIconText: {
    fontSize: 20,
  },
  gridLabelText: {
    fontSize: 11,
    color: '#57534E',
    fontWeight: '600',
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
