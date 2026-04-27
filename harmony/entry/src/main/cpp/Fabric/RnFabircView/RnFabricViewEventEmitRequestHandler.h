#pragma once
#include "RNOH/ArkJS.h"
#include "RNOH/EventEmitRequestHandler.h"
#include "RnFabricViewEventEmitter.h"
#include <napi/native_api.h>

using namespace facebook;
namespace rnoh {

enum RnFabricViewEventType {
    RnFabric_VIEW_ON_RECEIVEDATA = 0,
};

RnFabricViewEventType getRnFabricViewEventType(ArkJS &arkJs, napi_value eventObject, std::string eventName) {
    auto eventType = eventName;
    if (eventType == "onReceiveData") {
        return RnFabricViewEventType::RnFabric_VIEW_ON_RECEIVEDATA;
    } else {
        throw std::runtime_error("Unknown Page event type");
    }
}

class RnFabricViewEventEmitRequestHandler : public EventEmitRequestHandler {
public:
    void handleEvent(EventEmitRequestHandler::Context const &ctx) override {
        ArkJS arkJs(ctx.env);
        auto eventEmitter = ctx.shadowViewRegistry->getEventEmitter<react::RnFabricViewEventEmitter>(ctx.tag);
        if (eventEmitter == nullptr) {
            return;
        }

        RnFabricViewEventType type = getRnFabricViewEventType(arkJs, ctx.payload, ctx.eventName);
        switch (type) {
        case RnFabricViewEventType::RnFabric_VIEW_ON_RECEIVEDATA: {
            std::string rnValue = arkJs.getString(arkJs.getObjectProperty(ctx.payload, "rnValue"));

            react::RnFabricViewEventEmitter::OnReceiveData event = { rnValue};
            eventEmitter->onReceiveData(event);
            break;
        }
        default:
            break;
        }
    };
};
} // namespace rnoh