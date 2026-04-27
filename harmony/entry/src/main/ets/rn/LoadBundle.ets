import {
  ResourceJSBundleProvider,
  RNInstance,
  RNOHCoreContext,
  RNOHContext,
  RNComponentContext,
  MetroJSBundleProvider,
  ComponentBuilderContext,
  buildRNComponentForTag,
} from '@rnoh/react-native-openharmony';
import { createRNPackages } from './RNPackagesFactory';

import { ENABLE_CAPI_ARCHITECTURE } from './config';
import { RnFabricView } from '../customView/RnFabricView';

import { RNCWebView, WEB_VIEW } from '@react-native-oh-tpl/react-native-webview'
import { RNCCheckbox, CHECKBOX_TYPE } from '@react-native-ohos/checkbox'
import { RNCVideo, RNC_VIDEO_TYPE } from '@react-native-ohos/react-native-video'
import { Logger } from '../utils/Logger';

export const arkTsComponentNames: Array<string> = [RnFabricView.NAME, WEB_VIEW, CHECKBOX_TYPE, RNC_VIDEO_TYPE];

const TAG = 'LoadBundle'

@Builder
export function buildCustomComponent(ctx: ComponentBuilderContext) {
  Stack() {
    if (ctx.componentName === RnFabricView.NAME) {
      RnFabricView({
        ctx: ctx.rnComponentContext,
        tag: ctx.tag
      })
    } else if (ctx.componentName === WEB_VIEW) {
      RNCWebView({
        ctx: ctx.rnComponentContext,
        tag: ctx.tag
      })
    } else if (ctx.componentName === CHECKBOX_TYPE) {
      RNCCheckbox({
        ctx: ctx.rnComponentContext,
        tag: ctx.tag,
      })
    } else if (ctx.componentName === RNC_VIDEO_TYPE) {
      RNCVideo({
        ctx: ctx.rnComponentContext,
        tag: ctx.tag
      })
    }
  }
  .position({ x: 0, y: 0 })
}

export class LoadManager {
  // 记录已加载的bundle
  private static loadedBundle: Set<string> = new Set();
  public static metroInstance: RNInstance;
  public static cpInstance: RNInstance;
  public static bpInstance: RNInstance;
  private static shouldResetMetroInstance: Boolean = true;
  public static isMetroAvailable: boolean = false;
  static ctx: RNComponentContext;
  static uiContext?: UIContext

  public static loadBundle(instance: RNInstance, bundlePath: string, useBundleCache: boolean = true): Promise<void> {
    if (LoadManager.loadedBundle.has(bundlePath) && useBundleCache) {
      return Promise.resolve();
    }
    if (useBundleCache) {
      LoadManager.loadedBundle.add(bundlePath);
    }
    return instance.runJSBundle(new ResourceJSBundleProvider(getContext().resourceManager, bundlePath));
  }

  public static async loadMetroBundle(): Promise<boolean> {
    const rnohCoreContext: RNOHCoreContext | undefined = AppStorage.get('RNOHCoreContext');
    Logger.info(TAG, 'loadMetroBundle ' + (LoadManager.shouldResetMetroInstance) + ' , ' + rnohCoreContext);
    if (LoadManager.shouldResetMetroInstance && rnohCoreContext) {
      LoadManager.metroInstance = await rnohCoreContext.createAndRegisterRNInstance({
        enableDebugger: true,
        createRNPackages: createRNPackages,
        enableNDKTextMeasuring: true,
        enableBackgroundExecutor: false,
        enableCAPIArchitecture: ENABLE_CAPI_ARCHITECTURE,
        arkTsComponentNames: arkTsComponentNames
      });
      LoadManager.ctx = new RNComponentContext(
        RNOHContext.fromCoreContext(rnohCoreContext!, LoadManager.metroInstance),
        wrapBuilder(buildCustomComponent),
        wrapBuilder(buildRNComponentForTag),
        new Map()
      );

      const provider = new MetroJSBundleProvider();
      await LoadManager.metroInstance.runJSBundle(provider);

      const jsBundleExecutionStatus: string =
        LoadManager.metroInstance.getBundleExecutionStatus(provider.getURL()) as string;
      LoadManager.shouldResetMetroInstance = false;
      if (jsBundleExecutionStatus === 'DONE') {
        LoadManager.isMetroAvailable = true;
        return true;
      } else {
        LoadManager.isMetroAvailable = false;
        return false;
      }
    }
    LoadManager.isMetroAvailable = true;
    return true
  }

  public static resetLoadedData() {
    LoadManager.loadedBundle.clear();
    LoadManager.shouldResetMetroInstance = true;
  }

  public static getRNInstance(isMetroAvailable: boolean = false) {
    if (!!LoadManager.metroInstance && isMetroAvailable) {
      return LoadManager.metroInstance
    }
    if (!!LoadManager.cpInstance) {
      return LoadManager.cpInstance
    }
    if (!!LoadManager.bpInstance) {
      return LoadManager.bpInstance
    }
    return null
  }
}
