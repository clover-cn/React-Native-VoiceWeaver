// 与阅读器 txtEncoding.ts 保持同步，由回归测试校验两端行为。
/** 严格校验 UTF-8，拒绝截断、过长编码、代理区及超出 Unicode 范围的码点。 */
export function isValidUtf8(bytes: Uint8Array): boolean {
  let index = 0;
  while (index < bytes.length) {
    const first = bytes[index++];
    if (first <= 0x7f) {
      continue;
    }
    let remaining = 0;
    let min = 0x80;
    let max = 0xbf;
    if (first >= 0xc2 && first <= 0xdf) {
      remaining = 1;
    } else if (first >= 0xe0 && first <= 0xef) {
      remaining = 2;
      if (first === 0xe0) { min = 0xa0; }
      if (first === 0xed) { max = 0x9f; }
    } else if (first >= 0xf0 && first <= 0xf4) {
      remaining = 3;
      if (first === 0xf0) { min = 0x90; }
      if (first === 0xf4) { max = 0x8f; }
    } else {
      return false;
    }
    if (index + remaining > bytes.length || bytes[index] < min || bytes[index] > max) {
      return false;
    }
    index += 1;
    for (let offset = 1; offset < remaining; offset += 1) {
      if (bytes[index] < 0x80 || bytes[index] > 0xbf) {
        return false;
      }
      index += 1;
    }
  }
  return true;
}

/** 两端采用同一字节规则；有效 UTF-8 不参与汉字数量评分。 */
export function detectTxtEncoding(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return 'utf-8';
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return 'utf-16le';
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return 'utf-16be';
  }

  // 无 BOM 的 UTF-16 仅在零字节集中于一侧时识别，避免把任意字节配对成汉字。
  if (bytes.length >= 4 && bytes.length % 2 === 0) {
    const pairs = Math.min(bytes.length / 2, 2048);
    let evenZeros = 0;
    let oddZeros = 0;
    for (let index = 0; index < pairs * 2; index += 2) {
      if (bytes[index] === 0) { evenZeros += 1; }
      if (bytes[index + 1] === 0) { oddZeros += 1; }
    }
    if (oddZeros / pairs >= 0.2 && oddZeros >= evenZeros * 4) {
      return 'utf-16le';
    }
    if (evenZeros / pairs >= 0.2 && evenZeros >= oddZeros * 4) {
      return 'utf-16be';
    }
  }
  if (isValidUtf8(bytes)) {
    return 'utf-8';
  }
  // GB18030 覆盖 GBK，优先以完整字符集解码。
  return 'gb18030';
}
