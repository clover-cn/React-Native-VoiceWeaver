import React, {useState, useRef, useEffect} from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  Text,
  Animated,
  LayoutChangeEvent,
  NativeSyntheticEvent,
  StyleSheet,
} from 'react-native';
import {THEME_COLOR} from './Constant';
import {withDelay} from './CommonUtils';

// 组件Props类型定义
interface HorizontalTabBarProps {
  disable: boolean; //加载中不允许点击
  tabs: string[]; // 标签列表
  defaultActiveIndex?: number; // 默认选中索引
  onChange?: (index: number) => void; // 切换回调
  activeColor?: string; // 选中文字颜色
  inactiveColor?: string; // 未选中文字颜色
  barColor?: string; // 底部条颜色
}

const HorizontalTabBar: React.FC<HorizontalTabBarProps> = ({
  disable,
  tabs,
  defaultActiveIndex = 0,
  onChange,
  activeColor = '#000000',
  inactiveColor = '#666666',
  barColor = THEME_COLOR,
}) => {
  // 状态管理
  const [activeIndex, setActiveIndex] = useState(defaultActiveIndex);
  const [itemLayouts, setItemLayouts] = useState<
    Array<{x: number; width: number}>
  >(Array(tabs.length).fill({x: 0, width: 0}));
  const [scrollViewWidth, setScrollViewWidth] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);

  // 引用管理
  const scrollViewRef = useRef<ScrollView>(null);

  // 动画值
  const barTranslateX = useRef(new Animated.Value(0)).current;

  // 底部条动画（选中切换时）
  useEffect(() => {
    const targetLayout = itemLayouts[activeIndex];

    if (targetLayout) {
      Animated.parallel([
        Animated.timing(barTranslateX, {
          toValue: targetLayout.x,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [activeIndex, itemLayouts]);

  // 初始滚动（确保默认选中项显示完整）
  useEffect(() => {
    if (scrollViewWidth === 0) return;
    const targetLayout = itemLayouts[activeIndex];
    if (!targetLayout) return;

    const {x, width} = targetLayout;
    const itemRight = x + width;
    const visibleRight = scrollOffset + scrollViewWidth;

    if (itemRight > visibleRight) {
      scrollViewRef.current?.scrollTo({
        x: itemRight - scrollViewWidth,
        animated: false,
      });
    } else if (x < scrollOffset) {
      scrollViewRef.current?.scrollTo({x, animated: false});
    }
  }, [scrollViewWidth, itemLayouts, activeIndex]);

  // 处理标签点击
  const handleTabPress = (index: number) => {
    if (index === activeIndex) return;
    setActiveIndex(index);
    onChange && onChange(index);
    adjustScrollPosition(index);
  };

  // 自动调整滚动位置（确保点击项显示完整）
  const adjustScrollPosition = (index: number) => {
    const {x} = itemLayouts[index > 1 ? index - 2 : 0];
    scrollViewRef.current?.scrollTo({
      x: index > 1 ? x : 0,
      animated: true,
    });
  };

  // 记录标签布局信息
  const handleItemLayout = (index: number) => (e: LayoutChangeEvent) => {
    const {x, width} = e.nativeEvent.layout;
    setItemLayouts(prev => {
      const newLayouts = [...prev];
      newLayouts[index] = {x, width};
      return newLayouts;
    });
  };

  // 记录滚动容器宽度
  const handleScrollViewLayout = (e: LayoutChangeEvent) => {
    setScrollViewWidth(e.nativeEvent.layout.width);
  };

  // 记录滚动偏移量
  const handleScroll = (e: NativeSyntheticEvent<any>) => {
    setScrollOffset(e.nativeEvent.contentOffset.x);
  };

  return (
    <View style={styles.container}>
      <ScrollView
        ref={scrollViewRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        onLayout={handleScrollViewLayout}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}>
        {tabs.map((tab, index) => (
          <TouchableOpacity
            disabled={disable}
            key={index}
            onPress={() => handleTabPress(index)}
            onLayout={handleItemLayout(index)}
            style={styles.tabItem}>
            <Text
              style={[
                styles.tabText,
                {color: activeIndex === index ? activeColor : inactiveColor},
                {fontWeight: activeIndex === index ? '500' : 'normal'},
              ]}>
              {tab}
            </Text>
          </TouchableOpacity>
        ))}

        {/* 底部动画条 */}
        <Animated.View
          style={[
            styles.activeBar,
            {
              backgroundColor: barColor,
              width: itemLayouts?.[activeIndex].width ?? 28,
              transform: [{translateX: barTranslateX}],
            },
          ]}
        />
      </ScrollView>
    </View>
  );
};

// 样式定义
const styles = StyleSheet.create({
  container: {
    height: 56,
  },
  scrollView: {
    flex: 1,
    position: 'relative',
  },
  scrollContent: {
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  tabItem: {
    marginHorizontal: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabText: {
    fontSize: 14,
  },
  activeBar: {
    position: 'absolute',
    bottom: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: THEME_COLOR,
  },
});

export default HorizontalTabBar;
