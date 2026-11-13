#pragma once
#include <napi/native_api.h>
#include <functional>
#include <cstdint>
#include <cstddef>
using PcmConsumer = std::function<void(const uint8_t *, size_t, int, int)>;
using ExportCancel = std::function<void()>;
using ExportDecoder = std::function<void(int, int64_t, const PcmConsumer &, const ExportCancel &)>;
void InitChapterExport(napi_env env, napi_value exports, ExportDecoder decoder);
