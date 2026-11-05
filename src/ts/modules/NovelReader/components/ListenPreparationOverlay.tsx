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
  generationComplete: boolean;
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
  generationComplete,
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
    ? `${stageTitle}异常`
    : ready && !p.autoPlay
    ? '演播就绪，点击播放'
    : stageTitle;

  if (!p.expanded) {
    return (
      <TouchableOpacity
        accessibilityRole="button"
        style={styles.banner}
        onPress={p.error || !ready ? onExpand : onPlay}
        activeOpacity={0.85}>
        <Text style={styles.bannerIcon}>🎙️</Text>
        <Text style={styles.bannerText}>
          {p.error ? '听书准备异常，点击查看' : title}
        </Text>
        <Text style={styles.bannerAction}>
          {ready && !p.error ? '开始演播 ›' : '展开进度 ›'}
        </Text>
      </TouchableOpacity>
    );
  }

  return (
    <Modal
      transparent={false}
      visible
      animationType="fade"
      onRequestClose={onCollapse}
      statusBarTranslucent>
      <Animated.View style={[styles.backdrop, {opacity}]}>
        <SafeAreaView style={styles.safe}>
          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}>
            {/* 顶部标题区 */}
            <View style={styles.headerArea}>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>智能多角色演播</Text>
              </View>
              <Text style={styles.book} numberOfLines={2}>
                {bookName}
              </Text>
              <Text style={styles.chapter} numberOfLines={2}>
                {chapterTitle}
              </Text>
            </View>

            {/* 沉浸式琥珀声波律动 */}
            <View style={styles.wave} accessibilityElementsHidden>
              {[20, 38, 64, 88, 64, 38, 20].map((height, index) => (
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
                            outputRange: index % 2 ? [1, 0.42] : [0.42, 1],
                          }),
                        },
                      ],
                    },
                  ]}
                />
              ))}
            </View>

            {/* 当前阶段与耗时 */}
            <Text accessibilityLiveRegion="polite" style={styles.title}>
              {title}
            </Text>
            <Text style={styles.hint}>
              {p.error ||
                (ready
                  ? generationComplete
                    ? '本章音频已全部生成'
                    : '首段已就绪，后续片段继续生成中'
                  : `已等待 ${elapsed} 秒`)}
            </Text>

            {/* 精致步骤流程卡片 */}
            <View style={styles.stepsCard}>
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
                  <View
                    key={step.key}
                    style={[styles.step, current && styles.stepCurrent]}>
                    <Animated.Text
                      style={[
                        styles.stepIcon,
                        visited && styles.iconVisited,
                        current && styles.iconCurrent,
                        {opacity: activeOpacity},
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
                    <Text
                      style={[
                        styles.stepText,
                        visited && styles.textVisited,
                        current && styles.textCurrent,
                      ]}>
                      {step.title}
                      {skipped ? ' · 跳过' : ''}
                    </Text>
                  </View>
                );
              })}
            </View>

            <Text style={styles.tip}>
              {elapsed >= 30 && !ready && !p.error
                ? '初次解析大模型需稍作等待，你可以收起先继续阅读'
                : '文字正在编织为沉浸式有声演播…'}
            </Text>

            {/* 主操作按钮：琥珀暖金 */}
            <TouchableOpacity
              style={styles.primary}
              onPress={
                p.error ? onRetry : ready && !p.autoPlay ? onPlay : onCollapse
              }
              activeOpacity={0.85}>
              <Text style={styles.primaryText}>
                {p.error
                  ? '重试生成'
                  : ready && !p.autoPlay
                  ? '开始演播'
                  : '收起，继续阅读'}
              </Text>
            </TouchableOpacity>

            {/* 取消听书 */}
            <TouchableOpacity
              style={styles.secondary}
              onPress={onCancel}
              activeOpacity={0.75}>
              <Text style={styles.secondaryText}>
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
  backdrop: {
    flex: 1,
    backgroundColor: '#F8F6F0', // 实底宣纸暖白，彻底告别透底穿模 Bug！
  },
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
  headerArea: {
    alignItems: 'center',
    marginBottom: 8,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(217, 119, 6, 0.1)',
    marginBottom: 12,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#B45309',
    letterSpacing: 0.5,
  },
  book: {
    fontSize: 24,
    fontWeight: '800',
    color: '#1C1917',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  chapter: {
    fontSize: 14,
    color: '#78716C',
    marginTop: 8,
    textAlign: 'center',
  },
  wave: {
    height: 120,
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 18,
  },
  bar: {
    width: 6.5,
    borderRadius: 4,
    backgroundColor: '#D97706', // 琥珀暖金色波浪
    marginHorizontal: 4.5,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#1C1917',
    marginBottom: 8,
  },
  hint: {
    fontSize: 13,
    color: '#78716C',
    textAlign: 'center',
    lineHeight: 20,
  },
  stepsCard: {
    width: '100%',
    maxWidth: 290,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 18,
    marginTop: 20,
    borderWidth: 1,
    borderColor: '#EFECE6',
    shadowColor: '#1C1917',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6.5,
  },
  stepCurrent: {
    backgroundColor: 'rgba(217, 119, 6, 0.06)',
    borderRadius: 8,
    paddingHorizontal: 6,
    marginHorizontal: -6,
  },
  stepIcon: {
    color: '#D6D3D1',
    width: 24,
    fontSize: 14,
    textAlign: 'center',
  },
  iconVisited: {
    color: '#10B981', // 已完成绿色对勾
    fontWeight: '700',
  },
  iconCurrent: {
    color: '#D97706', // 进行中琥珀色
    fontSize: 14,
  },
  stepText: {
    color: '#A8A29E',
    fontSize: 13,
    marginLeft: 6,
  },
  textVisited: {
    color: '#57534E',
  },
  textCurrent: {
    color: '#B45309',
    fontWeight: '700',
  },
  tip: {
    color: '#78716C',
    fontSize: 12,
    marginVertical: 16,
    textAlign: 'center',
  },
  primary: {
    backgroundColor: '#D97706', // 琥珀暖金主按钮
    paddingVertical: 13,
    paddingHorizontal: 40,
    borderRadius: 24,
    shadowColor: '#D97706',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.28,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  secondary: {
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  secondaryText: {
    color: '#78716C',
    fontSize: 13,
    fontWeight: '600',
  },
  banner: {
    position: 'absolute',
    bottom: 90,
    left: 16,
    right: 16,
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#FAF5ED',
    borderWidth: 1,
    borderColor: '#EFE8DE',
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#1C1917',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 6,
  },
  bannerIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  bannerText: {
    color: '#44403C',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  bannerAction: {
    color: '#B45309',
    fontSize: 12,
    fontWeight: '700',
  },
});
