#include "RNOH/PackageProvider.h"
#include "RnFabricPackage.h"
#include "generated/RNOHGeneratedPackage.h"
#include "LinearGradientPackage.h"
#include "CheckboxPackage.h"
#include "ViewShotPackage.h"
#include "RNCVideoPackage.h"

using namespace rnoh;

std::vector<std::shared_ptr<Package>> PackageProvider::getPackages(Package::Context ctx) {
    return {
        std::make_shared<RnFabricPackagePackage>(ctx),
        std::make_shared<RNOHGeneratedPackage>(ctx),
        std::make_shared<ViewShotPackage>(ctx),
        std::make_shared<LinearGradientPackage>(ctx),
        std::make_shared<CheckboxPackage>(ctx),
        std::make_shared<RNCVideoPackage>(ctx),
    };
}