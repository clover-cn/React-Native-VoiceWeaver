package webpv.voice.weaver;

import android.content.Context;
import java.io.*;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/** 有界诊断日志；仅轮转本功能的日志，保留最新记录。 */
final class DiagnosticLog {
  private static final int LIMIT = 5 * 1024 * 1024;
  private static File file(Context context) throws IOException {
    File directory = new File(context.getFilesDir(), "voiceweaver");
    if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("无法创建日志目录");
    return new File(directory, "diagnostics.txt");
  }
  private static byte[] tail(File file, int maximum) throws IOException {
    if (!file.isFile()) return new byte[0];
    try (RandomAccessFile input = new RandomAccessFile(file, "r")) {
      long offset = Math.max(0, input.length() - maximum);
      input.seek(offset);
      if (offset > 0) { while (input.getFilePointer() < input.length() && input.read() != '\n') {} }
      byte[] bytes = new byte[(int)(input.length() - input.getFilePointer())];
      input.readFully(bytes); return bytes;
    }
  }
  static synchronized void append(Context context, String text) throws Exception {
    byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
    if (bytes.length > 256 * 1024) throw new IOException("日志批次过大");
    File target = file(context);
    if (target.length() + bytes.length > LIMIT) {
      byte[] retained = tail(target, 4 * 1024 * 1024);
      try (FileOutputStream output = new FileOutputStream(target)) { output.write(retained); }
    }
    try (FileOutputStream output = new FileOutputStream(target, true)) { output.write(bytes); }
  }
  static synchronized JSONObject view(Context context) throws Exception {
    File target = file(context);
    return new JSONObject().put("text", new String(tail(target, 128 * 1024), StandardCharsets.UTF_8))
      .put("bytes", target.length()).put("path", target.getAbsolutePath());
  }
  static synchronized String snapshot(Context context) throws Exception {
    return new String(tail(file(context), LIMIT), StandardCharsets.UTF_8);
  }
  static synchronized void clear(Context context) throws Exception {
    File target = file(context);
    if (target.exists()) {
      target.delete();
    }
  }
}
