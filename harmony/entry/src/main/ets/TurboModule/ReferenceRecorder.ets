import { common, abilityAccessCtrl } from '@kit.AbilityKit';
import { audio } from '@kit.AudioKit';
import { fileIo as fs } from '@kit.CoreFileKit';

export interface RecordingPayload { operation: string; id: string }
interface RecordingState { state: string; durationMs: number; error?: string; uri?: string; size?: number; fileName?: string; mimeType?: string }
interface RecordingPermission { granted: boolean }
export class RecordingError extends Error {}

class RecordingSession {
  id: string = '';
  state: string = 'starting';
  error: string = '';
  path: string = '';
  bytes: number = 0;
  cancelled: boolean = false;
  stop: boolean = false;
  release: boolean = false;
  capturer?: audio.AudioCapturer;
  file?: fs.File;
  finishing?: Promise<void>;
  watchdog: number = -1;
  lastData: number = 0;
}

/** 原生帧数限制长度，所有未确认录音均在前台生命周期内存在。 */
export class ReferenceRecorder {
  private static instance?: ReferenceRecorder;
  private static foreground: boolean = true;
  private session?: RecordingSession;
  private cancelledIds: Set<string> = new Set();
  private context: common.UIAbilityContext;
  private root: string;
  static get(context: common.UIAbilityContext): ReferenceRecorder {
    if (!ReferenceRecorder.instance) { ReferenceRecorder.instance = new ReferenceRecorder(context); }
    return ReferenceRecorder.instance;
  }
  static lifecycle(visible: boolean): void {
    ReferenceRecorder.foreground = visible;
    const instance = ReferenceRecorder.instance;
    const session = instance?.session;
    if (!visible && instance && session) { instance.execute({ operation: 'recordingCancel', id: session.id }).catch(() => {}); }
  }
  private constructor(context: common.UIAbilityContext) {
    this.context = context; this.root = context.cacheDir + '/reference-recordings';
    if (!fs.accessSync(this.root)) { fs.mkdirSync(this.root); }
    for (const name of fs.listFileSync(this.root)) {
      if (/^recording-[a-zA-Z0-9-]+\.wav$/.test(name)) { fs.unlinkSync(this.root + '/' + name); }
    }
  }
  private header(bytes: number): ArrayBuffer {
    const buffer = new ArrayBuffer(44); const view = new DataView(buffer);
    const text = (offset: number, value: string): void => { for (let i = 0; i < value.length; i++) { view.setUint8(offset + i, value.charCodeAt(i)); } };
    text(0, 'RIFF'); view.setUint32(4, bytes + 36, true); text(8, 'WAVEfmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 48000, true); view.setUint32(28, 96000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    text(36, 'data'); view.setUint32(40, bytes, true); return buffer;
  }
  private status(s: RecordingSession): RecordingState {
    const result: RecordingState = { state: s.state, durationMs: s.bytes / 96 };
    if (s.error) { result.error = s.error; }
    if (s.state === 'ready') { result.uri = 'file://' + s.path; result.size = s.bytes + 44; result.mimeType = 'audio/wav'; result.fileName = '现场录音.wav'; }
    return result;
  }
  private writeAt(file: fs.File, bytes: ArrayBuffer, offset: number): void {
    fs.lseek(file.fd, offset, fs.WhenceType.SEEK_SET);
    let written = 0;
    while (written < bytes.byteLength) {
      const count = fs.writeSync(file.fd, bytes.slice(written));
      if (count <= 0) { throw new RecordingError('录音文件写入失败'); }
      written += count;
    }
  }
  private async start(s: RecordingSession): Promise<void> {
    try {
      const options: audio.AudioCapturerOptions = {
        streamInfo: { samplingRate: audio.AudioSamplingRate.SAMPLE_RATE_48000, channels: audio.AudioChannel.CHANNEL_1, sampleFormat: audio.AudioSampleFormat.SAMPLE_FORMAT_S16LE, encodingType: audio.AudioEncodingType.ENCODING_TYPE_RAW },
        capturerInfo: { source: audio.SourceType.SOURCE_TYPE_MIC, capturerFlags: 0 }
      };
      s.capturer = await audio.createAudioCapturer(options);
      const actual = await s.capturer.getStreamInfo();
      if (actual.samplingRate !== 48000 || actual.channels !== 1 || actual.sampleFormat !== audio.AudioSampleFormat.SAMPLE_FORMAT_S16LE) { throw new RecordingError('设备不支持48 kHz单声道16位录音'); }
      if (s.cancelled || s.stop || !ReferenceRecorder.foreground) { await this.finish(s); return; }
      s.file = fs.openSync(s.path, fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
      this.writeAt(s.file, this.header(0), 0);
      s.capturer.on('audioInterrupt', event => {
        if (event.eventType === audio.InterruptType.INTERRUPT_TYPE_BEGIN) { s.cancelled = true; s.release = true; s.stop = true; if (s.state === 'recording') { this.finish(s); } }
      });
      s.capturer.on('readData', data => {
        if (s.cancelled || s.stop || !s.file || s.state !== 'recording') { return; }
        try {
          if (data.byteLength % 2 !== 0) { throw new RecordingError('麦克风返回了不完整的数据'); }
          const count = Math.min(data.byteLength, 1920000 - s.bytes);
          // 使用绝对定位，避免文件接口的相对 offset 导致音频中间出现空洞。
          this.writeAt(s.file, data.slice(0, count), 44 + s.bytes);
          s.bytes += count; s.lastData = Date.now();
          if (s.bytes >= 1920000) { s.stop = true; this.finish(s); }
        } catch (_) { s.error = '录音写入失败，请检查麦克风和可用存储空间'; s.stop = true; this.finish(s); }
      });
      s.lastData = Date.now();
      await s.capturer.start();
      s.state = 'recording';
      if (s.cancelled || s.stop) { await this.finish(s); return; }
      s.watchdog = setInterval(() => {
        if (Date.now() - s.lastData > 5000) { s.error = '麦克风没有返回数据，请重新录制'; s.stop = true; this.finish(s); }
      }, 500);
    } catch (error) {
      s.error = error instanceof RecordingError ? error.message : '录音启动失败，请检查麦克风权限或是否被占用';
      await this.finish(s);
    }
  }
  private finish(s: RecordingSession): Promise<void> {
    if (s.finishing) { return s.finishing; }
    s.finishing = this.complete(s); return s.finishing;
  }
  private async complete(s: RecordingSession): Promise<void> {
    s.stop = true; clearInterval(s.watchdog);
    if (s.capturer) {
      try { s.capturer.off('readData'); s.capturer.off('audioInterrupt'); } catch (_) {}
      try { await s.capturer.stop(); } catch (_) {}
      try { await s.capturer.release(); } catch (_) {}
      s.capturer = undefined;
    }
    if (!s.cancelled && !s.error && s.bytes < 96000) { s.error = '录音不足1秒，请重新长按录制'; }
    if (s.file) {
      try { if (!s.cancelled && !s.error) { this.writeAt(s.file, this.header(s.bytes), 0); fs.fsyncSync(s.file.fd); } }
      catch (_) { s.error = '录音保存失败，请检查可用存储空间'; }
      finally { try { fs.closeSync(s.file); } catch (_) { s.error = '录音文件关闭失败，请重新录制'; } s.file = undefined; }
    }
    s.state = s.cancelled ? 'cancelled' : s.error ? 'error' : 'ready';
    if (s.state !== 'ready' || s.release) { try { if (fs.accessSync(s.path)) { fs.unlinkSync(s.path); } } catch (_) {} }
    if (s.release && this.session === s) { this.session = undefined; }
  }
  async execute(p: RecordingPayload): Promise<Object | null> {
    if (p.operation === 'recordingPrepare') {
      const manager = abilityAccessCtrl.createAtManager();
      const result = await manager.requestPermissionsFromUser(this.context, ['ohos.permission.MICROPHONE']);
      const permission: RecordingPermission = { granted: result.authResults.length > 0 && result.authResults[0] === 0 };
      return permission;
    }
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(p.id)) { throw new RecordingError('录音会话无效'); }
    if (p.operation === 'recordingCancel' || p.operation === 'recordingRelease') {
      this.cancelledIds.add(p.id);
      if (this.cancelledIds.size > 128) { const ids = Array.from(this.cancelledIds); this.cancelledIds.delete(ids[0]); }
      const s = this.session;
      if (s && s.id === p.id) {
        s.cancelled = true; s.release = true; s.stop = true;
        if (s.state === 'starting') { return null; }
        if (s.state === 'recording') { await this.finish(s); }
        else { try { if (fs.accessSync(s.path)) { fs.unlinkSync(s.path); } } finally { this.session = undefined; } }
      }
      return null;
    }
    if (p.operation === 'recordingStart') {
      if (!ReferenceRecorder.foreground || this.cancelledIds.has(p.id)) { throw new RecordingError('录音已取消，请重新长按'); }
      if (this.session) { throw new RecordingError('已有录音，请先结束或重录'); }
      const s = new RecordingSession(); s.id = p.id; s.path = this.root + '/recording-' + p.id + '.wav'; this.session = s;
      this.start(s); return this.status(s);
    }
    const s = this.session;
    if (!s || s.id !== p.id) { const empty: RecordingState = { state: 'cancelled', durationMs: 0 }; return empty; }
    if (p.operation === 'recordingStop') {
      s.stop = true;
      if (s.state === 'recording') { await this.finish(s); }
    } else if (p.operation !== 'recordingStatus') { throw new RecordingError('未知录音操作'); }
    return this.status(s);
  }
}
