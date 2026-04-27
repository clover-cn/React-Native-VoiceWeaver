import VideoSessionController, {
  NativeAudioPlaybackState,
  NativeAudioQueuePayload,
} from './VideoSessionController';

type PlaybackStateCallback = (payload: NativeAudioPlaybackState) => void;

class VideoPlayerController {
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
    VideoSessionController.loadNativeQueue(payload);
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
