#include "RNOH/Package.h"

namespace rnoh {
class RnFabricPackagePackage : public Package {
    public:
        RnFabricPackagePackage(Package::Context ctx) : Package(ctx) {}
    
        std::unique_ptr<TurboModuleFactoryDelegate> createTurboModuleFactoryDelegate() override;
    
        std::vector<facebook::react::ComponentDescriptorProvider> createComponentDescriptorProviders() override;

        ComponentNapiBinderByString createComponentNapiBinderByName() override;
    
        ComponentJSIBinderByString createComponentJSIBinderByName() override;
    
        EventEmitRequestHandlers createEventEmitRequestHandlers() override;
    
        ComponentInstanceFactoryDelegate::Shared createComponentInstanceFactoryDelegate() override;
    };
} // namespace rnoh
