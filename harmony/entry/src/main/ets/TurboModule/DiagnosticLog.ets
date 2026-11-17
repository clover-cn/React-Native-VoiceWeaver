import { common } from '@kit.AbilityKit';
import { fileIo as fs, picker } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';

interface LogView { text: string; bytes: number; path: string }
/** 日志轮转独立于用户书籍和音频，不清理其他文件。 */
export class DiagnosticLog {
  private path: string;
  private context: common.UIAbilityContext;
  constructor(context: common.UIAbilityContext) {
    this.context = context;
    this.path = context.filesDir + '/voiceweaver/diagnostics.txt';
  }
  private tail(maximum: number): Uint8Array {
    if (!fs.accessSync(this.path)) { return new Uint8Array(0); }
    const size = fs.statSync(this.path).size;
    const offset = Math.max(0, size - maximum);
    const buffer = new ArrayBuffer(size - offset);
    const file = fs.openSync(this.path, fs.OpenMode.READ_ONLY);
    try { fs.readSync(file.fd, buffer, {offset: offset}); } finally { fs.closeSync(file); }
    const bytes = new Uint8Array(buffer);
    if (!offset) { return bytes; }
    const newline = bytes.indexOf(10);
    return newline < 0 ? new Uint8Array(0) : bytes.slice(newline + 1);
  }
  append(text: string): void {
    const bytes = new util.TextEncoder().encodeInto(text);
    if (bytes.length > 256 * 1024) { throw new Error('日志批次过大'); }
    const size = fs.accessSync(this.path) ? fs.statSync(this.path).size : 0;
    if (size + bytes.length > 5 * 1024 * 1024) {
      const retained = this.tail(4 * 1024 * 1024);
      const file = fs.openSync(this.path, fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC);
      try { fs.writeSync(file.fd, retained.buffer as ArrayBuffer); } finally { fs.closeSync(file); }
    }
    const file = fs.openSync(this.path, fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY | fs.OpenMode.APPEND);
    try { fs.writeSync(file.fd, bytes.buffer as ArrayBuffer); } finally { fs.closeSync(file); }
  }
  view(): LogView {
    return {text: util.TextDecoder.create('utf-8').decodeWithStream(this.tail(128 * 1024)),
      bytes: fs.accessSync(this.path) ? fs.statSync(this.path).size : 0, path: this.path};
  }
  async save(): Promise<boolean> {
    const snapshot = this.tail(5 * 1024 * 1024);
    const options = new picker.DocumentSaveOptions();
    options.newFileNames = ['voiceweaver-diagnostics.txt'];
    const uris = await new picker.DocumentViewPicker(this.context).save(options);
    if (!uris.length) { return false; }
    const target = fs.openSync(uris[0], fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
    try { fs.writeSync(target.fd, snapshot.buffer as ArrayBuffer); fs.fsyncSync(target.fd); }
    finally { fs.closeSync(target); }
    return true;
  }
  clear(): void {
    if (fs.accessSync(this.path)) {
      fs.unlinkSync(this.path);
    }
  }
}
