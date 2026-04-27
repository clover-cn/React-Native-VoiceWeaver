import { emitter } from '@kit.BasicServicesKit';
import { JSON } from '@kit.ArkTS';
import { Permissions } from '@kit.AbilityKit';

export const KNOCK_PER: Permissions = 'ohos.permission.DISTRIBUTED_DATASYNC';

interface KnockShareData {
  param: string | KnockShareParam,
}

interface KnockShareParam {
  fileUri: string,
  title: string,
}

export class ShareManager {
  public static fileUri: string = '';
  public static title: string = '';

  private static immersiveListening() {
    emitter.on('knockShare', (eventData: emitter.GenericEventData<string>) => {
      try {
        if (eventData?.data) {
          let parObj = JSON.parse(JSON.stringify(eventData.data)) as KnockShareData
          if (parObj.param && typeof parObj.param === 'string') {
            parObj.param = JSON.parse(parObj.param) as KnockShareParam
          }
          if (typeof parObj.param !== 'string') {
            ShareManager.fileUri = parObj.param.fileUri;
            ShareManager.title = parObj.param.title;
          }
        }
      } catch (e) {
        ShareManager.fileUri = ''
        ShareManager.title = ''
        return
      }
    });
  }

  private static immersiveDisablingListening() {
    emitter.off('knockShare')
  }

  public static init() {
    ShareManager.immersiveListening(); // 添加碰一碰监听
  }

  public static destroy() {
    ShareManager.immersiveDisablingListening(); // 移除碰一碰监听
  }
}