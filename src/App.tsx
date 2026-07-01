import React from 'react';
import {View, StyleSheet} from 'react-native';
import NovelReaderApp from './ts/modules/NovelReader/NovelReaderApp';
import {
  DebugProvider,
  DebugOverlay,
  DebugPasswordModal,
} from './ts/modules/NovelReader/debug';

const App = () => {
  return (
    <DebugProvider>
      <View style={styles.root}>
        <NovelReaderApp />
        <DebugPasswordModal />
        <DebugOverlay />
      </View>
    </DebugProvider>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});

export default App;
