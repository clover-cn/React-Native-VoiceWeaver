package webpv.voice.weaver;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.*;
import android.net.Uri;
import android.os.*;
import java.io.*;
import java.nio.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.json.*;

/** 仅前台使用麦克风；实际 PCM 帧数决定录音时长。 */
final class ReferenceRecorder {
  static final int RATE = 48000, MIN_BYTES = RATE*2, MAX_BYTES = RATE*2*20;
  static final class RecordingError extends IOException { RecordingError(String message) { super(message); } }
  private static final Object LOCK = new Object();
  private static final Set<String> cancelledIds = new LinkedHashSet<>();
  private static Session active;
  private static boolean initialized, foreground = true;
  private static final class Session {
    String id, error; File file;
    volatile String state = "starting";
    volatile int bytes;
    volatile boolean stop, cancelled, release;
  }
  static void lifecycle(boolean visible) {
    synchronized (LOCK) {
      foreground = visible;
      if (!visible && active != null) {
        active.cancelled = true; active.stop = true; active.release = true;
        if (!active.state.equals("starting") && !active.state.equals("recording")) { active.file.delete(); active = null; }
      }
    }
  }
  static void initialize(Context context) {
    synchronized (LOCK) {
      if (initialized) return;
      File dir = new File(context.getCacheDir(), "reference-recordings");
      if (!dir.exists()) dir.mkdirs();
      File[] files = dir.listFiles();
      if (files != null) for (File file : files) if (file.isFile() && file.getName().matches("recording-[a-zA-Z0-9-]+\\.wav")) file.delete();
      initialized = true;
    }
  }
  private static JSONObject status(Session s) throws Exception {
    JSONObject value = new JSONObject().put("state",s.state).put("durationMs",s.bytes*1000L/(RATE*2));
    if (s.error != null) value.put("error",s.error);
    if (s.state.equals("ready")) value.put("uri",Uri.fromFile(s.file).toString()).put("size",s.bytes+44).put("mimeType","audio/wav").put("fileName","现场录音.wav");
    return value;
  }
  static Object execute(Context context, JSONObject p) throws Exception {
    initialize(context);
    synchronized (LOCK) {
      String op = p.getString("operation");
      if (op.equals("recordingPrepare")) return new JSONObject().put("granted",context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED);
      String id = p.getString("id");
      if (!id.matches("[a-zA-Z0-9-]{1,100}")) throw new RecordingError("录音会话无效");
      if (op.equals("recordingCancel") || op.equals("recordingRelease")) {
        cancelledIds.add(id);
        while (cancelledIds.size() > 128) cancelledIds.remove(cancelledIds.iterator().next());
        if (active != null && active.id.equals(id)) {
          active.cancelled = true; active.stop = true; active.release = true;
          if (!active.state.equals("starting") && !active.state.equals("recording")) { active.file.delete(); active = null; }
        }
        return JSONObject.NULL;
      }
      if (op.equals("recordingStart")) {
        if (!foreground || cancelledIds.contains(id)) throw new RecordingError("录音已取消，请重新长按");
        if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) throw new RecordingError("请先授权麦克风权限");
        if (active != null) throw new RecordingError("已有录音，请先结束或重录");
        Session s = new Session(); s.id = id;
        s.file = new File(new File(context.getCacheDir(),"reference-recordings"),"recording-"+id+".wav"); active = s;
        new Thread(() -> capture(context,s),"reference-recorder").start(); return status(s);
      }
      if (active == null || !active.id.equals(id)) return new JSONObject().put("state","cancelled").put("durationMs",0);
      if (op.equals("recordingStop")) active.stop = true;
      else if (!op.equals("recordingStatus")) throw new RecordingError("未知录音操作");
      return status(active);
    }
  }
  static byte[] header(int bytes) {
    ByteBuffer b = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN);
    b.put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt(36+bytes).put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII));
    b.putInt(16).putShort((short)1).putShort((short)1).putInt(RATE).putInt(RATE*2).putShort((short)2).putShort((short)16);
    b.put("data".getBytes(StandardCharsets.US_ASCII)).putInt(bytes); return b.array();
  }
  private static void capture(Context context, Session s) {
    AudioRecord recorder = null; AudioFocusRequest focus = null;
    AudioManager manager = (AudioManager)context.getSystemService(Context.AUDIO_SERVICE);
    AudioManager.OnAudioFocusChangeListener listener = change -> { if (change < 0) { s.cancelled = true; s.stop = true; } };
    AudioManager.AudioRecordingCallback callback = new AudioManager.AudioRecordingCallback() {
      @Override public void onRecordingConfigChanged(List<AudioRecordingConfiguration> configs) {
        if (Build.VERSION.SDK_INT >= 29) for (AudioRecordingConfiguration config : configs)
          if (config.isClientSilenced()) { s.cancelled = true; s.stop = true; }
      }
    };
    try {
      int buffer = AudioRecord.getMinBufferSize(RATE,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT);
      if (buffer <= 0) throw new RecordingError("设备不支持48 kHz单声道录音");
      recorder = new AudioRecord(MediaRecorder.AudioSource.MIC,RATE,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT,Math.max(buffer,8192));
      if (recorder.getState() != AudioRecord.STATE_INITIALIZED || recorder.getSampleRate() != RATE || recorder.getChannelCount() != 1 || recorder.getAudioFormat() != AudioFormat.ENCODING_PCM_16BIT) throw new RecordingError("录音设备初始化失败，请检查麦克风是否被占用");
      int granted;
      if (Build.VERSION.SDK_INT >= 26) {
        focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
          .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
          .setOnAudioFocusChangeListener(listener,new Handler(Looper.getMainLooper())).build();
        granted = manager.requestAudioFocus(focus);
      } else granted = manager.requestAudioFocus(listener,AudioManager.STREAM_MUSIC,AudioManager.AUDIOFOCUS_GAIN_TRANSIENT);
      if (granted != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) throw new RecordingError("无法获得录音焦点，请稍后重试");
      if (Build.VERSION.SDK_INT >= 29) recorder.registerAudioRecordingCallback(context.getMainExecutor(),callback);
      try (RandomAccessFile output = new RandomAccessFile(s.file,"rw")) {
        output.setLength(0); output.write(header(0));
        if (!s.stop && !s.cancelled) recorder.startRecording();
        s.state = "recording";
        byte[] bytes = new byte[4096]; long lastData = SystemClock.elapsedRealtime();
        while (!s.stop && !s.cancelled && s.bytes < MAX_BYTES) {
          int count = recorder.read(bytes,0,Math.min(bytes.length,MAX_BYTES-s.bytes),AudioRecord.READ_NON_BLOCKING);
          if (count < 0 || count % 2 != 0) throw new RecordingError("麦克风采集失败，请重新录制");
          if (count > 0) { output.write(bytes,0,count); s.bytes += count; lastData = SystemClock.elapsedRealtime(); }
          else { if (SystemClock.elapsedRealtime()-lastData > 5000) throw new RecordingError("麦克风没有返回数据，请检查是否被占用"); Thread.sleep(10); }
        }
        if (!s.cancelled && s.bytes < MIN_BYTES) throw new RecordingError("录音不足1秒，请重新长按录制");
        output.seek(0); output.write(header(s.bytes)); output.getFD().sync();
      }
    } catch (Exception e) {
      s.error = e instanceof RecordingError ? e.getMessage() : "录音失败，请检查麦克风权限及可用存储空间";
    } finally {
      if (recorder != null) {
        if (Build.VERSION.SDK_INT >= 29) { try { recorder.unregisterAudioRecordingCallback(callback); } catch (Exception ignored) {} }
        try { recorder.stop(); } catch (Exception ignored) {} recorder.release();
      }
      if (focus != null) manager.abandonAudioFocusRequest(focus); else manager.abandonAudioFocus(listener);
      synchronized (LOCK) {
        s.state = s.cancelled ? "cancelled" : s.error != null ? "error" : "ready";
        if (!s.state.equals("ready")) s.file.delete();
        if (s.release && active == s) { s.file.delete(); active = null; }
      }
    }
  }
}
