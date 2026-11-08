import {ConfigurationError} from './config';
import {createCastingEngine} from './casting';
import {listAudio} from './repository';
import {nativeCall} from './native';

/** 在获取章节和调用模型前，确认自动配音可选用的旁白录音真实存在。 */
export async function assertNarratorAvailable(): Promise<void> {
  const records = await listAudio();
  const casting = createCastingEngine({}, records);
  for (const record of records) {
    if (
      !record.disabled &&
      casting.parseAudioRecordName(record.name)?.emotion === 'narration' &&
      (await nativeCall<boolean>('exists', {uri: record.url}))
    ) {
      return;
    }
  }
  throw new ConfigurationError(
    '缺少可用的旁白参考录音，请先在音色库启用或导入“声线-旁白-性别”或“声线-narration-性别”录音，再开始听书。',
    'storage',
  );
}
