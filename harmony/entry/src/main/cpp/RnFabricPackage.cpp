#include "./Fabric/RnFabircView/RnFabricViewEventEmitRequestHandler.h"
#include "./Fabric/RnFabircView/RnFabricViewNapiBinder.h"
#include "./Fabric/RnFabircView/RnFabricViewJSIBinder.h"
#include "./Fabric/RnFabircView/RnFabricViewComponentDescriptor.h"
#include "RnFabricPackage.h"

using namespace rnoh;
using namespace facebook;

class RnFabricPackageFactoryDelegate : public TurboModuleFactoryDelegate {
    
    public:
    SharedTurboModule createTurboModule(Context ctx, const std::string &name) const override {
        return nullptr;
    };
};

class ButtonViewPackageComponentInstanceFactoryDelegate : public ComponentInstanceFactoryDelegate {
    public:
        using ComponentInstanceFactoryDelegate::ComponentInstanceFactoryDelegate;
    
        ComponentInstance::Shared create(ComponentInstance::Context ctx) override {
            return nullptr;
        }
};


EventEmitRequestHandlers RnFabricPackagePackage::createEventEmitRequestHandlers() {
    return {
            {std::make_shared<RnFabricViewEventEmitRequestHandler>()}};
}

ComponentNapiBinderByString RnFabricPackagePackage::createComponentNapiBinderByName() {
      return {{"RnFabricView", std::make_shared<RnFabricViewNapiBinder>()}};
};

ComponentJSIBinderByString RnFabricPackagePackage::createComponentJSIBinderByName() {
    return {
         {"RnFabricView", std::make_shared<RnFabricViewJSIBinder>(),},
    };
};

ComponentInstanceFactoryDelegate::Shared RnFabricPackagePackage::createComponentInstanceFactoryDelegate() {
    return std::make_shared<ButtonViewPackageComponentInstanceFactoryDelegate>();
}

std::unique_ptr<TurboModuleFactoryDelegate> RnFabricPackagePackage::createTurboModuleFactoryDelegate() {
    return std::make_unique<RnFabricPackageFactoryDelegate>();
}

std::vector<react::ComponentDescriptorProvider> RnFabricPackagePackage::createComponentDescriptorProviders() {
    return {
        react::concreteComponentDescriptorProvider<react::RnFabricViewComponentDescriptor>(),
    };
}
