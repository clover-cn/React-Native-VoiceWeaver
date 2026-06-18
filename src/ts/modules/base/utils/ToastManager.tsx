import React, {useState, useEffect, useRef} from 'react';
import {
  Text,
  Animated,
  StyleSheet,
  Dimensions,
  TouchableWithoutFeedback,
  Easing,
  View,
} from 'react-native';

const {width, height} = Dimensions.get('window');

export type ToastPosition = 'top' | 'center' | 'bottom';
const VALID_POSITIONS: ToastPosition[] = ['top', 'center', 'bottom'];

// 核心优化：用数组存储所有页面的update方法，避免覆盖
export const ToastGlobal = {
  message: '',
  visible: false,
  singleLine: false,
  duration: 1000,
  position: 'bottom' as ToastPosition,
  timer: null as NodeJS.Timeout | null,
  // 存储所有GlobalToast组件的update方法
  updateComponents: [] as Array<() => void>,
  // 注册update方法
  registerUpdate: (update: () => void) => {
    // 避免重复注册
    if (!ToastGlobal.updateComponents.includes(update)) {
      ToastGlobal.updateComponents.push(update);
    }
  },
  // 注销update方法（页面卸载时调用）
  unregisterUpdate: (update: () => void) => {
    ToastGlobal.updateComponents = ToastGlobal.updateComponents.filter(
      fn => fn !== update,
    );
  },
  // 通知所有页面更新Toast状态
  notifyUpdate: () => {
    ToastGlobal.updateComponents.forEach(update => {
      try {
        update();
      } catch (e) {}
    });
  },
};

export const Toast = {
  show: (msg: string, duration: number = 1000, position: string = 'bottom') => {
    if (ToastGlobal.timer) clearTimeout(ToastGlobal.timer);

    const singleLine = msg?.length <= 16;
    const validPosition = VALID_POSITIONS.includes(position as ToastPosition)
      ? (position as ToastPosition)
      : 'bottom';

    // 更新全局状态
    ToastGlobal.message = msg;
    ToastGlobal.duration = duration;
    ToastGlobal.position = validPosition;
    ToastGlobal.visible = true;
    ToastGlobal.singleLine = singleLine;

    // 通知所有页面的Toast组件更新
    ToastGlobal.notifyUpdate();

    if (duration > 0) {
      ToastGlobal.timer = setTimeout(() => {
        Toast.hide();
      }, duration);
    }
  },
  hide: () => {
    ToastGlobal.visible = false;
    ToastGlobal.notifyUpdate(); // 通知所有页面隐藏Toast
    if (ToastGlobal.timer) clearTimeout(ToastGlobal.timer);
  },
};

export const GlobalToast = () => {
  const [state, setState] = useState({
    visible: ToastGlobal.visible,
    message: ToastGlobal.message,
    position: ToastGlobal.position,
    singleLine: ToastGlobal.singleLine,
  });

  // 动画变量(初始处于"已隐藏"状态)
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const translateYAnim = useRef(new Animated.Value(20)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  // 是否真正挂载内容(动画播完才卸载,避免淡出动画被打断)
  const [mounted, setMounted] = useState(state.visible);
  // 防止快速重复调用 show 导致动画被多次重置闪烁:仅在状态发生有效切换时跑动画
  const lastVisibleRef = useRef(state.visible);

  // 定义当前组件的update方法
  const update = () => {
    setState({
      visible: ToastGlobal.visible,
      message: ToastGlobal.message,
      position: ToastGlobal.position,
      singleLine: ToastGlobal.singleLine,
    });
  };

  // 组件挂载时注册update方法，卸载时注销
  useEffect(() => {
    ToastGlobal.registerUpdate(update);
    // 初始化时同步一次状态
    update();

    // 页面卸载时清理
    return () => {
      ToastGlobal.unregisterUpdate(update);
      // 若当前是最后一个页面，清空timer避免内存泄漏
      if (ToastGlobal.updateComponents.length === 0 && ToastGlobal.timer) {
        clearTimeout(ToastGlobal.timer);
        ToastGlobal.timer = null;
      }
    };
  }, []);

  // 动画驱动:visible/position/message 变化时,重置起点再播动画
  useEffect(() => {
    opacityAnim.stopAnimation();
    translateYAnim.stopAnimation();
    scaleAnim.stopAnimation();

    if (state.visible) {
      // 立刻挂载内容,然后从"已隐藏"起点淡入
      setMounted(true);
      // 关键:每次淡入前先 setValue 到起点,避免上一次动画残留导致"突然显示再渐变"
      opacityAnim.setValue(0);
      if (state.position === 'center') {
        scaleAnim.setValue(0.85);
        Animated.parallel([
          Animated.timing(opacityAnim, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true,
          }),
          Animated.timing(scaleAnim, {
            toValue: 1,
            duration: 220,
            easing: Easing.out(Easing.back(1.4)),
            useNativeDriver: true,
          }),
        ]).start();
      } else {
        translateYAnim.setValue(20);
        Animated.parallel([
          Animated.timing(opacityAnim, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true,
          }),
          Animated.timing(translateYAnim, {
            toValue: 0,
            duration: 200,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]).start();
      }
    } else if (lastVisibleRef.current) {
      // 仅当之前确实可见过才跑淡出,避免初次挂载时白白播一次离场
      const onDone = ({finished}: {finished: boolean}) => {
        if (finished) {
          setMounted(false);
        }
      };
      if (state.position === 'center') {
        Animated.parallel([
          Animated.timing(opacityAnim, {
            toValue: 0,
            duration: 180,
            useNativeDriver: true,
          }),
          Animated.timing(scaleAnim, {
            toValue: 0.85,
            duration: 180,
            useNativeDriver: true,
          }),
        ]).start(onDone);
      } else {
        Animated.parallel([
          Animated.timing(opacityAnim, {
            toValue: 0,
            duration: 180,
            useNativeDriver: true,
          }),
          Animated.timing(translateYAnim, {
            toValue: 20,
            duration: 180,
            useNativeDriver: true,
          }),
        ]).start(onDone);
      }
    }

    lastVisibleRef.current = state.visible;
    // message 一并加入依赖:同位置同状态下连续 show 不同文案时也能重新播淡入
  }, [state.visible, state.position, state.message]);

  const getPosition = () => {
    switch (state.position) {
      case 'top':
        return {top: 40};
      case 'center':
        return {top: height / 2 - 25};
      default:
        return {bottom: 40};
    }
  };

  const getTransform = () => {
    if (state.position === 'center') {
      return [{scale: scaleAnim}];
    }
    const translateValue =
      state.position === 'top'
        ? Animated.multiply(translateYAnim, -1)
        : translateYAnim;
    return [{translateY: translateValue}];
  };

  return (
    // 不再使用 Modal,改为绝对定位的覆盖层,兼容鸿蒙等对 Modal 支持有差异的平台。
    // pointerEvents='box-none' 让未渲染区域穿透,不影响下层交互。
    <View pointerEvents="box-none" style={styles.overlay}>
      {mounted && (
        <View
          style={styles.modalContainer}
          pointerEvents={state.visible ? 'box-none' : 'none'}>
          <Animated.View
            // 气泡本身不抢焦点,但点击事件由内部的 TouchableWithoutFeedback 接收
            style={[
              styles.toast,
              getPosition(),
              {
                opacity: opacityAnim,
                transform: getTransform(),
              },
            ]}
            pointerEvents={state.visible ? 'auto' : 'none'}>
            <TouchableWithoutFeedback onPress={Toast.hide}>
              <View
                style={[
                  styles.bubble,
                  state.singleLine && styles.bubbleSingleLine,
                  {maxWidth: width * 0.75},
                ]}>
                <Text style={styles.text}>{state.message}</Text>
              </View>
            </TouchableWithoutFeedback>
          </Animated.View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 99999,
    elevation: 99999,
  },
  modalContainer: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
  },
  toast: {
    width: '100%',
    alignItems: 'center',
    position: 'absolute',
    justifyContent: 'center',
  },
  bubble: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    minWidth: 162,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 8,
  },
  bubbleSingleLine: {
    paddingVertical: 6,
    borderRadius: 18,
  },
  text: {
    color: '#fff',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 24,
    includeFontPadding: true,
  },
});
