import {nativeCall} from './native';

export type TtsProvider = 'siliconflow' | 'mimoTTS' | 'indextts2';
export type SettingsGroup =
  | 'llm'
  | 'prescan'
  | 'tts'
  | 'generation'
  | 'advanced'
  | 'storage';
export interface ModelConfig {
  endpoint: string;
  apiKey: string;
  model: string;
}
export interface EngineConfig {
  version: 1;
  llm: ModelConfig;
  prescan: ModelConfig & {independent: boolean};
  provider: TtsProvider;
  siliconflow: ModelConfig & {uploadEndpoint: string};
  mimoTTS: ModelConfig & {stylePrompt: string; sampleRate: number};
  indextts2: {endpoint: string; apiKey: string};
  generation: {
    prescanCount: number;
    prefetchCount: number;
    background: boolean;
  };
  advanced: {
    llmTimeout: number;
    ttsTimeout: number;
    coreMinChapters: number;
    coreMinDialogues: number;
    temporaryMaxChapters: number;
    temporaryMaxDialogues: number;
  };
}
export const defaultConfig = (): EngineConfig => ({
  version: 1,
  llm: {
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    apiKey: '',
    model: 'deepseek-chat',
  },
  prescan: {
    independent: false,
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    apiKey: '',
    model: 'deepseek-chat',
  },
  provider: 'siliconflow',
  siliconflow: {
    endpoint: 'https://api.siliconflow.cn/v1/audio/speech',
    uploadEndpoint: 'https://api.siliconflow.cn/v1/uploads/audio/voice',
    apiKey: '',
    model: '',
  },
  mimoTTS: {
    endpoint: 'https://api.xiaomimimo.com/v1/chat/completions',
    apiKey: '',
    model: 'mimo-v2.5-tts-voiceclone',
    stylePrompt: '',
    sampleRate: 24000,
  },
  indextts2: {endpoint: '', apiKey: ''},
  generation: {prescanCount: 10, prefetchCount: 2, background: true},
  advanced: {
    llmTimeout: 120000,
    ttsTimeout: 120000,
    coreMinChapters: 3,
    coreMinDialogues: 8,
    temporaryMaxChapters: 1,
    temporaryMaxDialogues: 3,
  },
});

export class ConfigurationError extends Error {
  constructor(message: string, public group: SettingsGroup) {
    super(message);
  }
}
export function validateTtsConfig(config: EngineConfig): void {
  const model = config[config.provider];
  if (!model.endpoint.trim()) {
    throw new ConfigurationError('请填写语音合成 API 地址。', 'tts');
  }
  if (config.provider !== 'indextts2') {
    if (!model.apiKey.trim()) {
      throw new ConfigurationError('请填写语音合成 API Key。', 'tts');
    }
    if (!('model' in model) || !model.model.trim()) {
      throw new ConfigurationError('请填写语音合成模型。', 'tts');
    }
  }
  if (config.provider === 'mimoTTS' && !config.mimoTTS.stylePrompt.trim()) {
    throw new ConfigurationError('请填写 Mimo 风格指令。', 'advanced');
  }
}
const endpointValid = (value: string) =>
  /^https?:\/\/[^\s/?#]+[^\s]*$/.test(value) && !/[?#]/.test(value);
export function validateConfig(
  config: EngineConfig,
  requireReady = false,
): void {
  const models = [
    ['llm', config.llm],
    ['prescan', config.prescan],
    ['tts', config.siliconflow],
    ['tts', config.mimoTTS],
    ['tts', config.indextts2],
  ] as const;
  for (const [group, model] of models) {
    if (model.endpoint && !endpointValid(model.endpoint)) {
      throw new ConfigurationError(
        '请输入有效的完整 API 请求地址，不包含查询参数。',
        group,
      );
    }
    if (/[\r\n]/.test(model.apiKey)) {
      throw new ConfigurationError('API Key 不能包含换行。', group);
    }
  }
  if (!endpointValid(config.siliconflow.uploadEndpoint)) {
    throw new ConfigurationError('音色上传地址无效。', 'tts');
  }
  for (const [name, value, min, max] of [
    ['预扫描章节数', config.generation.prescanCount, 0, 100],
    ['预取章节数', config.generation.prefetchCount, 0, 20],
    ['解析超时', config.advanced.llmTimeout, 1000, 600000],
    ['生成超时', config.advanced.ttsTimeout, 1000, 600000],
    ['核心角色章节数', config.advanced.coreMinChapters, 1, 100],
    ['核心角色对白数', config.advanced.coreMinDialogues, 1, 10000],
    ['临时角色章节数', config.advanced.temporaryMaxChapters, 1, 100],
    ['临时角色对白数', config.advanced.temporaryMaxDialogues, 1, 10000],
    ['采样率', config.mimoTTS.sampleRate, 8000, 96000],
  ] as const) {
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new ConfigurationError(
        `${name}必须是 ${min}–${max} 的整数。`,
        name.includes('章节数') && name.startsWith('预')
          ? 'generation'
          : 'advanced',
      );
    }
  }
  if (!requireReady) {
    return;
  }
  for (const [label, model, group] of [
    ['正文解析', config.llm, 'llm'],
    ...(config.prescan.independent && config.generation.prescanCount > 0
      ? [['角色预扫描', config.prescan, 'prescan']]
      : []),
    ['语音合成', config[config.provider], 'tts'],
  ] as Array<
    [string, {endpoint: string; apiKey: string; model?: string}, SettingsGroup]
  >) {
    if (!model.endpoint.trim()) {
      throw new ConfigurationError(`请填写${label} API 地址。`, group);
    }
    if (config.provider !== 'indextts2' || group !== 'tts') {
      if (!model.apiKey.trim()) {
        throw new ConfigurationError(`请填写${label} API Key。`, group);
      }
      if (!model.model?.trim()) {
        throw new ConfigurationError(`请填写${label}模型。`, group);
      }
    }
  }
  if (config.provider === 'mimoTTS' && !config.mimoTTS.stylePrompt.trim()) {
    throw new ConfigurationError('请填写 Mimo 风格指令。', 'advanced');
  }
}

export async function loadConfig(): Promise<EngineConfig> {
  const text = await nativeCall<string | null>('loadConfig');
  if (!text) {
    return defaultConfig();
  }
  const saved = JSON.parse(text) as EngineConfig;
  const defaults = defaultConfig();
  return {
    ...defaults,
    ...saved,
    llm: {...defaults.llm, ...saved.llm},
    prescan: {...defaults.prescan, ...saved.prescan},
    siliconflow: {...defaults.siliconflow, ...saved.siliconflow},
    mimoTTS: {...defaults.mimoTTS, ...saved.mimoTTS},
    indextts2: {...defaults.indextts2, ...saved.indextts2},
    generation: {...defaults.generation, ...saved.generation},
    advanced: {...defaults.advanced, ...saved.advanced},
  };
}
export async function saveConfig(config: EngineConfig): Promise<void> {
  validateConfig(config);
  await nativeCall('saveConfig', {text: JSON.stringify(config)});
}
