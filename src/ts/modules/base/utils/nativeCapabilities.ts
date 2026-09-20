import {BridgeTurboModule} from '../../../../../turboModules';
import {Platform} from 'react-native';

/** 检查实际原生模块，不能用 JS 包装方法存在与否判断功能可用。 */
export const hasNativeCapability = (method: string): boolean =>
  typeof (BridgeTurboModule as unknown as Record<string, unknown> | null)?.[
    method
  ] === 'function';

export const hasNativeStorage = (): boolean => {
  const available = ['getOhPrefData', 'setOhPrefData', 'delOhPrefData'].every(
    hasNativeCapability,
  );
  if (Platform.OS === 'android' && !available) {
    throw new Error('Android 持久化模块未加载，请重新安装完整应用');
  }
  return available;
};
