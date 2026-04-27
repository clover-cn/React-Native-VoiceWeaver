#pragma once

#include <jsi/jsi.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/PropsParserContext.h>

namespace facebook {
namespace react {
class JSI_EXPORT RnFabricViewProps final : public ViewProps {
public:
    RnFabricViewProps() = default;
    RnFabricViewProps(const PropsParserContext &context, const RnFabricViewProps &sourceProps,
                      const RawProps &rawProps);
#pragma mark - Props

    std::string src{""};
};

} // namespace react
} // namespace facebook
