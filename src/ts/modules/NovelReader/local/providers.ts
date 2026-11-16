import {ListenSegment, GlobalAudioBindings} from '../types/reader';
import {createTextHash} from '../utils/listenBook';
import {EngineConfig, ModelConfig} from './config';
import {logModelFailure, logModelProgress, nativeCall} from './native';
import {listAudio, updateAudio} from './repository';
import {availableSegment, AvailabilityContext} from './audioAvailability';
import {parseLlmResponse} from './llmStream';
import {designPrompt, usesVoiceDesign} from './voiceDesign';
import {diagnosticLog} from './native';
import {registerLogSecrets} from './logSafety';
import {generateIndexTtsJob, indexTtsJobsEndpoint, ModelHttpError, SpeechCheckpoint} from './indexTtsJobs';

interface NativeResponse {
  status: number;
  text?: string;
  uri?: string;
  retryAfter?: string;
}
export interface RequestScope {
  signal: AbortSignal;
}
/** 只展示错误摘要；移除请求密钥，HTML 网关页面不直接回显。 */
function responseErrorDetail(result: NativeResponse, payload: object): string {
  const text = (result.text || '').trim();
  if (!text) {
    return '对端未提供错误正文，请检查入口反向代理及中转站日志。';
  }
  if (/^\s*</.test(text)) {
    return '对端返回 HTML 错误页，请检查入口网关、反向代理或网络代理。';
  }
  let detail = '';
  try {
    const body = JSON.parse(text);
    const message = body?.error?.message || body?.message || body?.detail || body?.error;
    detail = typeof message === 'string' ? message : '';
  } catch (_) {
    return '对端返回非 JSON 错误正文，请检查中转站或入口代理日志。';
  }
  if (!detail) {
    return '对端返回 JSON 错误，但未提供文字说明。';
  }
  const headers = (payload as {headers?: Record<string, string>}).headers || {};
  for (const [name, value] of Object.entries(headers)) {
    if (/authorization|api[-_]?key|token|secret/i.test(name)) {
      for (const secret of [value, value.replace(/^Bearer\s+/i, '')]) {
        if (secret) {
          detail = detail.split(secret).join('[已隐藏]');
        }
      }
    }
  }
  return detail
    .replace(/Bearer\s+[^\s"'<>]+/gi, 'Bearer [已隐藏]')
    .replace(/\bsk-[A-Za-z0-9_-]+/g, '[已隐藏]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 500);
}
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('任务已取消'));
      return;
    }
    const cancel = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      reject(new Error('任务已取消'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', cancel);
      resolve();
    }, ms);
    signal.addEventListener('abort', cancel);
  });
}
export async function modelRequest(
  payload: object,
  signal: AbortSignal,
  stage = '',
  beforeAttempt?: () => Promise<void>,
  retryTransport = false,
): Promise<NativeResponse> {
  if (signal.aborted) {
    throw new Error('任务已取消');
  }
  const id = `request_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const startedAt = Date.now();
  const request = payload as {headers?: Record<string, string>; body?: string; audio?: boolean; referenceUri?: string};
  registerLogSecrets(request.headers);
  let model = '';
  try { model = JSON.parse(request.body || '{}').model || ''; } catch (_) {}
  diagnosticLog('INFO', 'request.start', {id, stage, model, audio: request.audio, reference: Boolean(request.referenceUri)});
  const abort = () => {
    void nativeCall('cancel', {id}).catch(() => undefined);
  };
  signal.addEventListener('abort', abort);
  try {
    await beforeAttempt?.();
    if (signal.aborted) {
      throw new Error('任务已取消');
    }
    let result: NativeResponse;
    try {
      result = await nativeCall<NativeResponse>('request', {id, ...payload});
    } catch (error) {
      // 原生超时也走一次有限重试，取消和其他异常直接保留。
      if (signal.aborted || (!retryTransport && !/timeout|timed out|超时/i.test(String(error)))) {
        throw error;
      }
      diagnosticLog('WARN', 'request.timeout', {id, stage, error: String(error)});
      result = {status: 504};
    }
    if (!signal.aborted && (result.status === 429 || result.status >= 500)) {
      diagnosticLog('WARN', 'request.retry', {id, stage, status: result.status, attempt: 1});
      const value = result.retryAfter || '';
      const retryAfter = /^\d+$/.test(value)
        ? Number(value) * 1000
        : Math.max(0, Date.parse(value) - Date.now()) || 0;
      await wait(
        result.status === 429 ? Math.max(20000, retryAfter) : 2000,
        signal,
      );
      logModelProgress(
        `${stage || '模型请求'}：HTTP ${result.status}，准备重试 1/1`,
      );
      await beforeAttempt?.();
      if (signal.aborted) {
        throw new Error('任务已取消');
      }
      result = await nativeCall<NativeResponse>('request', {id, ...payload});
    }
    if (signal.aborted) {
      throw new Error('任务已取消');
    }
    if (result.status < 200 || result.status >= 300) {
      const failure =
        result.status === 401 || result.status === 403
          ? '模型服务鉴权失败，请检查 API Key。'
          : result.status === 429
          ? '模型服务限流，请稍后重试。'
          : `模型服务请求失败 (${result.status})：${responseErrorDetail(
              result,
              payload,
            )}`;
      const message = stage ? `[${stage}] ${failure}` : failure;
      logModelFailure(message);
      throw new ModelHttpError(message, result.status);
    }
    diagnosticLog('INFO', 'request.done', {id, stage, model, status: result.status, elapsedMs: Date.now() - startedAt});
    return result;
  } catch (error) {
    diagnosticLog('ERROR', 'request.failed', {id, stage, model, elapsedMs: Date.now() - startedAt, cancelled: signal.aborted, error: String(error)});
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
export async function callLlm(
  model: ModelConfig,
  system: string,
  text: string,
  timeout: number,
  signal: AbortSignal,
  stage = '正文解析',
): Promise<any> {
  const startedAt = Date.now();
  const modelName = model.model
    .split(model.apiKey || '\u0000')
    .join('[已隐藏]');
  logModelProgress(
    `${stage}开始：模型=${modelName}，输入=${text.length} 字符，提示词=${system.length} 字符，等待数据超时=${timeout}ms，流式接收`,
  );
  try {
    const result = await modelRequest(
      {
        url: model.endpoint,
        timeout,
        stream: true,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          Authorization: `Bearer ${model.apiKey}`,
        },
        body: JSON.stringify({
          model: model.model,
          messages: [
            {role: 'system', content: system},
            {role: 'user', content: text},
          ],
          temperature: 0.1,
          stream: true,
        }),
      },
      signal,
      stage,
    );
    const content = parseLlmResponse(result.text || '');
    const parsed = JSON.parse(
      content
        .replace(/^\s*```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/, '')
        .trim(),
    );
    logModelProgress(`${stage}完成：耗时=${Date.now() - startedAt}ms`);
    return parsed;
  } catch (error) {
    logModelProgress(
      `${stage}${signal.aborted ? '取消' : '失败'}：耗时=${
        Date.now() - startedAt
      }ms`,
    );
    throw error;
  }
}

class AudioAvailabilityChanged extends Error {
  name = 'AudioAvailabilityChanged';
}

/** 禁用状态在上传或重试等待期间改变时，重新选音后再发送请求。 */
export async function generateSpeech(
  segment: ListenSegment,
  config: EngineConfig,
  bindings: GlobalAudioBindings,
  signal: AbortSignal,
  projectName?: string,
  availability?: AvailabilityContext,
  checkpoint?: SpeechCheckpoint,
): Promise<string> {
  const startedAt = Date.now();
  const context = {
    project: projectName, chapter: availability ? availability.chapterIndex + 1 : undefined,
    segment: (segment.index ?? -1) + 1, role: segment.role, roleId: segment.roleId,
    emotion: segment.emotion, provider: usesVoiceDesign(segment) ? 'mimoTTS' : config.provider,
    mode: segment.synthesisMode || 'reference', manual: segment.manualAssigned,
    referenceId: segment.referenceAudio?.id,
    textHash: createTextHash(segment.text), textLength: segment.text.length,
  };
  diagnosticLog('INFO', 'speech.start', context);
  try {
    const uri = await generateSpeechInternal(segment, config, bindings, signal, projectName, availability, checkpoint);
    diagnosticLog('INFO', 'speech.done', {...context, elapsedMs: Date.now() - startedAt});
    return uri;
  } catch (error) {
    diagnosticLog('ERROR', 'speech.failed', {...context, elapsedMs: Date.now() - startedAt,
      cancelled: signal.aborted, error: String(error)});
    throw error;
  }
}

async function generateSpeechInternal(
  segment: ListenSegment,
  config: EngineConfig,
  bindings: GlobalAudioBindings,
  signal: AbortSignal,
  projectName?: string,
  availability?: AvailabilityContext,
  checkpoint?: SpeechCheckpoint,
): Promise<string> {
  if (usesVoiceDesign(segment)) {
    const mimo = config.mimoTTS;
    if (!mimo?.endpoint?.trim() || !mimo.apiKey?.trim()) {
      throw new Error('路人文本设计音色缺少 MiMo 配置，请在语音设置中填写共用的 MiMo API 地址和密钥。');
    }
    if (!Number.isInteger(mimo.sampleRate) || mimo.sampleRate < 8000 || mimo.sampleRate > 96000) {
      throw new Error('路人 MiMo PCM 采样率需为 8000–96000 的整数。');
    }
    const result = await modelRequest({
      url: mimo.endpoint,
      timeout: config.advanced.ttsTimeout,
      audio: true,
      pcm: true,
      sampleRate: mimo.sampleRate,
      ...(projectName ? {owner: createTextHash(projectName)} : {}),
      headers: {'api-key': mimo.apiKey, 'Content-Type': 'application/json'},
      body: JSON.stringify({
        model: segment.voiceDesignFallback ? 'mimo-v2.5-tts' : 'mimo-v2.5-tts-voicedesign',
        messages: [
          {role: 'user', content: designPrompt(segment)},
          {role: 'assistant', content: segment.text},
        ],
        audio: {format: 'pcm16', optimize_text_preview: false,
          ...(segment.voiceDesignFallback ? {voice: 'mimo_default'} : {})},
        stream: false,
      }),
    }, signal, `语音 ${segment.role || '旁白'} / 片段 ${(segment.index ?? -1) + 1}`);
    if (!result.uri) {
      throw new Error('路人文本设计音色没有返回本地音频，请重试本句。');
    }
    return result.uri;
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await generateAvailableSpeech(
        segment,
        config,
        bindings,
        signal,
        projectName,
        availability,
        checkpoint,
      );
    } catch (error) {
      if (!(error instanceof AudioAvailabilityChanged)) {
        throw error;
      }
    }
  }
  throw new Error('音频启用状态连续变化，请稍后重新生成。');
}

async function generateAvailableSpeech(
  segment: ListenSegment,
  config: EngineConfig,
  bindings: GlobalAudioBindings,
  signal: AbortSignal,
  projectName?: string,
  availability?: AvailabilityContext,
  checkpoint?: SpeechCheckpoint,
): Promise<string> {
  const records = await listAudio();
  const prepared = availableSegment(
    segment,
    bindings,
    records,
    config.provider,
    availability,
  );
  const replaced = prepared !== segment;
  Object.assign(segment, prepared);
  const role = {
    ...segment.autoEmotionAudioMap,
    ...(replaced ? {} : bindings[segment.role || '']),
  };
  const reference =
    segment.referenceAudio ||
    role[segment.emotion || 'neutral'] ||
    (segment.missingEmotionPolicy === 'strict' ? undefined : role.neutral);
  if (segment.manualAssigned && segment.referenceAudio === null) {
    throw new Error(`角色“${segment.role || '旁白'}”缺少当前情绪的参考音频。`);
  }
  const record = records.find(
    item =>
      item.id ===
      (reference?.id || (reference?.mode === 3 ? role.neutral?.id : undefined)),
  );
  if (!record) {
    throw new Error(
      reference?.id
        ? `角色“${
            segment.role || '旁白'
          }”绑定的参考录音已不存在，请重新绑定现有音色。`
        : `角色“${segment.role || '旁白'}”缺少参考音频，请配置音色。`,
    );
  }
  const provider = config.provider;
  const usedIds = [record.id];
  if (
    provider === 'indextts2' &&
    (reference?.mode === 2 || reference?.mode === 3)
  ) {
    usedIds.push(role.neutral?.id || record.id);
  }
  const speechRequest = (payload: object, requestSignal: AbortSignal) =>
    modelRequest(payload, requestSignal, `语音 ${segment.role || '旁白'} / 片段 ${(segment.index ?? -1) + 1}`, async () => {
      const latest = await listAudio();
      if (
        usedIds.some(
          id => !latest.some(item => item.id === id && !item.disabled),
        )
      ) {
        throw new AudioAvailabilityChanged();
      }
    }, config.provider === 'indextts2');
  const model = config[provider];
  const common = {
    url: model.endpoint,
    timeout: config.advanced.ttsTimeout,
    audio: true,
    ...(projectName ? {owner: createTextHash(projectName)} : {}),
  };
  let result: NativeResponse;
  if (provider === 'siliconflow') {
    const sf = config.siliconflow;
    const account = createTextHash(
      JSON.stringify([sf.endpoint, sf.uploadEndpoint, sf.apiKey, sf.model]),
    );
    let voice = record.siliconVoices?.[account];
    if (!voice) {
      const uploaded = await speechRequest(
        {
          url: sf.uploadEndpoint,
          timeout: config.advanced.ttsTimeout,
          headers: {Authorization: `Bearer ${sf.apiKey}`},
          fields: {
            model: sf.model,
            customName: record.id,
            ...(record.sampleText ? {text: record.sampleText} : {}),
          },
          files: [{name: 'file', uri: record.url, mime: record.mime}],
        },
        signal,
      );
      const data = JSON.parse(uploaded.text || '{}');
      voice = data.uri;
      if (!voice) {
        throw new Error('音色上传响应缺少 URI。');
      }
      const savedVoice = voice;
      await updateAudio(items =>
        items.map(item =>
          item.id === record.id
            ? {
                ...item,
                siliconVoices: {...item.siliconVoices, [account]: savedVoice!},
              }
            : item,
        ),
      );
    }
    result = await speechRequest(
      {
        ...common,
        headers: {Authorization: `Bearer ${sf.apiKey}`},
        body: JSON.stringify({
          model: sf.model,
          input: segment.text,
          voice,
          response_format: 'mp3',
        }),
      },
      signal,
    );
  } else if (provider === 'mimoTTS') {
    const mimo = config.mimoTTS;
    result = await speechRequest(
      {
        ...common,
        headers: {'api-key': mimo.apiKey, 'Content-Type': 'application/json'},
        pcm: true,
        sampleRate: mimo.sampleRate,
        referenceUri: record.url,
        referenceMime: record.mime,
        body: JSON.stringify({
          model: mimo.model,
          messages: [
            {role: 'user', content: mimo.stylePrompt.trim()},
            {role: 'assistant', content: segment.text},
          ],
          audio: {format: 'pcm16'},
          stream: false,
        }),
      },
      signal,
    );
  } else {
    const base = records.find(item => item.id === role.neutral?.id) || record;
    const files = [
      {
        name: 'spk_audio_file',
        uri:
          reference?.mode === 2 || reference?.mode === 3
            ? base.url
            : record.url,
        mime: base.mime,
      },
    ];
    const fields: Record<string, string> = {text: segment.text};
    if (reference?.mode === 2) {
      files.push({name: 'emo_audio_file', uri: record.url, mime: record.mime});
      fields.emo_alpha = String(reference.emoWeight ?? 0.65);
    } else if (reference?.mode === 3) {
      const emotions = [
        'happy',
        'angry',
        'sad',
        'fearful',
        'disgusted',
        'melancholy',
        'surprised',
        'neutral',
      ];
      fields.emo_vector = JSON.stringify(
        emotions.map(emotion =>
          emotion === (segment.emotion || 'neutral')
            ? reference.emoWeight ?? 0
            : 0,
        ),
      );
      fields.emo_alpha = '0.6';
    }
    result = await generateIndexTtsJob(
      segment, model.endpoint,
      model.apiKey ? {Authorization: `Bearer ${model.apiKey}`} : {},
      fields, files, projectName ? createTextHash(projectName) : undefined,
      config.advanced.indexTtsWaitHours || 1, signal, speechRequest, checkpoint,
    );
  }
  if (!result.uri) {
    throw new Error('语音生成没有返回本地文件。');
  }
  return result.uri;
}

/** 显式取消才通知服务器；后台暂停和章节切换继续保留任务。 */
export async function cancelIndexTtsJob(segment: ListenSegment, config: EngineConfig): Promise<void> {
  const job = segment.indexTtsJob;
  if (!job || job.status === 'succeeded') { return; }
  if (indexTtsJobsEndpoint(config.indextts2.endpoint) !== job.endpoint) {
    throw new Error('任务服务地址已更改，无法确认旧服务上的取消，请在旧服务中检查任务。');
  }
  const headers = config.indextts2.apiKey ? {Authorization: `Bearer ${config.indextts2.apiKey}`} : {};
  await modelRequest({
    url: job.endpoint.replace(/\/jobs$/, '/requests') + '/' + encodeURIComponent(job.clientRequestId),
    method: 'DELETE', timeout: 30000, headers,
  }, new AbortController().signal, '取消 IndexTTS 任务', undefined, true);
}
