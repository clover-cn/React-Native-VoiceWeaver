# IndexTTS2 中转接口与API手册

本文档描述了如何通过 HTTP 请求使用 `api_server.py` 这个代理服务。为了兼容 Node.js 以及其他不同后端或脚本程序的调用需求，本接口提供了两种调用方式：一种基于普通 JSON 格式（用于音频文件已经在服务器上的场景），另一种基于 Multipart Form-data 格式（用于需要直接上传音频二进制文件的场景）。

## 服务启动说明

在项目根目录下（`index-tts`），打开终端面板并运行下方指令启动 API 中转站：

```bash
# 标准启动（兼容性强、高稳定性启动模式）
uv run api_server.py

# 开启半精度推理启动（推荐有支持 FP16 计算能力的显卡环境使用，能显著提速并节省约一半的显存）
uv run api_server.py --fp16
```
当控制台看到 `Uvicorn running on http://0.0.0.0:8000` 时即表示服务就绪。手机与电脑连接同一局域网，在手机填写 `http://电脑局域网IP:8000/api/tts/upload`，Key 留空。服务未添加鉴权，运行在受信任局域网即可。模型加载失败会终止启动。

## 长任务接口（新版手机端）

新版手机端提交后轮询，避免一次请求等待数分钟。手机与本脚本必须配套更新；旧脚本会收到明确的升级提示，不自动回退为同步合成。

| 方法与路径 | 行为 |
| --- | --- |
| `POST /api/tts/jobs` | 接收下文上传字段，额外支持 `client_request_id`，返回 202 和任务状态；不接受 `output_path` |
| `GET /api/tts/jobs/{job_id}` | 返回任务状态、排队位置、累计耗时及失败摘要 |
| `GET /api/tts/jobs/{job_id}/audio` | 下载 WAV；未成功返回 409，任务或文件不存在返回 404 |
| `DELETE /api/tts/jobs/{job_id}` | 取消排队或运行任务 |
| `DELETE /api/tts/requests/{client_request_id}` | 即使提交响应丢失也可取消；先到的取消可阻止迟到提交执行 |

任务响应示例：

```json
{"job_id":"0123456789abcdef0123456789abcdef","status":"queued","queue_position":1,"elapsed_seconds":0.01,"error":null,"protocol_version":1}
```

状态为 `queued / running / succeeded / failed / cancelled`。相同客户端编号始终定位同一任务；同一编号配不同内容返回 409。相同文本、音频内容、情绪和模型配置复用排队、运行或成功的任务。失败后显式重试需生成新的客户端编号。单个后台线程串行推理，查询接口不受推理阻塞；只运行一个服务进程，禁止增加 workers。

手机每 3 秒查询，单次网络请求超时 30 秒。高级设置中 `IndexTTS 任务等待上限` 默认 1 小时，可设 1–24 小时。断网、下载中断、应用重启或等待超限后，恢复生成会继续查询原任务，不会主动取消远端。显式停止才发送取消；运行中的 GPU 推理会安全执行完毕，再处理后续任务，不保证即时释放 GPU。

所有任务、客户端编号映射和结果保存在工作目录的 `voiceweaver_jobs/`（可用 `TTS_JOB_DIR` 指定固定位置）。参考音频按内容哈希复用路径；缓存仅消除重复特征提取，不改变采样参数或音质，也不保证达到实时生成。启动后日志显示实际设备和 FP16 状态。服务重启后保留已完成结果、继续排队任务；正在推理的任务标记失败，允许显式重试。

首版不自动清理该目录，磁盘占用会增长。需要清理时先停止服务，再由用户手动清理专用目录；这会使手机保存的任务编号失效，需重新生成。原有 `outputs/` 和用户音频不在清理范围内。不要只删除数据库而保留锁外的另一个运行进程。

加速参数保持原有行为：`--fp16`；`TTS_USE_CUDA_KERNEL=true` 和 `TTS_USE_DEEPSPEED=true` 为显式可选项，默认关闭。此次没有降低扩散步数、改变文本分段或启用多模型并发。

## 接口地址 (Endpoints)
- **JSON调用方式**： `POST /api/tts`
- **文件直传方式**： `POST /api/tts/upload`（同步兼容接口，复用相同推理队列；参考音频与结果保存在服务专用目录）

**通用响应格式**：如果未设置 `output_path` 参数，则服务器直接返回 `audio/wav` 格式的音频文件流。如果设置了 `output_path`，服务端仅将其落盘保存到该路径，并返回如下 JSON 串以供后续操作:
```json
{
  "status": "success",
  "file_path": "outputs/gen_{random}.wav"
}
```

---

## 1. 基础调用：通过存放于服务器的音频路径 (JSON Endpoint)

**请求路径**： `POST /api/tts`
**Content-Type**: `application/json`

| 参数名 | 类型 | 是否必填 | 默认值 | 说明 |
| :--- | :---: | :---: | :---: | :--- |
| `text` | string | **是** | - | 需要合成的目标文本。 |
| `spk_audio_prompt` | string | **是** | - | 音色基准文件在服务器上的绝对或相对路径。 |
| `output_path` | string | 否 | `null` | 指定输出文件的路径。如果不提供则直接返回二进制流。 |
| `emo_audio_prompt`| string | 否 | `null` | **指定情感参考音频**在服务器上的路径。 |
| `emo_alpha` | float | 否 | `1.0` | **情感权重调节**，范围 `0.0 - 1.0`。 |
| `emo_vector` | float[]| 否 | `null` | **直接指定8维情感向量**，包含8个小数`[高兴, 愤怒, 悲伤, 害怕, 厌恶, 忧郁, 惊讶, 平静]`。 |
| `use_random` | bool | 否 | `false`| **开启随机情感**：随机产生情绪偏置。注意可能降低音色相似度。 |
| `use_emo_text` | bool | 否 | `false`| **文本推断情感**：通过大模型(Qwen3)自动推断。 |
| `emo_text` | string | 否 | `null` | **独立情感文本引导**：结合 `use_emo_text` 并使用独立于台词的另一个句子来提取情感。 |

#### 请求示例 (纯 JSON)
```json
{
  "text": "酒楼丧尽天良，开始借机竞拍房间，哎，一群蠢货。",
  "spk_audio_prompt": "examples/voice_07.wav",
  "emo_audio_prompt": "examples/emo_sad.wav",
  "emo_alpha": 0.85
}
```

---

## 2. 进阶调用：直接从 Node.js/前端 上传音频文件 (Upload Endpoint)

在许多实际场景中，我们要克隆的用户音频并没有保存在 `api_server.py` 的这台服务器硬盘上，而是通过网络客户端推上来的 Blob 或 Buffer。此时请使用 `/api/tts/upload` 接口。

**请求路径**： `POST /api/tts/upload`
**Content-Type**: `multipart/form-data`

| Form 字段名 | 类型 | 是否必填 | 默认值 | 说明 |
| :--- | :---: | :---: | :---: | :--- |
| `text` | string | **是** | - | 需要合成的目标文本。 |
| `spk_audio_file` | File | **是** | - | 上传的参考音色频文件（二进制 Blob/Buffer）。 |
| `output_path` | string | 否 | `null` | 指定输出文件的路径。如果不提供则直接返回音频流。 |
| `emo_audio_file` | File | 否 | `null` | 上传的参考情感提示文件（二进制 Blob/Buffer）。 |
| `emo_alpha` | float | 否 | `1.0` | 情感权重调节（解析为浮点数）。 |
| `emo_vector` | string | 否 | `null` | 注意：在 FromData 中须提供序列化好的 JSON 数组字符串，例如 `'[0, 0, 0, 0, 0, 0, 0.45, 0]'`。 |
| `use_random` | string | 否 | `false`| 开启随机情感 (`'true'` 或 `'false'`)。 |
| `use_emo_text` | string | 否 | `false`| 文本推断情感 (`'true'` 或 `'false'`)。 |
| `emo_text` | string | 否 | `null` | 独立情感文本引导。 |

**接口行为细节**：
服务器将 `spk_audio_file`（及 `emo_audio_file`）按内容摘要缓存到 `voiceweaver_jobs/references`，临时上传文件写入缓存后清理。参考缓存和生成结果不会自动删除，请按上述说明管理磁盘空间。

#### Node.js 调用示例 (使用 axios 和 FormData)

以下是如何在 Node.js 中封装一个请求并直接将文件上传做 TTS 推理的示范：

```javascript
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

async function uploadAndSynthesize() {
    const form = new FormData();
    
    // ======== 必填参数 ========
    form.append('text', '翻译一下，什么叫他妈的惊喜？');
    form.append('spk_audio_file', fs.createReadStream('./local_user_voice.wav')); 
    
    // ======== 选填参数举例 ========
    
    // 假设也想上传一个单独的痛苦音频作为情绪参考
    // form.append('emo_audio_file', fs.createReadStream('./sad_reference.wav'));
    // form.append('emo_alpha',  '0.7'); 
    
    // 如果直接输入 8位情感向量：需要以序列化的 JSON 字符串格式传递
    // form.append('emo_vector', JSON.stringify([0, 0, 0, 0, 0, 0, 0.45, 0])); 
    
    // 自动清理文件，这端也流式拉取
    try {
        const response = await axios.post('http://127.0.0.1:8000/api/tts/upload', form, {
            headers: {
                ...form.getHeaders() // axios 必须设置这个来识别 multipart边界
            },
            responseType: 'stream' // 希望直接接收服务端产生的音频二进制流
        });

        // 写入到本地
        const writer = fs.createWriteStream('./downloaded_result.wav');
        response.data.pipe(writer);

        writer.on('finish', () => console.log('合成成功！文件保存在 downloaded_result.wav。'));
        writer.on('error', (err) => console.error('流写入失败: ', err));
        
    } catch (error) {
        if(error.response) {
            // 解析错误原因
            let errorData = '';
            error.response.data.on('data', chunk => { errorData += chunk.toString(); });
            error.response.data.on('end', () => console.error('引擎报错:', errorData));
        } else {
            console.error("请求失败:", error.message);
        }
    }
}

uploadAndSynthesize();
```
