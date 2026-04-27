import {
  buildRNComponentForTag,
  ComponentBuilderContext,
  LogBoxDialog,
  LogBoxTurboModule,
  ResourceJSBundleProvider,
  RNComponentContext,
  RNInstance,
  RNOHContext,
  RNOHCoreContext,
  RNOHErrorDialog,
} from '@rnoh/react-native-openharmony';
import { RNRouterParam } from '../model/RNRouterParam';
import { buildCustomComponent, createRNPackages, LoadManager } from '../rn';
import { arkTsComponentNames } from '../rn/LoadBundle';
import RNIndexPage from './rn/RNIndexPage';
import { display, router } from '@kit.ArkUI';
import { RnBridge } from '../TurboModule/RnBridge';
import { emitter } from '@kit.BasicServicesKit';
import { WindowWEmitterEvent } from '../entryability/EntryAbility';
import { preferences, uniformTypeDescriptor } from '@kit.ArkData';
import { Logger } from '../utils/Logger';
import { ShareManager } from '../utils/ShareManager';
import { harmonyShare, systemShare } from '@kit.ShareKit';
import { ENABLE_CAPI_ARCHITECTURE } from '../rn/config';
import { fileUri } from '@kit.CoreFileKit';

const TAG = 'Index'

@Entry()
@Component
struct Index {
  @StorageLink('RNOHCoreContext') rnohCoreContext: RNOHCoreContext | undefined = undefined;
  @State isBundleReady: boolean = false;
  isMetroAvailable: boolean = false;
  private cleanUpCallbacks: (() => void)[] = [];
  private logBoxDialogController?: CustomDialogController;
  @State sendIndex: number = 0;
  private moduleName = 'App'
  private params?: string
  private rnDefPref?: preferences.Preferences
  private foldStatus: display.FoldStatus = -1;
  private foldable: boolean = false;
  private isRegisteredShare: boolean = false;

  @Builder
  logBoxBuilder(_: ComponentBuilderContext) {
  }

  async aboutToAppear() {
    if (!this.rnohCoreContext) {
      return;
    }
    this.rnDefPref = await RnBridge.getRnBridgePref()
    this.moduleName = 'App'
    this.params = undefined
    if (!!AppStorage.get('isMetroAvailable')) {
      this.isMetroAvailable = AppStorage.get('isMetroAvailable') as boolean
      LoadManager.isMetroAvailable = true;
    }
    LoadManager.uiContext = this.getUIContext()
    Logger.info(TAG, 'LoadManager.uiContext ' + LoadManager.uiContext)

    if (!LoadManager.getRNInstance(this.isMetroAvailable)) {
      this.loadMetroBundle()
    } else {
      this.isBundleReady = true
    }

    if (!!LoadManager.uiContext) {
      Logger.info(TAG, 'getFoldStatus')
      this.getFoldStatus();
    }
  }

  callback = (eventData: emitter.GenericEventData<display.FoldStatus>): void => {
    if (eventData?.data !== undefined) {
      let data = eventData.data
      if (data['foldStatus'] !== undefined && data['foldStatus'] !== 0 && this.foldStatus !== data['foldStatus']) {
        this.foldStatus = data['foldStatus']
        this.foldable = data['foldable']
        this.emitWindowStateToRn(this.foldStatus, this.foldable)
      }
    }
  }

  aboutToDisappear() {
    LoadManager.resetLoadedData();
    this.cleanUpCallbacks.forEach(cleanUp => cleanUp());
    emitter.off(WindowWEmitterEvent, this.callback);
  }

  getFoldStatus() {
    try {
      if (canIUse('SystemCapability.Window.SessionManager')) {
        this.foldStatus = display.getFoldStatus();
        this.foldable = display.isFoldable();
      }
    } catch (err) {
    }
    this.emitWindowStateToRn(this.foldStatus, this.foldable);
    emitter.on(WindowWEmitterEvent, this.callback);
  }

  emitWindowStateToRn(foldStatus: display.FoldStatus, foldable: boolean) {
    LoadManager.getRNInstance(this.isMetroAvailable)?.emitDeviceEvent('WindowState', {
      foldStatus: foldStatus,
      foldable: foldable,
    })
  }

  subscribeReload() {
    if (!this.rnohCoreContext) {
      return;
    }
    this.cleanUpCallbacks.forEach(cleanUp => cleanUp())
    this.cleanUpCallbacks.push(this.rnohCoreContext!.devToolsController.eventEmitter.subscribe('RELOAD', async () => {
      this.isBundleReady = false;
      this.isMetroAvailable = false;
      LoadManager.isMetroAvailable = false;
      LoadManager.resetLoadedData();
      this.loadMetroBundle();
    }))
  }

  subscribeLogBox() {
    this.logBoxDialogController = new CustomDialogController({
      cornerRadius: 0,
      customStyle: true,
      alignment: DialogAlignment.TopStart,
      backgroundColor: Color.Transparent,
      builder: LogBoxDialog({
        ctx: new RNComponentContext(
          RNOHContext.fromCoreContext(this.rnohCoreContext!, LoadManager.metroInstance),
          wrapBuilder(buildCustomComponent),
          wrapBuilder(buildRNComponentForTag),
          new Map()
        ),
        rnInstance: LoadManager.metroInstance,
        initialProps: {},
        buildCustomComponent: this.logBoxBuilder,
      })
    })

    this.cleanUpCallbacks.push(LoadManager.metroInstance.getTurboModule<LogBoxTurboModule>(LogBoxTurboModule.NAME).eventEmitter.subscribe('SHOW',
      () => {
        this.logBoxDialogController?.open();
      }))
    this.cleanUpCallbacks.push(LoadManager.metroInstance.getTurboModule<LogBoxTurboModule>(LogBoxTurboModule.NAME).eventEmitter.subscribe('HIDE',
      () => {
        this.logBoxDialogController?.close();
      }))
  }

  loadMetroBundle() {
    LoadManager.loadMetroBundle().then((flag: boolean) => {
      AppStorage.setOrCreate('isMetroAvailable', flag);
      this.isMetroAvailable = flag;
      Logger.info(TAG, 'RNIndex SampleApp --- metro 服务是否可用 = ' + flag)

      this.register().then(() => {
        this.isBundleReady = true;
        this.getFoldStatus();
      });
    })
  }

  async register(): Promise<Map<string, RNInstance>> {
    if (!this.rnohCoreContext) {
      return new Map();
    }

    if (this.isMetroAvailable) {
      this.isBundleReady = true;
      this.subscribeReload();
      this.subscribeLogBox();
      return new Map();
    }

    let instanceMap: Map<string, RNInstance> = new Map();
    const cpInstance: RNInstance = await this.rnohCoreContext.createAndRegisterRNInstance({
      createRNPackages: createRNPackages,
      enableNDKTextMeasuring: true,
      enableBackgroundExecutor: false,
      enableCAPIArchitecture: ENABLE_CAPI_ARCHITECTURE,
      arkTsComponentNames: arkTsComponentNames
    });
    const bpInstance: RNInstance = await this.rnohCoreContext.createAndRegisterRNInstance({
      createRNPackages: createRNPackages,
      enableNDKTextMeasuring: true,
      enableBackgroundExecutor: false,
      enableCAPIArchitecture: ENABLE_CAPI_ARCHITECTURE,
      arkTsComponentNames: arkTsComponentNames
    });
    LoadManager.cpInstance = cpInstance;
    LoadManager.bpInstance = bpInstance;
    await cpInstance.runJSBundle(new ResourceJSBundleProvider(getContext()
      .resourceManager, 'bundle/basic/basic.harmony.bundle'));
    instanceMap.set('CPReactInstance', cpInstance);
    instanceMap.set('BPReactInstance', bpInstance);
    return instanceMap;
  }

  onPageShow(): void {
    setTimeout(async () => {
      if (this.isBundleReady) {
        Logger.info(TAG, 'onPageShow : ' + this.isBundleReady)
        LoadManager.getRNInstance(this.isMetroAvailable)?.emitDeviceEvent('onPageShow', { pageName: this.moduleName })
        this.getUIContext()
        if (this.moduleName === 'Detail') {
          emitter.on('onKnockPer', () => {
            this.registerShare();
            ShareManager.init();
          })
        }
      }
    }, 500)
  }

  onPageHide(): void {
    if (this.isBundleReady) {
      LoadManager.getRNInstance(this.isMetroAvailable)?.emitDeviceEvent('onPageHide', { pageName: this.moduleName })
      if (this.moduleName === 'Detail') {
        emitter.off('onKnockPer')
        Logger.info(TAG, 'ShareManager.destroy : ')
        ShareManager.destroy()
        harmonyShare.off('knockShare');
      }
    }
  }

  onBackPress(): boolean {
    if (!this.isBundleReady) {
      return false;
    }

    // 鸿蒙宿主页先拦截系统返回，再转发给 RN 的 BackHandler 统一处理。
    LoadManager.getRNInstance(this.isMetroAvailable)?.emitDeviceEvent('hardwareBackPress', {});
    return true;
  }

  registerShare(): void {
    // 注册碰一碰回调
    if (canIUse('SystemCapability.Collaboration.HarmonyShare') && !this.isRegisteredShare) {
      this.isRegisteredShare = true;
      harmonyShare.on('knockShare', (sharableTarget: harmonyShare.SharableTarget) => {
        if (ShareManager.fileUri) {
          // 构建图片分享数据
          const shareData = new systemShare.SharedData({
            utd: uniformTypeDescriptor.UniformDataType.JPEG,
            uri: fileUri.getUriFromPath(ShareManager.fileUri),
            title: ShareManager.title,
            thumbnailUri: fileUri.getUriFromPath(ShareManager.fileUri),
          });

          try {
            sharableTarget.share(shareData).then(() => {
              Logger.error(TAG, `分享成功`);
            }).catch((err: object) => {
              Logger.error(TAG, `分享失败: ${JSON.stringify(err)}`);
            });
          } catch (e) {
            Logger.error(TAG, 'sharableTarget.share不可调用');
          }
        }
      });
    }
  }

  build() {
    Column() {
      if (this.rnohCoreContext?.isDebugModeEnabled && this.isMetroAvailable) {
        RNOHErrorDialog()
      }
      if (this.isBundleReady) {
        RNIndexPage({ moduleName: this.moduleName, params: this.params }).layoutWeight(1)
      }
    }
  }
}
