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
                style={styles.loginBtn}
                disabled={loggingIn || props.loading}
                onPress={() => login(item.sourceUrl)}>
                <Text style={styles.loginBtnText}>登录书源</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
      {props.loading || loggingIn ? (
        <ActivityIndicator color="#D97706" style={styles.loader} />
      ) : (
        <View style={styles.actions}>
          {props.hasMore && (
            <TouchableOpacity
              style={styles.moreButton}
              onPress={props.onMore}
              activeOpacity={0.8}>
              <Text style={styles.moreButtonText}>加载更多章节</Text>
            </TouchableOpacity>
          )}
          {props.hasFailures && (
            <TouchableOpacity
              style={styles.retryButton}
              onPress={props.onRetry}
              activeOpacity={0.8}>
              <Text style={styles.retryButtonText}>重试异常书源</Text>
            </TouchableOpacity>
          )}
          {props.hasSearched && !props.hasMore && !props.hasFailures && (
            <Text style={styles.endMessage}>—— 已经到底啦 ——</Text>
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  footer: {
    paddingVertical: 20,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  loader: {
    marginVertical: 10,
  },
  failure: {
    width: '100%',
    marginBottom: 10,
    backgroundColor: '#FFF7ED',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FFEDD5',
  },
  message: {
    fontSize: 12,
    color: '#9A3412',
    lineHeight: 18,
  },
  loginBtn: {
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#D97706',
    borderRadius: 6,
  },
  loginBtnText: {
    fontSize: 11,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
  },
  moreButton: {
    backgroundColor: '#FAF5ED',
    borderWidth: 1,
    borderColor: '#EFE8DE',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 9,
    shadowColor: '#1C1917',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  moreButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#B45309',
  },
  retryButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EFECE6',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  retryButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#78716C',
  },
  endMessage: {
    fontSize: 12,
    color: '#A8A29E',
    paddingVertical: 8,
  },
});
