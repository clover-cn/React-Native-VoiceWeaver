import { window } from '@kit.ArkUI';
import { common } from '@kit.AbilityKit';

export class StatusBarManager {
  static handleStatusBarAction(context: common.BaseContext, p: string): void {
    try {
      interface ParamsType {
        action: string;
        args: Array<string>;
      }

      // 解析入参，用于设置状态栏的颜色
      const params: ParamsType = JSON.parse(p);
      const action: string = params.action;
      const args: Array<string> = params.args;
      let statusBarColor = '#FFFFFF'; // 默认白色
      let statusBarContentColor = '#000000'; // 默认黑色
      if (action === 'backgroundColorByHexString') {
        statusBarColor = args[0] || statusBarColor;
        statusBarContentColor = args[1] || statusBarContentColor;
      }
      // 创建SystemBarProperties对象
      const systemBarProperties: window.SystemBarProperties = {
        statusBarColor: statusBarColor,
        statusBarContentColor: statusBarContentColor,
      };
      StatusBarManager.setStatusBarBgColor(context, systemBarProperties);
    } catch (error) {
    }
  }

  private static setStatusBarBgColor(context: common.BaseContext,
    systemBarProperties: window.SystemBarProperties): void {
    window.getLastWindow(context).then((windowClass: window.Window) => {
      try {
        windowClass.setWindowSystemBarProperties(systemBarProperties);
      } catch (exception) {
      }
    }).catch(() => {
    });
  }
}