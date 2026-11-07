import { media } from '@kit.MediaKit';

export interface ReferenceAudioInspection { durationMs: number }

/** 仅携带本机生成、可直接展示的检查结果，不回显文件路径。 */
export class ReferenceAudioInspectionError extends Error {}

class InspectionSession {
  extractor: media.AVMetadataExtractor | null = null;
  expired: boolean = false;
}

/** 毫秒值直接比较；展示时的舍入不参与边界判断。 */
export function validateReferenceAudioDuration(duration: string | undefined): ReferenceAudioInspection {
  const durationMs = Number(duration);
  if (!duration || !Number.isFinite(durationMs) || durationMs <= 0) {
    throw new ReferenceAudioInspectionError('无法读取有效音频时长，请选择可正常播放的录音。');
  }
  if (durationMs > 20000) {
    const seconds = Math.ceil(durationMs / 10) / 100;
    throw new ReferenceAudioInspectionError(`音频时长为 ${seconds.toFixed(2)} 秒，超过 20 秒限制，请裁剪到 20 秒以内后重新选择。`);
  }
  return { durationMs: durationMs };
}

/** 使用独立提取器读取元数据，不创建播放器或改变听书会话。调用方负责关闭文件。 */
export async function inspectReferenceAudio(fd: number, length: number): Promise<ReferenceAudioInspection> {
  const session = new InspectionSession();
  let timer: number = -1;
  const work = async (): Promise<ReferenceAudioInspection> => {
    const created = await media.createAVMetadataExtractor();
    // 创建操作也可能超时；迟到的实例必须释放，不能再使用已关闭的文件。
    if (session.expired) {
      await created.release();
      throw new ReferenceAudioInspectionError('读取音频时长超时，请重新选择录音。');
    }
    session.extractor = created;
    created.fdSrc = { fd: fd, offset: 0, length: length };
    const metadata = await created.fetchMetadata();
    return validateReferenceAudioDuration(metadata.duration);
  };
  const timeout = new Promise<ReferenceAudioInspection>((_resolve, reject) => {
    timer = setTimeout(() => {
      session.expired = true;
      reject(new ReferenceAudioInspectionError('读取音频时长超时，请重新选择录音。'));
    }, 10000);
  });
  try {
    return await Promise.race([work(), timeout]);
  } catch (error) {
    if (error instanceof ReferenceAudioInspectionError) throw error;
    throw new ReferenceAudioInspectionError('无法读取音频时长，文件可能损坏或格式不受支持，请重新选择录音。');
  } finally {
    session.expired = true;
    clearTimeout(timer);
    if (session.extractor) {
      try { await session.extractor.release(); } catch (_) { /* 释放失败不得掩盖原始检查结果。 */ }
    }
  }
}
