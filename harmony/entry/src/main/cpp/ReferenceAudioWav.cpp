#include <napi/native_api.h>
#include <multimedia/player_framework/native_avsource.h>
#include <multimedia/player_framework/native_avdemuxer.h>
#include <multimedia/player_framework/native_avcodec_audiocodec.h>
#include <multimedia/player_framework/native_avbuffer.h>
#include <multimedia/player_framework/native_avformat.h>
#include <chrono>
#include <condition_variable>
#include <cstring>
#include <deque>
#include <mutex>
#include <stdexcept>
#include <vector>

namespace {
struct Buffer { uint32_t index; OH_AVBuffer *value; };
struct Session {
    std::mutex mutex;
    std::condition_variable ready;
    std::deque<Buffer> inputs, outputs;
    bool failed = false;
    OH_AVSource *source = nullptr;
    OH_AVDemuxer *demuxer = nullptr;
    OH_AVCodec *decoder = nullptr;
    ~Session() {
        // 销毁解码器会等待回调退出；回调状态必须比解码器活得更久。
        if (decoder) { OH_AudioCodec_Stop(decoder); OH_AudioCodec_Destroy(decoder); }
        if (demuxer) OH_AVDemuxer_Destroy(demuxer);
        if (source) OH_AVSource_Destroy(source);
    }
};
void Check(bool ok) { if (!ok) throw std::runtime_error("音频解码失败或格式不受支持"); }
void Error(OH_AVCodec *, int32_t, void *p) {
    auto &s = *static_cast<Session *>(p);
    std::lock_guard<std::mutex> lock(s.mutex); s.failed = true; s.ready.notify_one();
}
void Changed(OH_AVCodec *, OH_AVFormat *, void *) {}
void Input(OH_AVCodec *, uint32_t i, OH_AVBuffer *b, void *p) {
    auto &s = *static_cast<Session *>(p);
    std::lock_guard<std::mutex> lock(s.mutex); s.inputs.push_back({i,b}); s.ready.notify_one();
}
void Output(OH_AVCodec *, uint32_t i, OH_AVBuffer *b, void *p) {
    auto &s = *static_cast<Session *>(p);
    std::lock_guard<std::mutex> lock(s.mutex); s.outputs.push_back({i,b}); s.ready.notify_one();
}
void Put(std::vector<uint8_t> &v, size_t offset, uint32_t n, size_t bytes) {
    for (size_t i = 0; i < bytes; ++i) v[offset+i] = (n >> (8*i)) & 255;
}
std::vector<uint8_t> Header(std::vector<uint8_t> wav, int rate, int channels) {
    Check(rate > 0 && channels > 0 && wav.size() > 44 && (wav.size()-44) % (channels*2) == 0);
    memcpy(wav.data(), "RIFF", 4); Put(wav,4,wav.size()-8,4);
    memcpy(wav.data()+8,"WAVEfmt ",8); Put(wav,16,16,4); Put(wav,20,1,2);
    Put(wav,22,channels,2); Put(wav,24,rate,4); Put(wav,28,rate*channels*2,4);
    Put(wav,32,channels*2,2); Put(wav,34,16,2);
    memcpy(wav.data()+36,"data",4); Put(wav,40,wav.size()-44,4); return wav;
}
// 保留采样率和声道，仅接受交错的 16 位 PCM；不静默误标其他解码输出。
std::vector<uint8_t> Decode(int fd, int64_t size) {
    Check(size > 0 && size <= 5*1024*1024);
    Session s;
    s.source = OH_AVSource_CreateWithFD(fd, 0, size); Check(s.source);
    OH_AVFormat *meta = OH_AVSource_GetSourceFormat(s.source); Check(meta);
    int32_t tracks = 0; OH_AVFormat_GetIntValue(meta, OH_MD_KEY_TRACK_COUNT, &tracks);
    OH_AVFormat_Destroy(meta);
    OH_AVFormat *format = nullptr; int track = -1;
    for (int i = 0; i < tracks; ++i) {
        auto f = OH_AVSource_GetTrackFormat(s.source, i);
        int32_t type = -1;
        if (f && OH_AVFormat_GetIntValue(f, OH_MD_KEY_TRACK_TYPE, &type) && type == MEDIA_TYPE_AUD) {
            format = f; track = i; break;
        }
        if (f) OH_AVFormat_Destroy(f);
    }
    Check(format);
    const char *mime = nullptr;
    OH_AVFormat_GetStringValue(format, OH_MD_KEY_CODEC_MIME, &mime);
    // PCM WAV 无需压缩解码器，直接解封装并重新生成规范文件头。
    if (mime && strcmp(mime, "audio/raw") == 0) {
        int32_t rate = 0, channels = 0, sample = -1;
        OH_AVFormat_GetIntValue(format, OH_MD_KEY_AUD_SAMPLE_RATE, &rate);
        OH_AVFormat_GetIntValue(format, OH_MD_KEY_AUD_CHANNEL_COUNT, &channels);
        OH_AVFormat_GetIntValue(format, OH_MD_KEY_AUDIO_SAMPLE_FORMAT, &sample);
        OH_AVFormat_Destroy(format);
        Check(sample == SAMPLE_S16LE && rate > 0 && rate <= 192000 && channels > 0 && channels <= 2);
        s.demuxer = OH_AVDemuxer_CreateWithSource(s.source); Check(s.demuxer);
        Check(OH_AVDemuxer_SelectTrackByID(s.demuxer, track) == AV_ERR_OK);
        auto buffer = OH_AVBuffer_Create(1024*1024); Check(buffer);
        std::vector<uint8_t> wav(44,0);
        try {
            bool eos = false;
            while (!eos) {
                Check(OH_AVDemuxer_ReadSampleBuffer(s.demuxer, track, buffer) == AV_ERR_OK);
                OH_AVCodecBufferAttr attr{}; Check(OH_AVBuffer_GetBufferAttr(buffer,&attr) == AV_ERR_OK);
                Check(attr.size >= 0 && attr.offset >= 0 && int64_t(attr.offset)+attr.size <= OH_AVBuffer_GetCapacity(buffer));
                Check(wav.size()+attr.size <= 5*1024*1024 && wav.size()-44+attr.size <= int64_t(rate)*channels*2*20);
                if (attr.size) {
                    auto data = OH_AVBuffer_GetAddr(buffer); Check(data);
                    wav.insert(wav.end(),data+attr.offset,data+attr.offset+attr.size);
                }
                eos = (attr.flags & AVCODEC_BUFFER_FLAGS_EOS) != 0;
                Check(eos || attr.size > 0);
            }
        } catch (...) { OH_AVBuffer_Destroy(buffer); throw; }
        OH_AVBuffer_Destroy(buffer); return Header(std::move(wav),rate,channels);
    }
    s.decoder = mime ? OH_AudioCodec_CreateByMime(mime, false) : nullptr;
    if (!s.decoder) { OH_AVFormat_Destroy(format); Check(false); }
    OH_AVFormat_SetIntValue(format, OH_MD_KEY_AUDIO_SAMPLE_FORMAT, SAMPLE_S16LE);
    auto configured = OH_AudioCodec_Configure(s.decoder, format);
    OH_AVFormat_Destroy(format); Check(configured == AV_ERR_OK);
    s.demuxer = OH_AVDemuxer_CreateWithSource(s.source); Check(s.demuxer);
    Check(OH_AVDemuxer_SelectTrackByID(s.demuxer, track) == AV_ERR_OK);
    OH_AVCodecCallback cb = {Error, Changed, Input, Output};
    Check(OH_AudioCodec_RegisterCallback(s.decoder, cb, &s) == AV_ERR_OK);
    Check(OH_AudioCodec_Prepare(s.decoder) == AV_ERR_OK);
    Check(OH_AudioCodec_Start(s.decoder) == AV_ERR_OK);
    std::vector<uint8_t> wav(44, 0);
    bool sentEos = false, done = false; int32_t rate = 0, channels = 0;
    auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(30);
    while (!done) {
        Buffer b{}; bool output = false;
        {
            std::unique_lock<std::mutex> lock(s.mutex);
            Check(s.ready.wait_until(lock, deadline, [&] { return s.failed || !s.outputs.empty() || (!sentEos && !s.inputs.empty()); }));
            Check(!s.failed);
            output = !s.outputs.empty();
            auto &queue = output ? s.outputs : s.inputs; b = queue.front(); queue.pop_front();
        }
        if (!output) {
            Check(OH_AVDemuxer_ReadSampleBuffer(s.demuxer, track, b.value) == AV_ERR_OK);
            OH_AVCodecBufferAttr attr{}; Check(OH_AVBuffer_GetBufferAttr(b.value, &attr) == AV_ERR_OK);
            sentEos = (attr.flags & AVCODEC_BUFFER_FLAGS_EOS) != 0;
            Check(OH_AudioCodec_PushInputBuffer(s.decoder, b.index) == AV_ERR_OK);
        } else {
            OH_AVCodecBufferAttr attr{}; Check(OH_AVBuffer_GetBufferAttr(b.value, &attr) == AV_ERR_OK);
            auto desc = OH_AudioCodec_GetOutputDescription(s.decoder); Check(desc);
            int32_t r = 0, c = 0, sample = -1;
            OH_AVFormat_GetIntValue(desc, OH_MD_KEY_AUD_SAMPLE_RATE, &r);
            OH_AVFormat_GetIntValue(desc, OH_MD_KEY_AUD_CHANNEL_COUNT, &c);
            OH_AVFormat_GetIntValue(desc, OH_MD_KEY_AUDIO_SAMPLE_FORMAT, &sample);
            Check(sample == SAMPLE_S16LE && r > 0 && r <= 192000 && c > 0 && c <= 2);
            Check(rate == 0 || (rate == r && channels == c)); rate = r; channels = c;
            Check(attr.size >= 0 && attr.offset >= 0 && attr.offset + int64_t(attr.size) <= OH_AVBuffer_GetCapacity(b.value));
            Check(wav.size() + attr.size <= 5*1024*1024);
            Check(wav.size() - 44 + attr.size <= int64_t(rate)*channels*2*20);
            if (attr.size) {
                auto data = OH_AVBuffer_GetAddr(b.value); Check(data);
                wav.insert(wav.end(), data + attr.offset, data + attr.offset + attr.size);
            }
            done = (attr.flags & AVCODEC_BUFFER_FLAGS_EOS) != 0;
            Check(OH_AudioCodec_FreeOutputBuffer(s.decoder, b.index) == AV_ERR_OK);
        }
    }
    return Header(std::move(wav),rate,channels);
}
struct Job { napi_async_work work; napi_deferred deferred; int fd; int64_t size; std::vector<uint8_t> bytes; std::string error; };
void Run(napi_env, void *p) {
    auto &j = *static_cast<Job *>(p);
    try { j.bytes = Decode(j.fd,j.size); } catch (const std::exception &e) { j.error = e.what(); }
}
void Complete(napi_env env, napi_status status, void *p) {
    auto j = static_cast<Job *>(p); napi_value result;
    if (status != napi_ok || !j->error.empty()) {
        napi_value message; napi_create_string_utf8(env,"参考录音转 WAV 失败，请使用有效的 20 秒以内、5MB 以内录音",NAPI_AUTO_LENGTH,&message);
        napi_create_error(env,nullptr,message,&result); napi_reject_deferred(env,j->deferred,result);
    } else {
        void *data; napi_create_arraybuffer(env,j->bytes.size(),&data,&result);
        memcpy(data,j->bytes.data(),j->bytes.size()); napi_resolve_deferred(env,j->deferred,result);
    }
    napi_delete_async_work(env,j->work); delete j;
}
napi_value Convert(napi_env env, napi_callback_info info) {
    napi_value args[2], promise, name; size_t count = 2;
    napi_get_cb_info(env,info,&count,args,nullptr,nullptr);
    auto j = new Job{};
    if (count != 2 || napi_get_value_int32(env,args[0],&j->fd) != napi_ok || napi_get_value_int64(env,args[1],&j->size) != napi_ok) {
        delete j; napi_throw_type_error(env,nullptr,"需要文件描述符和长度"); return nullptr;
    }
    napi_create_promise(env,&j->deferred,&promise);
    napi_create_string_utf8(env,"convertReferenceWav",NAPI_AUTO_LENGTH,&name);
    napi_create_async_work(env,nullptr,name,Run,Complete,j,&j->work); napi_queue_async_work(env,j->work); return promise;
}
napi_value Init(napi_env env,napi_value exports) {
    napi_property_descriptor prop = {"convert",nullptr,Convert,nullptr,nullptr,nullptr,napi_default,nullptr};
    napi_define_properties(env,exports,1,&prop); return exports;
}
napi_module module = {1,0,nullptr,Init,"reference_wav",nullptr,{0}};
}
extern "C" __attribute__((constructor)) void RegisterReferenceWav() { napi_module_register(&module); }
