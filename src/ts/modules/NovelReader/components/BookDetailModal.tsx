import React, {memo} from 'react';
import {
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {Book} from '../types/reader';

interface BookDetailModalProps {
  visible: boolean;
  book: Book | null;
  onClose: () => void;
}

const getDisplayText = (value?: string, fallback = '暂无') => {
  const text = String(value || '').trim();
  return text || fallback;
};

const BookDetailModal: React.FC<BookDetailModalProps> = ({
  visible,
  book,
  onClose,
}) => {
  const sourceName = getDisplayText(book?.originName || book?.origin, '未知书源');

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}>
      <View style={styles.modalBg}>
        <TouchableOpacity
          style={styles.bgTouch}
          activeOpacity={1}
          onPress={onClose}
        />
        <View style={styles.modalContent}>
          <SafeAreaView style={styles.safeArea}>
            <View style={styles.header}>
              <Text style={styles.title}>书籍详情</Text>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <Text style={styles.closeText}>关闭</Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.scrollView}
              contentContainerStyle={styles.content}
              showsVerticalScrollIndicator={false}>
              <View style={styles.card}>
                <Text style={styles.bookName}>
                  {getDisplayText(book?.name, '未命名书籍')}
                </Text>
                <Text style={styles.authorText}>
                  作者：{getDisplayText(book?.author, '未知作者')}
                </Text>
              </View>

              <View style={styles.infoCard}>
                <Text style={styles.fieldLabel}>使用书源</Text>
                <Text style={styles.fieldValue}>{sourceName}</Text>
              </View>

              <View style={styles.infoCard}>
                <Text style={styles.fieldLabel}>书籍详情</Text>
                <Text style={styles.detailText}>
                  {getDisplayText(book?.intro, '暂无书籍详情')}
                </Text>
              </View>
            </ScrollView>
          </SafeAreaView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'flex-end',
  },
  bgTouch: {
    flex: 1,
  },
  modalContent: {
    backgroundColor: '#F5F5F9',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    height: '82%',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: -2},
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 8,
  },
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#D1D1D6',
    backgroundColor: '#FFF',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    position: 'relative',
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000',
  },
  closeBtn: {
    position: 'absolute',
    right: 16,
    padding: 8,
  },
  closeText: {
    fontSize: 16,
    color: '#007AFF',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 24,
  },
  card: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  bookName: {
    color: '#1C1C1E',
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 28,
    marginBottom: 8,
  },
  authorText: {
    color: '#636366',
    fontSize: 14,
    lineHeight: 20,
  },
  infoCard: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  fieldLabel: {
    color: '#8E8E93',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  fieldValue: {
    color: '#1C1C1E',
    fontSize: 15,
    lineHeight: 22,
  },
  detailText: {
    color: '#1C1C1E',
    fontSize: 15,
    lineHeight: 24,
  },
});

export default memo(BookDetailModal);
