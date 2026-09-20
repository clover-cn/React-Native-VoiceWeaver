import {NativeModules, Linking, Share, StatusBar} from 'react-native';
import type {Spec} from '../src/NativeBridgeTurboModule';

const native = NativeModules.BridgeTurboModule;

// Android 使用应用内注册的旧架构模块，不参与鸿蒙 Codegen。
const bridge: Spec | null = native
  ? {
      ...native,
      getOhASData: (key, fallback = null) => {
        if (key === 'topRectHeight' || key === 'bottomRectHeight') {
          return native.getWindowInset(key);
        }
        return fallback;
      },
      getOhPrefData: (callback, key, fallback = null, prefName) => {
        native.getOhPrefData(key, fallback, prefName, callback);
      },
      setStatusBarWhite: white =>
        StatusBar.setBarStyle(white ? 'light-content' : 'dark-content'),
      openLink: payload => {
        const value = JSON.parse(payload);
        Linking.openURL(value.url || value.link).catch(console.warn);
      },
      callPhone: phone => {
        Linking.openURL(`tel:${phone}`).catch(console.warn);
      },
      share: payload => {
        const value = JSON.parse(payload);
        Share.share({message: value.content || '', title: value.title}).catch(
          console.warn,
        );
        return true;
      },
      hiLog: (level, tag, content) => {
        if (__DEV__) {
          console.log(`[${level}] ${tag}: ${content}`);
        }
      },
    }
  : null;

export default bridge;
