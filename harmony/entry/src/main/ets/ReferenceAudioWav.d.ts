declare module 'libreference_wav.so' {
  /** 在原生工作线程解码，返回带文件头的 PCM WAV。 */
  export function convert(fd: number, size: number): Promise<ArrayBuffer>;
  /** 持有的文件描述符由调用方在任务结束后关闭。 */
  export function exportChapter(fds: number[], sizes: number[], names: string[], output: number, mode: string, gap: number, manifest: string): Promise<void>;
  export function cancelChapterExport(): void;
  export function chapterExportProgress(): number;
}
