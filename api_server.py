"""IndexTTS 单进程任务服务；复制本文件到 index-tts 根目录后用 uv run 启动。"""

import asyncio
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
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from typing import Optional, List

log = logging.getLogger("uvicorn.error")


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
            if not target.exists():
                temp = target.with_suffix("." + uuid.uuid4().hex + ".tmp")
                shutil.copyfile(source, temp)
                os.replace(temp, target)
        return str(target)

    def submit(self, params, client_id=None):
        params = dict(params)
        params.pop("output_path", None)
        for name in ("spk_audio_prompt", "emo_audio_prompt"):
            if params.get(name):
                params[name] = self.cache(params[name])
        fingerprint = hashlib.sha256(json.dumps(
            [self.identity, params], sort_keys=True, ensure_ascii=False,
            allow_nan=False).encode("utf-8")).hexdigest()
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
    root = Path(os.getenv("TTS_JOB_DIR", "voiceweaver_jobs")).resolve()
    async with single_instance(root):
        from indextts.infer_v2 import IndexTTS2
        cfg = Path(os.getenv("TTS_CFG_PATH", "checkpoints/config.yaml")).resolve()
        model_dir = Path(os.getenv("TTS_MODEL_DIR", "checkpoints")).resolve()
        options = {"use_fp16": "--fp16" in sys.argv,
                   "use_cuda_kernel": os.getenv("TTS_USE_CUDA_KERNEL", "false").lower() == "true",
                   "use_deepspeed": os.getenv("TTS_USE_DEEPSPEED", "false").lower() == "true"}
        tts = IndexTTS2(cfg_path=str(cfg), model_dir=str(model_dir), **options)
        log.info("IndexTTS 已加载 device=%s fp16=%s options=%s", tts.device, tts.use_fp16, options)
        weights = [(str(p.relative_to(model_dir)), p.stat().st_size, p.stat().st_mtime_ns)
                   for p in sorted(model_dir.rglob("*")) if p.is_file() and p.suffix in (".pth", ".pt", ".safetensors", ".bin")]
        identity = [str(model_dir), hashlib.sha256(cfg.read_bytes()).hexdigest(), weights, options]
        store = JobStore(root, identity, tts.infer)
        app.state.jobs = store
        store.start()
        try:
            yield
        finally:
            await asyncio.to_thread(store.close)


app = FastAPI(title="IndexTTS2 durable jobs", lifespan=lifespan)


class TTSRequest(BaseModel):
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
    store = app.state.jobs
    params = {"text": text, "emo_alpha": emo_alpha, "emo_vector": vector,
              "use_random": use_random, "use_emo_text": use_emo_text,
              "emo_text": emo_text, "verbose": verbose}
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
    params = request.dict()
    output = params.pop("output_path")
    validate_vector(params["emo_vector"])
    for name in ("spk_audio_prompt", "emo_audio_prompt"):
        if params.get(name) and not Path(params[name]).is_file():
            raise HTTPException(400, "参考音频文件不存在。")
    return await synchronous(params, output=output)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, workers=1)
