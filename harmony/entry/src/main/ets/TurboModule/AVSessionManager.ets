import { avSession } from '@kit.AVSessionKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { JSON } from '@kit.ArkTS';
import { wantAgent, common } from '@kit.AbilityKit';
import { backgroundTaskManager } from '@kit.BackgroundTasksKit';
import { image } from '@kit.ImageKit';
import { http } from '@kit.NetworkKit';
import { LoadManager } from '../rn';
import { Logger } from '../utils/Logger';

const TAG = 'AVSessionManager';
const COMMAND_EVENT_NAME = 'VideoSessionCommand';

interface SessionMetadataPayload {
  assetId: string;
  title?: string;
  mediaImage?: string;
  duration?: number;
  author?: string;
  album?: string;
  previousAssetId?: string;
  nextAssetId?: string;
}

interface SessionPlaybackPayload {
  state: 'playing' | 'paused' | 'stopped';
  elapsedTime?: number;
  duration?: number;
  speed?: number;
}

interface SessionCommandHandler {
  onPlay(): void;
  onPause(): void;
  onStop(): void;
  onPlayNext(): void;
  onPlayPrevious(): void;
  onSeek(timeMs: number): void;
}

export class AVSessionCommandHandler {
  onPlay(): void {
  }

  onPause(): void {
  }

  onStop(): void {
  }

  onPlayNext(): void {
  }

  onPlayPrevious(): void {
  }

  onSeek(_timeMs: number): void {
  }

  getElapsedTimeMs(): number {
    return 0;
  }

  getDurationMs(): number {
    return 0;
  }
}

const APP_BUNDLE_NAME = 'webpv.voice.weaver';
const ENTRY_ABILITY_NAME = 'EntryAbility';
const DEFAULT_COVER_RAWFILE = 'assets/src/ts/rawfile/dev/media/icon/default_avatar.png';

export class AVSessionManager {
  private static instance: AVSessionManager = new AVSessionManager();
  private avSessionInstance: avSession.AVSession | null = null;
  private isInitializing: boolean = false;
  private isActivated: boolean = false;
  private currentTag: string = 'NovelReaderAudio';
  private launchAbilityConfigured: boolean = false;
  private backgroundTaskStarted: boolean = false;
  private defaultPixelMap: image.PixelMap | null = null;
  private commandHandler: AVSessionCommandHandler | null = null;
  private cachedMetadataPayload: SessionMetadataPayload | null = null;
  private metadataPromise: Promise<void> | null = null;
  private lastMetadataSignature: string = '';
  private pendingMetadataSignature: string = '';
  private cachedPlaybackPayload: SessionPlaybackPayload = {
    state: 'paused',
    elapsedTime: 0,
    duration: 0,
    speed: 0,
  };
  private initPromise: Promise<void> | null = null;
  private playbackWritePromise: Promise<void> = Promise.resolve();
  private playbackWriteVersion: number = 0;

  public static getInstance(): AVSessionManager {
    return AVSessionManager.instance;
  }

  initSession(tag: string): void {
    if (this.avSessionInstance || this.isInitializing) {
      return;
    }

    this.isInitializing = true;
    this.currentTag = tag || this.currentTag;

    this.initPromise = avSession.createAVSession(
      getContext(),
      this.currentTag,
      'audio',
    ).then(async (session: avSession.AVSession) => {
      this.avSessionInstance = session;
      this.registerControlCommands();
      this.ensureLaunchAbility();
      Logger.info(TAG, `AVSession created: ${session.sessionId}`);
      await session.activate();
      this.isActivated = true;
      Logger.info(TAG, `AVSession activated: ${session.sessionId}`);
      this.flushCachedState();
    }).catch((error: BusinessError) => {
      Logger.error(TAG, `initSession failed: ${error.code}, ${error.message}`);
    }).finally(() => {
      this.isInitializing = false;
    });
  }

  async waitForReady(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise;
    }
  }

  updateMetadata(payload: string): void {
    try {
      this.cachedMetadataPayload = this.normalizeMetadataPayload(JSON.parse(payload) as SessionMetadataPayload);
      if (this.avSessionInstance && this.isActivated) {
        this.doWriteMetadata(this.cachedMetadataPayload);
      }
    } catch (error) {
      Logger.error(TAG, `updateMetadata parse failed: ${JSON.stringify(error)}`);
    }
  }

  setPlaybackState(payload: SessionPlaybackPayload): void {
    this.cachedPlaybackPayload = {
      state: payload.state,
      elapsedTime: payload.elapsedTime ?? this.cachedPlaybackPayload.elapsedTime ?? 0,
      duration: payload.duration ?? this.cachedPlaybackPayload.duration ?? 0,
      speed: payload.speed ?? (payload.state === 'playing' ? 1 : 0),
    };

    if (this.avSessionInstance && this.isActivated) {
      this.schedulePlaybackStateWrite();
    }

    if (payload.state === 'playing') {
      this.startContinuousTask();
    } else if (payload.state === 'stopped') {
      this.stopContinuousTask();
    }
  }

  updatePlayback(payload: string): void {
    try {
      const data = JSON.parse(payload) as SessionPlaybackPayload;
      this.setPlaybackState(data);
    } catch (error) {
      Logger.error(TAG, `updatePlayback parse failed: ${JSON.stringify(error)}`);
    }
  }

  destroy(): void {
    if (!this.avSessionInstance) {
      return;
    }

    this.stopContinuousTask();
    this.setPlaybackState({
      state: 'stopped',
      elapsedTime: 0,
    });
    this.avSessionInstance.off('play');
    this.avSessionInstance.off('pause');
    this.avSessionInstance.off('stop');
    this.avSessionInstance.off('playNext');
    this.avSessionInstance.off('playPrevious');
    this.avSessionInstance.off('seek');
    this.avSessionInstance.destroy((error?: BusinessError) => {
      if (error) {
        Logger.error(TAG, `destroy failed: ${error.code}, ${error.message}`);
        return;
      }
      Logger.info(TAG, 'AVSession destroyed');
      this.avSessionInstance = null;
      this.isActivated = false;
      this.launchAbilityConfigured = false;
    });
  }

  setCommandHandler(handler: AVSessionCommandHandler | null): void {
    this.commandHandler = handler;
  }

  private registerControlCommands(): void {
    if (!this.avSessionInstance) {
      return;
    }

    this.avSessionInstance.on('play', async () => {
      this.cachedPlaybackPayload.state = 'playing';
      this.cachedPlaybackPayload.speed = 1;
      this.schedulePlaybackStateWrite();
      if (this.commandHandler) {
        this.commandHandler.onPlay();
        return;
      }
      this.emitCommand('play');
    });

    this.avSessionInstance.on('pause', async () => {
      this.cachedPlaybackPayload.state = 'paused';
      this.cachedPlaybackPayload.speed = 0;
      if (this.commandHandler) {
        this.cachedPlaybackPayload.elapsedTime = this.commandHandler.getElapsedTimeMs();
      }
      this.schedulePlaybackStateWrite();
      if (this.commandHandler) {
        this.commandHandler.onPause();
        return;
      }
      this.emitCommand('pause');
    });

    this.avSessionInstance.on('stop', async () => {
      this.cachedPlaybackPayload.state = 'stopped';
      this.cachedPlaybackPayload.speed = 0;
      this.schedulePlaybackStateWrite();
      this.stopContinuousTask();
      if (this.commandHandler) {
        this.commandHandler.onStop();
        return;
      }
      this.emitCommand('stop');
    });

    this.avSessionInstance.on('playNext', () => {
      if (this.commandHandler) {
        this.commandHandler.onPlayNext();
        return;
      }
      this.emitCommand('playNext');
    });

    this.avSessionInstance.on('playPrevious', () => {
      if (this.commandHandler) {
        this.commandHandler.onPlayPrevious();
        return;
      }
      this.emitCommand('playPrevious');
    });

    this.avSessionInstance.on('seek', (time: number) => {
      if (this.commandHandler) {
        this.commandHandler.onSeek(time);
        return;
      }
      this.emitCommand('seek', time);
    });
  }

  private emitCommand(command: string, timeMs?: number): void {
    LoadManager.getRNInstance(LoadManager.isMetroAvailable)?.emitDeviceEvent(COMMAND_EVENT_NAME, {
      command: command,
      timeMs: timeMs,
    });
  }

  private schedulePlaybackStateWrite(): void {
    const writeVersion = ++this.playbackWriteVersion;
    this.playbackWritePromise = this.playbackWritePromise.catch(() => {
    }).then(async () => {
      if (this.metadataPromise) {
        try {
          await this.metadataPromise;
        } catch (_error) {
        }
      }

      if (!this.avSessionInstance || !this.isActivated) {
        return;
      }

      if (writeVersion !== this.playbackWriteVersion) {
        return;
      }

      await this.writePlaybackState({
        state: this.cachedPlaybackPayload.state,
        elapsedTime: this.cachedPlaybackPayload.elapsedTime,
        duration: this.cachedPlaybackPayload.duration,
        speed: this.cachedPlaybackPayload.speed,
      });
    });
  }

  private async writePlaybackState(payload: SessionPlaybackPayload): Promise<void> {
    if (!this.avSessionInstance) {
      return;
    }

    const playbackState: avSession.AVPlaybackState = {
      state: this.mapPlaybackState(payload.state),
      position: {
        elapsedTime: Math.max(0, Math.round(payload.elapsedTime ?? 0)),
        updateTime: Date.now(),
      }
    };

    if (payload.state === 'playing') {
      playbackState.speed = Math.max(payload.speed ?? 1, 0.1);
    }

    if (payload.duration !== undefined && payload.duration !== null && payload.duration > 0) {
      playbackState.duration = Math.round(payload.duration);
    }

    try {
      await this.avSessionInstance.setAVPlaybackState(playbackState);
      Logger.info(
        TAG,
        `setAVPlaybackState state=${payload.state} elapsed=${playbackState.position?.elapsedTime ?? 0} duration=${playbackState.duration ?? 0} speed=${playbackState.speed ?? 0}`,
      );
    } catch (error) {
      const businessError = error as BusinessError;
      Logger.error(TAG, `writePlaybackState failed: ${businessError.code}, ${businessError.message}`);
    }
  }

  private writeMetadata(payload: SessionMetadataPayload): void {
    if (!this.avSessionInstance) {
      return;
    }

    const signature = this.getMetadataSignature(payload);
    if (signature === this.lastMetadataSignature || signature === this.pendingMetadataSignature) {
      return;
    }

    this.pendingMetadataSignature = signature;
    this.metadataPromise = this.buildMetadata(payload).then((metadata: avSession.AVMetadata) => {
      return this.avSessionInstance?.setAVMetadata(metadata).then(() => {
        this.lastMetadataSignature = signature;
        Logger.info(TAG, `setAVMetadata assetId=${payload.assetId} title=${payload.title ?? ''}`);
      }).catch((error: BusinessError) => {
        Logger.error(TAG, `setAVMetadata failed: ${error.code}, ${error.message}`);
      });
    }).catch((error: BusinessError) => {
      Logger.error(TAG, `buildMetadata failed: ${error.code}, ${error.message}`);
    }).finally(() => {
      if (this.pendingMetadataSignature === signature) {
        this.pendingMetadataSignature = '';
      }
    });
  }

  private doWriteMetadata(payload: SessionMetadataPayload): void {
    this.writeMetadata(payload);
  }

  async waitForMetadata(): Promise<void> {
    if (this.metadataPromise) {
      await this.metadataPromise;
    }
  }

  private mapPlaybackState(state: 'playing' | 'paused' | 'stopped'): avSession.PlaybackState {
    switch (state) {
      case 'playing':
        return avSession.PlaybackState.PLAYBACK_STATE_PLAY;
      case 'paused':
        return avSession.PlaybackState.PLAYBACK_STATE_PAUSE;
      default:
        return avSession.PlaybackState.PLAYBACK_STATE_STOP;
    }
  }

  private ensureLaunchAbility(): void {
    if (!this.avSessionInstance || this.launchAbilityConfigured) {
      return;
    }

    const context = getContext() as common.UIAbilityContext;

    const wantAgentInfo: wantAgent.WantAgentInfo = {
      wants: [
        {
          bundleName: APP_BUNDLE_NAME,
          abilityName: ENTRY_ABILITY_NAME,
        },
      ],
      operationType: wantAgent.OperationType.START_ABILITY,
      requestCode: 0,
      wantAgentFlags: [wantAgent.WantAgentFlags.UPDATE_PRESENT_FLAG],
    };

    wantAgent.getWantAgent(wantAgentInfo).then(agent => {
      this.avSessionInstance?.setLaunchAbility(agent).then(() => {
        this.launchAbilityConfigured = true;
        Logger.info(TAG, 'setLaunchAbility success');
      }).catch((error: BusinessError) => {
        Logger.error(TAG, `setLaunchAbility failed: ${error.code}, ${error.message}`);
      });
    }).catch((error: BusinessError) => {
      Logger.error(TAG, `getWantAgent failed: ${error.code}, ${error.message}`);
    });
  }

  private flushCachedState(): void {
    if (this.cachedMetadataPayload) {
      this.writeMetadata(this.cachedMetadataPayload);
    }

    this.schedulePlaybackStateWrite();
  }

  private startContinuousTask(): void {
    if (this.backgroundTaskStarted || !this.avSessionInstance) {
      return;
    }

    const context = getContext() as common.UIAbilityContext;

    const wantAgentInfo: wantAgent.WantAgentInfo = {
      wants: [
        {
          bundleName: APP_BUNDLE_NAME,
          abilityName: ENTRY_ABILITY_NAME,
        },
      ],
      operationType: wantAgent.OperationType.START_ABILITY,
      requestCode: 0,
      wantAgentFlags: [wantAgent.WantAgentFlags.UPDATE_PRESENT_FLAG],
    };

    wantAgent.getWantAgent(wantAgentInfo).then(agent => {
      backgroundTaskManager.startBackgroundRunning(
        context,
        backgroundTaskManager.BackgroundMode.AUDIO_PLAYBACK,
        agent,
      ).then(() => {
        this.backgroundTaskStarted = true;
        Logger.info(TAG, 'startBackgroundRunning success');
      }).catch((error: BusinessError) => {
        Logger.error(TAG, `startBackgroundRunning failed: ${error.code}, ${error.message}`);
      });
    }).catch((error: BusinessError) => {
      Logger.error(TAG, `getWantAgent for background failed: ${error.code}, ${error.message}`);
    });
  }

  private stopContinuousTask(): void {
    if (!this.backgroundTaskStarted) {
      return;
    }

    backgroundTaskManager.stopBackgroundRunning(
      getContext() as common.UIAbilityContext,
      (error) => {
        if (error) {
          Logger.error(TAG, `stopBackgroundRunning failed: ${error.code}, ${error.message}`);
          return;
        }
        this.backgroundTaskStarted = false;
        Logger.info(TAG, 'stopBackgroundRunning success');
      },
    );
  }

  private async buildMetadata(data: SessionMetadataPayload): Promise<avSession.AVMetadata> {
    const metadata: avSession.AVMetadata = {
      assetId: data.assetId,
    };

    if (data.title) metadata.title = data.title;
    if (data.author) {
      metadata.author = data.author;
      metadata.artist = data.author;
    }
    if (data.album) metadata.album = data.album;
    if (data.duration !== undefined && data.duration !== null && data.duration > 0) {
      metadata.duration = data.duration;
    }
    if (data.previousAssetId) metadata.previousAssetId = data.previousAssetId;
    if (data.nextAssetId) metadata.nextAssetId = data.nextAssetId;

    let pixelMap: image.PixelMap | null = null;
    const mediaImage = this.normalizeOptionalText(data.mediaImage);
    if (mediaImage.length > 0 && mediaImage.startsWith('http')) {
      pixelMap = await this.getNetworkPixelMap(mediaImage);
    } else if (mediaImage.length > 0) {
      metadata.mediaImage = mediaImage;
    }

    if (!pixelMap && !metadata.mediaImage) {
      pixelMap = await this.getDefaultPixelMap();
    }

    if (pixelMap) {
      metadata.mediaImage = pixelMap;
    }

    return metadata;
  }

  private normalizeMetadataPayload(payload: SessionMetadataPayload): SessionMetadataPayload {
    return {
      assetId: this.normalizeOptionalText(payload.assetId),
      title: this.normalizeOptionalText(payload.title),
      mediaImage: this.normalizeOptionalText(payload.mediaImage),
      duration: payload.duration,
      author: this.normalizeOptionalText(payload.author),
      album: this.normalizeOptionalText(payload.album),
      previousAssetId: this.normalizeOptionalText(payload.previousAssetId),
      nextAssetId: this.normalizeOptionalText(payload.nextAssetId),
    };
  }

  private getMetadataSignature(payload: SessionMetadataPayload): string {
    return [
      payload.assetId,
      payload.title ?? '',
      payload.author ?? '',
      payload.album ?? '',
      payload.mediaImage ?? '',
      payload.duration !== undefined && payload.duration !== null ? Math.round(payload.duration).toString() : '',
      payload.previousAssetId ?? '',
      payload.nextAssetId ?? '',
    ].join('\u001f');
  }

  private normalizeOptionalText(value?: string | null): string {
    if (typeof value !== 'string') {
      return '';
    }

    return value.trim();
  }

  private async getNetworkPixelMap(url: string): Promise<image.PixelMap | null> {
    try {
      const httpRequest = http.createHttp();
      const response = await httpRequest.request(url, {
        method: http.RequestMethod.GET,
        expectDataType: http.HttpDataType.ARRAY_BUFFER
      });
      if (response.responseCode === 200 && response.result) {
        let imageSource = image.createImageSource(response.result as ArrayBuffer);
        let pixelMap = await imageSource.createPixelMap();
        httpRequest.destroy();
        return pixelMap;
      }
      httpRequest.destroy();
    } catch (error) {
      Logger.warn(TAG, `load network pixel map failed: ${JSON.stringify(error)}`);
    }
    return null;
  }

  private async getDefaultPixelMap(): Promise<image.PixelMap | null> {
    if (this.defaultPixelMap) {
      return this.defaultPixelMap;
    }

    try {
      const resource = await getContext().resourceManager.getRawFileContent(DEFAULT_COVER_RAWFILE);
      const imageSource = image.createImageSource(resource.buffer as ArrayBuffer);
      this.defaultPixelMap = await imageSource.createPixelMap({
        desiredSize: {
          width: 256,
          height: 256,
        },
      });
      return this.defaultPixelMap;
    } catch (error) {
      Logger.warn(TAG, `load default pixel map failed: ${JSON.stringify(error)}`);
      return null;
    }
  }
}
