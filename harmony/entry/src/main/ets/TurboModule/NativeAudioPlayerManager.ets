import { media } from '@kit.MediaKit';
import { audio } from '@kit.AudioKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { JSON } from '@kit.ArkTS';
import { fileIo as fs } from '@kit.CoreFileKit';
import { LoadManager } from '../rn';
import { Logger } from '../utils/Logger';
import { AVSessionManager } from './AVSessionManager';

const TAG = 'NativeAudioPlayer';
const PLAYBACK_EVENT_NAME = 'NovelAudioPlaybackState';
const PLAYBACK_PROGRESS_EVENT_THROTTLE_MS = 1000;
const SESSION_PROGRESS_SYNC_THROTTLE_MS = 1000;

interface NativeAudioSegmentPayload {
  id: string;
  url?: string | null;
  title?: string;
  duration?: number;
}

type WaitingReason = 'missing_current' | 'await_next' | null;

interface NativeAudioQueuePayload {
  chapterAssetId: string;
  title: string;
  author?: string;
  album?: string;
  mediaImage?: string;
  segments: NativeAudioSegmentPayload[];
  startIndex?: number;
  isExplicitStart?: boolean;
  autoPlay?: boolean;
  isGenerationComplete?: boolean;
}

interface NativePlaybackEventPayload {
  state: string;
  chapterAssetId: string;
  currentIndex: number;
  queueLength: number;
  positionMs: number;
  durationMs: number;
  waitingForMoreSegments: boolean;
  chapterFinished: boolean;
}

interface NativeMetadataPayload {
  assetId: string;
  title?: string;
  mediaImage?: string;
  duration?: number;
  author?: string;
  album?: string;
  previousAssetId?: string;
  nextAssetId?: string;
}

export class NativeAudioPlayerManager {
  private static instance: NativeAudioPlayerManager = new NativeAudioPlayerManager();
  private player: media.AVPlayer | null = null;
  private queue: NativeAudioSegmentPayload[] = [];
  private chapterAssetId: string = '';
  private chapterTitle: string = '';
  private chapterAuthor: string = '';
  private chapterAlbum: string = '';
  private chapterCover: string = '';
  private currentIndex: number = -1;
  private currentDurationMs: number = 0;
  private currentPositionMs: number = 0;
  private isGenerationComplete: boolean = false;
  private desiredPlaying: boolean = false;
  private waitingForMoreSegments: boolean = false;
  private waitingReason: WaitingReason = null;
  private initialized: boolean = false;
  private loadingIndex: number = -1;
  private resumeAfterInterrupt: boolean = false;
  private loadRequestId: number = 0;
  private stoppedExplicitly: boolean = false;
  private currentSourceUrl: string = '';
  private currentLocalFile: fs.File | null = null;
  private lastPlaybackEventAt: number = 0;
  private lastPlaybackEventState: string = '';
  private lastPlaybackEventIndex: number = -1;
  private lastSessionProgressSyncAt: number = 0;
  private lastSessionState: string = '';
  private lastSessionIndex: number = -1;

  public static getInstance(): NativeAudioPlayerManager {
    return NativeAudioPlayerManager.instance;
  }

  async ensureInitialized(): Promise<void> {
    if (this.initialized && this.player) {
      return;
    }

    this.player = await media.createAVPlayer();
    this.registerPlayerListeners();
    this.initialized = true;
  }

  loadQueue(payload: string): void {
    try {
      const data = JSON.parse(payload) as NativeAudioQueuePayload;
      Promise.all([
        this.ensureInitialized(),
        AVSessionManager.getInstance().waitForReady(),
      ]).then(() => this.applyQueuePayload(data)).catch((error: BusinessError) => {
        Logger.error(TAG, `loadQueue init failed: ${error.code}, ${error.message}`);
      });
    } catch (error) {
      Logger.error(TAG, `loadQueue parse failed: ${JSON.stringify(error)}`);
    }
  }

  play(): void {
    if (!this.player) {
      return;
    }

    this.desiredPlaying = true;
    this.resumeAfterInterrupt = false;

    if (this.currentIndex < 0 && this.queue.length > 0) {
      this.loadIndex(0, true);
      return;
    }

    if (this.waitingForMoreSegments) {
      this.emitPlaybackEvent('waiting');
      return;
    }

    if (this.player.state === 'stopped' || this.player.state === 'idle') {
      this.loadIndex(Math.max(0, this.currentIndex), true);
      return;
    }

    if (this.player.state === 'initialized') {
      this.loadIndex(Math.max(0, this.currentIndex), true);
      return;
    }

    this.player.play().then(() => {
      Logger.info(TAG, 'play success');
    }).catch((error: BusinessError) => {
      Logger.error(TAG, `play failed: ${error.code}, ${error.message}`);
      this.emitPlaybackEvent('error');
    });
  }

  pause(): void {
    if (!this.player) {
      return;
    }

    this.desiredPlaying = false;
    this.resumeAfterInterrupt = false;

    if (this.player.state !== 'playing' && this.player.state !== 'prepared' && this.player.state !== 'paused') {
      return;
    }

    this.player.pause().then(() => {
      Logger.info(TAG, 'pause success');
    }).catch((error: BusinessError) => {
      Logger.error(TAG, `pause failed: ${error.code}, ${error.message}`);
    });
  }

  seek(positionMs: number): void {
    if (!this.player) {
      return;
    }

    const target = Math.max(0, Math.round(positionMs));
    try {
      this.player.seek(target, media.SeekMode.SEEK_PREV_SYNC);
      this.currentPositionMs = target;
      this.syncSessionState(this.desiredPlaying ? 'playing' : 'paused', target);
      this.emitPlaybackEvent(this.desiredPlaying ? 'playing' : 'paused');
    } catch (error) {
      Logger.error(TAG, `seek failed: ${JSON.stringify(error)}`);
    }
  }

  stop(): void {
    if (!this.player) {
      return;
    }

    this.stoppedExplicitly = true;
    this.desiredPlaying = false;
    this.resumeAfterInterrupt = false;
    this.waitingForMoreSegments = false;
    this.waitingReason = null;
    this.currentPositionMs = 0;
    this.currentDurationMs = 0;
    this.player.stop().then(() => {
      Logger.info(TAG, 'stop success');
    }).catch((error: BusinessError) => {
      Logger.warn(TAG, `stop failed: ${error.code}, ${error.message}`);
    });
    this.syncSessionState('stopped', 0, 0);
    this.emitPlaybackEvent('stopped');
  }

  skipToNext(): void {
    if (this.currentIndex + 1 < this.queue.length) {
      this.loadIndex(this.currentIndex + 1, this.desiredPlaying);
      return;
    }

    if (this.isGenerationComplete) {
      this.finishChapter();
      return;
    }

    this.enterWaitingState('await_next', this.currentDurationMs);
  }

  skipToPrevious(): void {
    if (this.currentIndex <= 0) {
      this.seek(0);
      return;
    }

    this.loadIndex(this.currentIndex - 1, this.desiredPlaying);
  }

  release(): void {
    if (!this.player) {
      return;
    }

    this.desiredPlaying = false;
    this.resumeAfterInterrupt = false;
    this.waitingForMoreSegments = false;
    this.waitingReason = null;
    this.player.release().then(() => {
      Logger.info(TAG, 'release success');
    }).catch((error: BusinessError) => {
      Logger.warn(TAG, `release failed: ${error.code}, ${error.message}`);
    });
    this.player = null;
    this.initialized = false;
    this.queue = [];
    this.currentIndex = -1;
    this.currentPositionMs = 0;
    this.currentDurationMs = 0;
    this.currentSourceUrl = '';
    this.closeLocalFileSource();
    this.stoppedExplicitly = false;
    this.waitingReason = null;
  }

  getCurrentPositionMs(): number {
    return this.currentPositionMs;
  }

  getCurrentDurationMs(): number {
    return this.currentDurationMs;
  }

  private async applyQueuePayload(payload: NativeAudioQueuePayload): Promise<void> {
    const nextQueue = payload.segments;
    const isNewChapter = payload.chapterAssetId !== this.chapterAssetId;
    const hasQueueGrowth = nextQueue.length > this.queue.length;
    const targetStartIndex = this.normalizePayloadStartIndex(payload.startIndex);
    const isExplicitStart = payload.isExplicitStart === true;
    const resumeIndex =
      this.currentIndex >= 0 ? this.normalizeIndex(this.currentIndex) : targetStartIndex;

    Logger.info(
      TAG,
      `applyQueuePayload chapter=${payload.chapterAssetId}, startIndex=${payload.startIndex}, isExplicitStart=${isExplicitStart}, targetStartIndex=${targetStartIndex}, currentIndex=${this.currentIndex}, autoPlay=${payload.autoPlay}, queueLength=${nextQueue.length}`,
    );

    this.chapterAssetId = payload.chapterAssetId;
    this.chapterTitle = payload.title;
    this.chapterAuthor = payload.author ?? '';
    this.chapterAlbum = payload.album ?? '';
    this.chapterCover = payload.mediaImage ?? '';
    this.queue = nextQueue;
    this.isGenerationComplete = payload.isGenerationComplete ?? false;

    if (isNewChapter) {
      this.currentIndex = -1;
      this.currentDurationMs = 0;
      this.currentPositionMs = 0;
      this.currentSourceUrl = '';
      this.closeLocalFileSource();
      this.resumeAfterInterrupt = false;
      this.waitingForMoreSegments = false;
      this.waitingReason = null;
      this.stoppedExplicitly = false;
      this.desiredPlaying = payload.autoPlay ?? true;
      if (targetStartIndex >= 0) {
        await this.loadIndex(targetStartIndex, this.desiredPlaying);
      }
      return;
    }

    if (payload.autoPlay !== undefined) {
      this.desiredPlaying = payload.autoPlay;
    }

    const playerState = this.player?.state ?? 'idle';
    const shouldReloadStoppedQueue =
      this.desiredPlaying &&
      this.queue.length > 0 &&
      (this.stoppedExplicitly ||
        playerState === 'stopped' ||
        playerState === 'idle' ||
        playerState === 'initialized');

    if (shouldReloadStoppedQueue) {
      this.stoppedExplicitly = false;
      await this.loadIndex(resumeIndex, true);
      return;
    }

    if (this.currentIndex < 0 && this.queue.length > 0 && this.desiredPlaying) {
      await this.loadIndex(resumeIndex, true);
      return;
    }

    if (
      isExplicitStart &&
      payload.startIndex !== undefined &&
      targetStartIndex >= 0 &&
      targetStartIndex !== this.currentIndex
    ) {
      this.waitingForMoreSegments = false;
      this.waitingReason = null;
      await this.loadIndex(targetStartIndex, payload.autoPlay ?? true);
      return;
    }

    const currentSourceChanged =
      this.currentIndex >= 0 &&
      this.currentIndex < this.queue.length &&
      this.queue[this.currentIndex]?.url !== this.currentSourceUrl;
    if (currentSourceChanged) {
      await this.loadIndex(this.currentIndex, this.desiredPlaying);
      return;
    }

    this.updateSessionMetadata();
    if (this.waitingForMoreSegments) {
      if (
        this.waitingReason === 'missing_current' &&
        this.currentIndex >= 0 &&
        this.currentIndex < this.queue.length &&
        this.hasUsableUrl(this.queue[this.currentIndex]?.url)
      ) {
        this.waitingForMoreSegments = false;
        this.waitingReason = null;
        await this.loadIndex(this.currentIndex, this.desiredPlaying);
        return;
      }

      if (
        this.waitingReason === 'await_next' &&
        hasQueueGrowth &&
        this.currentIndex + 1 < this.queue.length
      ) {
        this.waitingForMoreSegments = false;
        this.waitingReason = null;
        await this.loadIndex(this.currentIndex + 1, this.desiredPlaying);
        return;
      }

      this.emitPlaybackEvent('waiting');
      return;
    }

    if (
      this.desiredPlaying &&
      this.player &&
      (playerState === 'prepared' || playerState === 'paused')
    ) {
      try {
        await this.player.play();
        return;
      } catch (error) {
        Logger.error(TAG, `恢复排队播放失败: ${JSON.stringify(error)}`);
        this.emitPlaybackEvent('error');
        return;
      }
    }

    this.emitPlaybackEvent(this.desiredPlaying ? 'playing' : 'paused');
  }

  private async loadIndex(index: number, autoPlay: boolean): Promise<void> {
    if (!this.player) {
      return;
    }

    const normalizedIndex = this.normalizeIndex(index);
    if (normalizedIndex < 0 || normalizedIndex >= this.queue.length) {
      return;
    }

    const target = this.queue[normalizedIndex];
    const requestId = ++this.loadRequestId;
    this.currentIndex = normalizedIndex;
    this.currentDurationMs = target.duration ?? 0;
    this.currentPositionMs = 0;
    this.waitingForMoreSegments = false;
    this.waitingReason = null;
    this.stoppedExplicitly = false;
    this.desiredPlaying = autoPlay;
    this.loadingIndex = normalizedIndex;
    this.updateSessionMetadata();

    if (!this.hasUsableUrl(target.url)) {
      this.enterWaitingState('missing_current');
      return;
    }

    Logger.info(
      TAG,
      `索引请求=${requestId}, index=${normalizedIndex}, playerState=${this.player.state}, autoPlay=${autoPlay}, sourceType=${
        this.isLocalCacheUri(target.url as string) ? 'local_cache' : 'remote_stream'
      }, url=${target.url ?? ''}`,
    );

    try {
      const player = await this.preparePlayerForLoad(requestId);
      if (!player || requestId !== this.loadRequestId) {
        return;
      }
      await this.applyPlayerSource(player, target.url as string);
      this.currentSourceUrl = target.url as string;
    } catch (error) {
      Logger.error(TAG, `loadIndex failed: ${JSON.stringify(error)}`);
      this.emitPlaybackEvent('error');
    }
  }

  private isLocalCacheUri(url: string): boolean {
    return url.startsWith('internal://cache/') || url.startsWith(getContext().cacheDir);
  }

  private resolveLocalCachePath(url: string): string {
    if (url.startsWith('internal://cache/')) {
      const relativePath = url.substring('internal://cache/'.length);
      return `${getContext().cacheDir}/${relativePath}`;
    }
    return url;
  }

  private closeLocalFileSource(): void {
    if (!this.currentLocalFile) {
      return;
    }

    try {
      fs.closeSync(this.currentLocalFile);
    } catch (error) {
      Logger.warn(TAG, `关闭本地文件失败： ${JSON.stringify(error)}`);
    }
    this.currentLocalFile = null;
  }

  private async applyPlayerSource(player: media.AVPlayer, url: string): Promise<void> {
    this.closeLocalFileSource();

    if (!this.isLocalCacheUri(url)) {
      Logger.info(TAG, `应用播放器源 远程流 URL=${url}`);
      player.url = url;
      return;
    }

    const localPath = this.resolveLocalCachePath(url);
    const localFile = await fs.open(localPath, fs.OpenMode.READ_ONLY);
    this.currentLocalFile = localFile;
    Logger.info(
      TAG,
      `应用播放器源 本地缓存 URL=${url}, localPath=${localPath}, fd=${localFile.fd}`,
    );
    player.url = `fd://${localFile.fd}`;
  }

  private async preparePlayerForLoad(requestId: number): Promise<media.AVPlayer | null> {
    let player = this.player;
    if (!player) {
      return null;
    }

    try {
      if (player.state !== 'idle') {
        await player.reset();
      }

      if (requestId !== this.loadRequestId) {
        return null;
      }

      return player;
    } catch (error) {
      Logger.warn(TAG, `preparePlayerForLoad 重置失败，只能重新整一下播放器: ${JSON.stringify(error)}`);
    }

    player = await this.rebuildPlayer();
    if (requestId !== this.loadRequestId) {
      return null;
    }
    return player;
  }

  private async rebuildPlayer(): Promise<media.AVPlayer | null> {
    const previousPlayer = this.player;
    if (previousPlayer) {
      try {
        await previousPlayer.release();
      } catch (error) {
        Logger.warn(TAG, `rebuildPlayer release failed: ${JSON.stringify(error)}`);
      }
    }

    try {
      const nextPlayer = await media.createAVPlayer();
      this.player = nextPlayer;
      this.registerPlayerListeners();
      this.initialized = true;
      return nextPlayer;
    } catch (error) {
      Logger.error(TAG, `rebuildPlayer create failed: ${JSON.stringify(error)}`);
      this.player = null;
      this.initialized = false;
      return null;
    }
  }

  private registerPlayerListeners(): void {
    if (!this.player) {
      return;
    }

    const player = this.player;

    player.on('stateChange', async (state: string, _reason: media.StateChangeReason) => {
      Logger.info(TAG, `stateChange: ${state}, currentIndex=${this.currentIndex}, loadingIndex=${this.loadingIndex}, desiredPlaying=${this.desiredPlaying}`);
      switch (state) {
        case 'initialized':
          player.audioRendererInfo = {
            usage: audio.StreamUsage.STREAM_USAGE_MUSIC,
            rendererFlags: 0,
          };
          try {
            await player.prepare();
          } catch (error) {
            Logger.error(TAG, `prepare failed: ${JSON.stringify(error)}`);
            this.emitPlaybackEvent('error');
          }
          break;
        case 'prepared':
          this.currentDurationMs = player.duration;
          this.updateSessionMetadata();
          await AVSessionManager.getInstance().waitForMetadata();
          if (this.desiredPlaying) {
            this.emitPlaybackEvent('loading');
            try {
              await player.play();
            } catch (error) {
              Logger.error(TAG, `play after prepared failed: ${JSON.stringify(error)}`);
              this.syncSessionState('paused', 0);
              this.emitPlaybackEvent('error');
            }
            break;
          }
          this.syncSessionState('paused', 0);
          this.emitPlaybackEvent('paused');
          break;
        case 'playing':
          this.syncSessionState('playing');
          this.emitPlaybackEvent('playing');
          break;
        case 'paused':
          this.syncSessionState('paused');
          this.emitPlaybackEvent('paused');
          break;
        case 'completed':
          this.handleSegmentCompleted();
          break;
        case 'stopped':
          this.emitPlaybackEvent('stopped');
          break;
        case 'released':
          this.emitPlaybackEvent('released');
          break;
        default:
          this.emitPlaybackEvent(state);
          break;
      }
    });

    player.on('timeUpdate', (time: number) => {
      this.currentPositionMs = time;
      const state = this.desiredPlaying ? 'playing' : 'paused';
      this.syncSessionState(state, undefined, undefined, true);
      this.emitPlaybackEvent(state, false, true);
    });

    player.on('durationUpdate', (duration: number) => {
      this.currentDurationMs = duration;
      this.updateSessionMetadata();
      this.emitPlaybackEvent(this.desiredPlaying ? 'playing' : 'paused');
    });

    player.on('audioInterrupt', (info: audio.InterruptEvent) => {
      Logger.warn(TAG, `audioInterrupt: ${JSON.stringify(info)}`);
      this.handleAudioInterrupt(info);
    });

    player.on('error', (error: BusinessError) => {
      Logger.error(TAG, `player error: ${error.code}, ${error.message}`);
      this.syncSessionState('paused');
      this.emitPlaybackEvent('error');
    });
  }

  private handleSegmentCompleted(): void {
    this.currentPositionMs = this.currentDurationMs;

    if (this.currentIndex + 1 < this.queue.length) {
      this.loadIndex(this.currentIndex + 1, this.desiredPlaying);
      return;
    }

    if (!this.isGenerationComplete) {
      this.enterWaitingState('await_next', this.currentDurationMs);
      return;
    }

    this.finishChapter();
  }

  private handleAudioInterrupt(info: audio.InterruptEvent): void {
    if (!this.player) {
      return;
    }

    if (info.eventType === audio.InterruptType.INTERRUPT_TYPE_END) {
      if (info.hintType === audio.InterruptHint.INTERRUPT_HINT_RESUME) {
        this.resumePlaybackAfterInterrupt();
      }
      return;
    }

    switch (info.hintType) {
      case audio.InterruptHint.INTERRUPT_HINT_PAUSE:
        this.pauseForInterrupt(true);
        break;
      case audio.InterruptHint.INTERRUPT_HINT_STOP:
        this.pauseForInterrupt(false);
        break;
      case audio.InterruptHint.INTERRUPT_HINT_DUCK:
      case audio.InterruptHint.INTERRUPT_HINT_UNDUCK:
        Logger.info(TAG, `ignore interrupt hint: ${info.hintType}`);
        break;
      default:
        if (info.forceType === audio.InterruptForceType.INTERRUPT_FORCE) {
          this.pauseForInterrupt(false);
        }
        break;
    }
  }

  private pauseForInterrupt(allowResume: boolean): void {
    if (!this.player) {
      return;
    }

    const shouldResume = allowResume && this.shouldResumeAfterInterrupt();
    this.resumeAfterInterrupt = shouldResume;
    this.desiredPlaying = false;

    if (this.player.state !== 'playing' && this.player.state !== 'prepared') {
      this.syncSessionState('paused');
      this.emitPlaybackEvent('paused');
      return;
    }

    this.player.pause().then(() => {
      Logger.info(TAG, `pause on interrupt success, resumeAfterInterrupt=${shouldResume}`);
    }).catch((error: BusinessError) => {
      Logger.warn(TAG, `pause on interrupt failed: ${error.code}, ${error.message}`);
    });
  }

  private resumePlaybackAfterInterrupt(): void {
    if (!this.player || !this.resumeAfterInterrupt) {
      return;
    }

    this.resumeAfterInterrupt = false;
    this.desiredPlaying = true;

    if (this.player.state === 'playing') {
      return;
    }

    if (this.player.state === 'stopped' || this.player.state === 'idle') {
      this.loadIndex(Math.max(0, this.currentIndex), true);
      return;
    }

    if (this.player.state === 'initialized') {
      this.loadIndex(Math.max(0, this.currentIndex), true);
      return;
    }

    this.player.play().then(() => {
      Logger.info(TAG, 'resume after interrupt success');
    }).catch((error: BusinessError) => {
      Logger.warn(TAG, `resume after interrupt failed: ${error.code}, ${error.message}`);
      this.desiredPlaying = false;
    });
  }

  private shouldResumeAfterInterrupt(): boolean {
    if (!this.player) {
      return false;
    }

    return this.desiredPlaying || this.player.state === 'playing' || this.player.state === 'prepared';
  }

  private finishChapter(): void {
    this.desiredPlaying = false;
    this.resumeAfterInterrupt = false;
    this.waitingForMoreSegments = false;
    this.waitingReason = null;
    this.syncSessionState('stopped', this.currentDurationMs);
    this.emitPlaybackEvent('stopped', true);
  }

  private syncSessionState(
    state: 'playing' | 'paused' | 'stopped',
    elapsedTime?: number,
    duration?: number,
    allowThrottle: boolean = false,
  ): void {
    if (allowThrottle && !this.shouldSyncSessionProgress(state)) {
      return;
    }

    this.markSessionProgressSynced(state);

    AVSessionManager.getInstance().setPlaybackState({
      state: state,
      elapsedTime: elapsedTime ?? this.currentPositionMs,
      duration: duration ?? this.currentDurationMs,
      speed: state === 'playing' ? 1 : 0,
    });
  }

  private shouldSyncSessionProgress(state: string): boolean {
    const now = Date.now();
    const stateChanged = this.lastSessionState !== state;
    const indexChanged = this.lastSessionIndex !== this.currentIndex;
    const shouldSync =
      stateChanged ||
      indexChanged ||
      now - this.lastSessionProgressSyncAt >= SESSION_PROGRESS_SYNC_THROTTLE_MS;

    if (shouldSync) {
      this.markSessionProgressSynced(state);
    }

    return shouldSync;
  }

  private markSessionProgressSynced(state: string): void {
    this.lastSessionProgressSyncAt = Date.now();
    this.lastSessionState = state;
    this.lastSessionIndex = this.currentIndex;
  }

  private updateSessionMetadata(): void {
    if (this.currentIndex < 0 || this.currentIndex >= this.queue.length) {
      return;
    }

    const current = this.queue[this.currentIndex];
    const metadata: NativeMetadataPayload = {
      assetId: current.id,
      title: this.chapterTitle,
      author: this.chapterAuthor,
      album: this.chapterAlbum,
      mediaImage: this.chapterCover,
      duration: this.currentDurationMs || current.duration,
      previousAssetId: this.currentIndex > 0 ? this.queue[this.currentIndex - 1].id : undefined,
      nextAssetId: this.currentIndex + 1 < this.queue.length ? this.queue[this.currentIndex + 1].id : undefined,
    };
    AVSessionManager.getInstance().updateMetadata(JSON.stringify(metadata));
  }

  private emitPlaybackEvent(
    state: string,
    chapterFinished: boolean = false,
    allowThrottle: boolean = false,
  ): void {
    if (allowThrottle && !this.shouldEmitPlaybackProgress(state, chapterFinished)) {
      return;
    }

    this.markPlaybackEventEmitted(state);

    const payload: NativePlaybackEventPayload = {
      state: state,
      chapterAssetId: this.chapterAssetId,
      currentIndex: this.currentIndex,
      queueLength: this.queue.length,
      positionMs: this.currentPositionMs,
      durationMs: this.currentDurationMs,
      waitingForMoreSegments: this.waitingForMoreSegments,
      chapterFinished: chapterFinished,
    };
    LoadManager.getRNInstance(LoadManager.isMetroAvailable)?.emitDeviceEvent(PLAYBACK_EVENT_NAME, payload);
  }

  private shouldEmitPlaybackProgress(
    state: string,
    chapterFinished: boolean,
  ): boolean {
    const now = Date.now();
    const stateChanged = this.lastPlaybackEventState !== state;
    const indexChanged = this.lastPlaybackEventIndex !== this.currentIndex;
    const shouldEmit =
      chapterFinished ||
      stateChanged ||
      indexChanged ||
      now - this.lastPlaybackEventAt >= PLAYBACK_PROGRESS_EVENT_THROTTLE_MS;

    if (shouldEmit) {
      this.markPlaybackEventEmitted(state);
    }

    return shouldEmit;
  }

  private markPlaybackEventEmitted(state: string): void {
    this.lastPlaybackEventAt = Date.now();
    this.lastPlaybackEventState = state;
    this.lastPlaybackEventIndex = this.currentIndex;
  }

  private normalizeIndex(index: number): number {
    if (this.queue.length === 0) {
      return -1;
    }

    if (index < 0) {
      return 0;
    }

    if (index >= this.queue.length) {
      return this.queue.length - 1;
    }

    return index;
  }

  private normalizePayloadStartIndex(index?: number): number {
    return this.normalizeIndex(index ?? 0);
  }

  private hasUsableUrl(url?: string | null): boolean {
    return typeof url === 'string' && url.trim().length > 0;
  }

  private enterWaitingState(
    reason: WaitingReason,
    positionMs: number = 0,
  ): void {
    this.waitingForMoreSegments = true;
    this.waitingReason = reason;
    this.currentPositionMs = positionMs;
    this.currentDurationMs = positionMs > 0 ? this.currentDurationMs : 0;
    this.syncSessionState('paused', this.currentPositionMs, this.currentDurationMs);
    this.emitPlaybackEvent('waiting');
  }
}
