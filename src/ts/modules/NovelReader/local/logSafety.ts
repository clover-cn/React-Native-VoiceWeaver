const secrets = new Set<string>();
/** 只在内存登记密钥，用于去除服务端错误中回显的凭据。 */
export function registerLogSecrets(headers: Record<string, string> = {}): void {
  Object.entries(headers).forEach(([key, value]) => {
    if (/authorization|key|token|secret/i.test(key) && value) {
      secrets.add(value);
      secrets.add(value.replace(/^Bearer\s+/i, ''));
    }
  });
}
export function safeLogText(value: string): string {
  let text = String(value);
  secrets.forEach(secret => { if (secret) { text = text.split(secret).join('[已隐藏]'); } });
  return text.replace(/Bearer\s+[^\s"'<>]+/gi, 'Bearer [已隐藏]')
    .replace(/\bsk-[\w-]+/g, '[已隐藏]')
    .replace(/(["']?(?:api[_-]?key|token|secret|authorization)["']?\s*[:=]\s*)[^\s,}]+/gi, '$1[已隐藏]')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[地址已隐藏]')
    .replace(/[\r\n\t]+/g, ' ').slice(0, 8000);
}
