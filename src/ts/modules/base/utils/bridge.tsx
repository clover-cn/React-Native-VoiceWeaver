import {BridgeTurboModule} from '../../../../../turboModules';
import {DeviceEventEmitter} from 'react-native';

class Bridge2Native {
  private isLoading = false;

  private safeExeFun(fun: Function) {
    if (!this.isLoading) {
      this.isLoading = true;
      fun();
      setTimeout(() => {
        this.isLoading = false;
      }, 500);
    }
  }

  replaceUrl(pageName: string, param?: string) {
    this.safeExeFun(() => {
      BridgeTurboModule.replaceUrl(pageName, param, _result => {});
    });
  }

  back(
    param: string,
    onBackResult?: (result: string) => void,
    safe: boolean = true,
  ) {
    if (safe) {
      this.safeExeFun(() => {
        BridgeTurboModule.back(param, result => {
          onBackResult?.(result);
        });
      });
    } else {
      BridgeTurboModule.back(param, result => {
        onBackResult?.(result);
      });
    }
  }

  pushUrl(pageName: string, param?: string) {
    this.safeExeFun(() => {
      BridgeTurboModule.pushUrl(pageName, param, _result => {});
    });
  }

  getOhASData(key: string, defaultVal?: number | string | boolean | undefined) {
    let res = BridgeTurboModule.getOhASData(key, defaultVal);
    return res;
  }

  shutDownApp() {
    BridgeTurboModule.shutDownApp();
  }

  getOhPrefData(
    callback: (res: Object | null) => void,
    key: string,
    defaultVal?: null | Object,
    prefName?: string,
  ) {
    BridgeTurboModule.getOhPrefData(callback, key, defaultVal, prefName);
  }

  setOhPrefData(
    key: string,
    val: null | Object,
    prefName?: string,
    callback?: () => void,
  ) {
    BridgeTurboModule.setOhPrefData(key, val, prefName, callback);
  }

  delOhPrefData(key: string, prefName?: string, callback?: () => void) {
    BridgeTurboModule.delOhPrefData(key, prefName, callback);
  }

  saveImageToAlbum(
    path: string,
    callback?: (res: boolean, saveUri: string) => void,
  ) {
    return BridgeTurboModule.saveImageToAlbum(path, callback);
  }

  requestPayment(orderNo: string, callback?: () => void) {
    return BridgeTurboModule.requestPayment(orderNo, callback);
  }

  copyText(text: string, callback?: () => void) {
    return BridgeTurboModule.copyText(text, callback);
  }

  share(strData: string): boolean {
    return BridgeTurboModule.share(strData);
  }

  /**
   * 选择图片
   * @param action 动作，暂不用
   * @param callback 回调
   */
  selectPicture(action: string, callback?: (uri: string) => void): void {
    return BridgeTurboModule.selectPicture(action, callback);
  }

  /**
   * 选择音频，仅鸿蒙已实现。
   */
  selectAudio(callback?: (result: string) => void): void {
    return BridgeTurboModule.selectAudio(callback);
  }

  uploadAudio(payload: string, callback?: (result: string) => void): void {
    return BridgeTurboModule.uploadAudio(payload, callback);
  }

  /**
   * 选择并读取 JSON 文档，仅鸿蒙已实现。
   */
  selectJsonDocument(callback?: (result: string) => void): void {
    return BridgeTurboModule.selectJsonDocument(callback || (() => {}));
  }

  /**
   * 导出 JSON 文档，仅鸿蒙已实现。
   */
  exportJsonDocument(
    payload: string,
    callback?: (result: string) => void,
  ): void {
    return BridgeTurboModule.exportJsonDocument(payload, callback || (() => {}));
  }

  /**
   *
   * @param tag
   * @param content
   * @param level 字符串类型支持'info'、'debug'、'warn'、'error' 分别对应数字类型0、1、2、3
   */
  hiLog(tag: string, content: string, level: string | number = 0) {
    return BridgeTurboModule.hiLog(level, tag, content);
  }

  setOnPageShow(pageName: string, cb: () => void) {
    return DeviceEventEmitter.addListener('onPageShow', param => {
      if (param?.pageName === pageName) {
        cb();
      }
    });
  }

  openLink(param: any): void {
    return BridgeTurboModule.openLink(JSON.stringify(param));
  }

  callPhone(phone: string): void {
    return BridgeTurboModule.callPhone(phone);
  }

  emitterEmit(key: string, param: string): void {
    return BridgeTurboModule.emitterEmit(key, param);
  }

  setStatusBarWhite(white: boolean) {
    BridgeTurboModule.setStatusBarWhite(white);
  }

  requestPermission(preList: string[], callback: (access: boolean) => void) {
    BridgeTurboModule.requestPermission(preList, callback);
  }

  getDefaultAddress(callback: (address?: string) => void) {
    BridgeTurboModule.getDefaultAddress(callback);
  }

  isAddressExist(address: string): boolean {
    return BridgeTurboModule.isAddressExist(address);
  }
}

let bridge = new Bridge2Native();
export default bridge;
