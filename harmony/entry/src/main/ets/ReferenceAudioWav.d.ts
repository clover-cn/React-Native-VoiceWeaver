declare module 'libreference_wav.so' {
  /** 在原生工作线程解码，返回带文件头的 PCM WAV。 */
  export function convert(fd: number, size: number): Promise<ArrayBuffer>;
}
