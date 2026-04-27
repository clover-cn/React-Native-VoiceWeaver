import {useEffect, useState} from 'react';
import {EmitterSubscription} from 'react-native/Libraries/vendor/emitter/EventEmitter';
import bridge from './bridge';
import {DeviceEventEmitter, Dimensions} from 'react-native';

export function WindowInfo() {
  const [foldStatus, setFoldStatus] = useState<number>(0);
  const [foldable, setFoldable] = useState<boolean>(false);
  let emitter: EmitterSubscription | null = null;
  // 初始化加载数据
  useEffect(() => {
    let foldableTem = bridge.getOhASData('Foldable') as boolean;
    foldableTem !== foldable && setFoldable(foldableTem);

    let foldStatusTem = bridge.getOhASData('FoldStatus') as number;
    foldStatusTem !== 0 && setFoldStatus(foldStatusTem);

    emitter = DeviceEventEmitter.addListener('WindowState', windowState => {
      // 添加事件处理
      windowState.foldStatus !== 0 &&
        windowState.foldStatus !== foldStatus &&
        setFoldStatus(windowState.foldStatus);

      windowState.foldable !== foldable && setFoldable(windowState.foldable);
    });
    return () => {
      emitter && emitter.remove();
    };
  }, []);
  return {
    foldStatus,
    foldable,
  };
}
