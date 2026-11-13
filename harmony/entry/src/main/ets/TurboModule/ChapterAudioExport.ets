import { common } from '@kit.AbilityKit';
import { fileIo as fs, picker } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { exportChapter, cancelChapterExport, chapterExportProgress } from 'libreference_wav.so';

export interface ExportSegment { uri: string; role: string }
export interface ChapterExportPayload {
  operation: string; id: string; segments: ExportSegment[];
  mode: string; gap: number; fileName: string;
}
interface ManifestItem { order: number; role: string; fileName: string }
interface ExportState { stage: string; done: number; total: number; error?: string }

/** 所有可展示错误均由本机固定文案生成。 */
export class ChapterExportError extends Error {}

/** 单任务文件锁与文件描述符快照；音频处理在 NAPI 工作线程完成。 */
export class ChapterAudioExport {
  private context: common.UIAbilityContext;
  private base: string;
  private root: string;
  private id: string = '';
  private directory: string = '';
  private output: string = '';
  private fileName: string = '';
  private paths: Set<string> = new Set();
  private state: ExportState = { stage: 'cancelled', done: 0, total: 0 };
  private cancelled: boolean = false;
  constructor(context: common.UIAbilityContext) {
    this.context = context;
    this.root = context.filesDir + '/voiceweaver';
    this.base = context.cacheDir + '/chapter-exports';
    // 此目录仅含本功能的临时产物，与源音频目录完全独立。
    if (fs.accessSync(this.base)) { fs.rmdirSync(this.base); }
    fs.mkdirSync(this.base);
  }
  assertMutable(path: string): void {
    if (this.paths.has(path)) { throw new ChapterExportError('音频正在导出，请等待完成或取消下载后再清理'); }
  }
  private source(uri: string): string {
    if (!uri.startsWith('file://')) { throw new ChapterExportError('音频未缓存在本机，请先完成本章转换'); }
    const path = uri.substring(7);
    if (!path.startsWith(this.root + '/') || path.includes('..') || !/^generated-[a-zA-Z0-9_.-]+$/.test(path.substring(this.root.length + 1))) {
      throw new ChapterExportError('只能导出本机生成的章节音频');
    }
    return path;
  }
  private async run(files: fs.File[], sizes: number[], names: string[], output: fs.File, mode: string, gap: number, manifest: string): Promise<void> {
    try {
      this.state.stage = 'processing';
      await exportChapter(files.map(file => file.fd), sizes, names, output.fd, mode, gap, manifest);
      this.state.done = files.length;
      this.state.stage = this.cancelled ? 'cancelled' : 'ready';
    } catch (error) {
      const message = (error as Error).message;
      this.state.error = message || '音频处理失败，请检查音频及可用存储空间';
      this.state.stage = this.cancelled ? 'cancelled' : 'error';
    } finally {
      files.forEach(file => fs.closeSync(file)); fs.closeSync(output);
      if (this.state.stage !== 'ready' && fs.accessSync(this.output)) { fs.unlinkSync(this.output); }
    }
  }
  async execute(p: ChapterExportPayload): Promise<Object | null> {
    if (p.operation === 'exportStart') {
      if (this.id) { throw new ChapterExportError('已有语音下载任务，请等待完成'); }
      if ((p.mode !== 'zip' && p.mode !== 'wav') || !Number.isFinite(p.gap) || p.gap < 0 || p.gap > 30 || !p.segments?.length || p.segments.length >= 65535) {
        throw new ChapterExportError('导出参数无效');
      }
      const files: fs.File[] = [];
      const sizes: number[] = [];
      const names: string[] = [];
      const manifest: ManifestItem[] = [];
      let output: fs.File | undefined = undefined;
      try {
        this.cancelled = false;
        this.state = { stage: 'checking', done: 0, total: p.segments.length };
        for (let i = 0; i < p.segments.length; i++) {
          const segment = p.segments[i];
          const path = this.source(segment.uri);
          if (!fs.accessSync(path) || fs.statSync(path).size === 0) { throw new ChapterExportError('第' + (i + 1) + '段音频缺失，请重新生成'); }
          const extension = path.substring(path.lastIndexOf('.') + 1).toLowerCase();
          if (!/^[a-z0-9]{1,8}$/.test(extension)) { throw new ChapterExportError('音频格式标识无效'); }
          const name = String(i + 1).padStart(4, '0') + '.' + extension;
          files.push(fs.openSync(path, fs.OpenMode.READ_ONLY));
          sizes.push(fs.statSync(path).size); names.push(name); this.paths.add(path);
          manifest.push({ order: i + 1, role: segment.role || '旁白', fileName: name });
        }
        this.id = util.generateRandomUUID();
        this.directory = this.base + '/' + this.id; fs.mkdirSync(this.directory);
        this.output = this.directory + '/chapter.' + p.mode;
        this.fileName = p.fileName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
        output = fs.openSync(this.output, fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
        this.run(files, sizes, names, output, p.mode, p.gap, JSON.stringify(manifest));
        return this.id;
      } catch (error) {
        files.forEach(file => fs.closeSync(file)); if (output) { fs.closeSync(output); }
        if (this.directory && fs.accessSync(this.directory)) { fs.rmdirSync(this.directory); }
        this.id = ''; this.paths.clear();
        if (error instanceof ChapterExportError) { throw error; }
        throw new ChapterExportError('检查音频文件失败，请检查缓存及可用存储空间');
      }
    }
    if (!this.id || this.id !== p.id) { throw new ChapterExportError('导出任务已结束'); }
    switch (p.operation) {
      case 'exportStatus':
        if (this.state.stage === 'processing') { this.state.done = chapterExportProgress(); }
        return this.state;
      case 'exportCancel':
        if (this.state.stage === 'saving') { return null; }
        this.cancelled = true; cancelChapterExport();
        if (this.state.stage === 'ready') { this.state.stage = 'cancelled'; }
        return null;
      case 'exportRelease':
        if (this.state.stage === 'processing' || this.state.stage === 'saving') {
          this.cancelled = true; cancelChapterExport(); throw new ChapterExportError('请等待导出任务停止');
        }
        if (fs.accessSync(this.directory)) { fs.rmdirSync(this.directory); }
        this.paths.clear(); this.id = ''; this.directory = ''; return null;
      case 'exportSave': return this.save();
      default: throw new ChapterExportError('未知导出操作');
    }
  }
  private async save(): Promise<boolean> {
    if (this.cancelled || this.state.stage !== 'ready') { throw new ChapterExportError('音频尚未准备完成'); }
    this.state.stage = 'saving';
    let target: fs.File | undefined = undefined;
    try {
      const options = new picker.DocumentSaveOptions(); options.newFileNames = [this.fileName];
      const uris = await new picker.DocumentViewPicker(this.context).save(options);
      if (!uris.length) { this.state.stage = 'cancelled'; return false; }
      target = await fs.open(uris[0], fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
      await fs.copyFile(this.output, target.fd);
      await fs.fsync(target.fd);
      this.state.stage = 'saved'; return true;
    } catch (error) {
      this.state.stage = 'error';
      if (target) { try { fs.truncateSync(target.fd, 0); } catch (_) {} }
      throw new ChapterExportError('保存失败，请检查目标位置及剩余空间后重试');
    } finally { if (target) { fs.closeSync(target); } }
  }
}
