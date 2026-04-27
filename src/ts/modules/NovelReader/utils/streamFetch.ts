import { fetch } from '@react-native-oh/react-native-harmony';

export type StreamChunkCallback = (chunk: string) => void;

/**
 * 封装支持流式读取的网络请求，替代原生 SSE 监听，适配鸿蒙网络流机制。
 * @param url 请求地址
 * @param onChunk 收到数据块的回调
 * @param customOptions 请求自定义配置
 */
export const streamFetch = async (
  url: string,
  onChunk: StreamChunkCallback,
  customOptions?: RequestInit
): Promise<void> => {
  try {
    const options: RequestInit = {
      method: 'GET',
      headers: {
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
      ...customOptions,
    };

    const response = await fetch(url, options);
    
    // 如果返回的 body 没有 getReader，或者请求失败
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    if (!response.body) {
      throw new Error('Response body is null, cannot stream data.');
    }

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore: Harmony fetch API provides standard ReadableStream
    const reader = response.body.getReader();
    // eslint-disable-next-line no-undef
    const decoder = new TextDecoder('utf-8');

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      
      if (value) {
        const chunkStr = decoder.decode(value as Uint8Array, { stream: true });
        onChunk(chunkStr);
      }
    }
  } catch (error) {
    console.error('[streamFetch] Error reading stream:', error);
    throw error;
  }
};
