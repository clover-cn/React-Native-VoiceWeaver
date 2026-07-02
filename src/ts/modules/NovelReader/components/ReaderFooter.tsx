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

interface ReaderFooterProps {
  currentChapter: number;
  totalChapters: number;
  listenState: string; // 'idle' | 'loading' | 'ready' | 'error'
  listenPhaseText?: string;
  isPlaying: boolean;
  currentSegIdx?: number;      // 当前播放段落序号
  totalSegments?: number;      // 总段落数
  onStartListen: () => void;
  onTogglePlayPause: () => void;
  onStopListen: () => void;
  onPrevChapter: () => void;
  onNextChapter: () => void;
  onMenuItemClick?: (itemIdentifier: string) => void;
  loadingMenuItemId?: string | null;
}

// 模块级常量与工具函数 —— 避免每次 render 重建引用
const MENU_ITEMS: ReadonlyArray<{label: string; id: string}> = [
  // {label: '书签', id: 'bookmark'},
  // {label: '缓存', id: 'download'},
  // {label: '搜索', id: 'search'},
  // { label: '护眼', id: 'eyecare' },
  // { label: '夜间', id: 'night' },
  {label: '翻页模式', id: 'flip'},
  {label: '书籍详情', id: 'info'},
  {label: '书源管理', id: 'sourceManage'},
  {label: '书源切换', id: 'source'},
  {label: '音频管理', id: 'audio'},
  {label: '定时关闭', id: 'sleep'},
];

const formatTime = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

/**
 * 迷你进度条 —— 独立订阅高频 PlaybackProgressContext，
 * 把每秒 ~1 次的进度更新隔离在该子组件内，避免重渲整个 Footer 与 grid。
 * 注：进度填充仍用 width 百分比（JS 驱动），但仅触发本组件 layout，
 * 不再扫到 Footer 主体；scaleX + native driver 的方案在 RNOH 上需要
 * 额外的 transform-origin / translateX 补偿，复杂度不值，故不采用。
 */
interface MiniProgressBarProps {
  currentSegIdx: number;
  totalSegments: number;
}

const MiniProgressBar: React.FC<MiniProgressBarProps> = memo(
  ({currentSegIdx, totalSegments}) => {
    const {currentProgress, totalDuration} = useContext(PlaybackProgressContext);
    const progressPercent =
      totalDuration > 0 ? Math.min(currentProgress / totalDuration, 1) : 0;

    return (
      <View style={styles.miniProgressContainer}>
        <Text style={styles.miniProgressText}>
          {currentSegIdx + 1}/{totalSegments}
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
 * grid 子项 —— memo 化避免父级 render 时整组重建。
 * onPress 由父级用 useCallback 稳定。
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
        onPress={handlePress}>
        <View style={styles.gridIconCircle}>
          {isLoading ? (
            <ActivityIndicator size="small" color="#8E8E93" />
          ) : (
            <Text style={styles.gridLabel}>{label[0]}</Text>
          )}
        </View>
        <Text style={styles.gridLabelText}>{label}</Text>
      </TouchableOpacity>
    );
  },
);
FooterMenuItem.displayName = 'FooterMenuItem';

const ReaderFooter: React.FC<ReaderFooterProps> = ({
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
  // 把 onMenuItemClick 透传给 grid 子项 —— 直接传引用，由父级保证稳定即可
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
          <TouchableOpacity style={styles.listenBtn} onPress={onStartListen}>
            <Text style={styles.listenBtnText}>耳机 听书</Text>
          </TouchableOpacity>
        );
      case 'loading':
        return (
          <View style={styles.loadingControl}>
            <ActivityIndicator size="small" color="#7c6ff7" />
            <Text style={styles.loadingText}>{listenPhaseText}</Text>
          </View>
        );
      case 'ready':
        return (
          <View style={styles.listenReadyContainer}>
            {/* 播放控制按钮行 */}
            <View style={styles.listenReadyActions}>
              <TouchableOpacity
                style={styles.listenBtnReady}
                onPress={onTogglePlayPause}>
                <Text style={styles.listenBtnTextReady}>
                  {isPlaying ? '⏸ 暂停' : '▶ 播放'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.listenBtnGhost}
                onPress={onStopListen}>
                <Text style={styles.listenBtnGhostText}>
                  {isPlaying ? '退出听书' : '取消听书'}
                </Text>
              </TouchableOpacity>
            </View>
            {/* 迷你进度条：仅在播放/暂停时显示。订阅高频进度被隔离到子组件 */}
            {currentSegIdx >= 0 && (
              <MiniProgressBar
                currentSegIdx={currentSegIdx}
                totalSegments={totalSegments}
              />
            )}
          </View>
        );
      case 'error':
        return (
          <TouchableOpacity
            style={styles.listenBtnError}
            onPress={onStartListen}>
            <Text style={styles.listenBtnTextError}>重试生成</Text>
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
        <View style={styles.progressRow}>
          <Text style={styles.progressText}>第 {currentChapter + 1} 章</Text>
          <View style={styles.listenWrapper}>{renderListenControl()}</View>
          <Text style={styles.progressText}>
            {currentChapter + 1} / {totalChapters}
          </Text>
        </View>

        {/* 快捷功能网格 */}
        <View style={styles.gridContainer}>
          {MENU_ITEMS.map(item => (
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
        <View style={styles.chapterControlRow}>
          <TouchableOpacity
            style={[
              styles.chapterBtn,
              currentChapter <= 0 && styles.chapterBtnDisabled,
            ]}
            onPress={onPrevChapter}
            disabled={currentChapter <= 0}>
            <Text style={styles.chapterBtnText}>上一章</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.chapterBtn,
              styles.chapterBtnPrimary,
              currentChapter >= totalChapters - 1 && styles.chapterBtnDisabled,
            ]}
            onPress={onNextChapter}
            disabled={currentChapter >= totalChapters - 1}>
            <Text style={styles.chapterBtnPrimaryText}>下一章</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: -2},
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 10,
  },
  innerBox: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 32,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  progressText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#A0A0A5',
  },
  listenWrapper: {
    flex: 1,
    alignItems: 'center',
  },
  listenReadyActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  listenBtn: {
    backgroundColor: '#7c6ff7',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
  },
  listenBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  listenBtnReady: {
    backgroundColor: 'rgba(124,111,247,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(124,111,247,0.3)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
  },
  listenBtnTextReady: {
    color: '#7c6ff7',
    fontSize: 13,
    fontWeight: 'bold',
  },
  listenBtnGhost: {
    backgroundColor: '#f5efe3',
    borderWidth: 1,
    borderColor: 'rgba(98, 77, 48, 0.16)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
  },
  listenBtnGhostText: {
    color: '#7d5f33',
    fontSize: 13,
    fontWeight: '600',
  },
  listenBtnError: {
    backgroundColor: 'rgba(255,80,80,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,80,80,0.3)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
  },
  listenBtnTextError: {
    color: '#ff8080',
    fontSize: 13,
  },
  loadingControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: 'rgba(124,111,247,0.12)',
    borderRadius: 16,
  },
  loadingText: {
    fontSize: 12,
    color: '#7c6ff7',
  },
  listenReadyContainer: {
    alignItems: 'center',
    gap: 8,
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
    color: '#7c6ff7',
    fontWeight: '600',
    minWidth: 36,
  },
  miniProgressBar: {
    flex: 1,
    height: 3,
    backgroundColor: 'rgba(124,111,247,0.15)',
    borderRadius: 2,
    overflow: 'hidden' as const,
  },
  miniProgressFill: {
    height: '100%',
    backgroundColor: '#7c6ff7',
    borderRadius: 2,
  },
  miniProgressTime: {
    fontSize: 10,
    color: '#A0A0A5',
    minWidth: 64,
    textAlign: 'right' as const,
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    marginBottom: 24,
  },
  gridItem: {
    width: '25%',
    alignItems: 'center',
    marginBottom: 16,
  },
  gridIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F2F2F7',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  gridLabel: {
    fontSize: 16,
    color: '#8E8E93',
  },
  gridLabelText: {
    fontSize: 11,
    color: '#636366',
    fontWeight: '500',
  },
  chapterControlRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
  },
  chapterBtn: {
    flex: 1,
    backgroundColor: '#F2F2F7',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
  chapterBtnDisabled: {
    opacity: 0.4,
  },
  chapterBtnText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1C1C1E',
  },
  chapterBtnPrimary: {
    backgroundColor: '#007AFF',
    shadowColor: '#007AFF',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  chapterBtnPrimaryText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
});

export default memo(ReaderFooter);
