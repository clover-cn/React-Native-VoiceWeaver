#include "RnFabricViewEventEmitter.h"

namespace facebook {
namespace react {

void RnFabricViewEventEmitter::onReceiveData(OnReceiveData event) const {
    dispatchEvent("receiveData", [event = std::move(event)](jsi::Runtime &runtime) {
        auto payload = jsi::Object(runtime);
        payload.setProperty(runtime, "rnValue", event.rnValue);
        return payload;
    });
}

} // namespace react
} // namespace facebook
