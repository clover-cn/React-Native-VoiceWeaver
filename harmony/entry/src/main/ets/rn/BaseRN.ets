import {
  RNOHCoreContext,
  RNSurface,
  RNInstance,
  RNOHContext,
  RNComponentContext,
  buildRNComponentForTag
} from '@rnoh/react-native-openharmony';
import { Logger } from '../utils/Logger';
import { LoadManager, buildCustomComponent } from './LoadBundle';

const wrappedCustomRNComponentBuilder = wrapBuilder(buildCustomComponent);

@Component
export struct BaseRN {
  @StorageLink('RNOHCoreContext') rnohCoreContext: RNOHCoreContext | undefined = undefined;
  useBundleCache: boolean = true;
  rnInstance?: RNInstance;
  moduleName: string = '';
  initProps: Record<string, string> = {};
  bundlePath: string = '';
  @State isBundleReady: boolean = false;

  aboutToAppear() {
    Logger.error('BaseRN aboutToAppear',  this.bundlePath + ' , ' + this.moduleName)
    this.rnInstance && LoadManager.loadBundle(this.rnInstance, this.bundlePath, this.useBundleCache).then(() => {
      this.isBundleReady = true;
      Logger.info('BaseRN aboutToAppear', '加载完成' + this.bundlePath);
    }).catch((err: Error) => {
      Logger.error('BaseRN aboutToAppear', '加载失败' + this.bundlePath + err);
    });
  }

  build() {
    Column() {
      if (this.rnohCoreContext && this.isBundleReady) {
        RNSurface({
          surfaceConfig: {
            appKey: this.moduleName,
            initialProps: this.initProps,
          },
          ctx: new RNComponentContext(
            RNOHContext.fromCoreContext(this.rnohCoreContext!, this.rnInstance),
            wrappedCustomRNComponentBuilder,
            wrapBuilder(buildRNComponentForTag),
            new Map()
          ),
        })
      }
    }
    .height('100%')
    .width('100%')
  }
}
