import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  Animated,
  Dimensions,
  PanResponder,
  ScrollView,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import AutoSourceImage from './AutoSourceImage';
import {BannerData} from '../pages/home/model/BannerData';

// 获取屏幕宽度
const {width: screenWidth} = Dimensions.get('window');

// 组件属性
export interface SwiperProps {
  data: BannerData[]; // 轮播数据
  swiperW?: number; // 轮播图宽度，默认屏幕宽度
  height: number; // 轮播图高度（必填）
  imageRadius?: number; // 圆角 默认0
  autoplay?: boolean; // 是否自动播放，默认true
  loop?: boolean; // 是否循环播放，默认true
  interval?: number; // 自动播放间隔（毫秒），默认3000
  indicator?: boolean; // 是否显示指示器，默认true
  indicatorStyle?: StyleProp<ViewStyle>; // 指示器容器样式
  activeIndicatorStyle?: StyleProp<ViewStyle>; // 激活状态指示器样式
  inactiveIndicatorStyle?: StyleProp<ViewStyle>; // 非激活状态指示器样式
  containerStyle?: StyleProp<ViewStyle>; // 容器样式
  itemSpace?: number; // item间距
  onItemPress?: (index: number) => void; // 点击轮播项回调
}

const Swiper: React.FC<SwiperProps> = ({
  data,
  swiperW = screenWidth,
  height,
  imageRadius,
  autoplay = true,
  loop = true,
  interval = 3000,
  indicator = true,
  indicatorStyle,
  activeIndicatorStyle,
  inactiveIndicatorStyle,
  containerStyle,
  itemSpace,
  onItemPress,
}) => {
  // 状态管理
  let currentIndex = 0;

  // 引用
  const scrollViewRef = useRef<ScrollView>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // 处理循环逻辑的数据
  const [carouselData, setCarouselData] = useState<BannerData[]>([]);
  const [initialOffset, setInitialOffset] = useState(0);

  // 初始化数据，处理循环逻辑
  useEffect(() => {
    if (data.length === 0) {
      setCarouselData([]);
      setInitialOffset(0);
      return;
    }

    // 为了实现无缝循环，在首尾各添加数据
    if (loop && data.length > 1) {
      // 头部添加最后一项，尾部添加第一项
      data = [...data, ...data, ...data, ...data, ...data, data[0]];
      setCarouselData(data);
      setInitialOffset(swiperW); // 初始偏移到真实的第一项
      currentIndex = 0;
    } else {
      setCarouselData(data);
      setInitialOffset(0);
      currentIndex = 0;
    }

    if (autoplay && data.length > 1) {
      startAutoplay();
    }

    // 组件卸载时清除定时器
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [autoplay, loop, swiperW, data]);

  // 开始自动播放
  const startAutoplay = useCallback(() => {
    // 清除现有定时器
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    // 不需要自动播放或只有一项数据时不启动
    if (!autoplay || data.length <= 1 || !loop) return;

    timerRef.current = setInterval(() => {
      let nextIndex = currentIndex + 1;

      // 处理边界
      if (nextIndex === data.length - 1) {
        setTimeout(() => {
          scrollViewRef.current?.scrollTo({
            x: 0,
            animated: false,
          });
        }, interval * 0.8);
        // 滚动到下一项（循环数据中实际位置是nextIndex + 1）
        scrollViewRef.current?.scrollTo({
          x: nextIndex * swiperW,
          animated: true,
        });
        currentIndex = 0;
      } else {
        // 滚动到下一项（循环数据中实际位置是nextIndex + 1）
        scrollViewRef.current?.scrollTo({
          x: nextIndex * swiperW,
          animated: true,
        });
        currentIndex = nextIndex;
      }
    }, interval);
  }, [autoplay, data.length, loop, swiperW, interval]);

  // 处理手动滑动
  const panResponder = PanResponder.create({
    // 开始触摸时暂停自动播放
    onStartShouldSetPanResponder: () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      return true; // 不拦截事件，让ScrollView处理
    },
    // 触摸结束后恢复自动播放
    onPanResponderRelease: () => {
      if (autoplay && data.length > 1) {
        startAutoplay();
      }
    },
    onPanResponderTerminate: () => {
      if (autoplay && data.length > 1) {
        startAutoplay();
      }
    },
  });

  // 渲染轮播项
  const renderBannerData = (item: BannerData, index: number) => (
    <View
      key={item.id + '+' + index}
      style={[
        styles.slide,
        {width: swiperW - itemSpace * 2, height, marginHorizontal: itemSpace},
      ]}
      onTouchEnd={() =>
        onItemPress?.(
          // 计算原始数据索引
          loop ? (index - 1 + data.length) % data.length : index,
        )
      }>
      <AutoSourceImage
        source={item.source}
        style={[
          {width: swiperW - itemSpace * 2, height, marginHorizontal: itemSpace},
          imageRadius ? {borderRadius: imageRadius} : {},
        ]}
        resizeMode="cover"
      />
    </View>
  );

  // 空状态
  if (data.length === 0) {
    return (
      <View
        style={[
          styles.emptyContainer,
          {width: swiperW, height},
          containerStyle,
        ]}>
        <View style={styles.emptyIndicator} />
      </View>
    );
  }

  return (
    <View
      style={[styles.container, {width: swiperW, height}, containerStyle]}
      {...panResponder.panHandlers}>
      <ScrollView
        style={[
          {overflow: 'hidden'},
          imageRadius ? {borderRadius: imageRadius} : {},
        ]}
        ref={scrollViewRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        contentOffset={{x: initialOffset, y: 0}}>
        {carouselData.map((item, index) => renderBannerData(item, index))}
      </ScrollView>

      {/* 指示器 */}
      {indicator && data.length > 1 && (
        <View style={[styles.indicatorContainer, indicatorStyle]}>
          {data.map((_, i) => (
            <Animated.View
              key={i}
              style={[
                styles.indicatorDot,
                i === currentIndex
                  ? styles.activeIndicatorDot
                  : styles.inactiveIndicatorDot,
                i === currentIndex
                  ? activeIndicatorStyle
                  : inactiveIndicatorStyle,
              ]}
            />
          ))}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    overflow: 'hidden',
  },
  slide: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 指示器样式
  indicatorContainer: {
    position: 'absolute',
    bottom: 12,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  indicatorDot: {
    height: 3,
    imageRadius: 2,
    transitionDuration: '300ms',
  },
  activeIndicatorDot: {
    width: 12,
    backgroundColor: '#FFFFFF',
  },
  inactiveIndicatorDot: {
    width: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
  },
  // 空状态
  emptyContainer: {
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyIndicator: {
    width: 40,
    height: 40,
    imageRadius: 8,
    backgroundColor: '#e0e0e0',
  },
});

export default Swiper;
