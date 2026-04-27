import { PromptAction } from '@kit.ArkUI';
import { BusinessError } from '@kit.BasicServicesKit';
import {
  AggregatedLogin,
  Channel,
  LoginController,
  LoginChannelType,
  ApiController,
  LoginParams,
  LoginType,
  LoginFailError
} from 'aggregated_login';
import { LoadManager } from '../../rn';
import { RnBridge } from '../../TurboModule/RnBridge';
import { preferences } from '@kit.ArkData';
import { Logger } from '../../utils/Logger';
import { UserInfo } from '../../utils/GlobalData';

const TEXT_USER_AVATAR =
  'data:image/png;base64,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';

@Entry
@Component
struct LoginPage {
  promptAction: PromptAction = this.getUIContext().getPromptAction();
  controller: LoginController = new LoginController()
  navPathStack: NavPathStack = new NavPathStack()
  onLoginSuccess = (loginData: UserInfo) => {
    LoadManager.getRNInstance(LoadManager.isMetroAvailable)?.emitDeviceEvent('LoginData',
      { loginData: JSON.stringify(loginData) })
    RnBridge.getRnBridgePref().then((pref_: preferences.Preferences) => {
      pref_.putSync('LoginData', JSON.stringify(loginData));
      pref_.flush();
    })
    setTimeout(() => {
      LoadManager.uiContext?.getRouter().back();
    }, 500)
  };
  huaweiLogin = async (loginParams: LoginParams): Promise<void> => {
    Logger.error('TAG', 'huaweiLogin:' + JSON.stringify(loginParams));
    this.getUIContext().getPromptAction().showToast({ message: '华为一键登录成功' })
    let userInfo = await this.onGetUserInfo()
    this.onLoginSuccess(userInfo);
  }
  wxLogin = async (): Promise<void> => {
    this.getUIContext().getPromptAction().showToast({ message: '微信登录成功' })
    let userInfo = await this.onGetUserInfo()
    this.onLoginSuccess(userInfo);
  }
  verifyCodeLogin = async (loginParams: LoginParams): Promise<void> => {
    Logger.error('TAG', 'verifyCodeLogin:' + JSON.stringify(loginParams));
    try {
      const data = await this.promptAction.showDialog({
        title: '温馨提示',
        message: '模拟验证码登录成功？',
        buttons: [
          { text: '取消', color: '#000000' },
          { text: '确认', color: '#000000' },
        ]
      })
      if (data.index === 1) {
        this.getUIContext().getPromptAction().showToast({ message: '验证码登录成功' })
        this.controller.clearLoginInfo();
        let userInfo = await this.onGetUserInfo()
        this.onLoginSuccess(userInfo);
      }
    } catch (err) {
      Logger.error('TAG', '弹窗操作异常:' + err?.message);
    }
  }
  obtainVerifyCode = async () => {
    this.getUIContext().getPromptAction().showToast({ message: '获取验证码为模拟场景，真实获取验证码以业务实现为准' })
  }
  handleLoginFail = (loginChannelType: LoginChannelType, error: LoginFailError) => {
    if (loginChannelType === LoginChannelType.HUAWEI) {
      this.promptAction.showDialog({
        title: '温馨提示',
        message: '是否先模拟登录成功？',
        buttons: [
          { text: '取消', color: '#000000' },
          { text: '确认', color: '#000000' },
        ]
      }, (err: BusinessError, data) => { // 按钮动作回调
        Logger.error('TAG', err?.message);
        // 根据按钮索引处理动作
        if (data.index === 1) {
          this.getUIContext().getPromptAction().showToast({ message: '华为一键登录成功' })
          this.controller.clearLoginInfo();
          this.onGetUserInfo().then((userInfo) => {
            this.onLoginSuccess(userInfo);
          })
        }
      })
      return;
    }
  }

  //模拟后台返回用户信息
  onGetUserInfo = async () => {
    let loginData: UserInfo = new UserInfo();
    // todo： mock的用户Id
    loginData.userId = 1;
    // todo： mock的用户昵称
    loginData.userName = 'Michael';
    // todo： mock的用户手机号
    loginData.userPhone = '123****6789';
    // todo： mock的用户头像
    loginData.userAvatar = TEXT_USER_AVATAR;

    let pref_: preferences.Preferences = await RnBridge.getRnBridgePref();
    let allUserInfo = pref_?.getSync('LoginUserData', '');
    if (allUserInfo && typeof allUserInfo === 'string' && allUserInfo.length > 0) {
      let allUserInfos: UserInfo[] = [];
      try {
        allUserInfos = JSON.parse(allUserInfo);
      } catch (e) {
      }
      if (allUserInfos.length > 0) {
        allUserInfos.forEach((item, index) => {
          if (item.userId === loginData.userId) {
            loginData = item;
          }
        })
      }
    }
    return loginData;
  }

  build() {
    Navigation(this.navPathStack) {
      Column() {
        // 登录使用
        AggregatedLogin({
          routerModule: this.navPathStack,
          icon: $r('app.media.startIcon'), // todo 需要替换为开发者所需的图像资源文件。
          themeColor: $r('app.color.theme_color'),
          isSheet: false,
          autoSheet: false,
          isPersistence: false,
          loginTypes: [new Channel(LoginType.WECHAT, '微信', {
            appId: 'xxx',
            scope: 'snsapi_userinfo,snsapi_friend,snsapi_message,snsapi_contact',
            transaction: 'test123',
            state: 'none',
          }, $r('app.media.wx_count'))],
          privacyContent: [{
            privacyLabel: '《用户协议》',
            privacyUrl: ProtocolData.termOfServiceProtocol,
            privacyTag: '用户协议'
          }, {
            privacyLabel: '《xxxx隐私政策》',
            privacyUrl: ProtocolData.privacyProtocol,
            privacyTag: '隐私政策'
          }, {
            privacyLabel: '《华为账号用户认证协议》',
            privacyUrl: ProtocolData.huaweiUserProtocol,
            privacyTag: '华为账号用户认证协议'
          }],
          apiController: new ApiController(this.huaweiLogin, this.wxLogin, this.verifyCodeLogin),
          handleLoginFail: this.handleLoginFail,
          obtainVerifyCode: this.obtainVerifyCode,
          loginController: this.controller,
        });
      }
    }
    .mode(NavigationMode.Stack)
    .backgroundColor($r('app.color.bg_color'))
    .padding({ top: AppStorage.get<number>('topRectHeight'), bottom: AppStorage.get<number>('bottomRectHeight') })
    .hideTitleBar(true)
  }
}

export class ProtocolData {
  static termOfServiceProtocol: string =
    '<html lang="zh-CN" id="container"><head>\n    <meta charset="UTF-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n    <title>用户协议</title>\n    <style type="text/tailwindcss">\n        @layer utilities {\n            .content-auto {\n                content-visibility: auto;\n            }\n            .scrollbar-hide {\n                -ms-overflow-style: none;\n                scrollbar-width: none;\n            }\n            .scrollbar-hide::-webkit-scrollbar {\n                display: none;\n            }\n            .text-balance {\n                text-wrap: balance;\n            }\n        }\n    </style>\n</head>\n<body class="font-inter bg-gray-50 text-gray-800 min-h-screen flex flex-col">\n    <header class="bg-white shadow-sm sticky top-0 z-10 transition-all duration-300">\n        <div class="container mx-auto px-4 py-4 flex justify-between items-center">\n            <div class="flex items-center space-x-2">\n                <i class="fa fa-file-text-o text-primary text-2xl"></i>\n                <h1 class="text-xl font-bold text-gray-800">用户协议</h1>\n            </div>\n        </div>\n    </header>\n\n    <main class="flex-grow container mx-auto px-4 py-8">\n        <div class="max-w-4xl mx-auto bg-white rounded-xl shadow-md overflow-hidden transition-all duration-300 hover:shadow-lg">\n            <div class="p-6 md:p-8">\n                <div class="mb-8">\n                    <h2 class="text-[clamp(1.5rem,3vw,2.5rem)] font-bold text-gray-900 mb-4 text-balance">服务条款</h2>\n                    <p class="text-gray-600">请仔细阅读以下条款，使用我们的服务即表示您同意这些条款。</p>\n                </div>\n\n                <div class="space-y-8">\n                    <section id="section1" class="scroll-mt-20">\n                        <h3 class="text-xl font-bold text-gray-800 mb-4 flex items-center">\n                            <span class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center mr-3">1</span>\n                            服务概述\n                        </h3>\n                        <p class="text-gray-600 leading-relaxed mb-4">\n                            我们通过网站及移动应用（以下统称"服务"）为用户提供信息、工具和服务。这些服务可能包括但不限于内容浏览、社交互动、交易服务和个性化推荐。\n                        </p>\n                        <p class="text-gray-600 leading-relaxed">\n                            我们保留随时修改或停止服务的权利，而无需事先通知您。我们不会对您或任何第三方因服务的修改、暂停或终止而遭受的任何损失承担责任。\n                        </p>\n                    </section>\n\n                    <section id="section2" class="scroll-mt-20">\n                        <h3 class="text-xl font-bold text-gray-800 mb-4 flex items-center">\n                            <span class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center mr-3">2</span>\n                            用户账号\n                        </h3>\n                        <p class="text-gray-600 leading-relaxed mb-4">\n                            使用我们的服务可能需要您创建一个账号。您同意提供准确、完整和最新的个人信息，并维护和及时更新这些信息。\n                        </p>\n                        <p class="text-gray-600 leading-relaxed">\n                            您对您账号下发生的所有活动负责。如果您发现任何未经授权使用您账号的情况，您应立即通知我们。您不得将您的账号转让给任何第三方。\n                        </p>\n                    </section>\n\n                    <section id="section3" class="scroll-mt-20">\n                        <h3 class="text-xl font-bold text-gray-800 mb-4 flex items-center">\n                            <span class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center mr-3">3</span>\n                            隐私政策\n                        </h3>\n                        <p class="text-gray-600 leading-relaxed mb-4">\n                            我们重视您的隐私，并根据我们的隐私政策收集、使用和保护您的个人信息。使用我们的服务即表示您同意我们按照该隐私政策处理您的信息。\n                        </p>\n                        <p class="text-gray-600 leading-relaxed">\n                            我们可能会更新我们的隐私政策，建议您定期查看。继续使用我们的服务即表示您同意这些更新。\n                        </p>\n                    </section>\n\n                    <section id="section4" class="scroll-mt-20">\n                        <h3 class="text-xl font-bold text-gray-800 mb-4 flex items-center">\n                            <span class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center mr-3">4</span>\n                            内容使用\n                        </h3>\n                        <p class="text-gray-600 leading-relaxed mb-4">\n                            我们服务中提供的内容（包括但不限于文本、图形、图像、视频、音频）受版权、商标和其他知识产权法律的保护。\n                        </p>\n                        <p class="text-gray-600 leading-relaxed">\n                            您可以为个人非商业用途查看和使用这些内容，但未经我们明确书面许可，不得复制、修改、分发、传输或创建衍生作品。\n                        </p>\n                    </section>\n\n                    <section id="section5" class="scroll-mt-20">\n                        <h3 class="text-xl font-bold text-gray-800 mb-4 flex items-center">\n                            <span class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center mr-3">5</span>\n                            用户行为\n                        </h3>\n                        <p class="text-gray-600 leading-relaxed mb-4">\n                            您同意不利用我们的服务从事非法活动，或促进、鼓励任何非法活动。您不得干扰或破坏服务的正常运行，或试图访问未授权的系统或数据。\n                        </p>\n                        <p class="text-gray-600 leading-relaxed">\n                            您不得在服务中发布或传播垃圾邮件、病毒、恶意软件或任何其他有害内容。您不得收集或存储其他用户的个人信息。\n                        </p>\n                    </section>\n\n                    <section id="section6" class="scroll-mt-20">\n                        <h3 class="text-xl font-bold text-gray-800 mb-4 flex items-center">\n                            <span class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center mr-3">6</span>\n                            免责声明\n                        </h3>\n                        <p class="text-gray-600 leading-relaxed mb-4">\n                            我们的服务按"原样"提供，不附带任何形式的明示或暗示保证，包括但不限于适销性、特定用途适用性和不侵权的保证。\n                        </p>\n                        <p class="text-gray-600 leading-relaxed">\n                            在适用法律允许的最大范围内，我们不对因使用或无法使用服务而导致的任何直接、间接、偶然、特殊、惩罚性或后果性损害承担责任。\n                        </p>\n                    </section>\n\n                    <section id="section7" class="scroll-mt-20">\n                        <h3 class="text-xl font-bold text-gray-800 mb-4 flex items-center">\n                            <span class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center mr-3">7</span>\n                            法律适用与争议解决\n                        </h3>\n                        <p class="text-gray-600 leading-relaxed mb-4">\n                            本协议受[具体司法管辖区]法律管辖。因本协议引起的或与本协议有关的任何争议，应通过双方友好协商解决；协商不成的，任何一方均有权将争议提交[具体仲裁机构或法院]解决。\n                        </p>\n                        <p class="text-gray-600 leading-relaxed">\n                            如果本协议的任何条款被认定为无效或不可执行，该条款应被删除或修改，而其余条款应继续有效。\n                        </p>\n                    </section>\n\n                    <section id="section8" class="scroll-mt-20">\n                        <h3 class="text-xl font-bold text-gray-800 mb-4 flex items-center">\n                            <span class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center mr-3">8</span>\n                            协议更新\n                        </h3>\n                        <p class="text-gray-600 leading-relaxed mb-4">\n                            我们可能会不时更新本服务条款。当我们进行重大更改时，我们将通过在我们的网站上发布新的服务条款通知您，并且在某些情况下，我们可能会通过电子邮件或其他通信方式通知您。\n                        </p>\n                        <p class="text-gray-600 leading-relaxed">\n                            您继续使用我们的服务即表示您接受这些更新。我们鼓励您定期查看本服务条款。\n                        </p>\n                    </section>\n                </div>\n            </div>\n        </div>\n    </main>\n\n\n    </body></html>'
  static privacyProtocol: string =
    '<html lang="zh-CN" id="container"><head>\n    <meta charset="UTF-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n    <title>隐私协议</title>\n    <style type="text/tailwindcss">\n        @layer utilities {\n            .content-auto {\n                content-visibility: auto;\n            }\n            .scrollbar-hide {\n                -ms-overflow-style: none;\n                scrollbar-width: none;\n            }\n            .scrollbar-hide::-webkit-scrollbar {\n                display: none;\n            }\n            .text-balance {\n                text-wrap: balance;\n            }\n        }\n    </style>\n</head>\n<body class="font-inter bg-gray-50 text-gray-800 min-h-screen flex flex-col">\n    <header class="bg-white shadow-sm sticky top-0 z-10 transition-all duration-300">\n        <div class="container mx-auto px-4 py-4 flex justify-between items-center">\n            <div class="flex items-center space-x-2">\n                <i class="fa fa-file-text-o text-primary text-2xl"></i>\n                <h1 class="text-xl font-bold text-gray-800">隐私协议</h1>\n            </div>\n        </div>\n    </header>\n\n    <main class="flex-grow container mx-auto px-4 py-8">\n        <div class="max-w-4xl mx-auto bg-white rounded-xl shadow-md overflow-hidden transition-all duration-300 hover:shadow-lg">\n            <div class="p-6 md:p-8">\n                <div class="mb-8">\n                    <h2 class="text-[clamp(1.5rem,3vw,2.5rem)] font-bold text-gray-900 mb-4 text-balance">服务条款</h2>\n                    <p class="text-gray-600">请仔细阅读以下条款，使用我们的服务即表示您同意这些条款。</p>\n                </div>\n\n                <div class="space-y-8">\n                    <section id="section1" class="scroll-mt-20">\n                        <h3 class="text-xl font-bold text-gray-800 mb-4 flex items-center">\n                            <span class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center mr-3">1</span>\n                            服务概述\n                        </h3>\n                        <p class="text-gray-600 leading-relaxed mb-4">\n                            我们通过网站及移动应用（以下统称"服务"）为用户提供信息、工具和服务。这些服务可能包括但不限于内容浏览、社交互动、交易服务和个性化推荐。\n                        </p>\n                        <p class="text-gray-600 leading-relaxed">\n                            我们保留随时修改或停止服务的权利，而无需事先通知您。我们不会对您或任何第三方因服务的修改、暂停或终止而遭受的任何损失承担责任。\n                        </p>\n                    </section>\n\n                    <section id="section2" class="scroll-mt-20">\n                        <h3 class="text-xl font-bold text-gray-800 mb-4 flex items-center">\n                            <span class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center mr-3">2</span>\n                            用户账号\n                        </h3>\n                        <p class="text-gray-600 leading-relaxed mb-4">\n                            使用我们的服务可能需要您创建一个账号。您同意提供准确、完整和最新的个人信息，并维护和及时更新这些信息。\n                        </p>\n                        <p class="text-gray-600 leading-relaxed">\n                            您对您账号下发生的所有活动负责。如果您发现任何未经授权使用您账号的情况，您应立即通知我们。您不得将您的账号转让给任何第三方。\n                        </p>\n                    </section>\n\n                    <section id="section3" class="scroll-mt-20">\n                        <h3 class="text-xl font-bold text-gray-800 mb-4 flex items-center">\n                            <span class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center mr-3">3</span>\n                            隐私政策\n                        </h3>\n                        <p class="text-gray-600 leading-relaxed mb-4">\n                            我们重视您的隐私，并根据我们的隐私政策收集、使用和保护您的个人信息。使用我们的服务即表示您同意我们按照该隐私政策处理您的信息。\n                        </p>\n                        <p class="text-gray-600 leading-relaxed">\n                            我们可能会更新我们的隐私政策，建议您定期查看。继续使用我们的服务即表示您同意这些更新。\n                        </p>\n                    </section>\n\n                    <section id="section4" class="scroll-mt-20">\n                        <h3 class="text-xl font-bold text-gray-800 mb-4 flex items-center">\n                            <span class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center mr-3">4</span>\n                            内容使用\n                        </h3>\n                        <p class="text-gray-600 leading-relaxed mb-4">\n                            我们服务中提供的内容（包括但不限于文本、图形、图像、视频、音频）受版权、商标和其他知识产权法律的保护。\n                        </p>\n                        <p class="text-gray-600 leading-relaxed">\n                            您可以为个人非商业用途查看和使用这些内容，但未经我们明确书面许可，不得复制、修改、分发、传输或创建衍生作品。\n                        </p>\n                    </section>\n\n                    <section id="section5" class="scroll-mt-20">\n                        <h3 class="text-xl font-bold text-gray-800 mb-4 flex items-center">\n                            <span class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center mr-3">5</span>\n                            用户行为\n                        </h3>\n                        <p class="text-gray-600 leading-relaxed mb-4">\n                            您同意不利用我们的服务从事非法活动，或促进、鼓励任何非法活动。您不得干扰或破坏服务的正常运行，或试图访问未授权的系统或数据。\n                        </p>\n                        <p class="text-gray-600 leading-relaxed">\n                            您不得在服务中发布或传播垃圾邮件、病毒、恶意软件或任何其他有害内容。您不得收集或存储其他用户的个人信息。\n                        </p>\n                    </section>\n\n                    <section id="section6" class="scroll-mt-20">\n                        <h3 class="text-xl font-bold text-gray-800 mb-4 flex items-center">\n                            <span class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center mr-3">6</span>\n                            免责声明\n                        </h3>\n                        <p class="text-gray-600 leading-relaxed mb-4">\n                            我们的服务按"原样"提供，不附带任何形式的明示或暗示保证，包括但不限于适销性、特定用途适用性和不侵权的保证。\n                        </p>\n                        <p class="text-gray-600 leading-relaxed">\n                            在适用法律允许的最大范围内，我们不对因使用或无法使用服务而导致的任何直接、间接、偶然、特殊、惩罚性或后果性损害承担责任。\n                        </p>\n                    </section>\n\n                    <section id="section7" class="scroll-mt-20">\n                        <h3 class="text-xl font-bold text-gray-800 mb-4 flex items-center">\n                            <span class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center mr-3">7</span>\n                            法律适用与争议解决\n                        </h3>\n                        <p class="text-gray-600 leading-relaxed mb-4">\n                            本协议受[具体司法管辖区]法律管辖。因本协议引起的或与本协议有关的任何争议，应通过双方友好协商解决；协商不成的，任何一方均有权将争议提交[具体仲裁机构或法院]解决。\n                        </p>\n                        <p class="text-gray-600 leading-relaxed">\n                            如果本协议的任何条款被认定为无效或不可执行，该条款应被删除或修改，而其余条款应继续有效。\n                        </p>\n                    </section>\n\n                    <section id="section8" class="scroll-mt-20">\n                        <h3 class="text-xl font-bold text-gray-800 mb-4 flex items-center">\n                            <span class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center mr-3">8</span>\n                            协议更新\n                        </h3>\n                        <p class="text-gray-600 leading-relaxed mb-4">\n                            我们可能会不时更新本服务条款。当我们进行重大更改时，我们将通过在我们的网站上发布新的服务条款通知您，并且在某些情况下，我们可能会通过电子邮件或其他通信方式通知您。\n                        </p>\n                        <p class="text-gray-600 leading-relaxed">\n                            您继续使用我们的服务即表示您接受这些更新。我们鼓励您定期查看本服务条款。\n                        </p>\n                    </section>\n                </div>\n            </div>\n        </div>\n    </main>\n\n\n    </body></html>'
  static huaweiUserProtocol: string =
    '<html lang="zh-CN" id="container"><head>\n    <meta charset="UTF-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n    <title>华为账号用户认证协议</title>\n    <style type="text/tailwindcss">\n        @layer utilities {\n            .content-auto {\n                content-visibility: auto;\n            }\n            .scrollbar-hide {\n                -ms-overflow-style: none;\n                scrollbar-width: none;\n            }\n            .scrollbar-hide::-webkit-scrollbar {\n                display: none;\n            }\n            .text-balance {\n                text-wrap: balance;\n            }\n        }\n    </style>\n</head>\n<body class="font-inter bg-gray-50 text-gray-800 min-h-screen flex flex-col">\n    <header class="bg-white shadow-sm sticky top-0 z-10 transition-all duration-300">\n        <div class="container mx-auto px-4 py-4 flex justify-between items-center">\n            <div class="flex items-center space-x-2">\n                <i class="fa fa-file-text-o text-primary text-2xl"></i>\n                <h1 class="text-xl font-bold text-gray-800">华为账号用户认证协议</h1>\n            </div>\n        </div>\n    </header>\n\n    <main class="flex-grow container mx-auto px-4 py-8">\n        <div class="max-w-4xl mx-auto bg-white rounded-xl shadow-md overflow-hidden transition-all duration-300 hover:shadow-lg">\n            <div class="p-6 md:p-8">\n                <div class="mb-8">\n                    <h2 class="text-[clamp(1.5rem,3vw,2.5rem)] font-bold text-gray-900 mb-4 text-balance">服务条款</h2>\n                    <p class="text-gray-600">请仔细阅读以下条款，使用我们的服务即表示您同意这些条款。</p>\n                </div>\n\n                <div class="space-y-8">\n                    <section id="section1" class="scroll-mt-20">\n                        <h3 class="text-xl font-bold text-gray-800 mb-4 flex items-center">\n                            <span class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center mr-3">1</span>\n                            服务概述\n                        </h3>\n                        <p class="text-gray-600 leading-relaxed mb-4">\n                            我们通过网站及移动应用（以下统称"服务"）为用户提供信息、工具和服务。这些服务可能包括但不限于内容浏览、社交互动、交易服务和个性化推荐。\n                        </p>\n                        <p class="text-gray-600 leading-relaxed">\n                            我们保留随时修改或停止服务的权利，而无需事先通知您。我们不会对您或任何第三方因服务的修改、暂停或终止而遭受的任何损失承担责任。\n                        </p>\n                    </section>\n\n                    <section id="section2" class="scroll-mt-20">\n                        <h3 class="text-xl font-bold text-gray-800 mb-4 flex items-center">\n                            <span class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center mr-3">2</span>\n                            用户账号\n                        </h3>\n                        <p class="text-gray-600 leading-relaxed mb-4">\n                            使用我们的服务可能需要您创建一个账号。您同意提供准确、完整和最新的个人信息，并维护和及时更新这些信息。\n                        </p>\n                        <p class="text-gray-600 leading-relaxed">\n                            您对您账号下发生的所有活动负责。如果您发现任何未经授权使用您账号的情况，您应立即通知我们。您不得将您的账号转让给任何第三方。\n                        </p>\n                    </section>\n\n                    <section id="section3" class="scroll-mt-20">\n                        <h3 class="text-xl font-bold text-gray-800 mb-4 flex items-center">\n                            <span class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center mr-3">3</span>\n                            隐私政策\n                        </h3>\n                        <p class="text-gray-600 leading-relaxed mb-4">\n                            我们重视您的隐私，并根据我们的隐私政策收集、使用和保护您的个人信息。使用我们的服务即表示您同意我们按照该隐私政策处理您的信息。\n                        </p>\n                        <p class="text-gray-600 leading-relaxed">\n                            我们可能会更新我们的隐私政策，建议您定期查看。继续使用我们的服务即表示您同意这些更新。\n                        </p>\n                    </section>\n\n                    <section id="section4" class="scroll-mt-20">\n                        <h3 class="text-xl font-bold text-gray-800 mb-4 flex items-center">\n                            <span class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center mr-3">4</span>\n                            内容使用\n                        </h3>\n                        <p class="text-gray-600 leading-relaxed mb-4">\n                            我们服务中提供的内容（包括但不限于文本、图形、图像、视频、音频）受版权、商标和其他知识产权法律的保护。\n                        </p>\n                        <p class="text-gray-600 leading-relaxed">\n                            您可以为个人非商业用途查看和使用这些内容，但未经我们明确书面许可，不得复制、修改、分发、传输或创建衍生作品。\n                        </p>\n                    </section>\n\n                    <section id="section5" class="scroll-mt-20">\n                        <h3 class="text-xl font-bold text-gray-800 mb-4 flex items-center">\n                            <span class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center mr-3">5</span>\n                            用户行为\n                        </h3>\n                        <p class="text-gray-600 leading-relaxed mb-4">\n                            您同意不利用我们的服务从事非法活动，或促进、鼓励任何非法活动。您不得干扰或破坏服务的正常运行，或试图访问未授权的系统或数据。\n                        </p>\n                        <p class="text-gray-600 leading-relaxed">\n                            您不得在服务中发布或传播垃圾邮件、病毒、恶意软件或任何其他有害内容。您不得收集或存储其他用户的个人信息。\n                        </p>\n                    </section>\n\n                    <section id="section6" class="scroll-mt-20">\n                        <h3 class="text-xl font-bold text-gray-800 mb-4 flex items-center">\n                            <span class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center mr-3">6</span>\n                            免责声明\n                        </h3>\n                        <p class="text-gray-600 leading-relaxed mb-4">\n                            我们的服务按"原样"提供，不附带任何形式的明示或暗示保证，包括但不限于适销性、特定用途适用性和不侵权的保证。\n                        </p>\n                        <p class="text-gray-600 leading-relaxed">\n                            在适用法律允许的最大范围内，我们不对因使用或无法使用服务而导致的任何直接、间接、偶然、特殊、惩罚性或后果性损害承担责任。\n                        </p>\n                    </section>\n\n                    <section id="section7" class="scroll-mt-20">\n                        <h3 class="text-xl font-bold text-gray-800 mb-4 flex items-center">\n                            <span class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center mr-3">7</span>\n                            法律适用与争议解决\n                        </h3>\n                        <p class="text-gray-600 leading-relaxed mb-4">\n                            本协议受[具体司法管辖区]法律管辖。因本协议引起的或与本协议有关的任何争议，应通过双方友好协商解决；协商不成的，任何一方均有权将争议提交[具体仲裁机构或法院]解决。\n                        </p>\n                        <p class="text-gray-600 leading-relaxed">\n                            如果本协议的任何条款被认定为无效或不可执行，该条款应被删除或修改，而其余条款应继续有效。\n                        </p>\n                    </section>\n\n                    <section id="section8" class="scroll-mt-20">\n                        <h3 class="text-xl font-bold text-gray-800 mb-4 flex items-center">\n                            <span class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center mr-3">8</span>\n                            协议更新\n                        </h3>\n                        <p class="text-gray-600 leading-relaxed mb-4">\n                            我们可能会不时更新本服务条款。当我们进行重大更改时，我们将通过在我们的网站上发布新的服务条款通知您，并且在某些情况下，我们可能会通过电子邮件或其他通信方式通知您。\n                        </p>\n                        <p class="text-gray-600 leading-relaxed">\n                            您继续使用我们的服务即表示您接受这些更新。我们鼓励您定期查看本服务条款。\n                        </p>\n                    </section>\n                </div>\n            </div>\n        </div>\n    </main>\n\n\n    </body></html>'
}


export const ERROR_MSG_MAP: Record<number, string> = {
  1001502001: '用户未登录华为账号，请前往设置-登录华为账号。',
  1001500001: '应用指纹证书校验失败，请检查client_id、应用指纹证书配置。',
  1001502014: '应用未申请scopes或permissions权限。',
};