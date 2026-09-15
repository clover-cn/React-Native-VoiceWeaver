import React, {useEffect, useRef, useState} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {ListenPreparation, PREPARATION_STEPS} from '../utils/listenPreparation';

interface Props {
  preparation: ListenPreparation;
  bookName: string;
  chapterTitle: string;
  ready: boolean;
  playing: boolean;
  onCollapse: () => void;
  onExpand: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onPlay: () => void;
  onComplete: () => void;
}

export default function ListenPreparationOverlay({
  preparation: p,
  bookName,
  chapterTitle,
  ready,
  playing,
  onCollapse,
  onExpand,
  onCancel,
  onRetry,
  onPlay,
  onComplete,
}: Props) {
  const pulse = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then(value => {
        if (active) {
          setReduceMotion(value);
        }
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  useEffect(() => {
    const update = () =>
      setElapsed(Math.floor((Date.now() - p.startedAt) / 1000));
    update();
    if (!p.expanded || p.error || ready || playing) {
      return;
    }
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [p.startedAt, p.expanded, p.error, ready, playing]);
  useEffect(() => {
    if (!p.expanded || p.error || reduceMotion || playing) {
      pulse.setValue(0.5);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse, p.expanded, p.error, reduceMotion, playing]);
  useEffect(() => {
    if (!p.expanded) {
      return;
    }
    const animation = Animated.timing(opacity, {
      toValue: playing ? 0 : 1,
      duration: reduceMotion ? 0 : 220,
      useNativeDriver: true,
    });
    animation.start(({finished}) => {
      if (finished && playing) {
        onComplete();
      }
    });
    return () => animation.stop();
  }, [opacity, p.expanded, playing, reduceMotion, onComplete]);
  useEffect(() => {
    if (playing && !p.expanded) {
      onComplete();
    }
  }, [playing, p.expanded, onComplete]);
  const stageTitle =
    PREPARATION_STEPS.find(step => step.key === p.stage)?.title || '';
  const title = p.error
    ? `${stageTitle}失败`
    : ready && !p.autoPlay
    ? '已就绪，点击播放'
    : stageTitle;
  if (!p.expanded) {
    return (
      <TouchableOpacity
        accessibilityRole="button"
        style={styles.banner}
        onPress={p.error || !ready ? onExpand : onPlay}>
        <Text style={styles.bannerText}>
          {p.error ? '听书准备失败，点击查看' : title}
        </Text>
        <Text style={styles.hint}>
          {ready && !p.error ? '播放 ›' : '展开 ›'}
        </Text>
      </TouchableOpacity>
    );
  }
  return (
    <Modal
      transparent
      visible
      animationType="none"
      onRequestClose={onCollapse}
      statusBarTranslucent>
      <Animated.View style={[styles.backdrop, {opacity}]}>
        <SafeAreaView style={styles.safe}>
          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}>
            <Text style={styles.eyebrow}>为你准备这段故事</Text>
            <Text style={styles.book} numberOfLines={2}>
              {bookName}
            </Text>
            <Text style={styles.chapter} numberOfLines={2}>
              {chapterTitle}
            </Text>
            <View style={styles.wave} accessibilityElementsHidden>
              {[24, 44, 72, 96, 72, 44, 24].map((height, index) => (
                <Animated.View
                  key={index}
                  style={[
                    styles.bar,
                    {
                      height,
                      transform: [
                        {
                          scaleY: pulse.interpolate({
                            inputRange: [0, 1],
                            outputRange: index % 2 ? [1, 0.45] : [0.45, 1],
                          }),
                        },
                      ],
                    },
                  ]}
                />
              ))}
            </View>
            <Text accessibilityLiveRegion="polite" style={styles.title}>
              {title}
            </Text>
            <Text style={styles.hint}>
              {p.error || (ready ? '声音已准备好' : `已等待 ${elapsed} 秒`)}
            </Text>
            <View style={styles.steps}>
              {PREPARATION_STEPS.map(step => {
                const current = step.key === p.stage;
                const activeOpacity =
                  current && !p.error && !reduceMotion
                    ? pulse.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.45, 1],
                      })
                    : 1;
                const visited = p.visited.includes(step.key);
                const skipped =
                  !visited &&
                  PREPARATION_STEPS.findIndex(s => s.key === step.key) <
                    PREPARATION_STEPS.findIndex(s => s.key === p.stage);
                return (
                  <View key={step.key} style={styles.step}>
                    <Animated.Text
                      style={[
                        styles.stepIcon,
                        current && styles.current,
                        {
                          opacity: activeOpacity,
                        },
                      ]}>
                      {current
                        ? p.error
                          ? '!'
                          : '●'
                        : visited
                        ? '✓'
                        : skipped
                        ? '—'
                        : '○'}
                    </Animated.Text>
                    <Text style={[styles.stepText, current && styles.current]}>
                      {step.title}
                      {skipped ? ' · 跳过' : ''}
                    </Text>
                  </View>
                );
              })}
            </View>
            <Text style={styles.tip}>
              {elapsed >= 30 && !ready && !p.error
                ? '首次生成可能需要一些时间，你可以先继续阅读'
                : '故事正在变成声音'}
            </Text>
            <TouchableOpacity
              style={styles.primary}
              onPress={
                p.error ? onRetry : ready && !p.autoPlay ? onPlay : onCollapse
              }>
              <Text style={styles.primaryText}>
                {p.error
                  ? '重试'
                  : ready && !p.autoPlay
                  ? '开始播放'
                  : '收起，继续阅读'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondary} onPress={onCancel}>
              <Text style={styles.hint}>
                {p.error ? '返回阅读' : '取消听书'}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {flex: 1, backgroundColor: 'rgba(245,247,250,0.97)'},
  safe: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  eyebrow: {fontSize: 13, color: '#7C8798', marginBottom: 14},
  book: {
    fontSize: 24,
    fontWeight: '600',
    color: '#1C2940',
    textAlign: 'center',
  },
  chapter: {fontSize: 14, color: '#7C8798', marginTop: 10, textAlign: 'center'},
  wave: {
    height: 130,
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
  },
  bar: {
    width: 7,
    borderRadius: 8,
    backgroundColor: '#5282C9',
    marginHorizontal: 5,
  },
  title: {fontSize: 22, fontWeight: '600', color: '#1C2940', marginBottom: 12},
  hint: {fontSize: 13, color: '#65758A', textAlign: 'center', lineHeight: 21},
  steps: {alignSelf: 'center', alignItems: 'flex-start', marginTop: 22},
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
  },
  stepIcon: {color: '#A5AFBC', width: 28, fontSize: 16},
  stepText: {color: '#8793A3', fontSize: 14},
  current: {color: '#356AB9', fontWeight: '600'},
  tip: {
    color: '#8793A3',
    fontSize: 12,
    marginVertical: 18,
    textAlign: 'center',
  },
  primary: {
    backgroundColor: '#356AB9',
    paddingVertical: 14,
    paddingHorizontal: 36,
    borderRadius: 24,
  },
  primaryText: {color: '#FFFFFF', fontSize: 16, fontWeight: '600'},
  secondary: {padding: 16},
  banner: {
    position: 'absolute',
    bottom: 90,
    left: 16,
    right: 16,
    borderRadius: 16,
    padding: 16,
    backgroundColor: '#E9F0FB',
    flexDirection: 'row',
    justifyContent: 'space-between',
    elevation: 8,
  },
  bannerText: {color: '#285B9F', fontSize: 14, flex: 1},
});
