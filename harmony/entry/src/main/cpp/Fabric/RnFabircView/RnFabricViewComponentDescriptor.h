#pragma once

#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ViewShadowNode.h>
#include "RnFabricViewEventEmitter.h"

#include "RnFabricProps.h"

namespace facebook {
namespace react {

extern const char RnFabricViewComponentName[] = "RnFabricView";

  using RnFabricViewShadowNode = ConcreteViewShadowNode<RnFabricViewComponentName, RnFabricViewProps, RnFabricViewEventEmitter>;
  using RnFabricViewComponentDescriptor = ConcreteComponentDescriptor<RnFabricViewShadowNode>;

} // namespace react
} // namespace facebook
