#include "RnFabricProps.h"
#include <react/renderer/components/rncore/Props.h>
#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/core/propsConversions.h>

namespace facebook {
namespace react {
RnFabricViewProps::RnFabricViewProps(const PropsParserContext &context, const RnFabricViewProps &sourceProps,
                                     const RawProps &rawProps)
    : ViewProps(context, sourceProps, rawProps),

      src(convertRawProp(context, rawProps, "src", sourceProps.src, {""}))
{
}
} // namespace react
} // namespace facebook