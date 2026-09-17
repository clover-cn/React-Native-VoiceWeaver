import React, {useEffect, useState} from 'react';
import {
  Modal,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import VideoPlayerController from '../controllers/VideoPlayerController';
import {formatPlaybackRate, PLAYBACK_RATES} from '../utils/playbackRate';

export default function PlaybackRateControl() {
  const [rate, setRate] = useState(VideoPlayerController.getPlaybackRate());
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let active = true;
    VideoPlayerController.initializePlaybackRate()
      .then(() => {
        if (active) {
          setRate(VideoPlayerController.getPlaybackRate());
        }
      })
      .catch(error =>
        console.warn('[PlaybackRateControl] 读取倍速失败', error),
      );
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`听书速度 ${formatPlaybackRate(rate)}`}
        onPress={() => setVisible(true)}
        style={styles.trigger}>
        <Text style={styles.triggerText}>{formatPlaybackRate(rate)} 倍速</Text>
      </TouchableOpacity>
      <Modal
        transparent
        visible={visible}
        animationType="fade"
        onRequestClose={() => setVisible(false)}>
        <View style={styles.backdrop}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            accessibilityLabel="关闭倍速选择"
            onPress={() => setVisible(false)}
          />
          <SafeAreaView style={styles.sheet}>
            <View style={styles.sheetContent}>
              <Text style={styles.title}>听书速度</Text>
              <Text style={styles.subtitle}>立即生效，自动记住你的选择</Text>
              <View style={styles.options}>
                {PLAYBACK_RATES.map(value => (
                  <TouchableOpacity
                    key={value}
                    accessibilityRole="radio"
                    accessibilityState={{selected: rate === value}}
                    style={[styles.option, rate === value && styles.selected]}
                    onPress={() => {
                      VideoPlayerController.setPlaybackRate(value);
                      setRate(value);
                      setVisible(false);
                    }}>
                    <Text
                      style={[
                        styles.optionText,
                        rate === value && styles.selectedText,
                      ]}>
                      {formatPlaybackRate(value)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity
                style={styles.close}
                onPress={() => setVisible(false)}>
                <Text style={styles.subtitle}>关闭</Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 12},
  triggerText: {fontSize: 13, color: '#7c6ff7', fontWeight: '600'},
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  sheetContent: {paddingTop: 28},
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: '#242138',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    color: '#777487',
    textAlign: 'center',
    marginTop: 10,
  },
  options: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    padding: 16,
  },
  option: {
    width: '21%',
    margin: '2%',
    borderRadius: 12,
    paddingVertical: 14,
    backgroundColor: '#f3f2f8',
    alignItems: 'center',
  },
  selected: {backgroundColor: '#7c6ff7'},
  optionText: {color: '#514c67', fontSize: 16, fontWeight: '500'},
  selectedText: {color: '#fff'},
  close: {paddingBottom: 24, paddingTop: 2},
});
