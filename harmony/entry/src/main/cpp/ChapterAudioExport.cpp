#include "ChapterAudioExport.h"
#include <unistd.h>
#include <sys/stat.h>
#include <atomic>
#include <cmath>
#include <cstring>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>
#include <algorithm>
#include <multimedia/player_framework/native_avsource.h>
#include <multimedia/player_framework/native_avformat.h>

namespace {
ExportDecoder decode;
struct Source { int fd; int64_t size; std::string name; };
struct Job {
    napi_async_work work{}; napi_deferred deferred{};
    std::vector<Source> sources;
    int output = -1; double gap = 1.5;
    std::string mode, manifest, error;
    std::atomic<bool> cancelled{false}; std::atomic<int> done{0};
    void Check() { if (cancelled) throw std::runtime_error("已取消下载"); }
};
Job *current = nullptr; // 仅在 ArkTS 线程读写指针，工作线程只操作其原子字段。
void Require(bool ok, const char *message) { if (!ok) throw std::runtime_error(message); }
void Write(Job &j, const void *bytes, size_t size) {
    auto p = static_cast<const uint8_t *>(bytes);
    while (size) {
        j.Check(); ssize_t count = write(j.output,p,size);
        Require(count > 0,"写入失败，请检查可用存储空间"); p += count; size -= count;
    }
}
void Put(std::vector<uint8_t> &v, uint32_t value, int count) {
    for (int i=0;i<count;++i) v.push_back((value >> (i*8)) & 255);
}
uint32_t Offset(Job &j) {
    auto value = lseek(j.output,0,SEEK_CUR);
    Require(value >= 0 && uint64_t(value) <= 0xffffffffULL,"导出文件超过容量限制，请拆分章节");
    return static_cast<uint32_t>(value);
}
// ZIP 使用 STORE 与数据描述符，逐块计算 CRC，原始音频不进行二次编码。
uint32_t Crc(uint32_t crc, const uint8_t *bytes, size_t size) {
    for (size_t i=0;i<size;++i) {
        crc ^= bytes[i];
        for (int bit=0;bit<8;++bit) crc = (crc >> 1) ^ (0xedb88320U & (0U-(crc & 1)));
    }
    return crc;
}
void Zip(Job &j) {
    std::vector<uint8_t> directory;
    auto entry = [&](const std::string &name, int fd, int64_t size, const std::string &text) {
        Require(size >= 0 && uint64_t(size) <= 0xffffffffULL && name.size() <= 65535,"ZIP 条目超过容量限制");
        auto offset = Offset(j);
        std::vector<uint8_t> header;
        Put(header,0x04034b50,4); Put(header,20,2); Put(header,0x808,2); Put(header,0,2);
        Put(header,0,2); Put(header,33,2); Put(header,0,4); Put(header,0,4); Put(header,0,4);
        Put(header,name.size(),2); Put(header,0,2);
        Write(j,header.data(),header.size()); Write(j,name.data(),name.size());
        uint32_t crc = 0xffffffffU; int64_t position = 0;
        uint8_t buffer[65536];
        while (position < size) {
            j.Check(); size_t wanted = std::min<int64_t>(sizeof(buffer),size-position);
            ssize_t count;
            if (fd >= 0) count = pread(fd,buffer,wanted,position);
            else { memcpy(buffer,text.data()+position,wanted); count = wanted; }
            Require(count > 0,"源音频读取失败，请重新生成");
            crc = Crc(crc,buffer,count); Write(j,buffer,count); position += count;
            Offset(j);
        }
        crc ^= 0xffffffffU;
        header.clear(); Put(header,0x08074b50,4); Put(header,crc,4); Put(header,size,4); Put(header,size,4);
        Write(j,header.data(),header.size());
        Put(directory,0x02014b50,4); Put(directory,20,2); Put(directory,20,2); Put(directory,0x808,2);
        Put(directory,0,2); Put(directory,0,2); Put(directory,33,2); Put(directory,crc,4);
        Put(directory,size,4); Put(directory,size,4); Put(directory,name.size(),2);
        Put(directory,0,2); Put(directory,0,2); Put(directory,0,2); Put(directory,0,2); Put(directory,0,4); Put(directory,offset,4);
        directory.insert(directory.end(),name.begin(),name.end());
    };
    Require(j.sources.size() < 65535,"片段数超过 ZIP 容量限制");
    for (auto &source : j.sources) { entry(source.name,source.fd,source.size,""); ++j.done; }
    entry("manifest.json",-1,j.manifest.size(),j.manifest);
    uint32_t offset = Offset(j); Write(j,directory.data(),directory.size()); Offset(j);
    std::vector<uint8_t> end;
    Put(end,0x06054b50,4); Put(end,0,2); Put(end,0,2); Put(end,j.sources.size()+1,2); Put(end,j.sources.size()+1,2);
    Put(end,directory.size(),4); Put(end,offset,4); Put(end,0,2); Write(j,end.data(),end.size());
}
struct PcmSink {
    Job &j; int rate=0, channels=0, previous=0;
    int64_t frames=0, samples=0;
    std::vector<uint8_t> buffer;
    explicit PcmSink(Job &job):j(job) { buffer.reserve(8192); }
    void Flush() {
        auto size = lseek(j.output,0,SEEK_CUR);
        Require(size >= 44 && uint64_t(size)+buffer.size() <= 0xffffffffULL+8,"合并音频超过 WAV 容量限制，请改用分段 ZIP");
        Write(j,buffer.data(),buffer.size()); buffer.clear();
    }
    void Sample(int sample) {
        sample = std::max(-32768,std::min(32767,sample));
        buffer.push_back(sample & 255); buffer.push_back((sample >> 8) & 255); ++samples;
        if (buffer.size() == 8192) Flush();
    }
    void Accept(const uint8_t *bytes, size_t size, int r, int c) {
        j.Check();
        Require(r > 0 && r <= 192000 && c > 0 && c <= 8 && (rate == 0 || (rate == r && channels == c)),"音频采样格式不支持");
        rate=r; channels=c; Require(size % (c*2) == 0,"音频 PCM 数据不完整");
        for (size_t i=0;i<size;i+=c*2) {
            int sum=0;
            for (int channel=0;channel<c;++channel) sum += static_cast<int16_t>(bytes[i+channel*2] | (bytes[i+channel*2+1] << 8));
            int value=sum/c;
            if (frames == 0) Sample(value);
            else while (samples*int64_t(rate) <= frames*24000) {
                double fraction=(samples*double(rate)-(frames-1)*24000.0)/24000.0;
                Sample(std::lround(previous+(value-previous)*fraction));
            }
            previous=value; ++frames;
        }
    }
    void Finish() {
        Require(frames > 0,"音频解码结果为空");
        while (samples < std::llround(frames*24000.0/rate)) Sample(previous);
        Flush();
    }
};
void Wav(Job &j) {
    double duration = (j.sources.size()-1)*j.gap;
    for (auto &source : j.sources) {
        j.Check();
        auto media = OH_AVSource_CreateWithFD(source.fd,0,source.size);
        Require(media,"音频文件无效，请重新生成");
        auto format = OH_AVSource_GetSourceFormat(media); int64_t micros=0;
        if (format) { OH_AVFormat_GetLongValue(format,OH_MD_KEY_DURATION,&micros); OH_AVFormat_Destroy(format); }
        OH_AVSource_Destroy(media); duration += std::max<int64_t>(0,micros)/1000000.0;
    }
    Require(std::ceil(duration*24000)*2 <= 0xffffffffULL-36,"合并音频超过 WAV 容量限制，请改用分段 ZIP");
    uint8_t zero[8192]{}; Write(j,zero,44);
    for (size_t i=0;i<j.sources.size();++i) {
        if (i) {
            int64_t remaining=std::llround(j.gap*24000)*2;
            while (remaining) {
                size_t count=std::min<int64_t>(sizeof(zero),remaining);
                Require(uint64_t(lseek(j.output,0,SEEK_CUR))+count <= 0xffffffffULL+8,"合并音频超过 WAV 容量限制，请改用分段 ZIP");
                Write(j,zero,count); remaining-=count;
            }
        }
        auto &source=j.sources[i]; PcmSink sink(j);
        decode(source.fd,source.size,[&](const uint8_t *p,size_t size,int rate,int channels) { sink.Accept(p,size,rate,channels); },[&] { j.Check(); });
        sink.Finish(); ++j.done;
    }
    auto length=lseek(j.output,0,SEEK_CUR);
    Require(length > 44 && uint64_t(length) <= 0xffffffffULL+8,"WAV 容量超限");
    std::vector<uint8_t> h;
    auto text=[&](const char *s,size_t n) { h.insert(h.end(),s,s+n); };
    text("RIFF",4); Put(h,length-8,4); text("WAVEfmt ",8); Put(h,16,4); Put(h,1,2); Put(h,1,2);
    Put(h,24000,4); Put(h,48000,4); Put(h,2,2); Put(h,16,2); text("data",4); Put(h,length-44,4);
    Require(lseek(j.output,0,SEEK_SET) == 0,"WAV 文件头写入失败"); Write(j,h.data(),h.size());
}
void Run(napi_env,void *p) {
    auto &j=*static_cast<Job *>(p);
    try { if (j.mode == "zip") Zip(j); else Wav(j); j.Check(); Require(fsync(j.output) == 0,"文件保存失败，请检查可用空间"); }
    catch (const std::exception &e) { j.error=e.what(); }
}
void Complete(napi_env env,napi_status status,void *p) {
    auto j=static_cast<Job *>(p); napi_value result;
    if (status != napi_ok || !j->error.empty()) {
        napi_value message; napi_create_string_utf8(env,j->error.empty() ? "音频导出失败" : j->error.c_str(),NAPI_AUTO_LENGTH,&message);
        napi_create_error(env,nullptr,message,&result); napi_reject_deferred(env,j->deferred,result);
    } else { napi_get_undefined(env,&result); napi_resolve_deferred(env,j->deferred,result); }
    current=nullptr; napi_delete_async_work(env,j->work); delete j;
}
std::string String(napi_env env,napi_value value) {
    size_t size=0; Require(napi_get_value_string_utf8(env,value,nullptr,0,&size) == napi_ok,"导出字符串参数无效");
    std::vector<char> bytes(size+1); napi_get_value_string_utf8(env,value,bytes.data(),bytes.size(),&size); return std::string(bytes.data(),size);
}
napi_value Start(napi_env env,napi_callback_info info) {
    std::unique_ptr<Job> j(new Job{});
    try {
        Require(!current,"已有音频导出任务");
        napi_value args[7],promise,name; size_t count=7;
        napi_get_cb_info(env,info,&count,args,nullptr,nullptr); Require(count == 7,"导出参数不完整");
        uint32_t length=0; Require(napi_get_array_length(env,args[0],&length) == napi_ok && length > 0 && length < 65535,"片段数量无效");
        for (uint32_t i=0;i<length;++i) {
            napi_value fd,size,name; Source source{};
            napi_get_element(env,args[0],i,&fd); napi_get_element(env,args[1],i,&size); napi_get_element(env,args[2],i,&name);
            Require(napi_get_value_int32(env,fd,&source.fd) == napi_ok && napi_get_value_int64(env,size,&source.size) == napi_ok,"源文件参数无效");
            source.name=String(env,name); j->sources.push_back(source);
        }
        Require(napi_get_value_int32(env,args[3],&j->output) == napi_ok,"输出文件无效");
        j->mode=String(env,args[4]);
        Require(j->mode == "zip" || j->mode == "wav","导出模式无效");
        Require(napi_get_value_double(env,args[5],&j->gap) == napi_ok && std::isfinite(j->gap) && j->gap >= 0 && j->gap <= 30,"间隔无效");
        j->manifest=String(env,args[6]);
        napi_create_promise(env,&j->deferred,&promise); napi_create_string_utf8(env,"chapterAudioExport",NAPI_AUTO_LENGTH,&name);
        Require(napi_create_async_work(env,nullptr,name,Run,Complete,j.get(),&j->work) == napi_ok,"无法创建导出任务");
        if (napi_queue_async_work(env,j->work) != napi_ok) { napi_delete_async_work(env,j->work); throw std::runtime_error("无法启动导出任务"); }
        current=j.release(); return promise;
    } catch (const std::exception &e) { napi_throw_error(env,nullptr,e.what()); return nullptr; }
}
napi_value Cancel(napi_env env,napi_callback_info) {
    if (current) current->cancelled=true;
    napi_value result; napi_get_undefined(env,&result); return result;
}
napi_value Progress(napi_env env,napi_callback_info) {
    napi_value result; napi_create_int32(env,current ? current->done.load() : 0,&result); return result;
}
}
void InitChapterExport(napi_env env,napi_value exports,ExportDecoder decoder) {
    decode=std::move(decoder);
    napi_property_descriptor props[] = {
        {"exportChapter",nullptr,Start,nullptr,nullptr,nullptr,napi_default,nullptr},
        {"cancelChapterExport",nullptr,Cancel,nullptr,nullptr,nullptr,napi_default,nullptr},
        {"chapterExportProgress",nullptr,Progress,nullptr,nullptr,nullptr,napi_default,nullptr}
    };
    napi_define_properties(env,exports,3,props);
}
