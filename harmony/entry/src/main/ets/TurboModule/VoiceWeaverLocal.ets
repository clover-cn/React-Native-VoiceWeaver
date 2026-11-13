import { common } from '@kit.AbilityKit';
import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { huks } from '@kit.UniversalKeystoreKit';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import http from '@ohos.net.http';
import { GenerationBackground } from './GenerationBackground';
import { BusinessError } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { inspectReferenceAudio, ReferenceAudioInspectionError } from './ReferenceAudioInspector';
import { convert } from 'libreference_wav.so';
import { ChapterAudioExport, ChapterExportError, ChapterExportPayload } from './ChapterAudioExport';

interface UploadPart { name: string; uri: string; mime: string }
interface LocalPayload {
  operation: string; key: string; text: string; uri: string; extension: string;
  id: string; url: string; method: string; headers: Record<string, string>;
  fields?: Record<string, string>; files?: UploadPart[]; body: string;
  referenceUri?: string; referenceMime?: string; audio: boolean; pcm: boolean;
  timeout: number; sampleRate: number; enabled: boolean;
  stream?: boolean;
  owner?: string; uris?: string[];
}
interface AudioSpec { format: string; voice?: string }
interface MimoPayload { model: string; messages: Object[]; audio: AudioSpec; stream: boolean }
interface MimoAudio { data: string }
interface MimoMessage { audio: MimoAudio }
interface MimoChoice { message: MimoMessage }
interface MimoResult { choices: MimoChoice[] }
interface LocalResult { status?: number; retryAfter?: string; text?: string; uri?: string }

/** 只携带固定阶段与数字错误码，避免把请求或密钥写入日志。 */
class ConfigStorageError extends Error {
  stage: string;
  code: number;
  constructor(stage: string, code: number) {
    super('系统安全配置存储失败');
    this.stage = stage;
    this.code = code;
  }
}

/** 仅用于由本机生成、可安全展示的流式控制错误。 */
class StreamRequestError extends Error {}

/** 原生文件和网络入口，参考音频与响应二进制不穿过 JS 桥。 */
export class VoiceWeaverLocal {
  private audioExport: ChapterAudioExport;
  private context: common.UIAbilityContext;
  private root: string;
  private calls: Map<string, http.HttpRequest> = new Map();
  private streamCancels: Map<string, () => void> = new Map();
  private alias: string = 'voiceweaver.config.v1';
  private configQueue: Promise<void> = Promise.resolve();
  constructor(context: common.UIAbilityContext) {
    this.context = context;
    this.audioExport = new ChapterAudioExport(context);
    this.root = context.filesDir + '/voiceweaver';
    if (!fs.accessSync(this.root)) { fs.mkdirSync(this.root); }
  }
  private path(key: string): string {
    if (!/^[a-zA-Z0-9_.-]{1,180}$/.test(key) || key.includes('..')) { throw new Error('文件标识无效'); }
    return this.root + '/' + key;
  }
  private owned(uri: string): string {
    const path = uri.replace(/^file:\/\//, '');
    if (!path.startsWith(this.root + '/') || path.includes('..') || path.substring(this.root.length + 1).includes('/')) { throw new Error('音频路径无效'); }
    return path;
  }
  /** 选择器的内部缓存地址需要映射到应用缓存目录，不能直接传给文件接口。 */
  private importSource(uri: string): string {
    const prefix = 'internal://cache/';
    if (!uri.startsWith(prefix)) {
      if (uri.startsWith('internal://')) { throw new Error('不支持的内部录音地址'); }
      return uri;
    }
    const relative = uri.substring(prefix.length);
    const parts = relative.split('/');
    if (parts.some(part => part.length === 0 || part === '.' || part === '..') || /[\\?#\u0000]/.test(relative)) {
      throw new Error('录音缓存地址无效');
    }
    return this.context.cacheDir + '/' + relative;
  }
  private read(path: string): Uint8Array {
    const size = fs.statSync(path).size;
    if (size > 64 * 1024 * 1024) { throw new Error('文件超过64MB限制'); }
    const buffer = new ArrayBuffer(size);
    const file = fs.openSync(path, fs.OpenMode.READ_ONLY);
    try { fs.readSync(file.fd, buffer); } finally { fs.closeSync(file); }
    return new Uint8Array(buffer);
  }
  private atomic(path: string, bytes: Uint8Array): void {
    const temp = this.root + '/write-' + util.generateRandomUUID() + '.tmp';
    const file = fs.openSync(temp, fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
    try { fs.writeSync(file.fd, bytes.buffer as ArrayBuffer); fs.fsyncSync(file.fd); } finally { fs.closeSync(file); }
    fs.renameSync(temp, path);
  }
  private properties(purpose: number): huks.HuksParam[] {
    return [
      { tag: huks.HuksTag.HUKS_TAG_ALGORITHM, value: huks.HuksKeyAlg.HUKS_ALG_AES },
      { tag: huks.HuksTag.HUKS_TAG_KEY_SIZE, value: huks.HuksKeySize.HUKS_AES_KEY_SIZE_256 },
      { tag: huks.HuksTag.HUKS_TAG_PURPOSE, value: purpose }
    ];
  }
  private async config(p: LocalPayload): Promise<string | null> {
    let stage = 'readSettings';
    let handle: number | undefined = undefined;
    try {
      const path = this.path('settings.enc');
      const saving = p.operation === 'saveConfig';
      if (!saving && !fs.accessSync(path)) { return null; }
      stage = 'checkKey';
      // isKeyItemExist 在首次使用时会抛出 12000011；hasKeyItem 才返回 false。
      if (!await huks.hasKeyItem(this.alias, { properties: [] })) {
        if (!saving) { throw new Error('配置密钥不存在'); }
        stage = 'generateKey';
        await huks.generateKeyItem(this.alias, { properties: this.properties(huks.HuksKeyPurpose.HUKS_KEY_PURPOSE_ENCRYPT | huks.HuksKeyPurpose.HUKS_KEY_PURPOSE_DECRYPT) });
      }
      stage = 'prepareCipher';
      const data = saving ? new util.TextEncoder().encodeInto(p.text) : this.read(path);
      if (!saving && data.length < 28) { throw new Error('配置密文不完整'); }
      const nonce = saving ? cryptoFramework.createRandom().generateRandomSync(12).data : data.slice(0, 12);
      const props = this.properties(saving ? huks.HuksKeyPurpose.HUKS_KEY_PURPOSE_ENCRYPT : huks.HuksKeyPurpose.HUKS_KEY_PURPOSE_DECRYPT);
      props.push({ tag: huks.HuksTag.HUKS_TAG_BLOCK_MODE, value: huks.HuksCipherMode.HUKS_MODE_GCM });
      props.push({ tag: huks.HuksTag.HUKS_TAG_PADDING, value: huks.HuksKeyPadding.HUKS_PADDING_NONE });
      props.push({ tag: huks.HuksTag.HUKS_TAG_NONCE, value: nonce });
      if (!saving) { props.push({ tag: huks.HuksTag.HUKS_TAG_AE_TAG, value: data.slice(data.length - 16) }); }
      const input = saving ? data : data.slice(12, data.length - 16);
      stage = 'initSession';
      const session = await huks.initSession(this.alias, { properties: props, inData: new Uint8Array(0) });
      handle = session.handle;
      stage = 'finishSession';
      const result = await huks.finishSession(session.handle, { properties: props, inData: input });
      handle = undefined;
      const output = result.outData;
      if (!output) { throw new Error('系统密钥操作失败'); }
      if (saving) {
        const combined = new Uint8Array(nonce.length + output.length); combined.set(nonce); combined.set(output, nonce.length);
        stage = 'commitSettings';
        this.atomic(path, combined); return null;
      }
      stage = 'decodeSettings';
      return util.TextDecoder.create('utf-8').decodeWithStream(output);
    } catch (error) {
      if (handle !== undefined) {
        await huks.abortSession(handle, { properties: [] }).catch(() => {});
      }
      const code = (error as BusinessError).code;
      throw new ConfigStorageError(stage, typeof code === 'number' && Number.isFinite(code) ? code : 0);
    }
  }
  /** 设置读写串行化，防止首次保存时重复创建密钥或读取未提交文件。 */
  private serializedConfig(p: LocalPayload): Promise<string | null> {
    const result = this.configQueue.then(() => this.config(p));
    this.configQueue = result.then(() => {}, () => {});
    return result;
  }
  async execute(raw: string): Promise<string> {
    let operation = 'decode';
    try {
      const p: LocalPayload = JSON.parse(raw) as LocalPayload;
      operation = p.operation;
      if (operation.startsWith('export')) {
        const result = await this.audioExport.execute(JSON.parse(raw) as ChapterExportPayload);
        return JSON.stringify({ success: true, data: result });
      }
      let data: Object | null = null;
      switch (p.operation) {
        case 'loadConfig': case 'saveConfig': data = await this.serializedConfig(p); break;
        case 'background': await GenerationBackground.update(this.context, 'generation', p.enabled); break;
        case 'read': { const path = this.path(p.key); data = fs.accessSync(path) ? util.TextDecoder.create('utf-8').decodeWithStream(this.read(path)) : null; break; }
        case 'write': this.atomic(this.path(p.key), new util.TextEncoder().encodeInto(p.text)); break;
        case 'exists': data = fs.accessSync(this.owned(p.uri)); break;
        case 'inspectReferenceAudio': {
          const source = fs.openSync(this.importSource(p.uri), fs.OpenMode.READ_ONLY);
          try {
            data = await inspectReferenceAudio(source.fd, fs.statSync(source.fd).size);
          } finally { fs.closeSync(source); }
          break;
        }
        case 'importAudio': {
          const target = this.path('reference-' + util.generateRandomUUID() + '.wav');
          const source = fs.openSync(this.importSource(p.uri), fs.OpenMode.READ_ONLY);
          try {
            if (fs.statSync(source.fd).size > 5 * 1024 * 1024) { throw new ReferenceAudioInspectionError('参考录音超过5MB限制'); }
            await inspectReferenceAudio(source.fd, fs.statSync(source.fd).size);
            const wav: ArrayBuffer = await convert(source.fd, fs.statSync(source.fd).size);
            this.atomic(target, new Uint8Array(wav));
          } finally { fs.closeSync(source); }
          data = 'file://' + target; break;
        }
        case 'stats': { let size = 0; for (const name of fs.listFileSync(this.root)) { if (name.startsWith('generated-')) { size += fs.statSync(this.path(name)).size; } } data = size; break; }
        case 'clearGenerated': {
          const names = fs.listFileSync(this.root).filter(name => name.startsWith('generated-'));
          names.forEach(name => this.audioExport.assertMutable(this.path(name)));
          for (const name of names) { fs.unlinkSync(this.path(name)); }
          data = names.length; break;
        }
        case 'deleteProject': {
          if (!/^project-[a-f0-9]{64}\.json$/.test(p.key)) { throw new Error('书籍标识无效'); }
          const prefix = 'generated-' + p.key.substring(8, 72) + '-';
          const paths: Set<string> = new Set();
          for (const uri of p.uris || []) {
            const path = this.owned(uri);
            if (!path.substring(this.root.length + 1).startsWith('generated-')) { throw new Error('只能清理书籍生成音频'); }
            paths.add(path);
          }
          for (const name of fs.listFileSync(this.root)) {
            if (name.startsWith(prefix)) { paths.add(this.path(name)); }
          }
          for (const path of paths) { this.audioExport.assertMutable(path); }
          for (const path of paths) { if (fs.accessSync(path)) { fs.unlinkSync(path); } }
          const document = this.path(p.key);
          if (fs.accessSync(document)) { fs.unlinkSync(document); }
          break;
        }
        case 'deleteAudio': { const path = this.owned(p.uri); this.audioExport.assertMutable(path); if (fs.accessSync(path)) { fs.unlinkSync(path); } data = true; break; }
        case 'cancel': {
          const cancelStream = this.streamCancels.get(p.id);
          if (cancelStream) { cancelStream(); }
          const call = this.calls.get(p.id);
          if (call) { call.destroy(); this.calls.delete(p.id); }
          break;
        }
        case 'request': data = await this.request(p); break;
        default: throw new Error('未知端侧操作');
      }
      return JSON.stringify({ success: true, data: data });
    } catch (error) {
      if (error instanceof StreamRequestError || error instanceof ReferenceAudioInspectionError || error instanceof ChapterExportError) {
        return JSON.stringify({ success: false, error: error.message });
      }
      if (error instanceof ConfigStorageError) {
        hilog.error(0x0fff, 'VoiceWeaverLocal', '安全配置存储失败 stage=%{public}s code=%{public}d', error.stage, error.code);
        return JSON.stringify({ success: false, error: '本机安全配置存储失败（' + error.stage + '，错误码 ' + error.code + '），保存配置无需联网。' });
      }
      const code = (error as BusinessError).code;
      const safeCode = typeof code === 'number' && Number.isFinite(code) ? code : 0;
      if (operation === 'inspectReferenceAudio' || operation === 'importAudio') {
        return JSON.stringify({ success: false, error: '参考录音读取或导入失败，请确认文件可用后重新选择（错误码 ' + safeCode + '）。' });
      }
      hilog.error(0x0fff, 'VoiceWeaverLocal', '端侧操作失败 operation=%{public}s code=%{public}d', operation, safeCode);
      if (operation === 'request' && safeCode === 2300023) {
        return JSON.stringify({ success: false, error: '模型响应接收失败（2300023），可能超过响应大小限制或请求已中止，请检查响应大小和生成日志。' });
      }
      return JSON.stringify({ success: false, error: '端侧操作失败（错误码 ' + safeCode + '），请检查配置、网络或可用存储空间' });
    }
  }
  /** 系统 HTTP 流式事件维持接收；超时按连续无数据时间计算。 */
  private streamResponse(call: http.HttpRequest, p: LocalPayload, body: string | ArrayBuffer,
    headers: Record<string, string>): Promise<LocalResult> {
    return new Promise<LocalResult>((resolve, reject) => {
      const chunks: Uint8Array[] = [];
      let length = 0;
      let status: number | undefined = undefined;
      let responseHeaders: Record<string, string> = {};
      let ended = false;
      let settled = false;
      let timer: number = -1;
      let lastLog = 0;
      const cleanup = (): void => {
        clearTimeout(timer);
        this.streamCancels.delete(p.id);
      };
      // 显式列出系统错误和本地控制错误，避免 ArkTS 将其按结构类型匹配。
      const fail = (error: Error | StreamRequestError): void => {
        if (settled) { return; }
        settled = true;
        cleanup();
        reject(error);
        call.destroy();
      };
      const armTimeout = (): void => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          fail(new StreamRequestError('模型流式请求等待数据超时，请检查中转站或调整解析等待数据超时。'));
        }, p.timeout || 120000);
      };
      const finish = (): void => {
        if (settled || !ended || status === undefined) { return; }
        settled = true;
        cleanup();
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        const response: LocalResult = {
          status: status,
          retryAfter: responseHeaders['Retry-After'] || responseHeaders['retry-after'] || '',
          text: util.TextDecoder.create('utf-8').decodeWithStream(
            status < 200 || status >= 300 ? bytes.slice(0, 8192) : bytes)
        };
        hilog.info(0x0fff, 'VoiceWeaverLocal', '模型流式接收结束 status=%{public}d bytes=%{public}d', status, length);
        resolve(response);
      };
      call.on('headersReceive', (value: Object) => { responseHeaders = value as Record<string, string>; });
      call.on('dataReceive', (value: ArrayBuffer) => {
        if (settled) { return; }
        if (length + value.byteLength > 8 * 1024 * 1024) {
          fail(new StreamRequestError('模型流式响应超过8MB限制，请减少输入章节数。'));
          return;
        }
        chunks.push(new Uint8Array(value.slice(0)));
        length += value.byteLength;
        armTimeout();
        if (Date.now() - lastLog >= 5000) {
          lastLog = Date.now();
          hilog.info(0x0fff, 'VoiceWeaverLocal', '模型流式接收 bytes=%{public}d', length);
        }
      });
      call.on('dataEnd', () => { ended = true; finish(); });
      this.streamCancels.set(p.id, () => fail(new StreamRequestError('模型流式请求已取消。')));
      armTimeout();
      // readTimeout 是系统总时限；关闭它，由上面的原生空闲超时控制接收。
      try {
        call.requestInStream(p.url, {
          method: http.RequestMethod.POST, header: headers, extraData: body,
          usingCache: false, connectTimeout: p.timeout || 120000, readTimeout: 0
        }).then((code: number) => { status = code; finish(); }).catch((error: Error) => fail(error));
      } catch (error) {
        fail(error as Error);
      }
    });
  }
  private async request(p: LocalPayload): Promise<LocalResult> {
    let body: string | ArrayBuffer = p.body || '{}';
    const headers: Record<string, string> = p.headers || {};
    if (p.fields) {
      const boundary = 'VoiceWeaver' + util.generateRandomUUID();
      headers['Content-Type'] = 'multipart/form-data; boundary=' + boundary;
      const chunks: Uint8Array[] = [];
      const encoder = new util.TextEncoder();
      for (const name of Object.keys(p.fields)) { chunks.push(encoder.encodeInto('--' + boundary + '\r\nContent-Disposition: form-data; name="' + name + '"\r\n\r\n' + p.fields[name] + '\r\n')); }
      for (const file of p.files || []) {
        chunks.push(encoder.encodeInto('--' + boundary + '\r\nContent-Disposition: form-data; name="' + file.name + '"; filename="reference.wav"\r\nContent-Type: ' + file.mime + '\r\n\r\n'));
        chunks.push(this.read(this.owned(file.uri))); chunks.push(encoder.encodeInto('\r\n'));
      }
      chunks.push(encoder.encodeInto('--' + boundary + '--\r\n'));
      let length = 0; for (const chunk of chunks) { length += chunk.length; }
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      body = bytes.buffer as ArrayBuffer;
    } else if (p.referenceUri) {
      const json: MimoPayload = JSON.parse(p.body) as MimoPayload;
      json.audio.voice = 'data:' + (p.referenceMime || 'audio/wav') + ';base64,' + new util.Base64Helper().encodeToStringSync(this.read(this.owned(p.referenceUri)));
      body = JSON.stringify(json);
    }
    const call = http.createHttp(); this.calls.set(p.id, call);
    try {
      if (p.stream) { return await this.streamResponse(call, p, body, headers); }
      // 语音 JSON 中的 Base64 PCM 容易超过系统默认 5MB 接收限制。
      const response = await call.request(p.url, { method: http.RequestMethod.POST, header: headers, extraData: body, expectDataType: http.HttpDataType.ARRAY_BUFFER, usingCache: false, maxLimit: 64 * 1024 * 1024, connectTimeout: p.timeout || 120000, readTimeout: p.timeout || 120000 });
      const status = response.responseCode;
      const responseHeaders = response.header as Record<string, string>;
      const result: LocalResult = { status: status, retryAfter: responseHeaders['Retry-After'] || responseHeaders['retry-after'] || '', text: '' };
      if (status < 200 || status >= 300) {
        // 错误正文仅交给界面脱敏显示，不写入日志或持久文件。
        const errorBytes = new Uint8Array(response.result as ArrayBuffer).slice(0, 8192);
        result.text = util.TextDecoder.create('utf-8').decodeWithStream(errorBytes);
        hilog.warn(0x0fff, 'VoiceWeaverLocal', '模型 HTTP 请求失败 status=%{public}d', status);
        return result;
      }
      let bytes = new Uint8Array(response.result as ArrayBuffer);
      if (!p.audio) { result.text = util.TextDecoder.create('utf-8').decodeWithStream(bytes); return result; }
      if (p.pcm) {
        const json: MimoResult = JSON.parse(util.TextDecoder.create('utf-8').decodeWithStream(bytes)) as MimoResult;
        const pcm = new util.Base64Helper().decodeSync(json.choices[0].message.audio.data);
        if (pcm.length === 0 || pcm.length % 2 !== 0) { throw new Error('PCM 数据无效'); }
        bytes = new Uint8Array(44 + pcm.length); bytes.set(new util.TextEncoder().encodeInto('RIFF'), 0); bytes.set(new util.TextEncoder().encodeInto('WAVEfmt '), 8); bytes.set(new util.TextEncoder().encodeInto('data'), 36);
        const view = new DataView(bytes.buffer as ArrayBuffer); const rate = p.sampleRate || 24000;
        view.setUint32(4, 36 + pcm.length, true); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); view.setUint32(40, pcm.length, true); bytes.set(pcm, 44);
      }
      if (!this.calls.has(p.id) || bytes.length === 0) { throw new Error('生成已取消或音频为空'); }
      if (p.owner && !/^[a-f0-9]{64}$/.test(p.owner)) { throw new Error('书籍标识无效'); }
      const path = this.path('generated-' + (p.owner ? p.owner + '-' : '') + util.generateRandomUUID() + (p.pcm ? '.wav' : (p.extension || '.mp3')));
      this.atomic(path, bytes); result.uri = 'file://' + path; return result;
    } finally { this.calls.delete(p.id); call.destroy(); }
  }
}
