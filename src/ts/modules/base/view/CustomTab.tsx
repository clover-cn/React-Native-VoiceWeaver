import React, {memo, useEffect, useRef, useState} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StyleProp,
  ViewStyle,
  Image,
  ScrollView,
} from 'react-native';
import HomePage from '../pages/home/HomePage';
import CartPage from '../pages/cart/CartPage';
import ProfilePage from '../pages/profile/ProfilePage';
import bridge from '../utils/bridge';
import {THEME_COLOR} from '../utils/Constant';

// 定义Tab项的接口
export interface TabItem {
  key: string;
  title: string;
  activeImage: any;
  inactiveImage: any;
}

// 定义CustomTab组件的属性接口，新增tabInTop参数
export interface CustomTabProps {
  tabs: TabItem[];
  initialIndex?: number;
  width?: number;
  activeColor?: string;
  inactiveColor?: string;
  tabBarHeight?: number;
  getTabPage?: () => ((props: any) => React.JSX.Element)[];
  tabBarStyle?: StyleProp<ViewStyle>;
  tabInTop?: boolean; // 新增：控制Tab栏在顶部(true)还是底部(false)，默认false
}

export const CustomTab: React.FC<CustomTabProps> = ({
  tabs,
  initialIndex = 0,
  activeColor = THEME_COLOR,
  inactiveColor = '#666666',
  tabBarHeight = 80,
  getTabPage,
  tabBarStyle,
  tabInTop = false, // 默认在底部
}) => {
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [windowW, setWindowW] = useState(0);
  const scrollViewRef = useRef<ScrollView>(null);

  const getTab = () => {
    return TabView(
      tabs,
      activeIndex,
      setActiveIndex,
      tabBarHeight,
      activeColor,
      inactiveColor,
      tabBarStyle,
    );
  };
  return (
    <View
      style={styles.container}
      onLayout={e => {
        setWindowW(e.nativeEvent.layout.width);
      }}>
      {tabInTop && getTab()}
      <ScrollView
        style={styles.contentContainer}
        horizontal={true}
        ref={scrollViewRef}
        pagingEnabled={true} // 开启分页效果
        showsHorizontalScrollIndicator={false} // 隐藏滚动条
        scrollEventThrottle={16} // 滚动事件触发频率（毫秒）
        scrollEnabled={false}>
        {windowW > 0 && (
          <View style={{width: windowW, height: '100%'}}>
            {getTabPage().map((Page, index) => {
              return (
                <View
                  key={String(index)}
                  style={[
                    styles.contentContainer1,
                    activeIndex === index
                      ? {opacity: 1, zIndex: 100}
                      : {opacity: 0, zIndex: 0},
                  ]}>
                  <Page />
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
      {!tabInTop && getTab()}
    </View>
  );
};

const TabView = (
  tabs: TabItem[],
  activeIndex: number,
  setActiveIndex: (data: number) => void,
  tabBarHeight: number,
  activeColor: string,
  inactiveColor: string,
  tabBarStyle: StyleProp<ViewStyle>,
) => {
  const handleTabPress = (index: number) => {
    if (index !== activeIndex) {
      setActiveIndex(index);
    }
  };

  return (
    <View style={[styles.tabBar, {height: tabBarHeight}, tabBarStyle]}>
      {tabs.map((tab, index) =>
        TabItem(
          tab,
          index,
          activeIndex,
          activeColor,
          inactiveColor,
          handleTabPress,
        ),
      )}
    </View>
  );
};

const TabItem = (
  tab: TabItem,
  index: number,
  activeIndex: number,
  activeColor: string,
  inactiveColor: string,
  handleTabPress: (index: number) => void,
) => {
  return (
    <TouchableOpacity
      key={tab.key}
      style={styles.tabItem}
      onPress={() => handleTabPress(index)}>
      {index === activeIndex && tab.activeImage && (
        <Image
          source={tab.activeImage}
          resizeMode={'contain'}
          style={{width: 24, height: 24}}
        />
      )}
      {index !== activeIndex && tab.inactiveImage && (
        <Image
          source={tab.inactiveImage}
          resizeMode={'contain'}
          style={{width: 24, height: 24}}
        />
      )}
      <Text
        style={[
          styles.tabText,
          index === activeIndex ? {color: activeColor} : {color: inactiveColor},
        ]}>
        {tab.title}
      </Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    height: '100%',
    flexDirection: 'column',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#eef0f2',
    borderColor: '#eee',
  },
  tabItem: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabText: {
    fontSize: 10,
    paddingVertical: 2,
    paddingLeft: 1,
    fontWeight: '500',
  },
  contentContainer: {
    flex: 1,
    width: '100%',
  },
  contentContainer1: {
    flex: 1,
    width: '100%',
    height: '100%',
    position: 'absolute',
  },
});
