import { RNInstance } from '@rnoh/react-native-openharmony';
import { BaseRN } from '../../rn/BaseRN';
import { LoadManager } from '../../rn/LoadBundle';
import { MetroBaseRN } from '../../rn/MetroBaseRN'
import { router } from '@kit.ArkUI';
import { RNRouterParam } from '../../model/RNRouterParam';
import { JSON } from '@kit.ArkTS';
import { Logger } from '../../utils/Logger';

const TAG = 'RNIndexPage'

@Component
export default struct RNIndexPage {
  private instance: RNInstance = LoadManager.cpInstance
  private bundlePath = 'bundle/base/base.harmony.bundle'
  public moduleName = 'Splash'
  public params?: string
  private recodeParam?: Record<string, string>
  @StorageLink('isMetroAvailable') isMetroAvailable: boolean = false

  aboutToAppear(): void {
    let routerParam: RNRouterParam = router.getParams() as RNRouterParam
    this.moduleName = routerParam?.moduleName ?? this.moduleName
    Logger.info(TAG,
      'moduleName : ' + this.moduleName + ' , ' + routerParam?.moduleName + ' , ' + this.isMetroAvailable)
    this.params = routerParam?.params
    if (this.params) {
      try {
        this.recodeParam = JSON.parse(this.params) as Record<string, string>
      } catch (e) {
        Logger.info(TAG, JSON.stringify(e))
      }
    }
  }

  build() {
    Stack() {
      if (this.isMetroAvailable) {
        MetroBaseRN({
          moduleName: this.moduleName,
          initProps: this.recodeParam
        }).align(Alignment.Top).margin({ top: 0 })
      } else if (this.instance) {
        BaseRN({
          rnInstance: this.instance,
          moduleName: this.moduleName,
          bundlePath: this.bundlePath,
          initProps: this.recodeParam
        }).align(Alignment.Top).margin({ top: 0 })
      } else {
        Text('instance is null')
      }
    }
    .width('100%')
    .height('100%')
  }
}
