import {PermissionsAndroid, Platform} from 'react-native';
import {nativeCall} from './native';

export interface RecordingResult {
  state: 'starting' | 'recording' | 'ready' | 'cancelled' | 'error';
  durationMs: number;
  error?: string;
  uri?: string;
  size?: number;
  fileName?: string;
  mimeType?: string;
}
export interface RecordedAudio {
  recordingId: string;
  uri: string;
  durationMs: number;
  size: number;
  fileName: string;
  mimeType: string;
}

/** 只准备权限；授权返回后必须重新长按，不自动启动麦克风。 */
export async function prepareRecording(): Promise<boolean> {
  if (Platform.OS === 'android') {
    const permission = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
    if (!(await PermissionsAndroid.check(permission))) {
      const granted = await PermissionsAndroid.request(permission);
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        return false;
      }
    }
  }
  return (await nativeCall<{granted: boolean}>('recordingPrepare')).granted;
}

export function recordedAudio(
  id: string,
  result: RecordingResult,
): RecordedAudio {
  if (
    result.state !== 'ready' ||
    !result.uri?.startsWith('file://') ||
    !Number.isFinite(result.durationMs) ||
    result.durationMs < 1000 ||
    result.durationMs > 20000 ||
    !result.size ||
    result.size <= 44 ||
    result.size > 5 * 1024 * 1024
  ) {
    throw new Error('录音无效，请录制1～20秒的音频');
  }
  return {
    recordingId: id,
    uri: result.uri,
    durationMs: result.durationMs,
    size: result.size,
    fileName: result.fileName || '现场录音.wav',
    mimeType: 'audio/wav',
  };
}
