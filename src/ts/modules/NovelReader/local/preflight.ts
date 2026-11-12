import {ConfigurationError} from './config';
import {createCastingEngine} from './casting';
import {listAudio, loadProject} from './repository';
import {nativeCall} from './native';

/** 在获取章节和调用模型前，确认自动配音可选用的旁白录音真实存在。 */
export async function assertNarratorAvailable(
  projectName?: string,
): Promise<void> {
  const project = projectName ? await loadProject(projectName) : undefined;
  if (project?.listenMode === 'plain' && project.articleReferenceAudioId) {
    await assertArticleReferenceAvailable(project.articleReferenceAudioId);
    return;
  }
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

/** 文章显式选择的录音必须可用，不悄悄改回旁白。 */
export async function assertArticleReferenceAvailable(
  id: string,
): Promise<void> {
  const record = (await listAudio()).find(item => item.id === id);
  if (
    !record ||
    record.disabled ||
    !(await nativeCall<boolean>('exists', {uri: record.url}))
  ) {
    throw new ConfigurationError(
      '文章选择的参考音频已删除、禁用或文件不存在，请重新选择参考音频。',
      'storage',
    );
  }
}
