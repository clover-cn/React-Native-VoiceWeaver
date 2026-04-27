import {
  Animated,
  Dimensions,
  Modal,
  TouchableOpacity,
  View,
} from 'react-native';
import React, {useEffect, useRef} from 'react';
import {WindowInfo} from './WindowInfo';

interface CalculateParams {
  showAnimationType?: 'fade' | 'none' | 'slide';
  isFill?: boolean;
  viewHeight?: number;
  expandHeight?: number;
  bgColor?: string;
  clickInnerClose?: boolean;
}

const windowHeight = Dimensions.get('window').height;

export const showModal = (
  view: any,
  modalVisible: boolean,
  cbClose: () => void,
  {
    viewHeight = 0,
    expandHeight = 0,
    showAnimationType = 'fade',
    isFill = false,
    bgColor = '#00000088',
    clickInnerClose = false,
  }: CalculateParams = {},
) => {
  const {foldStatus} = WindowInfo();

  const getHeight = () => {
    if (!isFill) {
      return undefined;
    } else if (foldStatus === 1) {
      return expandHeight;
    } else {
      return viewHeight;
    }
  };

  const translateY = useRef(
    viewHeight > 0 ? new Animated.Value(viewHeight) : undefined,
  ).current;

  useEffect(() => {
    let toVal = 0;
    if (!modalVisible) {
      if (foldStatus === 1) {
        toVal = expandHeight;
      } else {
        toVal = viewHeight;
      }
    }
    translateY &&
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: toVal,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
  }, [modalVisible, foldStatus]);

  return (
    <Modal
      style={{width: '100%', height: '100%', zIndex: 9999}} // 业务弹窗 zIndex 低于 Toast
      animationType={showAnimationType}
      transparent={true}
      visible={modalVisible}
      onRequestClose={() => {
        cbClose();
      }}>
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: bgColor,
        }}>
        <View
          style={{
            margin: 16,
            width: '100%',
            height: isFill ? '100%' : undefined,
            borderRadius: 30,
            overflow: 'hidden',
            alignItems: 'center',
            justifyContent: foldStatus === 1 ? 'center' : 'flex-end',
          }}>
          <TouchableOpacity
            activeOpacity={1}
            style={{
              width: '100%',
              flex: 1,
              height: '100%',
            }}
            onPress={e => {
              clickInnerClose && cbClose();
            }}></TouchableOpacity>
          <Animated.View
            style={{
              width: foldStatus === 1 ? '65%' : '100%',
              height: getHeight(),
              marginBottom:
                isFill && foldStatus === 1
                  ? (windowHeight - viewHeight) / 2
                  : undefined,
              transform: isFill ? [{translateY}] : [],
            }}>
            {view}
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
};
