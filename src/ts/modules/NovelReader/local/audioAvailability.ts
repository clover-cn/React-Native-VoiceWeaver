import {AudioOption} from '../types/audio';
import {GlobalAudioBindings, ListenSegment} from '../types/reader';
import {createCastingEngine} from './casting';

export interface AvailabilityContext {
  casting: object;
  cards: ListenSegment[];
  projectName: string;
  chapterIndex: number;
  environment?: object;
  replacements: Map<string, string>;
  articleReferenceAudioId?: string;
}

/** 修复禁用引用；任务内复用替代声线，不改写用户的角色绑定。 */
export function availableSegment(
  segment: ListenSegment,
  bindings: GlobalAudioBindings,
  records: AudioOption[],
  provider: string,
  context?: AvailabilityContext,
): ListenSegment {
  if (segment.manualAssigned && segment.referenceAudio === null) {
    return segment;
  }
  const role = {
    ...segment.autoEmotionAudioMap,
    ...bindings[segment.role || ''],
  };
  const reference =
    segment.referenceAudio ||
    role[segment.emotion || 'neutral'] ||
    (segment.missingEmotionPolicy === 'strict' ? undefined : role.neutral);
  const primaryId =
    reference?.id || (reference?.mode === 3 ? role.neutral?.id : undefined);
  // 用户为文章指定的录音不可用时提示重选，避免自动替换成其他声线。
  if (primaryId && primaryId === context?.articleReferenceAudioId) {
    if (!records.some(record => record.id === primaryId && !record.disabled)) {
      throw new Error('文章选择的参考音频已删除或禁用，请重新选择。');
    }
    return segment;
  }
  const speakerId =
    provider === 'indextts2' && (reference?.mode === 2 || reference?.mode === 3)
      ? role.neutral?.id || primaryId
      : primaryId;
  const engine = createCastingEngine({}, records);
  const original = records.find(record => record.id === primaryId);
  const parsed = original && engine.parseAudioRecordName(original.name);
  const narrator = segment.type === 'narration' || segment.role === '旁白';
  const key = narrator ? '旁白' : segment.role || '';
  const taskActor = context?.replacements.get(key);
  if (
    (!taskActor || taskActor === parsed?.voiceActor) &&
    ![primaryId, speakerId].some(id =>
      records.some(record => record.id === id && record.disabled),
    )
  ) {
    return segment;
  }
  const error = () =>
    new Error(
      `角色“${
        segment.role || '旁白'
      }”的参考音频已禁用，缺少可用替代音频，请启用或导入音频。`,
    );
  const available = records.filter(record => !record.disabled);
  const actorName = context?.replacements.get(key) || parsed?.voiceActor;
  const sameActor = available
    .filter(record => {
      const name = engine.parseAudioRecordName(record.name);
      return (
        name &&
        name.voiceActor === actorName &&
        (narrator ? name.emotion === 'narration' : name.emotion !== 'narration')
      );
    })
    .sort((a, b) => (b.createTime || '').localeCompare(a.createTime || ''));
  const emotion = segment.emotion || 'neutral';
  let selected =
    sameActor.find(
      record =>
        engine.parseAudioRecordName(record.name)?.emotion ===
        (narrator ? 'narration' : emotion),
    ) ||
    (segment.missingEmotionPolicy !== 'strict'
      ? sameActor.find(
          record =>
            engine.parseAudioRecordName(record.name)?.emotion === 'neutral',
        )
      : undefined);
  if (!selected) {
    // 排除不能满足当前情绪的声线，避免持久化分配阻止重新选音。
    const eligibleActors = new Set(
      available
        .filter(record => {
          const name = engine.parseAudioRecordName(record.name);
          return (
            name &&
            (name.emotion === emotion ||
              (segment.missingEmotionPolicy !== 'strict' &&
                name.emotion === 'neutral'))
          );
        })
        .map(record => engine.parseAudioRecordName(record.name)?.voiceActor),
    );
    const candidates = available.filter(record => {
      const name = engine.parseAudioRecordName(record.name);
      return (
        name &&
        (narrator
          ? name.emotion === 'narration'
          : name.emotion !== 'narration' && eligibleActors.has(name.voiceActor))
      );
    });
    const casting = createCastingEngine(
      {
        casting: context?.casting || {},
        settings: {
          missingEmotionPolicy:
            segment.missingEmotionPolicy || 'fallback_neutral',
        },
      },
      candidates,
      context?.environment || {},
    );
    const cards = (context?.cards || [segment]).map(card => ({
      ...card,
      gender:
        (card.role === segment.role ? parsed?.gender : undefined) ||
        (card as ListenSegment & {gender?: string}).gender,
      manualAssigned: false,
      referenceAudio: undefined,
    }));
    const assigned = casting.autoAssignReferenceAudios({
      parsedCards: cards,
      projectName: context?.projectName || 'availability',
      provider,
      chapterIndex: context?.chapterIndex || 0,
    });
    const card = assigned.cards.find(
      (item: ListenSegment) =>
        (narrator
          ? item.type === 'narration' || item.role === '旁白'
          : item.role === segment.role) &&
        (item.emotion || 'neutral') === emotion,
    );
    selected = candidates.find(
      record => record.id === card?.referenceAudio?.id,
    );
    if (context) {
      context.casting = casting.snapshot().casting;
    }
  }
  if (!selected) {
    throw error();
  }
  const name = engine.parseAudioRecordName(selected.name);
  if (context && name) {
    context.replacements.set(key, name.voiceActor);
  }
  const map = Object.fromEntries(
    available
      .filter(
        record =>
          engine.parseAudioRecordName(record.name)?.voiceActor ===
          name?.voiceActor,
      )
      .map(record => [
        engine.parseAudioRecordName(record.name)?.emotion,
        {id: record.id, mode: 1 as const},
      ]),
  );
  return {
    ...segment,
    referenceAudio: {id: selected.id, mode: 1},
    autoEmotionAudioMap: map,
    autoAssignedVoiceActor: name?.voiceActor,
    referenceAudioFallback: 'disabled',
  };
}
