import {AudioOption, VoicePool} from '../types/audio';
import {GlobalAudioBindings, ListenSegment} from '../types/reader';
import {createTextHash} from '../utils/listenBook';
import {nativeCall, readDocument, writeDocument} from './native';

export interface LocalAudio extends AudioOption {
  url: string;
  mime: string;
  siliconVoices?: Record<string, string>;
}
export interface Character {
  name: string;
  aliases: string[];
  description?: string;
  gender?: string;
}
export interface LocalChapter {
  sourceText?: string;
  contentHash: string;
  configHash: string;
  segments: ListenSegment[];
  phase: string;
  error?: string;
  taskId?: string;
}
export interface LocalProject {
  characters: Record<string, Character>;
  bindings: GlobalAudioBindings;
  overrides: Record<string, string | null>;
  settings: {missingEmotionPolicy: 'strict' | 'fallback_neutral'};
  casting: object;
  chapters: Record<string, LocalChapter>;
}
export const emptyProject = (): LocalProject => ({
  characters: {},
  bindings: {},
  overrides: {},
  settings: {missingEmotionPolicy: 'fallback_neutral'},
  casting: {},
  chapters: {},
});
let writes: Promise<unknown> = Promise.resolve();
/** 串行化读改写，防止音色上传、编辑和生成互相覆盖。 */
export function serialized<T>(work: () => Promise<T>): Promise<T> {
  const next = writes.then(work, work);
  writes = next.catch(() => undefined);
  return next;
}
const projectKey = (name: string) => `project-${createTextHash(name)}.json`;
const projectVersions = new Map<string, number>();
export const loadProject = (name: string) =>
  readDocument(projectKey(name), emptyProject());
export async function updateProject<T>(
  name: string,
  update: (project: LocalProject) => T,
): Promise<T> {
  const version = projectVersions.get(name) || 0;
  return serialized(async () => {
    if (version !== (projectVersions.get(name) || 0)) {
      throw new Error('书籍已删除，本次修改已取消。');
    }
    const project = await loadProject(name);
    const result = update(project);
    await writeDocument(projectKey(name), project);
    return result;
  });
}
export const listAudio = () =>
  readDocument<LocalAudio[]>('references.json', []);

/** 串行删除书籍私有文件，全局配置与参考录音不参与清理。 */
export function deleteProjectFiles(
  name: string,
  extraUris: string[],
  cleanup: (chapterIndexes: number[]) => Promise<void>,
): Promise<void> {
  return serialized(async () => {
    const project = await loadProject(name);
    const uris = new Set(extraUris);
    for (const chapter of Object.values(project.chapters)) {
      for (const segment of chapter.segments) {
        if (segment.audioUrl) {
          uris.add(segment.audioUrl);
        }
        if (segment.localAudioUrl) {
          uris.add(segment.localAudioUrl);
        }
      }
    }
    await cleanup(Object.keys(project.chapters).map(Number));
    // 旧版本依据片段引用清理，新文件还带书籍标识以覆盖被替换的音频。
    await nativeCall('deleteProject', {
      key: projectKey(name),
      uris: [...uris].filter(uri =>
        /\/voiceweaver\/generated-[^/]+$/.test(uri),
      ),
    });
    projectVersions.set(name, (projectVersions.get(name) || 0) + 1);
  });
}
export function updateAudio(
  update: (records: LocalAudio[]) => LocalAudio[],
): Promise<void> {
  return serialized(async () => {
    await writeDocument('references.json', update(await listAudio()));
  });
}
export async function importAudio(
  uri: string,
  fileName: string,
  name: string,
  mime: string,
): Promise<void> {
  const localUri = await nativeCall<string>('importAudio', {
    uri,
    extension: fileName.split('.').pop() || 'wav',
  });
  await updateAudio(records => [
    ...records,
    {
      id: `voice_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      name,
      url: localUri,
      mime,
      sampleText: '',
      voicePool: 'general',
      createTime: new Date().toISOString(),
    },
  ]);
}
export async function deleteAudio(id: string): Promise<void> {
  const record = (await listAudio()).find(item => item.id === id);
  if (record) {
    await nativeCall('deleteAudio', {uri: record.url});
  }
  await updateAudio(records => records.filter(item => item.id !== id));
}
export const setVoicePool = (voiceActor: string, pool: VoicePool) =>
  updateAudio(records =>
    records.map(item =>
      item.name.split('-')[0] === voiceActor
        ? {...item, voicePool: pool}
        : item,
    ),
  );
