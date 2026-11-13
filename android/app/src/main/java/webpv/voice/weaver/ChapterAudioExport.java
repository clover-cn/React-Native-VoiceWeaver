package webpv.voice.weaver;

import android.content.Context;
import android.media.*;
import android.net.Uri;
import java.io.*;
import java.nio.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.zip.*;
import org.json.*;

/** 单任务章节导出；源文件固定到任务结束，整章数据不进入内存。 */
final class ChapterAudioExport {
  static final Object LOCK = new Object();
  private static Job active;
  private static boolean initialized;
  static final class ExportError extends IOException { ExportError(String message) { super(message); } }
  private static final class Job {
    final String id = UUID.randomUUID().toString();
    final List<File> sources = new ArrayList<>();
    final List<String> names = new ArrayList<>();
    final JSONArray manifest = new JSONArray();
    File directory, output;
    String fileName, mode;
    double gap;
    volatile String stage = "checking", error;
    volatile int done;
    volatile boolean cancelled;
  }
  static void initialize(Context context) {
    synchronized (LOCK) {
      if (initialized) return;
      File base = new File(context.getCacheDir(), "chapter-exports");
      // 此目录仅含本功能创建的临时产物，绝不遍历音频源目录。
      erase(base); base.mkdirs(); initialized = true;
    }
  }
  private static void erase(File file) {
    File[] children = file.listFiles();
    if (children != null) for (File child : children) erase(child);
    file.delete();
  }
  static void assertMutable(File file) throws IOException {
    if (active != null && active.sources.contains(file.getCanonicalFile()))
      throw new ExportError("音频正在导出，请等待完成或取消下载后再清理");
  }
  private static Job job(String id) throws IOException {
    if (active == null || !active.id.equals(id)) throw new ExportError("导出任务已结束");
    return active;
  }
  static Object execute(Context context, JSONObject p) throws Exception {
    initialize(context);
    synchronized (LOCK) {
      String operation = p.getString("operation");
      if (operation.equals("exportStart")) {
        if (active != null) throw new ExportError("已有语音下载任务，请等待完成");
        Job j = new Job();
        j.mode = p.getString("mode"); j.gap = p.getDouble("gap");
        if ((!j.mode.equals("wav") && !j.mode.equals("zip")) || !Double.isFinite(j.gap) || j.gap < 0 || j.gap > 30)
          throw new ExportError("导出参数无效");
        j.fileName = p.getString("fileName").replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_");
        JSONArray segments = p.getJSONArray("segments");
        if (segments.length() == 0) throw new ExportError("当前章节没有可导出的音频");
        File root = new File(context.getFilesDir(), "voiceweaver").getCanonicalFile();
        for (int i = 0; i < segments.length(); i++) {
          JSONObject segment = segments.getJSONObject(i);
          Uri uri = Uri.parse(segment.getString("uri"));
          if (!"file".equals(uri.getScheme())) throw new ExportError("音频未缓存在本机，请先完成本章转换");
          File source = new File(uri.getPath()).getCanonicalFile();
          if (!root.equals(source.getParentFile()) || !source.getName().startsWith("generated-"))
            throw new ExportError("只能导出本机生成的章节音频");
          if (!source.isFile() || !source.canRead() || source.length() == 0) throw new ExportError("第" + (i+1) + "段音频缺失，请重新生成");
          String original = source.getName();
          String extension = original.substring(original.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
          if (!extension.matches("[a-z0-9]{1,8}")) throw new ExportError("音频格式标识无效");
          String name = String.format(Locale.ROOT, "%04d.%s", i+1, extension);
          j.sources.add(source); j.names.add(name);
          j.manifest.put(new JSONObject().put("order", i+1).put("role", segment.optString("role", "旁白")).put("fileName", name));
        }
        j.directory = new File(new File(context.getCacheDir(), "chapter-exports"), j.id);
        if (!j.directory.mkdirs()) throw new ExportError("无法创建导出临时目录，请检查可用空间");
        j.output = new File(j.directory, "chapter." + j.mode);
        active = j;
        new Thread(() -> run(j), "chapter-audio-export").start();
        return j.id;
      }
      Job j = job(p.getString("id"));
      switch (operation) {
        case "exportStatus": return new JSONObject().put("stage", j.stage).put("done", j.done).put("total", j.sources.size()).put("error", j.error);
        case "exportCancel": j.cancelled = true; if (j.stage.equals("ready")) j.stage = "cancelled"; return JSONObject.NULL;
        case "exportRelease":
          if (j.stage.equals("checking") || j.stage.equals("processing") || j.stage.equals("saving")) { j.cancelled = true; throw new ExportError("请等待导出任务停止"); }
          erase(j.directory); active = null; return JSONObject.NULL;
        default: throw new ExportError("未知导出操作");
      }
    }
  }
  static String[] saveInfo(String id) throws Exception {
    synchronized (LOCK) {
      Job j = job(id); check(j);
      if (!j.stage.equals("ready")) throw new ExportError("音频尚未准备完成");
      return new String[]{j.fileName, j.mode.equals("zip") ? "application/zip" : "audio/wav"};
    }
  }
  static boolean save(Context context, String id, Uri target) throws Exception {
    Job j;
    synchronized (LOCK) { j = job(id); check(j); if (!j.stage.equals("ready")) throw new ExportError("音频尚未准备完成"); j.stage = "saving"; }
    try (InputStream in = new FileInputStream(j.output); OutputStream out = context.getContentResolver().openOutputStream(target, "wt")) {
      if (out == null) throw new ExportError("无法写入所选位置");
      copy(j, in, out); out.flush(); j.stage = "saved"; return true;
    } catch (Exception error) {
      j.stage = "error";
      // 尽量截断本次创建的不完整文件，绝不删除用户的其他文件。
      try (OutputStream ignored = context.getContentResolver().openOutputStream(target, "wt")) {} catch (Exception ignored) {}
      throw new ExportError("保存失败，请检查目标位置及剩余空间后重试");
    }
  }
  private static void check(Job j) throws IOException { if (j.cancelled) throw new ExportError("已取消下载"); }
  private static void copy(Job j, InputStream in, OutputStream out) throws IOException {
    byte[] buffer = new byte[65536]; int count;
    while ((count = in.read(buffer)) != -1) { check(j); out.write(buffer, 0, count); }
  }
  private static void run(Job j) {
    try {
      if (j.mode.equals("wav")) {
        double duration = Math.max(0, j.sources.size()-1)*j.gap;
        for (File source : j.sources) {
          check(j); MediaExtractor probe = new MediaExtractor();
          try {
            probe.setDataSource(source.getPath()); boolean found = false;
            for (int i = 0; i < probe.getTrackCount(); i++) {
              MediaFormat format = probe.getTrackFormat(i);
              if (format.getString(MediaFormat.KEY_MIME).startsWith("audio/")) {
                if (format.containsKey(MediaFormat.KEY_DURATION)) duration += Math.max(0, format.getLong(MediaFormat.KEY_DURATION))/1000000.0;
                found = true; break;
              }
            }
            if (!found) throw new ExportError("音频没有可解码的音轨，请重新生成");
          } finally { probe.release(); }
        }
        if (Math.ceil(duration*24000)*2 > 0xffffffffL-36) throw new ExportError("合并音频超过 WAV 容量限制，请改用分段 ZIP");
      }
      j.stage = "processing";
      if (j.mode.equals("zip")) {
        try (ZipOutputStream out = new ZipOutputStream(new BufferedOutputStream(new FileOutputStream(j.output)))) {
          for (int i = 0; i < j.sources.size(); i++) {
            check(j); out.putNextEntry(new ZipEntry(j.names.get(i)));
            try (InputStream in = new FileInputStream(j.sources.get(i))) { copy(j, in, out); }
            out.closeEntry(); j.done = i+1;
          }
          out.putNextEntry(new ZipEntry("manifest.json"));
          out.write(j.manifest.toString(2).getBytes(StandardCharsets.UTF_8)); out.closeEntry();
        }
      } else {
        try (RandomAccessFile out = new RandomAccessFile(j.output, "rw")) {
          out.write(new byte[44]);
          for (int i = 0; i < j.sources.size(); i++) {
            check(j);
            if (i > 0) {
              long remaining = Math.round(j.gap * 24000) * 2;
              byte[] zero = new byte[8192];
              while (remaining > 0) { check(j); int count = (int)Math.min(remaining, zero.length); writePcm(out, zero, count); remaining -= count; }
            }
            decode(j, j.sources.get(i), out); j.done = i+1;
          }
          long size = out.length()-44; out.seek(0);
          ByteBuffer header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN);
          header.put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt((int)(36+size)).put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII));
          header.putInt(16).putShort((short)1).putShort((short)1).putInt(24000).putInt(48000).putShort((short)2).putShort((short)16);
          header.put("data".getBytes(StandardCharsets.US_ASCII)).putInt((int)size); out.write(header.array());
        }
      }
      check(j); j.stage = "ready";
    } catch (Exception error) {
      j.error = error instanceof ExportError ? error.getMessage() : "音频处理失败，请检查音频文件及剩余存储空间";
      j.stage = j.cancelled ? "cancelled" : "error";
      j.output.delete();
    }
  }
  private static void writePcm(RandomAccessFile out, byte[] bytes, int count) throws IOException {
    if (out.getFilePointer()+count > 0xffffffffL+8) throw new ExportError("合并音频超过 WAV 容量限制，请改用分段 ZIP");
    out.write(bytes, 0, count);
  }
  /** 分块线性重采样，跨缓冲区保留相位，每个片段独立计算时长。 */
  private static final class PcmSink {
    final Job job; final RandomAccessFile out;
    final byte[] buffer = new byte[8192];
    int used, rate, channels, previous;
    long frames, outputFrames;
    PcmSink(Job job, RandomAccessFile out) { this.job = job; this.out = out; }
    void format(int r, int c) throws IOException {
      if (r <= 0 || r > 192000 || c <= 0 || c > 8 || (rate != 0 && (rate != r || channels != c))) throw new ExportError("音频采样格式不支持");
      rate = r; channels = c;
    }
    void sample(int sample) throws IOException {
      buffer[used++] = (byte)sample; buffer[used++] = (byte)(sample >> 8); outputFrames++;
      if (used == buffer.length) flush();
    }
    void accept(ByteBuffer input) throws IOException {
      check(job);
      if (rate == 0 || input.remaining() % (channels*2) != 0) throw new ExportError("音频 PCM 数据不完整");
      input.order(ByteOrder.LITTLE_ENDIAN);
      while (input.remaining() > 0) {
        int sum = 0; for (int c = 0; c < channels; c++) sum += input.getShort();
        int current = sum/channels;
        if (frames == 0) sample(current);
        else while (outputFrames * (long)rate <= frames * 24000L) {
          double fraction = (outputFrames * (double)rate - (frames-1)*24000.0)/24000.0;
          sample((int)Math.round(previous + (current-previous)*fraction));
        }
        previous = current; frames++;
      }
    }
    void flush() throws IOException { check(job); writePcm(out, buffer, used); used = 0; }
    void finish() throws IOException {
      if (frames == 0) throw new ExportError("音频解码结果为空");
      while (outputFrames < Math.round(frames*24000.0/rate)) sample(previous);
      flush();
    }
  }
  private static void decode(Job j, File source, RandomAccessFile out) throws Exception {
    MediaExtractor extractor = new MediaExtractor(); MediaCodec codec = null;
    try {
      extractor.setDataSource(source.getPath()); MediaFormat format = null;
      for (int i = 0; i < extractor.getTrackCount(); i++) {
        MediaFormat f = extractor.getTrackFormat(i);
        if (f.getString(MediaFormat.KEY_MIME).startsWith("audio/")) { format = f; extractor.selectTrack(i); break; }
      }
      if (format == null) throw new ExportError("音频没有可解码的音轨");
      PcmSink sink = new PcmSink(j, out);
      String mime = format.getString(MediaFormat.KEY_MIME);
      if (mime.equals("audio/raw")) {
        if (format.containsKey(MediaFormat.KEY_PCM_ENCODING) && format.getInteger(MediaFormat.KEY_PCM_ENCODING) != AudioFormat.ENCODING_PCM_16BIT)
          throw new ExportError("WAV 源文件必须为16位 PCM");
        sink.format(format.getInteger(MediaFormat.KEY_SAMPLE_RATE), format.getInteger(MediaFormat.KEY_CHANNEL_COUNT));
        ByteBuffer buffer = ByteBuffer.allocate(1024*1024);
        while (true) {
          check(j); buffer.clear(); int count = extractor.readSampleData(buffer, 0); if (count < 0) break;
          if (count == 0) throw new ExportError("音频数据无效");
          buffer.position(0); buffer.limit(count); sink.accept(buffer); extractor.advance();
        }
      } else {
        codec = MediaCodec.createDecoderByType(mime);
        format.setInteger(MediaFormat.KEY_PCM_ENCODING, AudioFormat.ENCODING_PCM_16BIT);
        codec.configure(format, null, null, 0); codec.start();
        MediaCodec.BufferInfo info = new MediaCodec.BufferInfo(); boolean inputDone = false, outputDone = false;
        long lastProgress = android.os.SystemClock.elapsedRealtime();
        while (!outputDone) {
          check(j);
          if (android.os.SystemClock.elapsedRealtime()-lastProgress > 30000) throw new ExportError("音频解码超时，请重试");
          if (!inputDone) {
            int index = codec.dequeueInputBuffer(10000);
            if (index >= 0) {
              ByteBuffer input = codec.getInputBuffer(index); input.clear(); int count = extractor.readSampleData(input, 0);
              if (count < 0) { codec.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); inputDone = true; }
              else { codec.queueInputBuffer(index, 0, count, extractor.getSampleTime(), 0); extractor.advance(); }
              lastProgress = android.os.SystemClock.elapsedRealtime();
            }
          }
          int index = codec.dequeueOutputBuffer(info, 10000);
          if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
            MediaFormat output = codec.getOutputFormat();
            if (output.containsKey(MediaFormat.KEY_PCM_ENCODING) && output.getInteger(MediaFormat.KEY_PCM_ENCODING) != AudioFormat.ENCODING_PCM_16BIT)
              throw new ExportError("解码器未输出16位 PCM");
            sink.format(output.getInteger(MediaFormat.KEY_SAMPLE_RATE), output.getInteger(MediaFormat.KEY_CHANNEL_COUNT));
          } else if (index >= 0) {
            try {
              ByteBuffer output = codec.getOutputBuffer(index);
              if (info.size > 0) { output.position(info.offset); output.limit(info.offset+info.size); sink.accept(output); }
              outputDone = (info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0;
              lastProgress = android.os.SystemClock.elapsedRealtime();
            } finally { codec.releaseOutputBuffer(index, false); }
          }
        }
      }
      sink.finish();
    } finally { if (codec != null) codec.release(); extractor.release(); }
  }
}
