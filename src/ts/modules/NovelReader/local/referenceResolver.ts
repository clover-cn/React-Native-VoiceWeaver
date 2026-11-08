import {
  AudioReferenceConfig,
  GlobalAudioBindings,
  ListenSegment,
} from '../types/reader';

/** 与生成请求共用的最终参考音频解析，保留片段指定优先级。 */
export function resolveReference(
  segment: ListenSegment,
  bindings: GlobalAudioBindings,
) {
  const role = {
    ...segment.autoEmotionAudioMap,
    ...bindings[segment.role || ''],
  };
  const blocked = segment.manualAssigned && segment.referenceAudio === null;
  const emotion = segment.emotion || 'neutral';
  const reference = blocked
    ? undefined
    : segment.referenceAudio ||
      role[emotion] ||
      (segment.missingEmotionPolicy === 'strict' ? undefined : role.neutral);
  const recordId =
    reference?.id ||
    (reference?.mode === 3
      ? segment.referenceSpeakerId || role.neutral?.id
      : undefined);
  return {role, reference, recordId, blocked};
}

/** IndexTTS2 的说话人、情绪录音必须分别展示，向量情绪无需第二条录音。 */
export function referenceLinks(
  segment: ListenSegment,
  bindings: GlobalAudioBindings,
  provider: string,
) {
  const resolved = resolveReference(segment, bindings);
  const {reference, recordId, role} = resolved;
  if (!recordId) return [];
  const speaker =
    provider === 'indextts2' && (reference?.mode === 2 || reference?.mode === 3)
      ? segment.referenceSpeakerId || role.neutral?.id || recordId
      : recordId;
  const links = [{audioId: speaker, kind: 'voice' as 'voice' | 'emotion'}];
  if (provider === 'indextts2' && reference?.mode === 2)
    links.push({audioId: recordId, kind: 'emotion'});
  return links;
}

const same = (
  a?: AudioReferenceConfig | null,
  b?: AudioReferenceConfig | null,
) => JSON.stringify(a || null) === JSON.stringify(b || null);

/** 旧版 manualAssigned 同时代表角色绑定和片段特例，不能一律覆盖。 */
export function assignmentSource(
  segment: ListenSegment,
  bindings: GlobalAudioBindings,
): NonNullable<ListenSegment['assignmentSource']> {
  if (segment.assignmentSource) return segment.assignmentSource;
  const binding = bindings[segment.role || ''];
  const expected =
    binding?.[segment.emotion || 'neutral'] ||
    (segment.missingEmotionPolicy === 'strict' ? undefined : binding?.neutral);
  if (expected && same(expected, segment.referenceAudio)) return 'role';
  if (!segment.manualAssigned) return 'auto';
  return 'legacy';
}

export function referenceSignature(
  segment: ListenSegment,
  bindings: GlobalAudioBindings,
  provider: string,
) {
  const resolved = resolveReference(segment, bindings);
  return JSON.stringify({
    reference: resolved.reference || null,
    blocked: Boolean(resolved.blocked),
    links: referenceLinks(segment, bindings, provider),
  });
}
