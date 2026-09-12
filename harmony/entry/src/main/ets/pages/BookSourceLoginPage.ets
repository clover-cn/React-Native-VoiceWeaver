import { router } from '@kit.ArkUI';
import webview from '@ohos.web.webview';
import { BookSourceSessionManager } from '../TurboModule/BookSourceSessionManager';

interface BookSourceLoginPageParams {
  requestId: number;
}

/** 使用原生 ArkWeb 完成用户交互，不注入凭据，不转发网页消息。 */
@Entry
@Component
struct BookSourceLoginPage {
  private controller: webview.WebviewController = new webview.WebviewController();
  private requestId: number = 0;
  private currentUrl: string = '';
  @State private loginUrl: string = '';
  @State private message: string = '请在网页中登录，再点击“完成登录”。';
  @State private saving: boolean = false;

  aboutToAppear(): void {
    const params = router.getParams() as BookSourceLoginPageParams;
    this.requestId = params?.requestId || 0;
    const request = BookSourceSessionManager.getRequest(this.requestId);
    if (request) {
      this.loginUrl = request.loginUrl;
      this.currentUrl = request.loginUrl;
    } else {
      this.message = '登录请求已失效，请返回重新打开。';
    }
  }

  aboutToDisappear(): void {
    BookSourceSessionManager.finish(this.requestId, { status: 'cancelled' });
  }

  onBackPress(): boolean {
    if (this.saving) {
      return true;
    }
    BookSourceSessionManager.finish(this.requestId, { status: 'cancelled' });
    return false;
  }

  private cancel(): void {
    BookSourceSessionManager.finish(this.requestId, { status: 'cancelled' });
    router.back();
  }

  private async complete(): Promise<void> {
    if (this.saving) {
      return;
    }
    this.saving = true;
    try {
      const saved = await BookSourceSessionManager.saveLogin(this.requestId, this.currentUrl);
      if (!saved) {
        this.message = '尚未读取到完整登录状态，请先在网页中完成登录。';
        return;
      }
      BookSourceSessionManager.finish(this.requestId, { status: 'authenticated' });
      router.back();
    } catch (_error) {
      this.message = '无法保存登录状态，请返回书源网站后重试。';
    } finally {
      this.saving = false;
    }
  }

  build() {
    Column() {
      Row() {
        Button('取消').enabled(!this.saving).onClick(() => this.cancel())
        Text('书源登录').fontSize(20).fontWeight(FontWeight.Medium).layoutWeight(1).textAlign(TextAlign.Center)
        Button(this.saving ? '保存中' : '完成登录')
          .enabled(!this.saving && this.loginUrl.length > 0)
          .onClick(() => this.complete())
      }.padding(12).width('100%')
      Text(this.message).fontSize(14).fontColor('#596273').padding({ left: 16, right: 16, bottom: 12 })
      if (this.loginUrl) {
        Web({ src: this.loginUrl, controller: this.controller })
          .javaScriptAccess(true)
          .domStorageAccess(true)
          .onPageBegin((event) => {
            if (event) {
              this.currentUrl = event.url;
            }
          })
          .onPageEnd((event) => {
            if (event) {
              this.currentUrl = event.url;
            }
          })
          .onErrorReceive((event) => {
            if (event?.request.isMainFrame()) {
              this.message = '网页加载失败，请检查网络后重新打开登录页。';
            }
          })
          .layoutWeight(1)
          .width('100%')
      }
    }.width('100%').height('100%').backgroundColor('#F5F6F8')
  }
}
