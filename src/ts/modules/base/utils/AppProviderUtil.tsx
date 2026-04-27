import {AppRegistry, Platform, Text, View} from 'react-native';
import {GlobalToast} from './ToastManager';
import {ToastProvider} from './ToastContext';
import React from 'react';

export function registerProvider() {
  AppRegistry.setWrapperComponentProvider(appParams => {
    return function ({children, ...otherProps}) {
      return (
        <ToastProvider>
          <View style={{flex: 1, width: '100%', height: '100%'}}>
            {children}
            <GlobalToast />
          </View>
        </ToastProvider>
      );
    };
  });
}
