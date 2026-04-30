import {TurboModule, TurboModuleRegistry} from 'react-native';

export interface Spec extends TurboModule {
  replaceUrl(
    pageName: string,
    param?: string,
    cb?: (result: string) => void,
  ): string;

  pushUrl(
    pageName: string,
    param?: string,
    cb?: (result: string) => void,
  ): string;

  back(param?: string, cb?: (result: string) => void): string;

  getOhASData(key: string, defaultVal?: Object | null): Object | null;

  shutDownApp(): void;

  getOhPrefData(
    callback: (res: Object | null) => void,
    key: string,
    defaultVal?: Object | null,
    prefName?: string,
  ): void;

  setOhPrefData(
    key: string,
    val: Object | null,
    prefName?: string,
    callback?: () => void,
  ): void;

  delOhPrefData(key: string, prefName?: string, callback?: () => void): void;

  saveImageToAlbum(
    path: string,
    callback?: (res: boolean, saveUri: string) => void,
  ): void;

  requestPayment(orderNo: string, callback?: () => void): void;

  copyText(text: string, callback?: () => void): void;

  /**
   *
   * @param level 字符串类型支持'info'、'debug'、'warn'、'error'
   * @param tag
   * @param content
   */
  hiLog(level: string, tag: string, content: string): void;

  /**
   * 分享
   * @param strData 分享内容，json
   *  content: content,
   *       title: title, // 不传title时 显示链接
   *       description: desc, // 不传则不显示描述内容
   */
  share(strData: string): boolean;

  selectPicture(action: string, callback: (uri: string) => void): void;

  selectAudio(callback: (result: string) => void): void;

  uploadAudio(payload: string, callback: (result: string) => void): void;

  selectJsonDocument(callback: (result: string) => void): void;

  exportJsonDocument(payload: string, callback: (result: string) => void): void;

  cacheListenBookAudio(
    payload: string,
    callback: (result: string) => void,
  ): void;

  cleanupListenBookAudioCache(
    payload: string,
    callback?: (result: string) => void,
  ): void;

  openLink(s: string): void;

  callPhone(s: string): void;

  emitterEmit(key: string, param: string): void;

  setStatusBarWhite(white: boolean): void;

  requestPermission(
    preList: string[],
    callback: (access: boolean) => void,
  ): void;

  initAVSession(tag: string): void;

  updateAVSessionMetadata(payload: string): void;

  updateAVSessionPlayback(payload: string): void;

  destroyAVSession(): void;

  loadNativeAudioQueue(payload: string): void;

  playNativeAudio(): void;

  pauseNativeAudio(): void;

  seekNativeAudio(positionMs: number): void;

  stopNativeAudio(): void;

  skipToNextNativeAudio(): void;

  skipToPreviousNativeAudio(): void;

  releaseNativeAudio(): void;
}

export default TurboModuleRegistry.get<Spec>(
  'BridgeTurboModule',
) as Spec | null;
