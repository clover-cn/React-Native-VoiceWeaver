#include "RNOH/PackageProvider.h"
#include "RnFabricPackage.h"
#include "generated/RNOHGeneratedPackage.h"
#include "LinearGradientPackage.h"
#include "CheckboxPackage.h"
#include "ViewShotPackage.h"
#include "RNCVideoPackage.h"
#include "WebViewPackage.h"

using namespace rnoh;

/** 当前 ArkTS 组件发送直接事件，仅转发真正属于 WebView 的事件。 */
class AppWebViewEventHandler final : public GeneratedEventEmitRequestHandler {
public:
    void handleEvent(Context const &ctx) override {
        if (ctx.shadowViewRegistry->getEventEmitter<facebook::react::WebViewEventEmitter>(ctx.tag)) {
            GeneratedEventEmitRequestHandler::handleEvent(ctx);
        }
    }
};

/** 保留原生属性解析，使用与当前 ArkTS 组件一致的事件和 JS 属性描述。 */
class AppWebViewPackage final : public WebViewPackage {
public:
    explicit AppWebViewPackage(Package::Context ctx) : WebViewPackage(ctx) {}

    ComponentJSIBinderByString createComponentJSIBinderByName() override {
        return {{"RNCWebView", std::make_shared<RNCWebViewJSIBinder>()}};
    }

    EventEmitRequestHandlers createEventEmitRequestHandlers() override {
        return {std::make_shared<AppWebViewEventHandler>()};
    }
};

/** 仅复用生成的业务模块工厂；WebView 的属性、事件和桥接由其原生包注册。 */
class AppTurboModulePackage final : public Package {
public:
    explicit AppTurboModulePackage(Package::Context ctx) : Package(ctx) {}

    std::unique_ptr<TurboModuleFactoryDelegate> createTurboModuleFactoryDelegate() override {
        return std::make_unique<RNOHGeneratedPackageTurboModuleFactoryDelegate>();
    }
};

std::vector<std::shared_ptr<Package>> PackageProvider::getPackages(Package::Context ctx) {
    return {
        std::make_shared<RnFabricPackagePackage>(ctx),
        std::make_shared<AppTurboModulePackage>(ctx),
        std::make_shared<AppWebViewPackage>(ctx),
        std::make_shared<ViewShotPackage>(ctx),
        std::make_shared<LinearGradientPackage>(ctx),
        std::make_shared<CheckboxPackage>(ctx),
        std::make_shared<RNCVideoPackage>(ctx),
    };
}
