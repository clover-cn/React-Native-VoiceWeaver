import React, {memo, useEffect, useRef, useState} from 'react';
import {
  Animated,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {SearchData} from '../pages/home/model/SearchData';
import {WindowInfo} from '../utils/WindowInfo';

export interface HomeSearchViewProps {
  data?: SearchData[];
  handleSearchClick?: (key?: SearchData) => void;
}

export const HomeSearchView: React.FC<HomeSearchViewProps> = memo(
  ({data, handleSearchClick}) => {
    const {foldStatus} = WindowInfo();
    const [currentIndex, setCurrentIndex] = useState(0);
    const scrollViewRef = useRef<ScrollView>(null);
    const timerRef = useRef<NodeJS.Timeout | null>(null);

    // 处理数据循环（复制首条数据到末尾，实现无缝滚动）
    const loopData = data ? [...data, data[0]] : [];

    // 自动滚动逻辑
    const startAutoScroll = () => {
      // 清除之前的定时器
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }

      timerRef.current = setInterval(() => {
        let nextIndex = currentIndex + 1;
        // 当滚动到最后一条（复制的第一条），瞬间切回真实第一条
        if (nextIndex === loopData.length - 1) {
          scrollToIndex(nextIndex);
          // 延迟重置索引，避免视觉闪烁
          setTimeout(() => {
            setCurrentIndex(0);
            scrollToIndex(0, false); // 无动画滚动到真实第一条
          }, 500);
        } else {
          setCurrentIndex(nextIndex % data.length);
          scrollToIndex(nextIndex);
        }
      }, 3000);
    };

    // 滚动到指定索引
    const scrollToIndex = (index: number, animated = true) => {
      scrollViewRef.current?.scrollTo({
        y: index * 36,
        animated,
      });
    };

    // 处理滚动结束事件（手动滑动后更新索引）
    const handleScrollEnd = (e: any) => {
      const contentOffsetY = e.nativeEvent.contentOffset.y;
      const current = Math.round(contentOffsetY / 36);

      // 处理边界情况
      if (current < data.length) {
        setCurrentIndex(current);
      }
    };

    if (data) {
      // 初始化自动滚动
      useEffect(() => {
        if (data.length <= 1) return; // 只有一条数据时不滚动

        startAutoScroll();
        return () => {
          if (timerRef.current) {
            clearInterval(timerRef.current);
          }
        };
      }, [currentIndex, data.length]);
    }

    return (
      <View
        style={[
          styles.homeSearchView,
          {paddingHorizontal: foldStatus === 1 ? 24 : 16},
        ]}>
        <TouchableOpacity
          style={styles.homeSearchInput}
          onPress={() => handleSearchClick(data?.[currentIndex])}
          activeOpacity={0.9}>
          <Image
            source={require('../../../rawfile/dev/media/icon/ic_search.svg')}
            resizeMode={'contain'}
            style={styles.homeSearchIcon}
          />
          <ScrollView
            ref={scrollViewRef}
            pagingEnabled={true} // 开启分页效果
            showsVerticalScrollIndicator={false} // 隐藏滚动条
            onScrollEndDrag={handleScrollEnd} // 滑动结束后更新索引
            scrollEventThrottle={16} // 滚动事件触发频率（毫秒）
          >
            {data && data.length > 0 ? (
              data.map((item, index) => (
                <View
                  key={index}
                  style={{height: 40, justifyContent: 'center'}}>
                  <Text
                    style={styles.homeSearchText}
                    numberOfLines={1} // 最多显示2行
                  >
                    {item.content}
                  </Text>
                </View>
              ))
            ) : (
              <TouchableOpacity
                style={{height: 40, justifyContent: 'center'}}
                onPress={() => handleSearchClick()}
                activeOpacity={0.9}>
                <Text
                  style={styles.homeSearchText}
                  numberOfLines={1} // 最多显示2行
                >
                  请输入搜索内容
                </Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </TouchableOpacity>
      </View>
    );
  },
);

const styles = StyleSheet.create({
  homeSearchView: {
    height: 40,
    width: '100%',
  },
  homeSearchInput: {
    width: '100%',
    height: '100%',
    backgroundColor: '#00000005',
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
  },
  homeSearchIcon: {
    width: 18,
    height: 18,
    marginHorizontal: 10,
    opacity: 0.6,
  },
  homeSearchText: {
    flex: 1,
    fontSize: 13,
    textAlignVertical: 'center',
    color: '#555555',
  },
});

export default HomeSearchView;
