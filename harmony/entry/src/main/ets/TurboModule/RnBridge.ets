import { TM } from '@rnoh/react-native-openharmony/generated/ts';
import { TurboModule } from '@rnoh/react-native-openharmony';
import { RNRouterParam } from '../model/RNRouterParam';
import { router } from '@kit.ArkUI';
import { LoadManager } from '../rn';
import { BusinessError, emitter, pasteboard } from '@kit.BasicServicesKit';
import { preferences } from '@kit.ArkData';
import { ImageUtils } from '../utils/SaveImage';
import { paymentService } from '@kit.PaymentKit';
import { abilityAccessCtrl, common, Permissions } from '@kit.AbilityKit';
import { Logger } from '../utils/Logger';
import { ShareUtils } from '../utils/ShareUtils';
import { photoAccessHelper } from '@kit.MediaLibraryKit';
import { PhotoHelper } from '../utils/PhotoHelper';
import { JSON } from '@kit.ArkTS';
import { call } from '@kit.TelephonyKit';
import { StatusBarManager } from '../utils/StatusBarManager';
import { BridgeOpenLinkModel } from '../model/BridgeOpenLinkModel';
import { BridgeShareModel } from '../model/BridgeShareModel';
import { KNOCK_PER } from '../utils/ShareManager';
import { AVSessionManager, AVSessionCommandHandler } from './AVSessionManager';
import { NativeAudioPlayerManager } from './NativeAudioPlayerManager';
import picker from '@ohos.file.picker';
import { fileIo as fs } from '@kit.CoreFileKit';
import request from '@ohos.request';
const TAG = 'RnBridge';
const LISTEN_AUDIO_CACHE_PREFIX = 'listen_book_audio_';

const LOGIN_PAGE_NAME = 'Login';
const LOGIN_PAGE = 'pages/login/LoginPage';

interface NativeSelectedAudioResult {
  cancelled: boolean;
  uri: string;
  name: string;
  size: number;
  error?: string;
}

interface NativeUploadPayload {
  url: string;
  uri: string;
  fileName: string;
  uploadName: string;
  mimeType: string;
}

interface NativeUploadResult {
  success: boolean;
  error?: string;
  responseCode?: number;
  message?: string;
}

interface NativeCachedUploadFile {
  path: string;
  uri: string;
}

interface NativeListenAudioCachePayload {
  url: string;
  cacheKey: string;
  extension?: string;
}

interface NativeListenAudioCacheResult {
  success: boolean;
  cacheKey: string;
  localUri?: string;
  localPath?: string;
  hit?: boolean;
  errorCode?: string;
  errorMessage?: string;
}

interface NativeListenAudioCacheCleanupPayload {
  localUris?: Array<string>;
  localPaths?: Array<string>;
}

interface NativeListenAudioCacheCleanupResult {
  success: boolean;
  deletedCount: number;
  failedCount: number;
}

interface UploadRequestHeader {
  Accept?: string;
}

interface NativeUploadResponseBody {
  success?: boolean;
  message?: string;
}

class NativeAudioSessionCommandHandler extends AVSessionCommandHandler {
  onPlay(): void {
    NativeAudioPlayerManager.getInstance().play();
  }

  onPause(): void {
    NativeAudioPlayerManager.getInstance().pause();
  }

  onStop(): void {
    NativeAudioPlayerManager.getInstance().stop();
  }

  onPlayNext(): void {
    NativeAudioPlayerManager.getInstance().skipToNext();
  }

  onPlayPrevious(): void {
    NativeAudioPlayerManager.getInstance().skipToPrevious();
  }

  onSeek(timeMs: number): void {
    NativeAudioPlayerManager.getInstance().seek(timeMs);
  }

  getElapsedTimeMs(): number {
    return NativeAudioPlayerManager.getInstance().getCurrentPositionMs();
  }

  getDurationMs(): number {
    return NativeAudioPlayerManager.getInstance().getCurrentDurationMs();
  }
}

export class RnBridge extends TurboModule implements TM.BridgeTurboModule.Spec {
  prePageName: string = ''

  private getUriScheme(uri: string): string {
    const safeUri = uri ? uri.trim() : ''
    const schemeSeparatorIndex = safeUri.indexOf('://')
    if (schemeSeparatorIndex > 0) {
      return safeUri.substring(0, schemeSeparatorIndex)
    }

    const colonIndex = safeUri.indexOf(':')
    if (colonIndex > 0) {
      return safeUri.substring(0, colonIndex)
    }

    return ''
  }

  private getFileNameFromUri(uri: string): string {
    if (!uri) {
      return ''
    }

    const safeUri = uri.split('?')[0]
    const fileName = safeUri.substring(safeUri.lastIndexOf('/') + 1)
    return decodeURIComponent(fileName)
  }

  private parseBusinessError(error: Object): BusinessError {
    return error as BusinessError
  }

  private stringifySelectedAudioResult(
    cancelled: boolean,
    uri: string,
    name: string,
    size: number,
    error?: string,
  ): string {
    const result: NativeSelectedAudioResult = {
      cancelled: cancelled,
      uri: uri,
      name: name,
      size: size,
      error: error,
    }
    return JSON.stringify(result)
  }

  private createUploadResult(
    success: boolean,
    error?: string,
    responseCode?: number,
    message?: string,
  ): NativeUploadResult {
    const result: NativeUploadResult = {
      success: success,
      error: error,
      responseCode: responseCode,
      message: message,
    }
    return result
  }

  private getNonEmptyText(value?: string): string {
    const text = value ? value.trim() : ''
    return text
  }

  private buildUploadFailureMessage(
    state?: request.TaskState,
    responsePayload?: string,
    fallback?: string,
  ): string {
    const stateMessage = this.getNonEmptyText(state?.message)
    if (stateMessage.length > 0) {
      return stateMessage
    }

    const payload = this.getNonEmptyText(responsePayload)
    if (payload.length > 0) {
      return `上传失败(${state?.responseCode ?? -1}): ${payload}`
    }

    const fallbackMessage = this.getNonEmptyText(fallback)
    if (fallbackMessage.length > 0) {
      return fallbackMessage
    }

    return `上传失败(${state?.responseCode ?? -1})`
  }

  private parseUploadResponseBody(responsePayload?: string): NativeUploadResponseBody | undefined {
    const payload = this.getNonEmptyText(responsePayload)
    if (payload.length === 0) {
      return undefined
    }

    try {
      const parsedPayload = JSON.parse(payload) as Record<string, Object | string | undefined>
      const body = typeof parsedPayload.body === 'string' ? parsedPayload.body : ''
      const bodyText = this.getNonEmptyText(body)
      if (bodyText.length === 0) {
        return undefined
      }
      return JSON.parse(bodyText) as NativeUploadResponseBody
    } catch (error) {
      Logger.warn(TAG, `parseUploadResponseBody failed: ${JSON.stringify(this.parseBusinessError(error))}`)
      return undefined
    }
  }

  private async buildSelectedAudioPayload(uri: string): Promise<string> {
    const sourceFileName = this.getFileNameFromUri(uri)
    let fileSize = 0
    try {
      const file = await fs.open(uri, fs.OpenMode.READ_ONLY)
      const stat = await fs.stat(file.fd)
      fileSize = Number(stat.size ?? 0)
      fs.closeSync(file)
    } catch (error) {
      Logger.warn(TAG, `read audio file stat failed: ${JSON.stringify(this.parseBusinessError(error))}`)
    }

    try {
      const cachedFile = await this.copyUploadSourceToCache(uri, sourceFileName)
      Logger.info(
        TAG,
        `buildSelectedAudioPayload cached audio: sourceUri=${uri}, cachedUri=${cachedFile.uri}, cachedPath=${cachedFile.path}, fileName=${sourceFileName}, fileSize=${fileSize}`,
      )
      return this.stringifySelectedAudioResult(false, cachedFile.uri, sourceFileName, fileSize)
    } catch (error) {
      const businessError = this.parseBusinessError(error)
      Logger.error(
        TAG,
        `buildSelectedAudioPayload cache copy failed: uri=${uri}, code=${businessError.code}, message=${businessError.message}`,
      )
      return this.stringifySelectedAudioResult(
        true,
        '',
        sourceFileName,
        fileSize,
        businessError.message ?? '缓存选中的音频失败',
      )
    }
  }

  private buildUploadTempPath(fileName: string): string {
    const cacheDir = getContext().cacheDir
    const extension = this.getFileExtension(fileName)
    const suffix = extension ? `.${extension}` : ''
    return `${cacheDir}/audio_upload_${Date.now()}${suffix}`
  }

  private buildUploadInternalCacheUri(tempPath: string): string {
    const cacheDir = getContext().cacheDir
    if (!tempPath.startsWith(cacheDir)) {
      return tempPath
    }

    const relativePath = tempPath.substring(cacheDir.length + 1)
    return `internal://cache/${relativePath}`
  }

  private getFileExtension(fileName: string): string {
    const trimmedName = fileName.trim()
    const dotIndex = trimmedName.lastIndexOf('.')
    if (dotIndex < 0 || dotIndex === trimmedName.length - 1) {
      return ''
    }

    const extension = trimmedName.substring(dotIndex + 1).toLowerCase()
    return extension
  }

  private getSafeUploadMimeType(fileName: string, mimeType: string): string {
    const trimmedMimeType = mimeType.trim()
    if (trimmedMimeType.length > 0) {
      return trimmedMimeType
    }
    const extension = this.getFileExtension(fileName)
    if (extension.length > 0) {
      switch (extension) {
        case 'mp3':
          return 'audio/mpeg'
        case 'wav':
          return 'audio/wav'
        case 'm4a':
          return 'audio/mp4'
        case 'aac':
          return 'audio/aac'
        case 'ogg':
          return 'audio/ogg'
        case 'flac':
          return 'audio/flac'
        default:
          return 'audio/mpeg'
      }
    }
    return 'audio/mpeg'
  }

  private getSafeUploadFileType(fileName: string, mimeType: string): string {
    const extension = this.getFileExtension(fileName)
    if (extension.length > 0) {
      return extension
    }

    const trimmedMimeType = mimeType.trim().toLowerCase()
    switch (trimmedMimeType) {
      case 'audio/mpeg':
        return 'mp3'
      case 'audio/wav':
        return 'wav'
      case 'audio/mp4':
        return 'm4a'
      case 'audio/aac':
        return 'aac'
      case 'audio/ogg':
        return 'ogg'
      case 'audio/flac':
        return 'flac'
      default:
        return 'mp3'
    }
  }

  private getSafeUploadFileName(fileName: string): string {
    const trimmedName = fileName.trim()
    if (trimmedName.length > 0) {
      return trimmedName
    }
    return `audio_${Date.now()}.mp3`
  }

  private getFileNameFromPath(path: string): string {
    const slashIndex = path.lastIndexOf('/')
    if (slashIndex < 0 || slashIndex === path.length - 1) {
      return path
    }
    return path.substring(slashIndex + 1)
  }

  private getPathFromInternalCacheUri(uri: string): string {
    const cachePrefix = 'internal://cache/'
    if (!uri.startsWith(cachePrefix)) {
      return uri
    }

    const relativePath = uri.substring(cachePrefix.length)
    return `${getContext().cacheDir}/${relativePath}`
  }

  private async copyUploadSourceToCache(sourceUri: string, fileName: string): Promise<NativeCachedUploadFile> {
    const tempPath = this.buildUploadTempPath(fileName)
    const tempUri = this.buildUploadInternalCacheUri(tempPath)
    Logger.info(
      TAG,
      `copyUploadSourceToCache start: sourceUri=${sourceUri}, sourceScheme=${this.getUriScheme(sourceUri)}, fileName=${fileName}, tempPath=${tempPath}, tempUri=${tempUri}`,
    )
    let sourceFile: fs.File | undefined = undefined
    try {
      sourceFile = fs.openSync(sourceUri, fs.OpenMode.READ_ONLY)
      Logger.info(TAG, `copyUploadSourceToCache opened source fd=${sourceFile.fd}`)
      fs.copyFileSync(sourceFile.fd, tempPath)
      Logger.info(TAG, `copyUploadSourceToCache copied to tempPath=${tempPath}`)
    } finally {
      if (sourceFile) {
        fs.closeSync(sourceFile)
      }
    }
    const tempStat = await fs.stat(tempPath)
    const cachedFile: NativeCachedUploadFile = {
      path: tempPath,
      uri: tempUri,
    }
    Logger.info(TAG, `copyUploadSourceToCache copied bytes=${Number(tempStat.size ?? 0)}`)
    Logger.info(TAG, `copyUploadSourceToCache success: ${JSON.stringify(cachedFile)}`)
    return cachedFile
  }

  private safeDeleteFile(path: string): void {
    if (!path) {
      return
    }

    try {
      fs.unlinkSync(path)
    } catch (error) {
      Logger.warn(TAG, `delete temp upload file failed: ${JSON.stringify(this.parseBusinessError(error))}`)
    }
  }

  private stringifyListenAudioCacheResult(result: NativeListenAudioCacheResult): string {
    return JSON.stringify(result)
  }

  private stringifyListenAudioCacheCleanupResult(
    result: NativeListenAudioCacheCleanupResult,
  ): string {
    return JSON.stringify(result)
  }

  private normalizeCacheKey(key: string): string {
    const normalized = key
      .trim()
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/_+/g, '_')
    if (normalized.length > 0) {
      return normalized
    }
    return `${Date.now()}`
  }

  private normalizeListenAudioCacheExtension(
    url: string,
    extension?: string,
  ): string {
    const normalizedExt = this.getFileExtension(extension?.trim() ?? '')
    if (normalizedExt.length > 0) {
      return normalizedExt
    }

    const fileName = this.getFileNameFromUri(url)
    const fileExt = this.getFileExtension(fileName)
    if (fileExt.length > 0) {
      return fileExt
    }

    return 'mp3'
  }

  private buildListenAudioCachePath(cacheKey: string, extension: string): string {
    const normalizedKey = this.normalizeCacheKey(cacheKey)
    const suffix = extension.length > 0 ? `.${extension}` : ''
    return `${getContext().cacheDir}/${LISTEN_AUDIO_CACHE_PREFIX}${normalizedKey}${suffix}`
  }

  private createListenAudioCacheResult(
    success: boolean,
    cacheKey: string,
    localPath?: string,
    hit: boolean = false,
    errorCode?: string,
    errorMessage?: string,
  ): NativeListenAudioCacheResult {
    const result: NativeListenAudioCacheResult = {
      success: success,
      cacheKey: cacheKey,
      localPath: localPath,
      localUri: localPath ? this.buildUploadInternalCacheUri(localPath) : undefined,
      hit: hit,
      errorCode: errorCode,
      errorMessage: errorMessage,
    }
    return result
  }

  private async statCachedFile(path: string): Promise<number> {
    const stat = await fs.stat(path)
    return Number(stat.size ?? 0)
  }

  private async cacheListenAudioFileInternal(
    payloadText: string,
  ): Promise<NativeListenAudioCacheResult> {
    const payload = JSON.parse(payloadText) as NativeListenAudioCachePayload
    const downloadUrl = this.getNonEmptyText(payload.url)
    const cacheKey = this.normalizeCacheKey(payload.cacheKey)

    if (downloadUrl.length === 0) {
      return this.createListenAudioCacheResult(
        false,
        cacheKey,
        undefined,
        false,
        'INVALID_URL',
        '下载地址为空',
      )
    }

    const extension = this.normalizeListenAudioCacheExtension(
      downloadUrl,
      payload.extension,
    )
    const cachePath = this.buildListenAudioCachePath(cacheKey, extension)

    try {
      const cacheSize = await this.statCachedFile(cachePath)
      if (cacheSize > 0) {
        Logger.info(TAG, `cacheListenAudioFileInternal hit: key=${cacheKey}, path=${cachePath}, size=${cacheSize}`)
        return this.createListenAudioCacheResult(true, cacheKey, cachePath, true)
      }
    } catch (error) {
      // ignore cache miss
    }

    this.safeDeleteFile(cachePath)

    const downloadContext = getContext(this) as common.UIAbilityContext
    const config: request.DownloadConfig = {
      url: downloadUrl,
      filePath: cachePath,
    }

    Logger.info(TAG, `cacheListenAudioFileInternal start: key=${cacheKey}, url=${downloadUrl}, path=${cachePath}`)

    return new Promise<NativeListenAudioCacheResult>((resolve) => {
      request.downloadFile(downloadContext, config)
        .then((task: request.DownloadTask) => {
          let settled = false
          const finish = async (
            success: boolean,
            errorCode?: string,
            errorMessage?: string,
          ) => {
            if (settled) {
              return
            }
            settled = true

            if (!success) {
              this.safeDeleteFile(cachePath)
              resolve(
                this.createListenAudioCacheResult(
                  false,
                  cacheKey,
                  undefined,
                  false,
                  errorCode ?? '-1',
                  errorMessage ?? '缓存下载失败',
                ),
              )
              return
            }

            try {
              const fileSize = await this.statCachedFile(cachePath)
              if (fileSize <= 0) {
                this.safeDeleteFile(cachePath)
                resolve(
                  this.createListenAudioCacheResult(
                    false,
                    cacheKey,
                    undefined,
                    false,
                    'EMPTY_FILE',
                    '缓存音频文件为空',
                  ),
                )
                return
              }

              Logger.info(
                TAG,
                `cacheListenAudioFileInternal success: key=${cacheKey}, path=${cachePath}, size=${fileSize}`,
              )
              resolve(this.createListenAudioCacheResult(true, cacheKey, cachePath, false))
            } catch (error) {
              this.safeDeleteFile(cachePath)
              resolve(
                this.createListenAudioCacheResult(
                  false,
                  cacheKey,
                  undefined,
                  false,
                  'STAT_FAILED',
                  '缓存文件校验失败',
                ),
              )
            }
          }

          task.on('complete', () => {
            finish(true)
          })

          task.on('fail', (errorCode: number) => {
            Logger.error(
              TAG,
              `cacheListenAudioFileInternal fail event: key=${cacheKey}, code=${errorCode}, url=${downloadUrl}`,
            )
            finish(false, `${errorCode}`, `缓存下载失败(${errorCode})`)
          })
        })
        .catch((error: BusinessError) => {
          Logger.error(TAG, `cacheListenAudioFileInternal create task failed: ${error.code}, ${error.message}`)
          this.safeDeleteFile(cachePath)
          resolve(
            this.createListenAudioCacheResult(
              false,
              cacheKey,
              undefined,
              false,
              `${error.code}`,
              error.message ?? '创建下载任务失败',
            ),
          )
        })
    })
  }

  private async cleanupListenAudioCacheInternal(
    payloadText: string,
  ): Promise<NativeListenAudioCacheCleanupResult> {
    let deletedCount = 0
    let failedCount = 0

    try {
      const payload = JSON.parse(payloadText) as NativeListenAudioCacheCleanupPayload
      const localPaths = (payload.localPaths ?? [])
        .map(item => this.getNonEmptyText(item))
        .filter(item => item.length > 0)
      const localUris = (payload.localUris ?? [])
        .map(item => this.getNonEmptyText(item))
        .filter(item => item.length > 0)
        .map(item => this.getPathFromInternalCacheUri(item))
      const targets = [...localPaths, ...localUris]

      targets.forEach(path => {
        try {
          this.safeDeleteFile(path)
          deletedCount += 1
        } catch (error) {
          failedCount += 1
        }
      })
    } catch (error) {
      failedCount += 1
    }

    return {
      success: failedCount === 0,
      deletedCount: deletedCount,
      failedCount: failedCount,
    }
  }

  private getOptions(pageName: string, param?: string): router.RouterOptions {
    let routerParam: RNRouterParam = new RNRouterParam();
    routerParam.moduleName = pageName;
    routerParam.params = param;
    let url: string = ''
    if (pageName === LOGIN_PAGE_NAME) {
      url = LOGIN_PAGE;
    } else {
      url = 'pages/Index';
    }
    return {
      url: url,
      params: routerParam
    };
  }

  replaceUrl(pageName: string, param?: string, callBack?: (result: string) => void): string {
    Logger.info(TAG, 'replaceUrl : ' + pageName + ' param' + JSON.stringify(param ?? ''));
    LoadManager.uiContext?.getRouter().replaceUrl(this.getOptions(pageName, param),
      (err: BusinessError) => {
        !err && callBack && callBack('replaceUrl : ' + pageName + ' success')
      });
    this.prePageName = pageName;
    return 'replaceUrl : ' + pageName + ' success';
  }

  pushUrl(pageName: string, param?: string, callBack?: (result: string) => void): string {
    Logger.info(TAG, 'pushUrl : ' + pageName + ' param' + JSON.stringify(param ?? ''));
    LoadManager.uiContext?.getRouter().pushUrl(this.getOptions(pageName, param),
      (err: BusinessError) => {
        !err && callBack && callBack('pushUrl : ' + pageName + ' success')
      });
    this.prePageName = pageName
    return 'pushUrl : ' + pageName + ' success';
  }

  back(param?: string, callBack?: (result: string) => void): string {
    Logger.info(TAG, 'back : ' + JSON.stringify(param ?? '') + ' this.prePageName:' + this.prePageName);
    let routerParam: RNRouterParam = new RNRouterParam()
    routerParam.moduleName = this.prePageName
    routerParam.params = param
    router.back({
      url: 'pages/Index',
      params: routerParam
    });
    callBack?.('back 鸿蒙侧回调: ' + JSON.stringify(param ?? ''));
    return 'back success with param: ' + JSON.stringify(param ?? '');
  }

  getOhASData(key: string, defaultVal?: null | Object): null | Object {
    let res = AppStorage.get(key) ?? defaultVal
    return res === undefined ? null : res;
  }

  public static async getRnBridgePref(prefName?: string) {
    return preferences.getPreferences(getContext(), prefName ?? 'pref')
  }

  getOhPrefData(callback: (res: null | Object) => void, key: string, defaultVal?: null | Object,
    prefName?: string) {
    let pref: preferences.Preferences | null
    RnBridge.getRnBridgePref(prefName).then((pref_) => {
      pref = pref_
    }).finally(() => {
      if (pref) {
        callback(pref.getSync(key, defaultVal))
      } else {
        callback(null)
      }
    })
  }

  setOhPrefData(key: string, val: null | Object, prefName?: string, callback?: () => void) {
    RnBridge.getRnBridgePref(prefName).then((pref) => {
      if (pref) {
        if (val === null || val === undefined) {
          pref.deleteSync(key)
        } else {
          pref.putSync(key, val)
        }
        pref.flushSync()
      }
    })
      .finally(() => {
        callback && callback()
      })
  }

  delOhPrefData(key: string, prefName?: string, callback?: () => void) {
    RnBridge.getRnBridgePref(prefName).then((pref) => {
      if (pref) {
        pref.deleteSync(key)
      }
    }).finally(() => {
      callback && callback()
    })
  }

  shutDownApp() {
    getContext().getApplicationContext().killAllProcesses()
    Logger.info(TAG, 'shutdown app success');
  }

  saveImageToAlbum(path: string, callback: (res: boolean, saveUri: string) => void) {
    try {
      ImageUtils.saveImageToAlbum(getContext(), path, callback)
    } catch (e) {
      callback(false, '')
    }
  }

  requestPayment(orderNo: string, callback: () => void) {
    Logger.info(TAG, 'requestPayment : ' + orderNo)
    paymentService
      .requestPayment(getContext() as common.UIAbilityContext, '')
      .then(() => {
      })
      .catch(() => {
      })
      .finally(() => {
        callback();
      });
  }

  copyText(text: string, callback: () => void) {
    let pasteData = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, text);
    let systemPasteboard = pasteboard.getSystemPasteboard();
    systemPasteboard.setDataSync(pasteData);
    callback?.();
  }

  hiLog(level: string | number, tag: string, content: string) {
    let levelTag = 0;
    if (typeof level === 'string') {
      if (level === 'info') {
        levelTag = 0;
      } else if (level === 'debug') {
        levelTag = 1;
      } else if (level === 'warn') {
        levelTag = 2;
      } else if (level === 'error') {
        levelTag = 3;
      }
    } else {
      levelTag = level
    }
    if (levelTag === 0) {
      Logger.info(tag, content);
    } else if (levelTag === 1) {
      Logger.debug(tag, content);
    } else if (levelTag === 2) {
      Logger.warn(tag, content);
    } else if (levelTag === 3) {
      Logger.error(tag, content);
    } else {
      Logger.info(tag, content);
    }
  }

  share(strData: string): boolean {
    Logger.info(TAG, 'share : ' + strData)
    let content = ""
    let title = ""
    let desc = ""
    try {
      let data = JSON.parse(strData) as BridgeShareModel
      if (!!data) {
        content = data.content
        title = data.title
        desc = data.desc
      }
      if (!!LoadManager.uiContext) {
        ShareUtils.share(LoadManager.uiContext, content, title, desc)
      }
    } catch (e) {
      Logger.error(TAG, e)
    }
    return true;
  }

  selectPicture(action: string, callback: ((uri: string) => void) | undefined): void {
    Logger.info(TAG, 'selectPicture : ' + action)
    let options: photoAccessHelper.PhotoSelectOptions = new photoAccessHelper.PhotoSelectOptions()
    options.MIMEType = photoAccessHelper.PhotoViewMIMETypes.IMAGE_TYPE //可选择的媒体文件类型，若无此参数，则默认为图片和视频类型。
    options.maxSelectNumber = 1 //选择媒体文件数量的最大值,默认1
    options.isPhotoTakingSupported = true //支持拍照。
    options.isEditSupported = true //支持编辑照片。
    options.isOriginalSupported = false //显示选择原图按钮。
    PhotoHelper.select(options).then(uris => {
      if (uris.length <= 0) {
        Logger.error(TAG, 'selectPicture select none');
        return
      }
      callback?.(uris[0])
    })
  }

  selectAudio(callback: ((result: string) => void) | undefined): void {
    Logger.info(TAG, 'selectAudio')
    try {
      const audioPicker = new picker.AudioViewPicker()
      audioPicker.select()
        .then(async (result: Array<string>) => {
          const selectedUri = result.length > 0 ? result[0] : ''
          if (!selectedUri) {
            callback?.(this.stringifySelectedAudioResult(true, '', '', 0))
            return
          }
          callback?.(await this.buildSelectedAudioPayload(selectedUri))
        })
        .catch((error: BusinessError) => {
          Logger.warn(TAG, `selectAudio failed: ${JSON.stringify(error)}`)
          callback?.(this.stringifySelectedAudioResult(true, '', '', 0, error.message ?? '选择音频失败'))
        })
    } catch (error) {
      Logger.error(TAG, `selectAudio exception: ${JSON.stringify(this.parseBusinessError(error))}`)
      callback?.(this.stringifySelectedAudioResult(true, '', '', 0, '当前设备不支持音频选择'))
    }
  }

  uploadAudio(payload: string, callback: ((result: string) => void) | undefined): void {
    Logger.info(TAG, `uploadAudio payload: ${payload}`)
    let settled = false
    const finish = (result: NativeUploadResult) => {
      if (settled) {
        return
      }
      settled = true
      callback?.(JSON.stringify(result))
    }

    try {
      Logger.info(TAG, `uploadAudio parsing payload`)
      const parsed = JSON.parse(payload) as NativeUploadPayload
      Logger.info(TAG, `uploadAudio parsed: url=${parsed.url}, uri=${parsed.uri}, fileName=${parsed.fileName}, uploadName=${parsed.uploadName}, mimeType=${parsed.mimeType}`)
      const uploadUrl = parsed.url.trim()
      const uploadFileName = this.getSafeUploadFileName(parsed.fileName)
      const uploadName = parsed.uploadName.trim()
      const mimeType = this.getSafeUploadMimeType(uploadFileName, parsed.mimeType)
      const uploadFileType = this.getSafeUploadFileType(uploadFileName, parsed.mimeType)
      Logger.info(
        TAG,
        `uploadAudio validation: ${JSON.stringify({
          urlEmpty: uploadUrl.length === 0,
          urlLength: uploadUrl.length,
          urlScheme: this.getUriScheme(uploadUrl),
          uriEmpty: parsed.uri.trim().length === 0,
          uriLength: parsed.uri.trim().length,
          uriScheme: this.getUriScheme(parsed.uri),
          fileNameEmpty: parsed.fileName.trim().length === 0,
          fileNameLength: parsed.fileName.trim().length,
          uploadNameEmpty: uploadName.length === 0,
          uploadNameLength: uploadName.length,
          mimeTypeFromPayload: parsed.mimeType,
          mimeTypeFinal: mimeType,
          uploadFileType: uploadFileType,
        })}`,
      )
      Logger.info(
        TAG,
        `uploadAudio processed: uploadUrl=${uploadUrl}, uploadFileName=${uploadFileName}, uploadName=${uploadName}, mimeType=${mimeType}, uploadFileType=${uploadFileType}`,
      )
      const cachedFile: NativeCachedUploadFile = {
        path: this.getPathFromInternalCacheUri(parsed.uri),
        uri: parsed.uri,
      }
      fs.stat(cachedFile.path)
        .then((cacheStat: fs.Stat) => {
          const uploadContext = getContext(this) as common.UIAbilityContext
          const cachedFileName = this.getFileNameFromPath(cachedFile.path)
          const header: UploadRequestHeader = {}
          const uploadFile: request.File = {
            filename: uploadFileName,
            name: 'file',
            uri: cachedFile.uri,
            type: uploadFileType,
          }
          const uploadData: request.RequestData = {
            name: 'name',
            value: uploadName,
          }
          const config: request.UploadConfig = {
            url: uploadUrl,
            header: header,
            method: 'POST',
            files: [uploadFile],
            data: [uploadData],
          }

          Logger.info(
            TAG,
            `uploadAudio cache stat: filePath=${cachedFile.path}, size=${Number(cacheStat.size ?? 0)}, fileUri=${cachedFile.uri}`,
          )
          Logger.info(
            TAG,
            `uploadAudio config: url=${uploadUrl}, fileUri=${cachedFile.uri}, filePath=${cachedFile.path}, filename=${cachedFileName}, uploadFilename=${uploadFileName}, uploadName=${uploadName}, mimeType=${mimeType}, uploadFileType=${uploadFileType}, cacheDir=${uploadContext.cacheDir}`,
          )
          Logger.info(TAG, `uploadAudio full config: ${JSON.stringify(config)}`)
          request.uploadFile(uploadContext, config)
            .then((task: request.UploadTask) => {
              let headerPayload = ''
              task.on('headerReceive', (headers: ESObject) => {
                headerPayload = JSON.stringify(headers)
                Logger.info(TAG, `uploadAudio headerReceive: ${headerPayload}`)
              })

              task.on('complete', (states: Array<request.TaskState>) => {
                const state: request.TaskState | undefined = states.length > 0 ? states[0] : undefined
                const responseBody = this.parseUploadResponseBody(headerPayload)
                Logger.info(TAG, `uploadAudio complete: ${JSON.stringify(state)}`)
                if (
                  (state && state.responseCode >= 200 && state.responseCode < 300) ||
                  responseBody?.success === true
                ) {
                  finish(
                    this.createUploadResult(
                      true,
                      undefined,
                      state?.responseCode,
                      this.getNonEmptyText(responseBody?.message) || state?.message,
                    ),
                  )
                  return
                }

                finish(
                  this.createUploadResult(
                    false,
                    this.buildUploadFailureMessage(state, headerPayload),
                    state?.responseCode,
                    headerPayload,
                  ),
                )
              })

              task.on('fail', (states: Array<request.TaskState>) => {
                const state: request.TaskState | undefined = states.length > 0 ? states[0] : undefined
                const responseBody = this.parseUploadResponseBody(headerPayload)
                Logger.error(TAG, `uploadAudio fail event: ${JSON.stringify(state)}`)
                if (responseBody?.success === true) {
                  finish(
                    this.createUploadResult(
                      true,
                      undefined,
                      state?.responseCode,
                      this.getNonEmptyText(responseBody?.message) || state?.message,
                    ),
                  )
                  return
                }
                finish(
                  this.createUploadResult(
                    false,
                    this.buildUploadFailureMessage(state, headerPayload),
                    state?.responseCode,
                    headerPayload,
                  ),
                )
              })
            })
            .catch((error: BusinessError) => {
              const businessError = this.parseBusinessError(error)
              Logger.error(
                TAG,
                `uploadAudio create task failed: code=${businessError.code}, message=${businessError.message}, details=${JSON.stringify(businessError)}`,
              )
              finish(this.createUploadResult(false, error.message ?? '创建上传任务失败'))
            })
        })
        .catch((error: Object) => {
          const businessError = this.parseBusinessError(error)
          Logger.error(TAG, `uploadAudio cache stat failed, uri=${parsed.uri}, path=${cachedFile.path}, code=${businessError.code}, message=${businessError.message}`)
          finish(this.createUploadResult(false, businessError.message ?? '检查缓存上传文件失败'))
        })
    } catch (error) {
      Logger.error(TAG, `uploadAudio exception: ${JSON.stringify(this.parseBusinessError(error))}`)
      finish(this.createUploadResult(false, '上传参数解析失败'))
    }
  }

  cacheListenBookAudio(payload: string, callback: ((result: string) => void) | undefined): void {
    this.cacheListenAudioFileInternal(payload)
      .then((result) => {
        callback?.(this.stringifyListenAudioCacheResult(result))
      })
      .catch((error: BusinessError) => {
        const fallback = this.createListenAudioCacheResult(
          false,
          `${Date.now()}`,
          undefined,
          false,
          `${error.code}`,
          error.message ?? '缓存音频失败',
        )
        callback?.(this.stringifyListenAudioCacheResult(fallback))
      })
  }

  cleanupListenBookAudioCache(
    payload: string,
    callback?: ((result: string) => void),
  ): void {
    this.cleanupListenAudioCacheInternal(payload)
      .then((result) => {
        callback?.(this.stringifyListenAudioCacheCleanupResult(result))
      })
      .catch(() => {
        callback?.(
          this.stringifyListenAudioCacheCleanupResult({
            success: false,
            deletedCount: 0,
            failedCount: 1,
          }),
        )
      })
  }

  openLink(strParam: string): void {
    Logger.info(TAG, 'startAbility : ' + strParam)
    try {
      let param = JSON.parse(strParam) as BridgeOpenLinkModel
      let url = param.url; // 包名需替换
      let context: common.UIAbilityContext = getContext(this) as common.UIAbilityContext
      // 需要拼接不同的应用包名，用以打开不同的应用详情页,例如：bundleName:'com.huawei.hmsapp.books'
      let link: string = url;
      // 以App Linking优先的方式在应用市场打开指定包名的应用详情页
      context.openLink(link, { appLinkingOnly: false })
        .then(() => {
          Logger.info('TAG', 'openlink success.');
        })
        .catch((error: BusinessError) => {
          Logger.error('TAG', `openlink failed. Code: ${error.code}, message is ${error.message}`);
        });
    } catch (e) {
      Logger.error(TAG, JSON.stringify(e))
    }
  }

  callPhone(phone: string): void {
    Logger.info(TAG, 'callPhone : ' + phone)
    // 调用查询能力接口
    let isSupport = call.hasVoiceCapability();
    if (!isSupport) {
      Logger.error(TAG, 'call.hasVoiceCapability not');
      return
    }
    // 如果设备支持呼叫能力，则继续跳转到拨号界面，并显示拨号的号码
    // 从API15开始支持tel格式电话号码，如：'tel:13xxxx'
    if (canIUse('SystemCapability.Applications.Contacts')) {
      call.makeCall(phone, (err: BusinessError) => {
        if (!err) {
          Logger.info(TAG, 'make call success.');
        } else {
          Logger.error(TAG, 'make call fail, err is:' + JSON.stringify(err));
        }
      });
    }
  }

  emitterEmit(key: string, param: string): void {
    let data: emitter.GenericEventData<object> = {
      data: {
        param: param
      }
    }
    emitter.emit(key, data);
  }

  setStatusBarWhite(white: boolean) {
    StatusBarManager.handleStatusBarAction(getContext(),
      JSON.stringify({
        'action': 'backgroundColorByHexString',
        'args': white ? ['#00FFFFFF', '#FFFFFF'] : ['#00FFFFFF', '#000000']
      }));
  }

  requestPermission(preList: Permissions[], callback: (access: boolean) => void): void {
    const atManager = abilityAccessCtrl.createAtManager();
    try {
      atManager.requestPermissionsFromUser(getContext(), preList).then(async (result) => {
        let dismissPer: Permissions[] = [];
        result.authResults.forEach((item, index) => {
          if (item !== 0) {
            dismissPer.push(preList[index]);
          }
        })
        if (dismissPer.length > 0) {
          let perList2 = [...dismissPer];
          dismissPer = [];
          for (let item of perList2) {
            const result2 = await atManager.requestPermissionOnSetting(getContext() as common.UIAbilityContext, [item])
            if (result2[0] !== 0) {
              dismissPer.push(item);
            }
          }
        }
        if (preList.indexOf(KNOCK_PER) && !dismissPer.includes(KNOCK_PER)) {
          let data: emitter.GenericEventData<object> = {
            data: {
              param: true
            }
          }
          emitter.emit('onKnockPer', data)
        }
        callback?.(dismissPer.length === 0)
      }).catch(() => {
        callback?.(false)
      });
    } catch (err) {
      callback?.(false)
    }
  }

  initAVSession(tag: string): void {
    AVSessionManager.getInstance().initSession(tag);
    AVSessionManager.getInstance().setCommandHandler(new NativeAudioSessionCommandHandler());
  }

  updateAVSessionMetadata(payload: string): void {
    AVSessionManager.getInstance().updateMetadata(payload);
  }

  updateAVSessionPlayback(payload: string): void {
    AVSessionManager.getInstance().updatePlayback(payload);
  }

  destroyAVSession(): void {
    NativeAudioPlayerManager.getInstance().release();
    AVSessionManager.getInstance().setCommandHandler(null);
    AVSessionManager.getInstance().destroy();
  }

  loadNativeAudioQueue(payload: string): void {
    NativeAudioPlayerManager.getInstance().loadQueue(payload);
  }

  playNativeAudio(): void {
    NativeAudioPlayerManager.getInstance().play();
  }

  pauseNativeAudio(): void {
    NativeAudioPlayerManager.getInstance().pause();
  }

  seekNativeAudio(positionMs: number): void {
    NativeAudioPlayerManager.getInstance().seek(positionMs);
  }

  stopNativeAudio(): void {
    NativeAudioPlayerManager.getInstance().stop();
  }

  skipToNextNativeAudio(): void {
    NativeAudioPlayerManager.getInstance().skipToNext();
  }

  skipToPreviousNativeAudio(): void {
    NativeAudioPlayerManager.getInstance().skipToPrevious();
  }

  releaseNativeAudio(): void {
    NativeAudioPlayerManager.getInstance().release();
  }
}
