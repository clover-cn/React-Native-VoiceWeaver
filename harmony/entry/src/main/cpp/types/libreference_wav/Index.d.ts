/** 使用系统解码器转换为 PCM WAV，文件描述符须在 Promise 完成前保持打开。 */
export const convert: (fd: number, size: number) => Promise<ArrayBuffer>;
/** 在原生工作线程打包或合并，输入输出文件描述符由调用方持有。 */
export const exportChapter: (fds: number[], sizes: number[], names: string[], output: number, mode: string, gap: number, manifest: string) => Promise<void>;
export const cancelChapterExport: () => void;
export const chapterExportProgress: () => number;
