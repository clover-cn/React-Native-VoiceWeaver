/**
 * 调试模式密码验证弹窗
 * 在根级别渲染，通过 DebugContext 控制显隐
 */
import React, {useState, useRef, useEffect} from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Keyboard,
  Platform,
} from 'react-native';
import {useDebug} from './DebugContext';

const DebugPasswordModal: React.FC = () => {
  const {isPasswordModalVisible, submitPassword, dismissPasswordModal} =
    useDebug();
  const [inputValue, setInputValue] = useState('');
  const [errorShown, setErrorShown] = useState(false);
  const inputRef = useRef<TextInput>(null);

  // 弹窗打开时重置状态并自动聚焦
  useEffect(() => {
    if (isPasswordModalVisible) {
      setInputValue('');
      setErrorShown(false);
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [isPasswordModalVisible]);

  const handleSubmit = () => {
    const trimmed = inputValue.trim();
    if (!trimmed) {
      return;
    }

    const success = submitPassword(trimmed);
    if (!success) {
      setErrorShown(true);
      setInputValue('');
    }
  };

  const handleDismiss = () => {
    Keyboard.dismiss();
    dismissPasswordModal();
  };

  return (
    <Modal
      visible={isPasswordModalVisible}
      transparent
      animationType="fade"
      onRequestClose={handleDismiss}>
      <View style={styles.backdrop}>
        <View style={styles.dialog}>
          <Text style={styles.title}>调试模式</Text>
          <Text style={styles.subtitle}>请输入密码以进入调试模式</Text>

          <TextInput
            ref={inputRef}
            style={styles.input}
            value={inputValue}
            onChangeText={text => {
              setInputValue(text);
              if (errorShown) {
                setErrorShown(false);
              }
            }}
            placeholder="请输入密码"
            placeholderTextColor="#999"
            secureTextEntry
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
            autoCapitalize="none"
            autoCorrect={false}
          />

          {errorShown && (
            <Text style={styles.errorText}>密码错误，请重试</Text>
          )}

          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.button, styles.cancelButton]}
              onPress={handleDismiss}
              activeOpacity={0.7}>
              <Text style={styles.cancelText}>取消</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.confirmButton]}
              onPress={handleSubmit}
              activeOpacity={0.7}>
              <Text style={styles.confirmText}>确认</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  dialog: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1C1C1E',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: '#8E8E93',
    marginBottom: 20,
  },
  input: {
    width: '100%',
    height: 48,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    borderRadius: 10,
    paddingHorizontal: 16,
    fontSize: 16,
    color: '#1C1C1E',
    backgroundColor: '#F9F9F9',
    marginBottom: 8,
  },
  errorText: {
    fontSize: 13,
    color: '#FF3B30',
    marginBottom: 8,
    alignSelf: 'flex-start',
  },
  buttonRow: {
    flexDirection: 'row',
    marginTop: 16,
    gap: 12,
  },
  button: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: '#F2F2F7',
  },
  cancelText: {
    fontSize: 16,
    color: '#8E8E93',
    fontWeight: '600',
  },
  confirmButton: {
    backgroundColor: '#007AFF',
  },
  confirmText: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '600',
  },
});

export {DebugPasswordModal};
