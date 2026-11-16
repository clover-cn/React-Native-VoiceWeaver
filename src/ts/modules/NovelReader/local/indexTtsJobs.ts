import {ListenSegment} from '../types/reader';
import {createTextHash} from '../utils/listenBook';

export interface JobResponse {
  status: number;
  text?: string;
  uri?: string;
}
export type JobRequest = (
  payload: object,
  signal: AbortSignal,
) => Promise<JobResponse>;
export type SpeechCheckpoint = (phase?: string) => Promise<void>;

/** 保留服务器任务引用，让用户恢复等待而不是重新推理。 */
export class IndexTtsPending extends Error {}
export class ModelHttpError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export const indexTtsJobsEndpoint = (endpoint: string): string => {
  if (!/\/api\/tts\/upload\/?$/.test(endpoint)) {
    throw new Error('IndexTTS 完整端点必须以 /api/tts/upload 结尾。');
  }
  return endpoint.replace(/\/upload\/?$/, '/jobs');
};

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('任务已取消'));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(new Error('任务已取消'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort);
  });
}

interface RemoteJob {
  job_id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  protocol_version: number;
  queue_position?: number;
}

function parseJob(result: JobResponse): RemoteJob {
  const job = JSON.parse(result.text || '{}') as RemoteJob;
  if (
    job.protocol_version !== 1 ||
    !/^[a-f0-9]{32}$/.test(job.job_id) ||
    !['queued', 'running', 'succeeded', 'failed', 'cancelled'].includes(
      job.status,
    )
  ) {
    throw new Error('IndexTTS 任务协议不匹配，请更新配套 api_server.py。');
  }
  return job;
}

/** 每段持久化幂等编号；网络失败与等待超限不丢弃服务器任务。 */
export async function generateIndexTtsJob(
  segment: ListenSegment,
  endpoint: string,
  headers: Record<string, string>,
  fields: Record<string, string>,
  files: {name: string; uri: string; mime: string}[],
  owner: string | undefined,
  waitHours: number,
  signal: AbortSignal,
  request: JobRequest,
  checkpoint: SpeechCheckpoint = async () => undefined,
): Promise<JobResponse> {
  const url = indexTtsJobsEndpoint(endpoint);
  const fingerprint = createTextHash(JSON.stringify([url, fields, files]));
  if (
    segment.indexTtsJob?.fingerprint !== fingerprint ||
    segment.indexTtsJob?.endpoint !== url
  ) {
    segment.indexTtsJob = {
      endpoint: url,
      fingerprint,
      clientRequestId: `tts_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2)}`,
    };
  }
  const saved = segment.indexTtsJob;
  await checkpoint('tts_queued');
  const started = Date.now();
  let phase = '';
  const common = {headers, timeout: 30000};
  try {
    if (!saved.jobId) {
      let result: JobResponse;
      try {
        result = await request(
          {
            url,
            ...common,
            fields: {...fields, client_request_id: saved.clientRequestId},
            files,
          },
          signal,
        );
      } catch (error) {
        if (
          error instanceof ModelHttpError &&
          [404, 405].includes(error.status)
        ) {
          throw new Error(
            'IndexTTS 服务不支持任务接口，请更新配套 api_server.py 后重试。',
          );
        }
        throw error;
      }
      const job = parseJob(result);
      saved.jobId = job.job_id;
      saved.status = job.status;
      await checkpoint('tts_queued');
    }
    while (true) {
      if (Date.now() - started >= waitHours * 3600000) {
        throw new IndexTtsPending(
          'IndexTTS 任务尚未完成，已保留编号，请稍后恢复生成。',
        );
      }
      let result: JobResponse;
      try {
        result = await request(
          {url: `${url}/${saved.jobId}`, method: 'GET', ...common},
          signal,
        );
      } catch (error) {
        if (error instanceof ModelHttpError && error.status === 404) {
          segment.indexTtsJob = undefined;
          await checkpoint();
          throw new Error('IndexTTS 任务已失效，请重试生成。');
        }
        throw error;
      }
      const job = parseJob(result);
      if (job.job_id !== saved.jobId) {
        throw new Error('IndexTTS 返回了不匹配的任务编号。');
      }
      saved.status = job.status;
      if (['failed', 'cancelled'].includes(job.status)) {
        segment.indexTtsJob = undefined;
        await checkpoint();
        throw new Error(
          job.status === 'failed'
            ? 'IndexTTS 模型推理失败或服务重启中断，请查看服务端日志并重试。'
            : 'IndexTTS 服务器任务已取消，请重试生成。',
        );
      }
      const nextPhase =
        job.status === 'succeeded'
          ? 'tts_downloading'
          : job.status === 'queued'
          ? 'tts_queued'
          : 'tts_running';
      if (nextPhase !== phase) {
        phase = nextPhase;
        await checkpoint(phase);
      }
      if (job.status === 'succeeded') {
        try {
          const audio = await request(
            {
              url: `${url}/${saved.jobId}/audio`,
              method: 'GET',
              ...common,
              audio: true,
              extension: '.wav',
              ...(owner ? {owner} : {}),
            },
            signal,
          );
          if (!audio.uri) {
            throw new Error('IndexTTS 音频下载没有返回本地文件。');
          }
          return audio;
        } catch (error) {
          if (error instanceof ModelHttpError && error.status === 404) {
            segment.indexTtsJob = undefined;
            await checkpoint();
            throw new Error('IndexTTS 音频结果已失效，请重试生成。');
          }
          throw error;
        }
      }
      await sleep(3000, signal);
    }
  } catch (error) {
    if (
      signal.aborted ||
      !segment.indexTtsJob ||
      error instanceof IndexTtsPending ||
      (error instanceof Error && error.name === 'AudioAvailabilityChanged')
    ) {
      throw error;
    }
    if (
      error instanceof ModelHttpError &&
      [400, 401, 403, 404, 405, 409, 422].includes(error.status)
    ) {
      throw error;
    }
    if (/更新配套|协议不匹配|任务编号/.test(String(error))) {
      throw error;
    }
    throw new IndexTtsPending(
      'IndexTTS 连接或下载中断，已保留任务编号，请恢复生成以继续查询。',
    );
  }
}
