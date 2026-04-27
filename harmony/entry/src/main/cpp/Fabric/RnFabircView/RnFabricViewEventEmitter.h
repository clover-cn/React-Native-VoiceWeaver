#pragma once

#include <jsi/jsi.h>
#include <react/renderer/components/view/ViewEventEmitter.h>

namespace facebook {
namespace react {

class JSI_EXPORT RnFabricViewEventEmitter : public ViewEventEmitter {
public:
    using ViewEventEmitter::ViewEventEmitter;
    struct OnReceiveData {
        std::string rnValue;
    };

    void onReceiveData(OnReceiveData value) const;
};

} // namespace react
} // namespace facebook
