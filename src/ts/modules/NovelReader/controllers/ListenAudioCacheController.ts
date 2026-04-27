import {BridgeTurboModule} from '../../../../../turboModules';

export interface CacheListenAudioPayload {
  url: string;
  cacheKey: string;
  extension?: string;
}

export interface CacheListenAudioResult {
  success: boolean;
  cacheKey: string;
  localUri?: string;
  localPath?: string;
  hit?: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export interface CleanupListenAudioCachePayload {
  localUris?: string[];
  localPaths?: string[];
}

export interface CleanupListenAudioCacheResult {
  success: boolean;
  deletedCount: number;
  failedCount: number;
}

class ListenAudioCacheController {
  cacheAudio(
    payload: CacheListenAudioPayload,
  ): Promise<CacheListenAudioResult> {
    if (!BridgeTurboModule) {
      return Promise.resolve({
        success: false,
        cacheKey: payload.cacheKey,
        errorCode: 'BRIDGE_UNAVAILABLE',
        errorMessage: 'BridgeTurboModule 不可用',
      });
    }

    return new Promise(resolve => {
      try {
        BridgeTurboModule.cacheListenBookAudio(
          JSON.stringify(payload),
          resultText => {
            try {
              resolve(JSON.parse(resultText) as CacheListenAudioResult);
            } catch (error) {
              resolve({
                success: false,
                cacheKey: payload.cacheKey,
                errorCode: 'PARSE_FAILED',
                errorMessage: '缓存结果解析失败',
              });
            }
          },
        );
      } catch (error) {
        resolve({
          success: false,
          cacheKey: payload.cacheKey,
          errorCode: 'CACHE_CALL_FAILED',
          errorMessage: '调用缓存接口失败',
        });
      }
    });
  }

  cleanupAudioCache(
    payload: CleanupListenAudioCachePayload,
  ): Promise<CleanupListenAudioCacheResult> {
    if (!BridgeTurboModule) {
      return Promise.resolve({
        success: false,
        deletedCount: 0,
        failedCount: 1,
      });
    }

    return new Promise(resolve => {
      try {
        BridgeTurboModule.cleanupListenBookAudioCache(
          JSON.stringify(payload),
          resultText => {
            try {
              resolve(JSON.parse(resultText) as CleanupListenAudioCacheResult);
            } catch (error) {
              resolve({
                success: false,
                deletedCount: 0,
                failedCount: 1,
              });
            }
          },
        );
      } catch (error) {
        resolve({
          success: false,
          deletedCount: 0,
          failedCount: 1,
        });
      }
    });
  }
}

export default new ListenAudioCacheController();
