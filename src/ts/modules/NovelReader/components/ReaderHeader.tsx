import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Platform,
  useWindowDimensions,
} from 'react-native';
import bridge from '../../base/utils/bridge';

interface ReaderHeaderProps {
  title?: string;
  onBack: () => void;
  onSettingClick?: () => void;
  onMenuClick?: (menuName: string) => void;
}

const ReaderHeader: React.FC<ReaderHeaderProps> = ({
  onBack,
  onSettingClick,
  onMenuClick,
}) => {
  // 窗口尺寸变化时重新读取原生避让高度，适配旋转和折叠屏。
  useWindowDimensions();
  // 安卓窗口已由非透明状态栏避让，iOS 由 SafeAreaView 负责。
  const nativeTop =
    Platform.OS !== 'android' && Platform.OS !== 'ios'
      ? Number(bridge.getOhASData('topRectHeight', 0))
      : 0;
  const topInset = Number.isFinite(nativeTop) ? Math.max(0, nativeTop) : 0;
  // 鸿蒙 SafeAreaView 会覆盖显式顶部 padding，使用普通容器承载原生避让高度。
  const HeaderContainer = Platform.OS === 'ios' ? SafeAreaView : View;
  return (
    <HeaderContainer
      style={[styles.safeArea, topInset > 0 && {paddingTop: topInset}]}>
      <View style={styles.container}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack}>
          <Text style={styles.backText}>← 返回</Text>
        </TouchableOpacity>

        <View style={styles.centerGroup}>
          {/* <TouchableOpacity style={styles.navItem} onPress={() => onMenuClick?.('home')}>
            <Text style={styles.navText}>详情</Text>
          </TouchableOpacity> */}
          <TouchableOpacity
            style={styles.navItem}
            onPress={() => onMenuClick?.('reading')}>
            <Text style={[styles.navText, styles.activeNavText]}>阅读</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.navItem}
            onPress={() => onMenuClick?.('catalog')}>
            <Text style={styles.navText}>目录</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.settingBtn} onPress={onSettingClick}>
          {/* <Text style={styles.settingText}>设置</Text> */}
          <Text style={styles.settingText}>设置</Text>
        </TouchableOpacity>
      </View>
    </HeaderContainer>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: 'rgba(244, 241, 232, 0.95)', // 模仿纸张底层
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  },
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    height: Platform.OS === 'ios' ? 44 : 56,
  },
  backBtn: {
    flex: 1,
    alignItems: 'flex-start',
  },
  backText: {
    color: '#007AFF', // iOS 蓝
    fontSize: 16,
    fontWeight: '500',
  },
  centerGroup: {
    flex: 2,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
  },
  navItem: {
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  navText: {
    fontSize: 14,
    color: '#8A8A8E',
    marginTop: 2,
  },
  activeNavText: {
    color: '#007AFF',
    fontWeight: 'bold',
  },
  settingBtn: {
    flex: 1,
    alignItems: 'flex-end',
  },
  settingText: {
    color: '#48484A',
    fontSize: 16,
  },
});

export default ReaderHeader;
