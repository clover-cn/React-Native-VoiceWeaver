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
    ? '暂停播放'
    : '继续播放';
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
              <Image
                source={{uri: props.coverUrl}}
                style={styles.cover}
                onError={() => setCoverFailed(true)}
              />
            ) : (
              <View style={[styles.cover, styles.placeholder]}>
                <Text style={styles.coverText}>听</Text>
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
            style={[styles.action, nextDisabled && styles.disabled]}>
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
            style={styles.play}>
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
            style={styles.action}>
            <Text style={styles.actionIcon}>☷</Text>
          </TouchableOpacity>
        </View>
        {props.listenState === 'ready' && <SegmentProgress />}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  safeArea: {paddingHorizontal: 12, paddingBottom: 8},
  nonAndroidBottomInset: {paddingBottom: 28},
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 10,
    shadowColor: '#314B7A',
    shadowOffset: {width: 0, height: 3},
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 5,
  },
  row: {flexDirection: 'row', alignItems: 'center'},
  book: {flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center'},
  cover: {width: 42, height: 54, borderRadius: 8},
  placeholder: {
    backgroundColor: '#EAF1FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverText: {fontSize: 22, fontWeight: '700', color: '#2872FF'},
  info: {flex: 1, minWidth: 0, marginLeft: 10},
  title: {fontSize: 15, fontWeight: '600', color: '#172746'},
  subtitle: {fontSize: 12, color: '#8390AA', marginTop: 5},
  action: {
    width: 44,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionIcon: {fontSize: 24, color: '#8495B5'},
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
    borderTopWidth: 8,
    borderBottomWidth: 8,
    borderLeftWidth: 12,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: '#8495B5',
  },
  nextEndBar: {
    width: 3,
    height: 16,
    marginLeft: 3,
    borderRadius: 1.5,
    backgroundColor: '#8495B5',
  },
  disabled: {opacity: 0.3},
  play: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#286CFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryIcon: {color: '#FFFFFF', fontSize: 21, fontWeight: '700'},
  playTriangle: {
    width: 0,
    height: 0,
    marginLeft: 3,
    borderTopWidth: 9,
    borderBottomWidth: 9,
    borderLeftWidth: 14,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: '#FFFFFF',
  },
  pauseIcon: {flexDirection: 'row', gap: 5, alignItems: 'center'},
  pauseBar: {width: 4, height: 18, borderRadius: 2, backgroundColor: '#FFFFFF'},
  track: {
    height: 3,
    backgroundColor: '#E7ECF5',
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 9,
  },
  fill: {height: 3, backgroundColor: '#387CFF', borderRadius: 2},
});

export default ListenPlaybackBar;
