import type {ListenSegment} from '../types/reader';
import type {Character} from './repository';
import type {BystanderMode} from './config';

/** 文本事实与配音设计分开保存；未知性别只在配音层采用男性兜底。 */
export function castingGender(value: {gender?: string; castingGender?: string}): string {
  if (value.gender === 'male' || value.gender === 'female') {
    return value.gender;
  }
  return value.castingGender === 'female' ? 'female' : 'male';
}

/** 同一角色固定音色，只将本句情绪作为临时表演指令。 */
export function prepareVoiceDesign(
  segment: ListenSegment,
  mode: BystanderMode,
  character?: Character,
): ListenSegment {
  if (segment.type !== 'dialogue' || segment.manualAssigned) {
    return {...segment, synthesisMode: 'reference'};
  }
  if (mode === 'audioPool') {
    return {...segment, synthesisMode: 'reference', voiceDesignFallback: undefined};
  }
  if (segment.voiceAllocationType !== 'temporary' && character?.synthesisMode !== 'voiceDesign') {
    return segment;
  }
  const gender = castingGender({
    gender: segment.textGender || character?.gender || segment.gender,
    castingGender: segment.castingGender || character?.castingGender,
  });
  const description = character?.voiceDescription || segment.voiceDescription ||
    `成年${gender === 'female' ? '女性' : '男性'}听感，普通话清楚，音高自然，共鸣适中，吐字利落，不过度表演。`;
  if (character) {
    character.synthesisMode = 'voiceDesign';
    character.voiceDescription = description;
    character.voiceProfileVersion = character.voiceProfileVersion || 1;
  }
  return {
    ...segment,
    synthesisMode: 'voiceDesign',
    castingGender: gender,
    voiceDescription: description,
    voiceProfileVersion: character?.voiceProfileVersion || 1,
    referenceAudio: undefined,
    autoEmotionAudioMap: undefined,
    autoAssignedVoiceActor: null,
  };
}

export function usesVoiceDesign(segment: ListenSegment): boolean {
  return segment.type === 'dialogue' && !segment.manualAssigned &&
    segment.synthesisMode === 'voiceDesign';
}

export function designPrompt(segment: ListenSegment): string {
  return `${segment.voiceDescription || '成年男性听感，普通话清楚，音高自然。'}\n本句表演：${segment.speechStyle || `情绪为${segment.emotion || 'neutral'}，语速正常，不过度表演。`}\n严格朗读提供的台词，不增删、不改写。`;
}
