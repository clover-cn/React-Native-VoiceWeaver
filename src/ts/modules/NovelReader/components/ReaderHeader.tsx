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
        <TouchableOpacity
          style={styles.backBtn}
          onPress={onBack}
          activeOpacity={0.75}
          accessibilityLabel="返回书架">
          <Text style={styles.backText}>‹ 返回</Text>
        </TouchableOpacity>

        <View style={styles.centerGroup}>
          <TouchableOpacity
            style={styles.navItem}
            onPress={() => onMenuClick?.('reading')}
            activeOpacity={0.8}>
            <Text style={[styles.navText, styles.activeNavText]}>正文阅读</Text>
            <View style={styles.activeIndicator} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.navItem}
            onPress={() => onMenuClick?.('catalog')}
            activeOpacity={0.8}>
            <Text style={styles.navText}>目录</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.settingBtn}
          onPress={onSettingClick}
          activeOpacity={0.75}
          accessibilityLabel="阅读设置">
          <Text style={styles.settingText}>设置</Text>
        </TouchableOpacity>
      </View>
    </HeaderContainer>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: '#F8F6F0', // 实底温润宣纸色，彻底消除透字重叠 Bug
    borderBottomWidth: 1,
    borderBottomColor: '#EFECE6',
    shadowColor: '#1C1917',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 4,
  },
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    height: Platform.OS === 'ios' ? 44 : 52,
  },
  backBtn: {
    flex: 1,
    alignItems: 'flex-start',
    paddingVertical: 6,
  },
  backText: {
    color: '#1C1917',
    fontSize: 16,
    fontWeight: '700',
  },
  centerGroup: {
    flex: 2,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 20,
  },
  navItem: {
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    position: 'relative',
  },
  navText: {
    fontSize: 15,
    color: '#78716C',
    fontWeight: '500',
  },
  activeNavText: {
    color: '#B45309',
    fontWeight: '700',
  },
  activeIndicator: {
    width: 16,
    height: 2.5,
    backgroundColor: '#D97706',
    borderRadius: 1.5,
    marginTop: 3,
  },
  settingBtn: {
    flex: 1,
    alignItems: 'flex-end',
    paddingVertical: 6,
  },
  settingText: {
    color: '#78716C',
    fontSize: 15,
    fontWeight: '600',
  },
});

export default ReaderHeader;
