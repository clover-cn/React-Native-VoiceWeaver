import {DeviceEventEmitter, EmitterSubscription} from 'react-native';
import {BridgeTurboModule} from '../../../../../turboModules';

export interface SessionMetadata {
  assetId: string;
  title: string;
  mediaImage?: string;
  duration?: number;
  author?: string;
  album?: string;
  previousAssetId?: string;
  nextAssetId?: string;
}

export interface NativeAudioSegment {
  id: string;
  url?: string | null;
  title?: string;
  duration?: number;
}

export interface NativeAudioQueuePayload {
  chapterAssetId: string;
  title: string;
  author?: string;
  album?: string;
  mediaImage?: string;
  segments: NativeAudioSegment[];
  startIndex?: number;
  autoPlay?: boolean;
  isGenerationComplete?: boolean;
}

export interface NativeAudioPlaybackState {
  state: string;
  chapterAssetId: string;
  currentIndex: number;
  queueLength: number;
  positionMs: number;
  durationMs: number;
  waitingForMoreSegments: boolean;
  chapterFinished: boolean;
}

export type NativeAudioStateCallback = (
  payload: NativeAudioPlaybackState,
) => void;

const PLAYBACK_EVENT_NAME = 'NovelAudioPlaybackState';
const SESSION_TAG = 'NovelReaderAudio';

class VideoSessionController {
  private playbackSubscription: EmitterSubscription | null = null;
  private commandSubscription: EmitterSubscription | null = null;
  private listeners: NativeAudioStateCallback[] = [];

  async initSession(): Promise<boolean> {
    if (!BridgeTurboModule) {
      console.warn('[VideoSessionController] BridgeTurboModule 不可用');
      return false;
    }

    try {
      BridgeTurboModule.initAVSession(SESSION_TAG);
      return true;
    } catch (error) {
      console.warn('[VideoSessionController] initAVSession 失败', error);
      return false;
    }
  }

  setMetadata(meta: SessionMetadata): void {
    if (!BridgeTurboModule) {
      return;
    }

    try {
      BridgeTurboModule.updateAVSessionMetadata(
        JSON.stringify({
          ...meta,
          duration:
            typeof meta.duration === 'number'
              ? Math.max(0, Math.round(meta.duration))
              : undefined,
        }),
      );
    } catch (error) {
      console.warn('[VideoSessionController] update metadata 失败', error);
    }
  }

  loadNativeQueue(payload: NativeAudioQueuePayload): void {
    if (!BridgeTurboModule) {
      return;
    }

    BridgeTurboModule.loadNativeAudioQueue(JSON.stringify(payload));
  }

  playNative(): void {
    BridgeTurboModule?.playNativeAudio();
  }

  pauseNative(): void {
    BridgeTurboModule?.pauseNativeAudio();
  }

  seekNative(positionSeconds: number): void {
    BridgeTurboModule?.seekNativeAudio(
      Math.max(0, Math.round(positionSeconds * 1000)),
    );
  }

  stopNative(): void {
    BridgeTurboModule?.stopNativeAudio();
  }

  nextNative(): void {
    BridgeTurboModule?.skipToNextNativeAudio();
  }

  previousNative(): void {
    BridgeTurboModule?.skipToPreviousNativeAudio();
  }

  subscribePlaybackState(callback: NativeAudioStateCallback): () => void {
    this.listeners.push(callback);

    if (!this.playbackSubscription) {
      this.playbackSubscription = DeviceEventEmitter.addListener(
        PLAYBACK_EVENT_NAME,
        payload => {
          this.listeners.forEach(listener => listener(payload));
        },
      );
    }

    if (!this.commandSubscription && DeviceEventEmitter) {
      this.commandSubscription = DeviceEventEmitter.addListener(
        'VideoSessionCommand',
        payload => {
          switch (payload.command) {
            case 'play':
              this.playNative();
              break;
            case 'pause':
              this.pauseNative();
              break;
            case 'stop':
              this.stopNative();
              break;
            case 'playNext':
              this.nextNative();
              break;
            case 'playPrevious':
              this.previousNative();
              break;
            case 'seek':
              if (payload.timeMs != null) {
                this.seekNative(payload.timeMs / 1000);
              }
              break;
            default:
              break;
          }
        },
      );
    }

    return () => {
      this.listeners = this.listeners.filter(listener => listener !== callback);
      if (this.listeners.length === 0) {
        this.playbackSubscription?.remove();
        this.playbackSubscription = null;
      }
    };
  }

  destroy() {
    this.playbackSubscription?.remove();
    this.playbackSubscription = null;
    this.commandSubscription?.remove();
    this.commandSubscription = null;
    this.listeners = [];

    try {
      BridgeTurboModule?.releaseNativeAudio();
      BridgeTurboModule?.destroyAVSession();
    } catch (error) {
      console.warn('[VideoSessionController] destroyAVSession 失败', error);
    }
  }
}

export default new VideoSessionController();
