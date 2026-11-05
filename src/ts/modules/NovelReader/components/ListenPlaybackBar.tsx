import React, {memo, useContext, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {PlaybackProgressContext} from '../contexts/ActiveSegContext';

interface Props {
  bookName: string;
  coverUrl?: string;
  chapterTitle: string;
  listenState: 'idle' | 'loading' | 'ready' | 'error';
  listenPhase: string;
  isPlaying: boolean;
  canGoNextSegment: boolean;
  onTogglePlayPause: () => void;
  onRetry: () => void;
  onNextSegment: () => void;
  onOpenControls: () => void;
  onOpenCatalog: () => void;
}

/** 只订阅当前段落进度，避免高频刷新书籍信息和操作按钮。 */
const SegmentProgress = memo(() => {
  const {currentProgress, totalDuration} = useContext(PlaybackProgressContext);
  const progress =
    Number.isFinite(currentProgress) && totalDuration > 0
      ? Math.max(0, Math.min(currentProgress / totalDuration, 1))
      : 0;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="当前段落播放进度"
      accessibilityValue={{min: 0, max: 100, now: Math.round(progress * 100)}}
      style={styles.track}>
      <View style={[styles.fill, {width: `${progress * 100}%`}]} />
    </View>
  );
});

/** 使用视图绘制播放状态，规避鸿蒙设备上的符号字体差异。 */
const PlaybackGlyph = memo(({isPlaying}: {isPlaying: boolean}) => {
  if (isPlaying) {
    return (
      <View style={styles.pauseIcon}>
        <View style={styles.pauseBar} />
        <View style={styles.pauseBar} />
      </View>
    );
  }

  return <View style={styles.playTriangle} />;
});

/** 听书时常驻底栏，复用阅读器的播放、切段与目录操作。 */
const ListenPlaybackBar = memo((props: Props) => {
  const [coverFailed, setCoverFailed] = useState(false);
  useEffect(() => setCoverFailed(false), [props.coverUrl]);
  const loading =
    props.listenState === 'loading' || props.listenState === 'idle';
  const failed = props.listenState === 'error';
  const nextDisabled = !props.canGoNextSegment || loading || failed;
  const actionLabel = failed
    ? '重试生成'
    : props.isPlaying
    ? '暂停演播'
    : '继续演播';
  return (
    <View
      style={[
        styles.safeArea,
        Platform.OS !== 'android' && styles.nonAndroidBottomInset,
      ]}>
      <View style={styles.card}>
        <View style={styles.row}>
          <TouchableOpacity
            style={styles.book}
            onPress={props.onOpenControls}
            accessibilityRole="button"
            accessibilityLabel={`${props.bookName}，展开听书设置`}>
            {props.coverUrl && !coverFailed ? (
              <View style={styles.coverWrapper}>
                <Image
                  source={{uri: props.coverUrl}}
                  style={styles.cover}
                  onError={() => setCoverFailed(true)}
                  resizeMode="cover"
                />
                <View style={styles.coverSpine} />
              </View>
            ) : (
              <View style={[styles.coverWrapper, styles.placeholder]}>
                <Text style={styles.coverText}>听</Text>
                <View style={styles.coverSpine} />
              </View>
            )}
            <View style={styles.info}>
              <Text numberOfLines={1} style={styles.title}>
                {props.bookName}
              </Text>
              <Text numberOfLines={1} style={styles.subtitle}>
                {loading
                  ? props.listenPhase || '正在准备音频…'
                  : failed
                  ? '音频生成失败，点击重试'
                  : props.chapterTitle}
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="下一段音频"
            accessibilityState={{disabled: nextDisabled}}
            disabled={nextDisabled}
            onPress={props.onNextSegment}
            style={[styles.action, nextDisabled && styles.disabled]}
            activeOpacity={0.75}>
            <View style={styles.nextIcon}>
              <View style={styles.nextTriangle} />
              <View style={styles.nextEndBar} />
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={loading ? '正在准备音频' : actionLabel}
            accessibilityState={{disabled: loading, busy: loading}}
            disabled={loading}
            onPress={failed ? props.onRetry : props.onTogglePlayPause}
            style={styles.play}
            activeOpacity={0.85}>
            {loading ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : failed ? (
              <Text style={styles.retryIcon}>↻</Text>
            ) : (
              <PlaybackGlyph isPlaying={props.isPlaying} />
            )}
          </TouchableOpacity>

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="打开章节目录"
            onPress={props.onOpenCatalog}
            style={styles.action}
            activeOpacity={0.75}>
            <Text style={styles.actionIcon}>☷</Text>
          </TouchableOpacity>
        </View>
        {props.listenState === 'ready' && <SegmentProgress />}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  safeArea: {paddingHorizontal: 14, paddingBottom: 10},
  nonAndroidBottomInset: {paddingBottom: 28},
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 10,
    borderWidth: 1,
    borderColor: '#EFECE6',
    shadowColor: '#1C1917',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.1,
    shadowRadius: 14,
    elevation: 8,
  },
  row: {flexDirection: 'row', alignItems: 'center'},
  book: {flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center'},
  coverWrapper: {
    width: 44,
    height: 56,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#4B3F35',
  },
  cover: {width: '100%', height: '100%'},
  placeholder: {
    backgroundColor: '#4B3F35',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverSpine: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
  },
  coverText: {fontSize: 20, fontWeight: '800', color: '#F59E0B'},
  info: {flex: 1, minWidth: 0, marginLeft: 10},
  title: {fontSize: 15, fontWeight: '700', color: '#1C1917'},
  subtitle: {fontSize: 12, color: '#78716C', marginTop: 4},
  action: {
    width: 42,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionIcon: {fontSize: 22, color: '#78716C'},
  nextIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: 24,
    height: 24,
  },
  nextTriangle: {
    width: 0,
    height: 0,
    borderTopWidth: 7,
    borderBottomWidth: 7,
    borderLeftWidth: 10,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: '#78716C',
  },
  nextEndBar: {
    width: 2.5,
    height: 14,
    marginLeft: 3,
    borderRadius: 1.5,
    backgroundColor: '#78716C',
  },
  disabled: {opacity: 0.3},
  play: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#D97706', // 琥珀暖金
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#D97706',
    shadowOffset: {width: 0, height: 3},
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
    marginHorizontal: 4,
  },
  retryIcon: {color: '#FFFFFF', fontSize: 20, fontWeight: '700'},
  playTriangle: {
    width: 0,
    height: 0,
    marginLeft: 3,
    borderTopWidth: 8,
    borderBottomWidth: 8,
    borderLeftWidth: 13,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: '#FFFFFF',
  },
  pauseIcon: {flexDirection: 'row', gap: 4, alignItems: 'center'},
  pauseBar: {
    width: 3.5,
    height: 16,
    borderRadius: 2,
    backgroundColor: '#FFFFFF',
  },
  track: {
    height: 3,
    backgroundColor: '#EFECE6',
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 8,
  },
  fill: {height: 3, backgroundColor: '#D97706', borderRadius: 2},
});

export default ListenPlaybackBar;
