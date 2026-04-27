import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Animated,
  Dimensions,
  Platform,
  SafeAreaView,
  TouchableWithoutFeedback,
} from 'react-native';
import { Chapter } from '../types/reader';

interface ReaderCatalogProps {
  visible: boolean;
  chapters: Chapter[];
  currentIndex: number;
  onClose: () => void;
  onSelectChapter: (index: number) => void;
}

const { width } = Dimensions.get('window');
const DRAWER_WIDTH = width * 0.8;

const ReaderCatalog: React.FC<ReaderCatalogProps> = ({
  visible,
  chapters,
  currentIndex,
  onClose,
  onSelectChapter,
}) => {
  const slideAnim = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start(() => {
        try {
          if (currentIndex >= 0 && chapters.length > 0) {
            flatListRef.current?.scrollToIndex({
              index: currentIndex,
              viewPosition: 0.5,
              animated: false,
            });
          }
        } catch (e) {
          // ignore scroll error if flatlist is not fully layout
        }
      });
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: -DRAWER_WIDTH,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, currentIndex, chapters.length, slideAnim, fadeAnim]);

  const handleItemPress = React.useCallback(
    (index: number) => {
      onSelectChapter(index);
      onClose();
    },
    [onSelectChapter, onClose]
  );

  const renderItem = React.useCallback(
    ({ item, index }: { item: Chapter; index: number }) => {
      return (
        <CatalogItem
          item={item}
          index={index}
          isActive={index === currentIndex}
          onPress={handleItemPress}
        />
      );
    },
    [currentIndex, handleItemPress]
  );

  const keyExtractor = (item: Chapter, index: number) => `chapter_${index}`;

  return (
    <View
      style={[
        styles.absoluteContainer,
        { pointerEvents: visible ? 'auto' : 'none' },
      ]}>
      {/* 遮罩层 */}
      <TouchableWithoutFeedback onPress={onClose}>
        <Animated.View style={[styles.overlay, { opacity: fadeAnim }]} />
      </TouchableWithoutFeedback>

      {/* 侧边栏 */}
      <Animated.View
        style={[styles.drawer, { transform: [{ translateX: slideAnim }] }]}>
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>目录</Text>
            <Text style={styles.chapterCount}>共 {chapters.length} 章</Text>
          </View>
          <FlatList
            ref={flatListRef}
            data={chapters}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            initialNumToRender={20}
            maxToRenderPerBatch={20}
            windowSize={10}
            removeClippedSubviews={Platform.OS === 'android'}
            getItemLayout={(data, index) => ({
              length: 50,
              offset: 50 * index,
              index,
            })}
          />
        </SafeAreaView>
      </Animated.View>
    </View>
  );
};

const CatalogItem = React.memo(
  ({
    item,
    index,
    isActive,
    onPress,
  }: {
    item: Chapter;
    index: number;
    isActive: boolean;
    onPress: (index: number) => void;
  }) => {
    return (
      <TouchableOpacity
        style={[styles.itemContainer, isActive && styles.activeItemContainer]}
        onPress={() => onPress(index)}>
        <Text
          numberOfLines={2}
          style={[styles.itemText, isActive && styles.activeItemText]}>
          {item.title}
        </Text>
      </TouchableOpacity>
    );
  }
);

const styles = StyleSheet.create({
  absoluteContainer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
    elevation: 1000,
    flexDirection: 'row',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  drawer: {
    width: DRAWER_WIDTH,
    height: '100%',
    backgroundColor: '#F7F7F7', // 稍微不同的背景色区分阅读区
    shadowColor: '#000',
    shadowOffset: {
      width: 2,
      height: 0,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  safeArea: {
    flex: 1,
  },
  header: {
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E0E0E0',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: Platform.OS === 'android' ? 24 : 0,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  chapterCount: {
    fontSize: 12,
    color: '#999',
    marginBottom: 2,
  },
  listContent: {
    paddingBottom: 40,
  },
  itemContainer: {
    height: 50,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EEEEEE',
  },
  activeItemContainer: {
    backgroundColor: 'rgba(0, 122, 255, 0.05)',
  },
  itemText: {
    fontSize: 15,
    color: '#333',
    lineHeight: 20,
  },
  activeItemText: {
    color: '#007AFF',
    fontWeight: 'bold',
  },
});

export default ReaderCatalog;
