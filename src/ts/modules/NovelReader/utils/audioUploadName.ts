export interface AudioNameFields {
  voiceActor: string;
  emotion: string;
  gender: string;
}

const emotions: Record<string, string> = {
  happy: '高兴',
  开心: '高兴',
  高兴: '高兴',
  angry: '愤怒',
  生气: '愤怒',
  愤怒: '愤怒',
  sad: '悲伤',
  悲伤: '悲伤',
  fearful: '害怕',
  害怕: '害怕',
  恐惧: '害怕',
  disgusted: '厌恶',
  厌恶: '厌恶',
  melancholy: '忧郁',
  忧郁: '忧郁',
  忧伤: '忧郁',
  surprised: '惊讶',
  惊讶: '惊讶',
  neutral: '平静',
  平静: '平静',
  narration: '旁白',
  旁白: '旁白',
};
const genders: Record<string, string> = {
  male: '男',
  m: '男',
  男: '男',
  female: '女',
  f: '女',
  女: '女',
};
const normalize = (value: string, aliases: Record<string, string>) => {
  const trimmed = value.trim();
  const key = trimmed.toLowerCase();
  return Object.prototype.hasOwnProperty.call(aliases, key)
    ? aliases[key]
    : trimmed;
};

/** 只预填能够可靠拆分的名称；随机文件名仅作为名字候选。 */
export function parseAudioNameDraft(baseName: string): AudioNameFields {
  const parts = baseName.split('-');
  return {
    voiceActor: parts.length === 1 || parts.length === 3 ? parts[0].trim() : '',
    emotion: parts.length === 3 ? normalize(parts[1], emotions) : '',
    gender: parts.length === 3 ? normalize(parts[2], genders) : '',
  };
}

/** 不采用匹配器的未知情绪兜底，防止错误名称被当作平静音频导入。 */
export function validateAudioName(fields: AudioNameFields) {
  const normalized = {
    voiceActor: fields.voiceActor.trim(),
    emotion: normalize(fields.emotion, emotions),
    gender: normalize(fields.gender, genders),
  };
  const errors: Partial<Record<keyof AudioNameFields, string>> = {};
  if (!normalized.voiceActor) {
    errors.voiceActor = '请输入名字';
  }
  if (
    ![
      '高兴',
      '愤怒',
      '悲伤',
      '害怕',
      '厌恶',
      '忧郁',
      '惊讶',
      '平静',
      '旁白',
    ].includes(normalized.emotion)
  ) {
    errors.emotion = '请输入支持的情绪，旁白录音请填“旁白”';
  }
  if (!['男', '女'].includes(normalized.gender)) {
    errors.gender = '请输入性别：男或女';
  }
  for (const field of Object.keys(normalized) as Array<keyof AudioNameFields>) {
    if (/[-\r\n]/.test(fields[field])) {
      errors[field] = '不能包含“-”或换行';
    }
  }
  const valid = Object.keys(errors).length === 0;
  return {
    errors,
    valid,
    name: valid
      ? `${normalized.voiceActor}-${normalized.emotion}-${normalized.gender}`
      : '',
  };
}

/** 导入入口再次检查完整名称，确保复制文件前拦截非法值。 */
export function requireAudioUploadName(name: string): string {
  if (name.split('-').length !== 3) {
    throw new Error('音频名称必须为：名字-情绪-性别');
  }
  const [voiceActor, emotion, gender] = name.split('-');
  const result = validateAudioName({voiceActor, emotion, gender});
  if (!result.valid) {
    throw new Error(Object.values(result.errors).join('；'));
  }
  return result.name;
}
