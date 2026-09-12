import React, {useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {BookSourceDiagnostic} from '../bookSource/types';
import LocalBookSourceService from '../bookSource/LocalBookSourceService';
import {openBookSourceLogin} from '../bookSource/bookSourceSession';

interface Props {
  loading: boolean;
  hasSearched: boolean;
  hasMore: boolean;
  hasFailures: boolean;
  diagnostics: BookSourceDiagnostic[];
  onMore: () => void;
  onRetry: () => void;
}

export const SearchResultsFooter = (props: Props) => {
  const [loggingIn, setLoggingIn] = useState(false);
  const login = async (sourceId: string) => {
    setLoggingIn(true);
    try {
      const source = (await LocalBookSourceService.getSources()).find(
        item => item.bookSourceUrl === sourceId,
      );
      if (!source) {
        throw new Error('未找到书源，请刷新书源列表');
      }
      const result = await openBookSourceLogin(source);
      if (result.status === 'authenticated') {
        props.onRetry();
      }
      if (result.status === 'failed') {
        Alert.alert('登录失败', result.message || '无法完成书源登录');
      }
    } catch (error) {
      Alert.alert(
        '登录失败',
        error instanceof Error ? error.message : '无法打开书源登录',
      );
    } finally {
      setLoggingIn(false);
    }
  };

  return (
    <View style={styles.footer}>
      {props.diagnostics
        .filter(item => !item.ok)
        .map(item => (
          <View key={item.sourceUrl} style={styles.failure}>
            <Text style={styles.message}>
              {item.sourceName}：{item.message}
            </Text>
            {item.stage === 'auth' && (
              <TouchableOpacity
                disabled={loggingIn || props.loading}
                onPress={() => login(item.sourceUrl)}>
                <Text style={styles.action}>登录书源</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
      {props.loading || loggingIn ? (
        <ActivityIndicator color="#007AFF" />
      ) : (
        <View style={styles.actions}>
          {props.hasMore && (
            <TouchableOpacity style={styles.button} onPress={props.onMore}>
              <Text style={styles.action}>加载更多</Text>
            </TouchableOpacity>
          )}
          {props.hasFailures && (
            <TouchableOpacity style={styles.button} onPress={props.onRetry}>
              <Text style={styles.action}>重试失败书源</Text>
            </TouchableOpacity>
          )}
          {props.hasSearched && !props.hasMore && !props.hasFailures && (
            <Text style={styles.message}>没有更多结果了</Text>
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  footer: {padding: 16, alignItems: 'center'},
  failure: {width: '100%', marginBottom: 10},
  message: {fontSize: 13, color: '#636366', lineHeight: 20},
  actions: {flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap'},
  action: {fontSize: 14, color: '#007AFF', paddingVertical: 6},
  button: {paddingHorizontal: 12},
});
