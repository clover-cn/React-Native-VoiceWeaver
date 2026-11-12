/** 聚合 OpenAI 兼容 SSE 的正文增量；推理字段不混入最终 JSON。 */
export function parseLlmResponse(text: string): string {
  const input = text.replace(/^\uFEFF/, '').trim();
  if (input.startsWith('{')) {
    const response = JSON.parse(input);
    const reason = response.choices?.[0]?.finish_reason;
    if (reason && reason !== 'stop') {
      throw new Error(
        '模型输出未正常完成，可能达到长度限制或被过滤，请减少输入内容。',
      );
    }
    const content = response.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new Error('解析服务没有返回文本结果。');
    }
    return content;
  }
  let content = '';
  let completed = false;
  let truncated = false;
  for (const event of input.replace(/\r\n/g, '\n').split(/\n\n+/)) {
    const data = event
      .split('\n')
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!data) {
      continue;
    }
    if (data.trim() === '[DONE]') {
      completed = true;
      break;
    }
    let chunk;
    try {
      chunk = JSON.parse(data);
    } catch (_) {
      throw new Error('模型流式响应格式错误或传输中断，请重试。');
    }
    if (chunk.error) {
      throw new Error('模型在流式响应中返回错误，请检查中转站上游日志。');
    }
    const choice = chunk.choices?.[0];
    if (typeof choice?.delta?.content === 'string') {
      content += choice.delta.content;
    }
    if (choice?.finish_reason != null) {
      completed = true;
      truncated = choice.finish_reason !== 'stop';
    }
  }
  if (truncated) {
    throw new Error(
      '模型输出未正常完成，可能达到长度限制或被过滤，请减少输入章节数。',
    );
  }
  if (!completed) {
    throw new Error('模型流式响应中断，未收到结束标记，请重试。');
  }
  if (!content.trim()) {
    throw new Error('模型流式响应没有返回正文内容。');
  }
  return content;
}
