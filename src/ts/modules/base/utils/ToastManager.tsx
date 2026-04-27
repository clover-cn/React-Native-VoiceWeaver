import React, {useState, useEffect, useRef} from 'react';
import {
  Text,
  Animated,
  StyleSheet,
  Dimensions,
  TouchableWithoutFeedback,
  Easing,
  View,
  Modal,
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

  // 动画变量
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const translateYAnim = useRef(new Animated.Value(20)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;

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

  // 状态变化触发动画
  useEffect(() => {
    opacityAnim.stopAnimation();
    translateYAnim.stopAnimation();
    scaleAnim.stopAnimation();

    if (state.visible) {
      if (state.position === 'center') {
        Animated.parallel([
          Animated.timing(opacityAnim, {
            toValue: 1,
            duration: 150,
            useNativeDriver: true,
          }),
          Animated.timing(scaleAnim, {
            toValue: 1,
            duration: 150,
            easing: Easing.out(Easing.back(1.5)),
            useNativeDriver: true,
          }),
        ]).start();
      } else {
        Animated.parallel([
          Animated.timing(opacityAnim, {
            toValue: 1,
            duration: 150,
            useNativeDriver: true,
          }),
          Animated.timing(translateYAnim, {
            toValue: 50,
            duration: 150,
            useNativeDriver: true,
          }),
        ]).start();
      }
    } else {
      if (state.position === 'center') {
        Animated.parallel([
          Animated.timing(opacityAnim, {
            toValue: 0,
            duration: 150,
            useNativeDriver: true,
          }),
          Animated.timing(scaleAnim, {
            toValue: 0.8,
            duration: 150,
            useNativeDriver: true,
          }),
        ]).start();
      } else {
        Animated.parallel([
          Animated.timing(opacityAnim, {
            toValue: 0,
            duration: 150,
            useNativeDriver: true,
          }),
          Animated.timing(translateYAnim, {
            toValue: 20,
            duration: 150,
            useNativeDriver: true,
          }),
        ]).start();
      }
    }
  }, [state.visible, state.position]);

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
        ? translateYAnim
        : Animated.multiply(translateYAnim, -1);
    return [{translateY: translateValue}];
  };

  return (
    <Modal
      animationType="none"
      transparent={true}
      visible={state.visible}
      onRequestClose={Toast.hide}
      style={{zIndex: 99999}}>
      <TouchableWithoutFeedback onPress={Toast.hide}>
        <View style={styles.modalContainer}>
          <Animated.View
            style={[
              styles.toast,
              getPosition(),
              {
                opacity: opacityAnim,
                transform: getTransform(),
              },
            ]}>
            <View
              style={[
                {
                  maxWidth: width * 0.75,
                  paddingHorizontal: 16,
                  minWidth: 162,
                  backgroundColor: 'rgba(0,0,0,0.7)',
                  borderRadius: 8,
                  paddingVertical: state.visible ? 8 : 0,
                  height: state.visible ? undefined : 0,
                },
                state.singleLine
                  ? {
                      paddingVertical: 6,
                      borderRadius: 18,
                    }
                  : {},
              ]}>
              <Text
                style={[styles.text, {height: state.visible ? undefined : 0}]}>
                {state.message}
              </Text>
            </View>
          </Animated.View>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

const styles = StyleSheet.create({
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
  text: {
    color: '#fff',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 24,
    includeFontPadding: true,
  },
});
