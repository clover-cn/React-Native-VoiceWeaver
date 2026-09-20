package webpv.voice.weaver;

import java.io.File;
import java.io.IOException;

/** 只允许操作缓存根目录的直接子文件，解析真实路径后再校验。 */
final class CacheFiles {

  static boolean isOwnedChild(File directory, File candidate)
    throws IOException {
    return directory
      .getCanonicalFile()
      .equals(candidate.getCanonicalFile().getParentFile());
  }
}
