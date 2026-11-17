# IndexTTS 2.0 / 2.5 中转接口与 API 手册

## 版本选择（发布时请明确指定）

同一个脚本支持两版，对手机提供相同的任务接口；手机无需选择模型版本。将脚本放到对应 IndexTTS 项目根目录，在该目录运行：

```powershell
# IndexTTS 2.0 代码与权重
uv run api_server.py --version 2 --fp16

# IndexTTS 2.5 代码与权重
uv run api_server.py --version 2.5 --fp16

# 查看启动参数，不加载模型
uv run api_server.py --help
```

不传 `--version` 时默认 **2.5**，保留现有 2.5 用户的启动方式。不会在加载失败时自动切换版本。只延迟导入所选版本：2.0 用户无需安装或提供 `infer_v2_5.py`。如果模块或依赖缺失，脚本给出明确错误。

| 所选版本 | 推理模块 | `--fp16` 对应精度 | 请求适配 |
| --- | --- | --- | --- |
| `2` | `indextts.infer_v2` | FP16 | 不向模型传 `lang`、`duration_factor` |
| `2.5` | `indextts.infer_v2_5` | BF16；硬件不支持时用全精度 | 默认 `lang=ZH`、`duration_factor=1.0` |

启动前检查 `config.yaml` 的版本与该版必需文件，发现不匹配或缺文件立即报错，不自动下载、不覆盖配置。2.0 接受 `version: 2` 或 `version: 2.0`；无版本字段的老配置仅在具有旧版 BPE 配置且不呈现已知 2.5 词表特征时接受。2.5 必须明确声明 `version: 2.5`。这些检查不能识别人为改名或混装的所有权重，请始终使用同一版本完整的配置和权重。

默认模型目录为 `checkpoints`，配置为 `checkpoints/config.yaml`。自定义路径时同时设置环境变量，示例：

```powershell
$env:TTS_MODEL_DIR = 'D:\models\IndexTTS-2'
$env:TTS_CFG_PATH = 'D:\models\IndexTTS-2\config.yaml'
uv run api_server.py --version 2 --fp16
```

更换版本后建议使用独立的 `TTS_JOB_DIR`；若继续使用原任务目录，模型版本已纳入缓存标识，不兼容的旧任务与结果不会复用，需要重新生成，旧音频文件不删除。不能同时启动 API 与 WebUI 进行显存和速度对比。

## 低显存启动策略

CUDA 显存低于 10GB 时自动选择该版本的半精度，并在模型支持 `use_qwen_emo` 参数时跳过 QwenEmotion。参考录音、情绪参考录音和 8 维情绪向量仍可使用；未加载 QwenEmotion 时，`use_emo_text=true` 会返回明确的 422 错误。确需文字情绪推断时，可设置 `TTS_USE_QWEN_EMO=true` 后重启，这会增加模型占用。老版 2.0 若没有这个构造参数，脚本不传入该参数，保留模型原有的加载行为，并输出警告，因此不保证这类老版本也能省去情绪模型的显存。启动日志显示所选版本、设备和加载选项；推理工作线程使用 `torch.inference_mode()`，避免建立不必要的梯度图。

2.5 的 JSON 与上传接口可显式传入 `lang`、`duration_factor`。2.0 仅接受这两个字段的默认值 `ZH`、`1.0`，并在调用模型前移除它们；非默认值返回 422，不会静默忽略。切换模型或推理版本后，服务启动会将不兼容的旧排队任务和成功结果标记为失败，防止复用旧噪音；旧文件保留，需显式重新生成。手机已下载的旧噪音也需要重新生成对应片段，不能继续播放本地旧缓存。

对比性能时请分别运行 API 和 WebUI，使用相同参考音频、文本与情绪参数，区分首次加载和后续请求；已完成任务可能命中缓存，不能用缓存命中耗时衡量推理速度。此策略不保证固定显存用量或速度。

本文档描述了如何通过 HTTP 请求使用 `api_server.py` 这个代理服务。为了兼容 Node.js 以及其他不同后端或脚本程序的调用需求，本接口提供了两种调用方式：一种基于普通 JSON 格式（用于音频文件已经在服务器上的场景），另一种基于 Multipart Form-data 格式（用于需要直接上传音频二进制文件的场景）。

## 服务启动说明

在项目根目录下（`index-tts`），打开终端面板并运行下方指令启动 API 中转站：

```bash
# 标准启动（示例为 2.5，2.0 请将版本参数改为 2）
uv run api_server.py --version 2.5

# 半精度推理（2.0 为 FP16，2.5 为 BF16，实际收益需测试）
uv run api_server.py --version 2.5 --fp16
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
