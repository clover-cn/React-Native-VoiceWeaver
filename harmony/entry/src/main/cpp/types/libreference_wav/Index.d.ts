/** 使用系统解码器转换为 PCM WAV，文件描述符须在 Promise 完成前保持打开。 */
export const convert: (fd: number, size: number) => Promise<ArrayBuffer>;
