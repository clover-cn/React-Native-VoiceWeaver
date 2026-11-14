import { RNAbility, } from '@rnoh/react-native-openharmony';
import dataPreferences from '@ohos.data.preferences';
import window from '@ohos.window';
import { display } from '@kit.ArkUI';
import { emitter } from '@kit.BasicServicesKit';
import { Logger } from '../utils/Logger';
import { Want } from '@kit.AbilityKit';
import { WXLoginService } from 'aggregated_login';
import AbilityConstant from '@ohos.app.ability.AbilityConstant';
import { ReferenceRecorder } from '../TurboModule/ReferenceRecorder';

export let preferences: dataPreferences.Preferences | null = null;

const TAG = 'EntryAbility'

export default class EntryAbility extends RNAbility {
  onForeground(): void {
    super.onForeground();
    ReferenceRecorder.lifecycle(true);
  }
  onBackground(): void {
    ReferenceRecorder.lifecycle(false);
    super.onBackground();
  }
  onDestroy(): void {
    ReferenceRecorder.lifecycle(false);
    super.onDestroy();
  }
  getPagePath() {
    return 'pages/Index';
  }

  // 实例化登录服务
  private loginServiceImpl: WXLoginService =
    WXLoginService.create()// todo 填写微信开放平台配置的应用AppID
      .initWX('wxc92d9d6570127a32')

  onNewWant(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    super.onNewWant(want, launchParam);
    this.loginServiceImpl.handleWant(want);
  }

  onCreate(want: Want): void {
    super.onCreate(want);
    this.loginServiceImpl.handleWant(want);
  }

  onWindowStageCreate(windowStage: window.WindowStage) {
    super.onWindowStageCreate(windowStage);
    try {
      let options: dataPreferences.Options = {
        name: 'comp_mall_rn'
      };
      preferences = dataPreferences.getPreferencesSync(this.context, options);
    } catch (err) {
    }
    AppStorage.setOrCreate('RNAbility', this);
    let windowClass: window.Window = windowStage.getMainWindowSync();
    let type = window.AvoidAreaType.TYPE_NAVIGATION_INDICATOR; // 以导航条避让为例
    let avoidArea = windowClass.getWindowAvoidArea(type);
    let bottomRectHeight = avoidArea.bottomRect.height; // 获取到导航条区域的高度
    AppStorage.setOrCreate('bottomRectHeight', px2vp(bottomRectHeight));

    type = window.AvoidAreaType.TYPE_SYSTEM; // 以状态栏避让为例
    avoidArea = windowClass.getWindowAvoidArea(type);
    let topRectHeight = avoidArea.topRect.height; // 获取状态栏区域高度
    AppStorage.setOrCreate('topRectHeight', px2vp(topRectHeight));


    const emEvent = (foldStatus: display.FoldStatus, foldable: boolean) => {
      let eventDataWindowState: emitter.GenericEventData<object> = {
        data: {
          foldStatus: foldStatus,
          foldable: foldable,
        }
      };
      Logger.info(TAG, 'FoldStatus: ' + foldStatus + ' foldable: ' + foldable);
      AppStorage.setOrCreate('FoldStatus', foldStatus);
      AppStorage.setOrCreate('Foldable', foldable);
      emitter.emit(WindowWEmitterEvent, eventDataWindowState);
    }
    emEvent(display.getFoldStatus(), display.isFoldable());
    windowClass.on('avoidAreaChange', () => {
      // 窗口旋转或折叠后同步避让高度，供阅读菜单等原生桥接调用读取。
      const systemArea = windowClass.getWindowAvoidArea(window.AvoidAreaType.TYPE_SYSTEM);
      const navigationArea = windowClass.getWindowAvoidArea(window.AvoidAreaType.TYPE_NAVIGATION_INDICATOR);
      AppStorage.setOrCreate('topRectHeight', px2vp(systemArea.topRect.height));
      AppStorage.setOrCreate('bottomRectHeight', px2vp(navigationArea.bottomRect.height));
      emEvent(display.getFoldStatus(), display.isFoldable());
    })
  }
}

export const WindowWEmitterEvent = 'WindowStateEmitterEvent'
