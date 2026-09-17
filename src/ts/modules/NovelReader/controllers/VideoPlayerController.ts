import VideoSessionController, {
  NativeAudioPlaybackState,
  NativeAudioQueuePayload,
} from './VideoSessionController';
import {loadPlaybackRate, savePlaybackRate} from '../utils/readerStorage';
import {normalizePlaybackRate} from '../utils/playbackRate';

type PlaybackStateCallback = (payload: NativeAudioPlaybackState) => void;

class VideoPlayerController {
  private playbackRate = 1;
  private rateChanged = false;
  private rateInitialization: Promise<number> | null = null;
  private rateWrites: Promise<void> = Promise.resolve();
  private lastQueue: NativeAudioQueuePayload | null = null;

  getPlaybackRate(): number {
    return this.playbackRate;
  }

  initializePlaybackRate(): Promise<number> {
    if (!this.rateInitialization) {
      this.rateInitialization = loadPlaybackRate().then(rate => {
        if (!this.rateChanged) {
          this.playbackRate = normalizePlaybackRate(rate);
          this.refreshPlaybackRate();
        }
        return this.playbackRate;
      });
    }
    return this.rateInitialization;
  }

  setPlaybackRate(rate: number): void {
    this.rateChanged = true;
    this.playbackRate = normalizePlaybackRate(rate);
    this.refreshPlaybackRate();
    const value = this.playbackRate;
    this.rateWrites = this.rateWrites
      .then(() => savePlaybackRate(value))
      .catch(error => {
        console.warn('[VideoPlayerController] 保存倍速失败', error);
      });
  }

  /** 只更新队列的倍速，不携带旧的跳段与自动播放指令。 */
  private refreshPlaybackRate(): void {
    if (!this.lastQueue) {
      return;
    }
    VideoSessionController.loadNativeQueue({
      ...this.lastQueue,
      playbackRate: this.playbackRate,
      startIndex: undefined,
      isExplicitStart: false,
      autoPlay: undefined,
    });
  }
  private listeners: PlaybackStateCallback[] = [];
  private unsubscribeNative: (() => void) | null = null;

  init() {
    if (this.unsubscribeNative) {
      return;
    }

    this.unsubscribeNative = VideoSessionController.subscribePlaybackState(
      payload => {
        this.listeners.forEach(listener => listener(payload));
      },
    );
  }

  loadQueue(payload: NativeAudioQueuePayload) {
    this.init();
    this.lastQueue = payload;
    VideoSessionController.loadNativeQueue({
      ...payload,
      playbackRate: this.playbackRate,
    });
    this.initializePlaybackRate().catch(error =>
      console.warn('[VideoPlayerController] 读取倍速失败', error),
    );
  }

  play() {
    VideoSessionController.playNative();
  }

  pause() {
    VideoSessionController.pauseNative();
  }

  seek(timeSeconds: number) {
    VideoSessionController.seekNative(timeSeconds);
  }

  stop() {
    this.lastQueue = null;
    VideoSessionController.stopNative();
  }

  next() {
    VideoSessionController.nextNative();
  }

  previous() {
    VideoSessionController.previousNative();
  }

  onPlaybackState(callback: PlaybackStateCallback): () => void {
    this.init();
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(listener => listener !== callback);
    };
  }

  clearAllListeners() {
    this.listeners = [];
    this.unsubscribeNative?.();
    this.unsubscribeNative = null;
  }
}

export default new VideoPlayerController();
