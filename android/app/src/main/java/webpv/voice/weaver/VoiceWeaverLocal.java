package webpv.voice.weaver;

import android.content.Context;
import android.net.Uri;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.io.*;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import okhttp3.*;
import org.json.*;

/** 应用私有文件和模型网络执行器，音频不经过 JS 桥传输。 */
final class VoiceWeaverLocal {
  private static final String ALIAS = "voiceweaver.config.v1";
  private static final ConcurrentHashMap<String, Call> calls = new ConcurrentHashMap<>();
  private static final java.util.Set<String> cancelledRequests = ConcurrentHashMap.newKeySet();
  private static final Object configLock = new Object();
  private static volatile boolean cancelled = false;
  private static java.lang.ref.WeakReference<com.facebook.react.bridge.ReactApplicationContext> react;
  static void cancelAll() {
    cancelled = true; for (Call call : calls.values()) call.cancel();
    com.facebook.react.bridge.ReactApplicationContext current = react == null ? null : react.get();
    if (current != null && current.hasActiveCatalystInstance()) current.getJSModule(com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter.class).emit("VoiceWeaverCancelGeneration", null);
  }
  private final Context context;
  private final File root;
  VoiceWeaverLocal(Context context) throws IOException {
    this.context = context;
    if (context instanceof com.facebook.react.bridge.ReactApplicationContext) react = new java.lang.ref.WeakReference<>((com.facebook.react.bridge.ReactApplicationContext) context);
    root = new File(context.getFilesDir(), "voiceweaver");
    if (!root.isDirectory() && !root.mkdirs() && !root.isDirectory()) throw new IOException("无法创建本地目录");
  }
  private File file(String key) throws IOException {
    if (!key.matches("[a-zA-Z0-9_.-]{1,180}") || key.contains("..")) throw new IOException("无效的文件标识");
    return new File(root, key);
  }
  private byte[] read(File f) throws IOException {
    try (InputStream in = new FileInputStream(f); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
      byte[] buffer = new byte[16384]; int n;
      while ((n = in.read(buffer)) != -1) { out.write(buffer, 0, n); if (out.size() > 64 * 1024 * 1024) throw new IOException("文件超过64MB限制"); }
      return out.toByteArray();
    }
  }
  private void atomic(File target, byte[] bytes) throws IOException {
    File temp = File.createTempFile("write-", ".tmp", root);
    try {
      try (FileOutputStream out = new FileOutputStream(temp)) { out.write(bytes); out.getFD().sync(); }
      if (!temp.renameTo(target)) throw new IOException("本地文件提交失败");
    } finally { if (temp.exists()) temp.delete(); }
  }
  private SecretKey key() throws Exception {
    KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
    if (!store.containsAlias(ALIAS)) {
      KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
      generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
      generator.generateKey();
    }
    return (SecretKey) store.getKey(ALIAS, null);
  }
  private synchronized Object config(JSONObject p, boolean save) throws Exception {
    File target = file("settings.enc");
    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
    if (save) {
      cipher.init(Cipher.ENCRYPT_MODE, key());
      byte[] encrypted = cipher.doFinal(p.getString("text").getBytes(StandardCharsets.UTF_8));
      ByteArrayOutputStream bytes = new ByteArrayOutputStream(); bytes.write(cipher.getIV()); bytes.write(encrypted);
      atomic(target, bytes.toByteArray()); return JSONObject.NULL;
    }
    if (!target.exists()) return JSONObject.NULL;
    byte[] bytes = read(target);
    cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, bytes, 0, 12));
    return new String(cipher.doFinal(bytes, 12, bytes.length - 12), StandardCharsets.UTF_8);
  }
  private File ownedAudio(String uri) throws Exception {
    File source = new File(Uri.parse(uri).getPath()).getCanonicalFile();
    if (!source.getPath().startsWith(root.getCanonicalPath() + File.separator)) throw new IOException("音频不属于应用目录");
    return source;
  }
  Object execute(JSONObject p) throws Exception {
    ChapterAudioExport.initialize(context);
    String op = p.getString("operation");
    if (op.startsWith("export")) return ChapterAudioExport.execute(context, p);
    if (op.equals("clearGenerated") || op.equals("deleteProject") || op.equals("deleteAudio")) {
      synchronized (ChapterAudioExport.LOCK) { return executeInternal(p); }
    }
    return executeInternal(p);
  }
  private Object executeInternal(JSONObject p) throws Exception {
    String operation = p.getString("operation");
    switch (operation) {
      case "loadConfig": synchronized (configLock) { return config(p, false); }
      case "saveConfig": synchronized (configLock) { return config(p, true); }
      case "background": {
        android.content.Intent intent = new android.content.Intent(context, GenerationService.class);
        if (p.optBoolean("enabled")) { cancelled = false; if (android.os.Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent); else context.startService(intent); }
        else context.stopService(intent);
        return JSONObject.NULL;
      }
      case "isCancelled": return cancelled;
      case "read": { File f = file(p.getString("key")); return f.exists() ? new String(read(f), StandardCharsets.UTF_8) : JSONObject.NULL; }
      case "write": atomic(file(p.getString("key")), p.getString("text").getBytes(StandardCharsets.UTF_8)); return JSONObject.NULL;
      case "exists": return ownedAudio(p.getString("uri")).isFile();
      case "importAudio": {
        File target = file("reference-" + UUID.randomUUID() + ".wav");
        try (InputStream in = context.getContentResolver().openInputStream(Uri.parse(p.getString("uri")))) {
          if (in == null) throw new IOException("无法读取参考录音");
          byte[] b = new byte[16384]; int n; long size = 0;
          while ((n = in.read(b)) != -1) { size += n; if (size > 5 * 1024 * 1024) throw new IOException("参考录音超过5MB限制"); }
          atomic(target, ReferenceAudioWav.convert(context, Uri.parse(p.getString("uri"))));
        }
        return Uri.fromFile(target).toString();
      }
      case "stats": { long size = 0; File[] files = root.listFiles(); if (files != null) for (File f : files) if (f.getName().startsWith("generated-")) size += f.length(); return size; }
      case "clearGenerated": {
        int count = 0; File[] files = root.listFiles();
        if (files != null) for (File f : files) if (f.getName().startsWith("generated-")) ChapterAudioExport.assertMutable(f);
        if (files != null) for (File f : files) if (f.getName().startsWith("generated-") && !AudioPlaybackService.usesFile(f) && f.delete()) count++;
        return count;
      }
      case "deleteProject": {
        String key = p.getString("key");
        if (!key.matches("project-[a-f0-9]{64}\\.json")) throw new IOException("书籍标识无效");
        String prefix = "generated-" + key.substring(8, 72) + "-";
        java.util.Set<File> targets = new java.util.HashSet<>();
        JSONArray uris = p.optJSONArray("uris");
        if (uris != null) for (int i = 0; i < uris.length(); i++) {
          File target = ownedAudio(uris.getString(i));
          if (!target.getName().startsWith("generated-")) throw new IOException("只能清理书籍生成音频");
          targets.add(target);
        }
        File[] entries = root.listFiles();
        if (entries != null) for (File target : entries) if (target.getName().startsWith(prefix)) targets.add(target);
        for (File target : targets) { ChapterAudioExport.assertMutable(target); if (AudioPlaybackService.usesFile(target)) throw new IOException("音频正在播放，请先停止播放"); }
        for (File target : targets) if (target.exists() && !target.delete()) throw new IOException("清理书籍音频失败");
        File document = file(key);
        if (document.exists() && !document.delete()) throw new IOException("清理书籍资料失败");
        return JSONObject.NULL;
      }
      case "deleteAudio": { File f = ownedAudio(p.getString("uri")); ChapterAudioExport.assertMutable(f); if (AudioPlaybackService.usesFile(f)) throw new IOException("音频正在播放"); return !f.exists() || f.delete(); }
      case "cancel": { String id = p.getString("id"); cancelledRequests.add(id); Call call = calls.get(id); if (call != null) call.cancel(); return JSONObject.NULL; }
      case "request": return request(p);
      default: throw new IOException("未知端侧操作");
    }
  }
  private Object request(JSONObject p) throws Exception {
    String id = p.getString("id");
    Request.Builder builder = new Request.Builder().url(p.getString("url"));
    JSONObject headers = p.optJSONObject("headers");
    if (headers != null) for (java.util.Iterator<String> keys = headers.keys(); keys.hasNext();) { String name = keys.next(); builder.header(name, headers.getString(name)); }
    RequestBody body;
    JSONObject fields = p.optJSONObject("fields");
    if (fields != null) {
      MultipartBody.Builder form = new MultipartBody.Builder().setType(MultipartBody.FORM);
      for (java.util.Iterator<String> keys = fields.keys(); keys.hasNext();) { String name = keys.next(); form.addFormDataPart(name, fields.getString(name)); }
      JSONArray files = p.optJSONArray("files");
      if (files != null) for (int i = 0; i < files.length(); i++) {
        JSONObject f = files.getJSONObject(i); File source = ownedAudio(f.getString("uri"));
        form.addFormDataPart(f.getString("name"), source.getName(), RequestBody.create(MediaType.parse(f.optString("mime", "audio/wav")), source));
      }
      body = form.build();
    } else {
      String text = p.optString("body", "{}");
      if (p.has("referenceUri")) {
        JSONObject json = new JSONObject(text);
        json.getJSONObject("audio").put("voice", "data:" + p.optString("referenceMime", "audio/wav") + ";base64," + Base64.encodeToString(read(ownedAudio(p.getString("referenceUri"))), Base64.NO_WRAP));
        text = json.toString();
      }
      body = RequestBody.create(MediaType.parse("application/json"), text);
    }
    builder.method(p.optString("method", "POST"), body);
    boolean stream = p.optBoolean("stream");
    long timeout = p.optLong("timeout", 120000);
    OkHttpClient client = new OkHttpClient.Builder()
      .connectTimeout(timeout, TimeUnit.MILLISECONDS)
      .readTimeout(timeout, TimeUnit.MILLISECONDS)
      .callTimeout(stream ? 0 : timeout, TimeUnit.MILLISECONDS).build();
    Call call = client.newCall(builder.build()); calls.put(id, call);
    if (cancelledRequests.remove(id)) call.cancel();
    try (Response response = call.execute()) {
      if (response.body() == null) throw new IOException("模型返回空响应");
      JSONObject result = new JSONObject().put("status", response.code()).put("retryAfter", response.header("Retry-After", ""));
      // 错误正文仅供界面脱敏诊断，限制大小且不记录日志。
      if (!response.isSuccessful()) return result.put("text", response.peekBody(8192).string());
      if (stream) {
        // 持续读取网络分块，按无数据时间超时；不记录正文和密钥。
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        long lastLog = 0;
        try (InputStream input = response.body().byteStream()) {
          int count;
          while ((count = input.read(buffer)) != -1) {
            if (call.isCanceled()) throw new IOException("模型流式请求已取消");
            if (output.size() + count > 8 * 1024 * 1024) throw new IOException("模型流式响应超过8MB限制");
            output.write(buffer, 0, count);
            if (System.currentTimeMillis() - lastLog >= 5000) {
              lastLog = System.currentTimeMillis();
              android.util.Log.i("VoiceWeaverLocal", "模型流式接收 bytes=" + output.size());
            }
          }
        }
        return result.put("text", output.toString("UTF-8"));
      }
      if (!p.optBoolean("audio")) return result.put("text", response.body().string());
      byte[] bytes = response.body().bytes();
      if (p.optBoolean("pcm")) {
        JSONObject json = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
        bytes = Base64.decode(json.getJSONArray("choices").getJSONObject(0).getJSONObject("message").getJSONObject("audio").getString("data"), Base64.DEFAULT);
        if (bytes.length == 0 || bytes.length % 2 != 0) throw new IOException("PCM 数据无效");
        ByteBuffer wav = ByteBuffer.allocate(44 + bytes.length).order(ByteOrder.LITTLE_ENDIAN);
        wav.put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt(36 + bytes.length).put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII)).putInt(16).putShort((short)1).putShort((short)1);
        int rate = p.optInt("sampleRate", 24000); wav.putInt(rate).putInt(rate * 2).putShort((short)2).putShort((short)16).put("data".getBytes(StandardCharsets.US_ASCII)).putInt(bytes.length).put(bytes); bytes = wav.array();
      }
      if (call.isCanceled() || bytes.length == 0) throw new IOException("生成已取消或音频为空");
      String owner = p.optString("owner", "");
      if (!owner.isEmpty() && !owner.matches("[a-f0-9]{64}")) throw new IOException("书籍标识无效");
      File target = file("generated-" + (owner.isEmpty() ? "" : owner + "-") + UUID.randomUUID() + (p.optBoolean("pcm") ? ".wav" : p.optString("extension", ".mp3")));
      atomic(target, bytes);
      return result.put("uri", Uri.fromFile(target).toString());
    } finally { calls.remove(id, call); cancelledRequests.remove(id); }
  }
}
