import React, {useEffect, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {listAudio} from '../local/repository';
import {AudioOption} from '../types/audio';

interface Props {
  visible: boolean;
  selectedId?: string;
  onSelect: (record: AudioOption | null) => void;
  onClose: () => void;
}

/** 文章独立选择参考录音；默认项继续使用系统旁白，不改变全局音色。 */
export default function ArticleVoicePicker({
  visible,
  selectedId,
  onSelect,
  onClose,
}: Props) {
  const [records, setRecords] = useState<AudioOption[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!visible) {
      return;
    }
    let live = true;
    setLoading(true);
    setError('');
    setQuery('');
    listAudio()
      .then(value => {
        if (live) {
          setRecords(value.filter(record => !record.disabled));
        }
      })
      .catch(() => {
        if (live) {
          setRecords([]);
          setError('无法读取音色库，请重试。');
        }
      })
      .finally(() => {
        if (live) {
          setLoading(false);
        }
      });
    return () => {
      live = false;
    };
  }, [visible, reload]);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.title}>文章参考音频</Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="取消选择参考音频"
            onPress={onClose}>
            <Text style={styles.action}>取消</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.hint}>
          仅用于这篇文章。默认使用旁白，也可选择音色库中其他已启用的录音。
        </Text>
        <TouchableOpacity
          accessibilityRole="radio"
          accessibilityLabel="默认旁白"
          accessibilityState={{selected: !selectedId}}
          onPress={() => onSelect(null)}
          style={styles.row}>
          <Text style={styles.name}>默认旁白</Text>
          <Text style={styles.action}>{!selectedId ? '已选' : '选择'}</Text>
        </TouchableOpacity>
        <TextInput
          accessibilityLabel="搜索文章参考音频"
          placeholder="搜索音色库中的录音名称"
          value={query}
          onChangeText={setQuery}
          style={styles.search}
        />
        {loading ? (
          <ActivityIndicator accessibilityLabel="参考音频加载中" />
        ) : null}
        {error ? (
          <TouchableOpacity onPress={() => setReload(value => value + 1)}>
            <Text style={styles.hint}>{error} 点击重试</Text>
          </TouchableOpacity>
        ) : null}
        <FlatList
          data={records.filter(record =>
            record.name.toLowerCase().includes(query.trim().toLowerCase()),
          )}
          keyExtractor={record => record.id}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            !loading && !error ? (
              <Text style={styles.hint}>
                {query
                  ? '没有匹配的录音。'
                  : '暂无可用录音，可先在音色库导入或启用参考音频。'}
              </Text>
            ) : null
          }
          renderItem={({item}) => (
            <TouchableOpacity
              accessibilityRole="radio"
              accessibilityLabel={item.name}
              accessibilityState={{selected: selectedId === item.id}}
              onPress={() => onSelect(item)}
              style={styles.row}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.action}>
                {selectedId === item.id ? '已选' : '选择'}
              </Text>
            </TouchableOpacity>
          )}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#F8F6F0'},
  header: {
    height: 56,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {fontSize: 18, fontWeight: '700', color: '#1C1917'},
  action: {fontSize: 14, color: '#B45309', marginLeft: 12},
  hint: {
    fontSize: 13,
    color: '#78716C',
    lineHeight: 20,
    marginHorizontal: 18,
    marginVertical: 12,
  },
  search: {
    margin: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: '#D9CDB9',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    color: '#1C1917',
  },
  row: {
    marginHorizontal: 16,
    marginVertical: 4,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
  },
  name: {flex: 1, fontSize: 15, color: '#1C1917'},
});
