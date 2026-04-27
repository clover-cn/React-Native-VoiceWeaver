import {StyleSheet, View} from 'react-native';
import * as React from 'react';
import {WebView} from 'react-native-webview';
import {useEffect, useState} from 'react';
import {CommonTitle} from '../../utils/CommonUtils';
import bridge from '../../utils/bridge';
import {BottomReactHeight, TopReactHeight} from '../../utils/Constant';

function SimpleWebPage(props) {
  const [url, setUrl] = useState({uri: 'https://developer.huawei.com/'});
  useEffect(() => {
    if (props.webUrl && typeof props.webUrl === 'string') {
      if (
        props.webUrl.startsWith('http://') ||
        props.webUrl.startsWith('https://')
      ) {
        setUrl({uri: props.webUrl});
      }
    } else if (props.webUrl && typeof props.webUrl === 'number') {
      setUrl(props.webUrl);
    }
  }, []);

  function getWebUrl() {
    if (props.webUrl === 'user_agreement') {
      return require('../../../../rawfile/dev/user_agreement.html');
    } else if (props.webUrl === 'privacy_policy') {
      return require('../../../../rawfile/dev/privacy_policy.html');
    } else {
      return url;
    }
  }

  return (
    <View style={styles.content}>
      {CommonTitle('', 'black', null, () => {
        bridge.back('');
      })}
      <WebView
        style={{height: '100%', marginHorizontal: 16}}
        source={getWebUrl()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    width: '100%',
    height: '100%',
    paddingTop: TopReactHeight,
    paddingBottom: BottomReactHeight,
  },
});
export default SimpleWebPage;
