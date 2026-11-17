"""IndexTTS 单进程任务服务；复制本文件到 index-tts 根目录后用 uv run 启动。"""

import asyncio
import argparse
import importlib
import inspect
from contextlib import asynccontextmanager, contextmanager
import hashlib
import json
import logging
import math
import os
from pathlib import Path
import shutil
import sqlite3
import sys
import threading
import time
import uuid

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
from typing import Optional, List

log = logging.getLogger("uvicorn.error")


def startup_args(argv=None):
    """显式选择模型版本；不在加载失败后自动切换推理实现。"""
    parser = argparse.ArgumentParser(description="IndexTTS 2.0 / 2.5 任务服务")
    parser.add_argument("--version", choices=("2", "2.5"), default="2.5")
    parser.add_argument("--fp16", action="store_true", help="2.0 使用 FP16；2.5 使用 BF16，不支持时用全精度")
    return parser.parse_args(sys.argv[1:] if argv is None else argv)


def validate_model_files(version, cfg_path, model_dir):
    """加载前检查配置版本及本地必需文件，不自动下载或更改配置。"""
    import yaml
    cfg_path, model_dir = Path(cfg_path), Path(model_dir)
    if not cfg_path.is_file():
        raise RuntimeError(f"模型配置不存在：{cfg_path}")
    config = yaml.safe_load(cfg_path.read_text(encoding="utf-8"))
    if not isinstance(config, dict):
        raise RuntimeError("模型配置必须是 YAML 对象")
    declared = str(config.get("version", ""))
    declared = "2" if declared == "2.0" else declared
    if not declared and version == "2" and config.get("dataset", {}).get("bpe_model") and config.get("gpt", {}).get("number_text_tokens", 0) != 60509:
        declared = "2"
    if declared != version:
        raise RuntimeError(f"所选版本 {version} 与配置版本 {declared or '无法识别'} 不匹配，请选择正确版本及对应权重目录。")
    required = [config.get("gpt_checkpoint", "gpt.pth"), config.get("s2mel_checkpoint", "s2mel.pth"), config.get("w2v_stat", "wav2vec2bert_stats.pt")]
    required += ["codec.pth", "multilingual_zh_ja_yue_char_del.tiktoken"] if version == "2.5" else [config.get("dataset", {}).get("bpe_model", "bpe.model")]
    missing = [str(name) for name in required if not isinstance(name, str) or not (model_dir / name).is_file()]
    if missing:
        raise RuntimeError("模型目录缺少必需文件：" + ", ".join(missing))


def model_class(version):
    """只导入所选版本，允许旧项目没有 2.5 模块。"""
    module = "indextts.infer_v2_5" if version == "2.5" else "indextts.infer_v2"
    try:
        return importlib.import_module(module).IndexTTS2
    except ImportError as error:
        raise RuntimeError(f"无法加载 {module}，请确认该版本代码及依赖已安装；不会自动切换版本。") from error


def supported_options(model, options):
    """旧版 2.0 没有可选情绪加载参数时，保留原行为并明确记录。"""
    options = dict(options)
    if "use_qwen_emo" not in inspect.signature(model).parameters:
        options.pop("use_qwen_emo", None)
        log.warning("当前模型类不支持 use_qwen_emo，保留该模型原有情绪模型加载行为。")
    return options


def inference_params(version, params):
    """统一请求协议；2.0 不接收 2.5 专属参数，非默认值明确拒绝。"""
    params = dict(params)
    lang = params.pop("lang", "ZH")
    duration = params.pop("duration_factor", 1.0)
    if not math.isfinite(duration) or duration <= 0:
        raise HTTPException(422, "duration_factor 必须为有限正数")
    if version == "2":
        if lang.upper() != "ZH" or duration != 1.0:
            raise HTTPException(422, "IndexTTS 2.0 不支持 lang 或 duration_factor 控制，请使用默认 ZH 和 1.0。")
    else:
        params.update(lang=lang, duration_factor=duration)
    return params


def model_options(torch_module, argv=None, environ=None, version="2.5"):
    """对齐 WebUI：低于 10GB 的显卡默认不加载文字情绪模型。"""
    argv = sys.argv if argv is None else argv
    environ = os.environ if environ is None else environ
    vram = (torch_module.cuda.get_device_properties(0).total_memory / (1024 ** 3)
            if torch_module.cuda.is_available() else None)
    low_vram = vram is not None and vram < 10
    qwen = environ.get("TTS_USE_QWEN_EMO")
    if qwen is not None and qwen.lower() not in ("true", "false"):
        raise ValueError("TTS_USE_QWEN_EMO 必须为 true 或 false")
    half = "--fp16" in argv or low_vram
    return {("use_fp16" if version == "2" else "use_bf16"): half if version == "2" else half and torch_module.cuda.is_available() and torch_module.cuda.is_bf16_supported(),
            "use_qwen_emo": qwen.lower() == "true" if qwen is not None else not low_vram,
            "use_cuda_kernel": environ.get("TTS_USE_CUDA_KERNEL", "false").lower() == "true",
            "use_deepspeed": environ.get("TTS_USE_DEEPSPEED", "false").lower() == "true"}


class JobStore:
    """事务化保存任务；仅工作线程可以调用模型，HTTP 线程仅操作状态。"""

    def __init__(self, root, model_identity, infer):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.audio = self.root / "references"
        self.audio.mkdir(exist_ok=True)
        (self.root / "results").mkdir(exist_ok=True)
        self.db = self.root / "jobs.sqlite3"
        self.identity = model_identity
        self.infer = infer
        self.condition = threading.Condition(threading.RLock())
        self.stopping = False
        self.worker = None
        with self.connection() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("""CREATE TABLE IF NOT EXISTS jobs (
                seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
                fingerprint TEXT NOT NULL, params TEXT NOT NULL, state TEXT NOT NULL,
                created REAL NOT NULL, started REAL, finished REAL, error TEXT,
                result TEXT NOT NULL)""")
            db.execute("CREATE INDEX IF NOT EXISTS job_fingerprint ON jobs(fingerprint, state)")
            db.execute("""CREATE TABLE IF NOT EXISTS requests (
                client_id TEXT PRIMARY KEY, job_id TEXT NOT NULL, fingerprint TEXT NOT NULL)""")
            db.execute("CREATE TABLE IF NOT EXISTS cancellations(client_id TEXT PRIMARY KEY)")
            db.execute("UPDATE jobs SET state='failed', error=?, finished=? WHERE state='running'",
                       ("服务重启中断了推理，请显式重试。", time.time()))
            # 模型或推理版本改变后，旧结果不可当作新模型的合成结果继续复用。
            for row in db.execute("SELECT id,params,fingerprint FROM jobs WHERE state IN ('queued','succeeded')").fetchall():
                if self.fingerprint(json.loads(row["params"])) != row["fingerprint"]:
                    db.execute("UPDATE jobs SET state='failed', error=?, finished=? WHERE id=?",
                               ("模型或推理版本已更改，请重新生成音频。", time.time(), row["id"]))

    def fingerprint(self, params):
        """将推理版本和参数共同纳入结果身份，避免复用不兼容音频。"""
        return hashlib.sha256(json.dumps([self.identity, params], sort_keys=True,
            ensure_ascii=False, allow_nan=False).encode("utf-8")).hexdigest()

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.db, timeout=30)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def cache(self, source):
        """按文件内容复用参考路径，不删除调用方的原文件。"""
        digest = hashlib.sha256()
        with open(source, "rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        target = self.audio / (digest.hexdigest() + ".wav")
        with self.condition:
            # 服务运行期间缓存目录可能被外部清理，每次写入前确保目录存在。
            self.audio.mkdir(parents=True, exist_ok=True)
            if not target.exists():
                temp = target.with_suffix("." + uuid.uuid4().hex + ".tmp")
                try:
                    shutil.copyfile(source, temp)
                    os.replace(temp, target)
                finally:
                    # 仅清理本次写入的临时文件，不触碰已有录音和缓存。
                    try:
                        temp.unlink(missing_ok=True)
                    except OSError:
                        log.warning("参考音频临时文件清理失败", exc_info=True)
        return str(target)

    def submit(self, params, client_id=None):
        params = dict(params)
        params.pop("output_path", None)
        for name in ("spk_audio_prompt", "emo_audio_prompt"):
            if params.get(name):
                params[name] = self.cache(params[name])
        fingerprint = self.fingerprint(params)
        with self.condition, self.connection() as db:
            previous = db.execute("SELECT * FROM requests WHERE client_id=?", (client_id,)).fetchone() if client_id else None
            if previous:
                if previous["fingerprint"] != fingerprint:
                    raise HTTPException(409, "客户端请求编号已用于不同的合成参数。")
                return self.status(previous["job_id"])
            cancelled = bool(client_id and db.execute("SELECT 1 FROM cancellations WHERE client_id=?", (client_id,)).fetchone())
            existing = None if cancelled else db.execute("""SELECT id FROM jobs WHERE fingerprint=?
                AND state IN ('queued','running','succeeded') ORDER BY seq DESC LIMIT 1""",
                (fingerprint,)).fetchone()
            job_id = existing["id"] if existing else uuid.uuid4().hex
            if not existing:
                db.execute("""INSERT INTO jobs(id,fingerprint,params,state,created,result)
                    VALUES(?,?,?,'queued',?,?)""", (job_id, fingerprint,
                    json.dumps(params, ensure_ascii=False), time.time(),
                    str(self.root / "results" / (job_id + ".wav"))))
                if cancelled:
                    db.execute("UPDATE jobs SET state='cancelled', finished=? WHERE id=?", (time.time(), job_id))
            if client_id:
                db.execute("INSERT INTO requests VALUES(?,?,?)", (client_id, job_id, fingerprint))
            db.commit()
            self.condition.notify_all()
        return self.status(job_id)

    def status(self, job_id):
        with self.condition, self.connection() as db:
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            if not row:
                raise HTTPException(404, "任务不存在或已失效。")
            position = db.execute("SELECT count(*) FROM jobs WHERE state IN ('queued','running') AND seq < ?",
                                  (row["seq"],)).fetchone()[0] + 1 if row["state"] == "queued" else 0
            return {"job_id": row["id"], "status": row["state"], "queue_position": position,
                    "elapsed_seconds": round((row["finished"] or time.time()) - row["created"], 2),
                    "error": row["error"], "protocol_version": 1}

    def result(self, job_id):
        status = self.status(job_id)
        if status["status"] != "succeeded":
            raise HTTPException(409, "任务尚未成功完成。")
        with self.connection() as db:
            path = db.execute("SELECT result FROM jobs WHERE id=?", (job_id,)).fetchone()[0]
        if not Path(path).is_file():
            with self.condition, self.connection() as db:
                db.execute("UPDATE jobs SET state='failed', error=? WHERE id=?",
                           ("音频结果文件已失效，请显式重试。", job_id))
            raise HTTPException(404, "音频结果文件已失效，请显式重试。")
        return path

    def cancel(self, job_id):
        self.status(job_id)
        with self.condition, self.connection() as db:
            db.execute("UPDATE jobs SET state='cancelled', finished=? WHERE id=? AND state IN ('queued','running')",
                       (time.time(), job_id))
        return self.status(job_id)

    def cancel_request(self, client_id):
        """即使提交响应丢失，也能取消；先到的取消以墓碑阻止迟到的提交执行。"""
        with self.condition, self.connection() as db:
            db.execute("INSERT OR IGNORE INTO cancellations VALUES(?)", (client_id,))
            row = db.execute("SELECT job_id FROM requests WHERE client_id=?", (client_id,)).fetchone()
            if row:
                db.execute("UPDATE jobs SET state='cancelled', finished=? WHERE id=? AND state IN ('queued','running')",
                           (time.time(), row[0]))
        return {"status": "cancelled", "client_request_id": client_id}

    def start(self):
        self.worker = threading.Thread(target=self.run, name="indextts-inference", daemon=True)
        self.worker.start()

    def close(self):
        with self.condition:
            self.stopping = True
            self.condition.notify_all()
        if self.worker:
            self.worker.join()

    def run(self):
        while True:
            with self.condition:
                if self.stopping:
                    return
                with self.connection() as db:
                    row = db.execute("SELECT * FROM jobs WHERE state='queued' ORDER BY seq LIMIT 1").fetchone()
                    if row:
                        db.execute("UPDATE jobs SET state='running', started=? WHERE id=?", (time.time(), row["id"]))
                if not row:
                    self.condition.wait(timeout=1)
                    continue
            try:
                # 排队后结果目录也可能被外部清理，推理前恢复专用目录。
                Path(row["result"]).parent.mkdir(parents=True, exist_ok=True)
                self.infer(**json.loads(row["params"]), output_path=row["result"])
                if not Path(row["result"]).is_file():
                    raise RuntimeError("模型未生成音频文件")
                state, error = "succeeded", None
            except Exception:
                log.exception("IndexTTS 任务失败 id=%s", row["id"])
                state, error = "failed", "模型推理失败，请查看服务端日志并显式重试。"
            with self.condition, self.connection() as db:
                db.execute("UPDATE jobs SET state=?, error=?, finished=? WHERE id=? AND state='running'",
                           (state, error, time.time(), row["id"]))


@asynccontextmanager
async def single_instance(root):
    """用系统文件锁阻止多进程各自加载模型和消费同一个队列。"""
    Path(root).mkdir(parents=True, exist_ok=True)
    lock = open(Path(root) / "server.lock", "a+b")
    try:
        lock.seek(0)
        if os.name == "nt":
            import msvcrt
            if not lock.read(1):
                lock.write(b"0")
                lock.flush()
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        lock.close()
        raise RuntimeError("同一任务目录只能运行一个 IndexTTS 服务进程；请勿增加 workers。")
    try:
        yield
    finally:
        lock.close()


@asynccontextmanager
async def lifespan(app):
    args = startup_args()
    root = Path(os.getenv("TTS_JOB_DIR", "voiceweaver_jobs")).resolve()
    async with single_instance(root):
        import torch
        cfg = Path(os.getenv("TTS_CFG_PATH", "checkpoints/config.yaml")).resolve()
        model_dir = Path(os.getenv("TTS_MODEL_DIR", "checkpoints")).resolve()
        validate_model_files(args.version, cfg, model_dir)
        IndexTTS2 = model_class(args.version)
        options = supported_options(IndexTTS2, model_options(torch, version=args.version))
        tts = IndexTTS2(cfg_path=str(cfg), model_dir=str(model_dir), **options)
        app.state.model_version = args.version
        app.state.use_qwen_emo = options.get("use_qwen_emo", True)
        log.info("IndexTTS %s 已加载 device=%s options=%s", args.version, tts.device, options)
        if not app.state.use_qwen_emo:
            log.info("已跳过 QwenEmotion：支持参考音频和情绪向量；文字情绪推断已禁用。")
        weights = [(str(p.relative_to(model_dir)), p.stat().st_size, p.stat().st_mtime_ns)
                   for p in sorted(model_dir.rglob("*")) if p.is_file() and p.suffix in (".pth", ".pt", ".safetensors", ".bin")]
        identity = [args.version, "api-dual-1", str(model_dir), hashlib.sha256(cfg.read_bytes()).hexdigest(), weights, options]
        def infer(**params):
            # 梯度模式按线程隔离，必须在实际推理线程内关闭梯度记录。
            with torch.inference_mode():
                return tts.infer(**inference_params(args.version, params))
        store = JobStore(root, identity, infer)
        app.state.jobs = store
        store.start()
        try:
            yield
        finally:
            await asyncio.to_thread(store.close)


app = FastAPI(title="IndexTTS2 durable jobs", lifespan=lifespan)


@app.exception_handler(OSError)
async def storage_error(request, error):
    """存储失败返回可读 JSON；具体本机路径只留在服务端日志。"""
    log.error("IndexTTS 服务端音频存储失败", exc_info=(type(error), error, error.__traceback__))
    return JSONResponse(status_code=503, content={
        "detail": "服务端音频缓存存储不可用，请检查 voiceweaver_jobs 目录及写入权限；这不是手机缺少参考音频。"
    })


class TTSRequest(BaseModel):
    lang: str = "ZH"
    duration_factor: float = Field(1.0, gt=0)
    text: str = Field(..., min_length=1)
    spk_audio_prompt: str
    output_path: Optional[str] = None
    emo_audio_prompt: Optional[str] = None
    emo_alpha: float = Field(1.0, ge=0, le=1)
    emo_vector: Optional[List[float]] = None
    use_random: bool = False
    use_emo_text: bool = False
    emo_text: Optional[str] = None
    verbose: bool = False


def validate_vector(vector):
    if vector is not None and (len(vector) != 8 or any(not math.isfinite(x) for x in vector)):
        raise HTTPException(422, "emo_vector 必须包含 8 个有限数值。")


async def uploaded_params(
    text: str = Form(...), spk_audio_file: UploadFile = File(...),
    emo_audio_file: Optional[UploadFile] = File(None), emo_alpha: float = Form(1.0, ge=0, le=1),
    emo_vector: Optional[str] = Form(None), use_random: bool = Form(False),
    use_emo_text: bool = Form(False), emo_text: Optional[str] = Form(None),
    verbose: bool = Form(False), client_request_id: Optional[str] = Form(None, max_length=128),
    output_path: Optional[str] = Form(None),
    lang: str = Form("ZH"), duration_factor: float = Form(1.0, gt=0),
):
    """上传内容只存到服务专用缓存，不接受任务接口的任意输出路径。"""
    try:
        vector = json.loads(emo_vector) if emo_vector else None
        if vector is not None:
            if not isinstance(vector, list) or any(isinstance(x, bool) or not isinstance(x, (int, float)) for x in vector):
                raise ValueError()
            validate_vector(vector)
    except (ValueError, TypeError):
        raise HTTPException(422, "emo_vector 必须是 8 维数值 JSON 数组。")
    if not text.strip():
        raise HTTPException(422, "合成文本不能为空。")
    if use_emo_text and not getattr(app.state, "use_qwen_emo", True):
        raise HTTPException(422, "当前未加载 QwenEmotion；请使用参考音频或情绪向量，或设置 TTS_USE_QWEN_EMO=true 后重启。")
    store = app.state.jobs
    params = {"text": text, "lang": lang, "duration_factor": duration_factor, "emo_alpha": emo_alpha, "emo_vector": vector,
              "use_random": use_random, "use_emo_text": use_emo_text,
              "emo_text": emo_text, "verbose": verbose}
    params = inference_params(getattr(app.state, "model_version", "2.5"), params)
    for name, upload in (("spk_audio_prompt", spk_audio_file), ("emo_audio_prompt", emo_audio_file)):
        if upload:
            await upload.seek(0)
            # 文件摘要和落盘由线程处理，避免阻塞查询接口。
            def save(upload=upload):
                temp = store.root / (uuid.uuid4().hex + ".upload")
                try:
                    with open(temp, "wb") as target:
                        shutil.copyfileobj(upload.file, target)
                    return store.cache(temp)
                finally:
                    if temp.exists():
                        temp.unlink()
            params[name] = await asyncio.to_thread(save)
    return params, client_request_id, output_path


from fastapi import Depends


@app.post("/api/tts/jobs", status_code=202)
async def submit_job(data=Depends(uploaded_params)):
    params, client_id, output = data
    if output:
        raise HTTPException(422, "任务接口不接受 output_path，请使用音频下载接口。")
    return await asyncio.to_thread(app.state.jobs.submit, params, client_id)


@app.get("/api/tts/jobs/{job_id}")
async def job_status(job_id: str):
    return await asyncio.to_thread(app.state.jobs.status, job_id)


@app.get("/api/tts/jobs/{job_id}/audio")
async def job_audio(job_id: str):
    path = await asyncio.to_thread(app.state.jobs.result, job_id)
    return FileResponse(path, media_type="audio/wav", filename=job_id + ".wav")


@app.delete("/api/tts/jobs/{job_id}")
async def cancel_job(job_id: str):
    return await asyncio.to_thread(app.state.jobs.cancel, job_id)


@app.delete("/api/tts/requests/{client_id}")
async def cancel_request(client_id: str):
    if not client_id or len(client_id) > 128:
        raise HTTPException(422, "客户端请求编号无效。")
    return await asyncio.to_thread(app.state.jobs.cancel_request, client_id)


async def synchronous(params, client_id=None, output=None):
    store = app.state.jobs
    job = await asyncio.to_thread(store.submit, params, client_id)
    while job["status"] in ("queued", "running"):
        await asyncio.sleep(0.5)
        job = await asyncio.to_thread(store.status, job["job_id"])
    if job["status"] != "succeeded":
        raise HTTPException(500, job["error"] or "任务已取消。")
    path = await asyncio.to_thread(store.result, job["job_id"])
    if output:
        def copy():
            Path(output).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, output)
        await asyncio.to_thread(copy)
        return {"status": "success", "file_path": output}
    return FileResponse(path, media_type="audio/wav", filename=Path(path).name)


@app.post("/api/tts/upload")
async def upload_sync(data=Depends(uploaded_params)):
    return await synchronous(*data)


@app.post("/api/tts")
async def json_sync(request: TTSRequest):
    if request.use_emo_text and not getattr(app.state, "use_qwen_emo", True):
        raise HTTPException(422, "当前未加载 QwenEmotion；请使用参考音频或情绪向量，或设置 TTS_USE_QWEN_EMO=true 后重启。")
    params = request.dict()
    params = inference_params(getattr(app.state, "model_version", "2.5"), params)
    output = params.pop("output_path")
    validate_vector(params["emo_vector"])
    for name in ("spk_audio_prompt", "emo_audio_prompt"):
        if params.get(name) and not Path(params[name]).is_file():
            raise HTTPException(400, "参考音频文件不存在。")
    return await synchronous(params, output=output)


if __name__ == "__main__":
    startup_args()
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, workers=1)
