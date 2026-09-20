package webpv.voice.weaver;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import com.facebook.react.bridge.*;
import com.facebook.react.bridge.Callback;
import java.io.*;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import okhttp3.*;
import org.json.*;

/** Android 文件、存储及媒体桥接；耗时操作不占用 UI 线程。 */
public final class BridgeModule extends ReactContextBaseJavaModule {

  private final ExecutorService io = Executors.newFixedThreadPool(3);
  private final ExecutorService storage = Executors.newSingleThreadExecutor();
  private final Object cacheLock = new Object();
  private final OkHttpClient http = new OkHttpClient.Builder()
    .callTimeout(120, java.util.concurrent.TimeUnit.SECONDS)
    .build();
  private Callback pickerCallback;
  private String pickerKind;
  private String exportText;
  private static final int PICK = 8101;
  private static final int LOGIN = 8102;
  private Callback loginCallback;
  private static final long MAX_TEXT = 64L * 1024 * 1024;

  public BridgeModule(ReactApplicationContext context) {
    super(context);
    context.addActivityEventListener(
      new BaseActivityEventListener() {
        @Override
        public void onActivityResult(
          Activity activity,
          int request,
          int result,
          Intent data
        ) {
          if (request == LOGIN && loginCallback != null) {
            Callback cb = loginCallback;
            loginCallback = null;
            cb.invoke(
              data != null && data.hasExtra("result")
                ? data.getStringExtra("result")
                : json("status", "cancelled").toString()
            );
          }
          if (request != PICK || pickerCallback == null) return;
          Callback cb = pickerCallback;
          String kind = pickerKind;
          String text = exportText;
          pickerCallback = null;
          pickerKind = null;
          exportText = null;
          if (
            result != Activity.RESULT_OK ||
            data == null ||
            data.getData() == null
          ) {
            cb.invoke(json("success", false, "cancelled", true).toString());
            return;
          }
          Uri uri = data.getData();
          task(cb, () -> readSelection(kind, uri, text));
        }
      }
    );
  }

  @Override
  public String getName() {
    return "BridgeTurboModule";
  }

  static JSONObject json(Object... pairs) {
    JSONObject result = new JSONObject();
    try {
      for (int i = 0; i < pairs.length; i += 2) result.put(
        (String) pairs[i],
        pairs[i + 1]
      );
    } catch (JSONException error) {
      throw new IllegalArgumentException(error);
    }
    return result;
  }

  interface Work {
    JSONObject run() throws Exception;
  }

  private void task(Callback callback, Work work) {
    io.execute(() -> {
      JSONObject result;
      try {
        result = work.run();
      } catch (Exception error) {
        result =
          json(
            "success",
            false,
            "cancelled",
            false,
            "error",
            error.getMessage() == null ? "操作失败" : error.getMessage(),
            "errorCode",
            "NATIVE_ERROR",
            "errorMessage",
            error.getMessage() == null ? "原生操作失败" : error.getMessage()
          );
      }
      if (callback != null) callback.invoke(result.toString());
    });
  }

  private String normalizeHttpUrl(String rawUrl) throws IOException {
    try {
      return new URI(rawUrl).toASCIIString();
    } catch (Exception error) {
      throw new IOException("音频地址无效");
    }
  }

  private File directory(String name) throws IOException {
    File root = name.equals("audio")
      ? getReactApplicationContext().getCacheDir()
      : getReactApplicationContext().getFilesDir();
    File dir = new File(root, name);
    if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException(
      "无法创建应用目录"
    );
    return dir;
  }

  private byte[] bytes(Uri uri, long limit) throws IOException {
    try (
      InputStream input = getReactApplicationContext()
        .getContentResolver()
        .openInputStream(uri);
      ByteArrayOutputStream output = new ByteArrayOutputStream()
    ) {
      if (input == null) throw new IOException("无法读取文件");
      byte[] buffer = new byte[16384];
      int count;
      long total = 0;
      while ((count = input.read(buffer)) != -1) {
        total += count;
        if (total > limit) throw new IOException("文件超过可处理大小");
        output.write(buffer, 0, count);
      }
      return output.toByteArray();
    }
  }

  private String fileName(Uri uri) {
    try (
      Cursor cursor = getReactApplicationContext()
        .getContentResolver()
        .query(
          uri,
          new String[] { OpenableColumns.DISPLAY_NAME },
          null,
          null,
          null
        )
    ) {
      if (cursor != null && cursor.moveToFirst()) return cursor.getString(0);
    }
    return "document";
  }

  private JSONObject readSelection(String kind, Uri uri, String text)
    throws Exception {
    if (kind.equals("export")) {
      try (
        OutputStream output = getReactApplicationContext()
          .getContentResolver()
          .openOutputStream(uri, "wt")
      ) {
        if (output == null) throw new IOException("无法写入文件");
        output.write(text.getBytes(StandardCharsets.UTF_8));
      }
      return json("success", true, "cancelled", false, "uri", uri.toString());
    }
    byte[] content = bytes(
      uri,
      kind.equals("audio") ? 5L * 1024 * 1024 : MAX_TEXT
    );
    String name = fileName(uri);
    if (kind.equals("audio")) {
      File file = File.createTempFile(
        "upload-",
        ".audio",
        getReactApplicationContext().getCacheDir()
      );
      try (FileOutputStream out = new FileOutputStream(file)) {
        out.write(content);
      }
      return json(
        "cancelled",
        false,
        "uri",
        Uri.fromFile(file).toString(),
        "name",
        name,
        "size",
        content.length
      );
    }
    if (kind.equals("txt")) {
      String id = UUID.randomUUID().toString();
      try (
        FileOutputStream out = new FileOutputStream(
          new File(directory("books"), id)
        )
      ) {
        out.write(content);
      }
      return json(
        "success",
        true,
        "cancelled",
        false,
        "localBookId",
        id,
        "name",
        name,
        "size",
        content.length,
        "content",
        "",
        "contentBase64",
        Base64.encodeToString(content, Base64.NO_WRAP)
      );
    }
    return json(
      "cancelled",
      false,
      "name",
      name,
      "size",
      content.length,
      "content",
      new String(content, StandardCharsets.UTF_8)
    );
  }

  private void pick(
    String kind,
    String mime,
    String name,
    String content,
    Callback callback
  ) {
    getReactApplicationContext()
      .runOnUiQueueThread(() -> {
        Activity activity = getCurrentActivity();
        if (activity == null || pickerCallback != null) {
          callback.invoke(
            json("success", false, "error", "文件选择器不可用或正在使用")
              .toString()
          );
          return;
        }
        pickerCallback = callback;
        pickerKind = kind;
        exportText = content;
        Intent intent = new Intent(
          kind.equals("export")
            ? Intent.ACTION_CREATE_DOCUMENT
            : Intent.ACTION_OPEN_DOCUMENT
        )
          .setType(mime)
          .addCategory(Intent.CATEGORY_OPENABLE);
        if (name != null) intent.putExtra(Intent.EXTRA_TITLE, name);
        try {
          activity.startActivityForResult(intent, PICK);
        } catch (Exception e) {
          pickerCallback = null;
          callback.invoke(
            json("success", false, "error", "无法打开文件选择器").toString()
          );
        }
      });
  }

  @ReactMethod
  public void selectAudio(Callback cb) {
    pick("audio", "audio/*", null, null, cb);
  }

  @ReactMethod
  public void selectJsonDocument(Callback cb) {
    pick("json", "*/*", null, null, cb);
  }

  @ReactMethod
  public void selectTxtDocument(Callback cb) {
    pick("txt", "text/*", null, null, cb);
  }

  @ReactMethod
  public void exportJsonDocument(String payload, Callback cb) {
    try {
      JSONObject p = new JSONObject(payload);
      pick(
        "export",
        "application/json",
        p.getString("fileName"),
        p.getString("content"),
        cb
      );
    } catch (Exception e) {
      cb.invoke(json("success", false, "error", "导出参数无效").toString());
    }
  }

  private File book(String id) throws IOException {
    if (!id.matches("[a-zA-Z0-9-]+")) throw new IOException("书籍 ID 无效");
    return new File(directory("books"), id);
  }

  @ReactMethod
  public void readLocalTxtBook(String id, Callback cb) {
    task(
      cb,
      () ->
        json(
          "success",
          true,
          "localBookId",
          id,
          "content",
          "",
          "contentBase64",
          Base64.encodeToString(
            bytes(Uri.fromFile(book(id)), MAX_TEXT),
            Base64.NO_WRAP
          )
        )
    );
  }

  @ReactMethod
  public void deleteLocalTxtBook(String id, Callback cb) {
    task(
      cb,
      () -> {
        File f = book(id);
        if (f.exists() && !f.delete()) throw new IOException("删除失败");
        return json("success", true, "localBookId", id);
      }
    );
  }

  @ReactMethod
  public void getOhPrefData(
    String key,
    Dynamic fallback,
    String name,
    Callback cb
  ) {
    String defaultValue = fallback.isNull() ? null : fallback.asString();
    storage.execute(() -> {
      String value = null;
      String failure = null;
      try {
        value =
          getReactApplicationContext()
            .getSharedPreferences(
              name == null ? "default" : name,
              Context.MODE_PRIVATE
            )
            .getString(key, defaultValue);
      } catch (RuntimeException error) {
        failure = "存储读取失败";
      }
      cb.invoke(value, failure);
    });
  }

  @ReactMethod
  public void setOhPrefData(
    String key,
    String value,
    String name,
    Callback cb
  ) {
    storage.execute(() -> {
      String failure = null;
      try {
        boolean ok = getReactApplicationContext()
          .getSharedPreferences(
            name == null ? "default" : name,
            Context.MODE_PRIVATE
          )
          .edit()
          .putString(key, value)
          .commit();
        if (!ok) failure = "存储写入失败";
      } catch (RuntimeException error) {
        failure = "存储写入失败";
      }
      if (cb != null) cb.invoke(failure);
    });
  }

  @ReactMethod
  public void delOhPrefData(String key, String name, Callback cb) {
    storage.execute(() -> {
      String failure = null;
      try {
        boolean ok = getReactApplicationContext()
          .getSharedPreferences(
            name == null ? "default" : name,
            Context.MODE_PRIVATE
          )
          .edit()
          .remove(key)
          .commit();
        if (!ok) failure = "存储删除失败";
      } catch (RuntimeException error) {
        failure = "存储删除失败";
      }
      if (cb != null) cb.invoke(failure);
    });
  }

  @ReactMethod(isBlockingSynchronousMethod = true)
  public double getWindowInset(String key) {
    int resource = getReactApplicationContext()
      .getResources()
      .getIdentifier(
        key.equals("topRectHeight")
          ? "status_bar_height"
          : "navigation_bar_height",
        "dimen",
        "android"
      );
    return resource == 0
      ? 0
      : getReactApplicationContext().getResources().getDimension(resource) /
      getReactApplicationContext().getResources().getDisplayMetrics().density;
  }

  @ReactMethod
  public void uploadAudio(String payload, Callback cb) {
    task(
      cb,
      () -> {
        JSONObject p = new JSONObject(payload);
        Uri uri = Uri.parse(p.getString("uri"));
        byte[] content = bytes(uri, 5L * 1024 * 1024);
        RequestBody part = RequestBody.create(
          MediaType.parse(p.getString("mimeType")),
          content
        );
        MultipartBody body = new MultipartBody.Builder()
          .setType(MultipartBody.FORM)
          .addFormDataPart("file", p.getString("fileName"), part)
          .addFormDataPart("name", p.getString("uploadName"))
          .build();
        try (
          Response response = http
            .newCall(
              new Request.Builder().url(p.getString("url")).post(body).build()
            )
            .execute()
        ) {
          String responseText = response.body() == null
            ? ""
            : response.body().string();
          JSONObject result;
          try {
            result = new JSONObject(responseText);
          } catch (JSONException e) {
            result = json("success", false, "message", "上传服务返回无效数据");
          }
          boolean ok =
            response.isSuccessful() && result.optBoolean("success", true);
          return json(
            "success",
            ok,
            "responseCode",
            response.code(),
            "message",
            result.optString("message", ok ? "上传成功" : "上传失败")
          );
        }
      }
    );
  }

  @ReactMethod
  public void cacheListenBookAudio(String payload, Callback cb) {
    task(
      cb,
      () -> {
        synchronized (cacheLock) {
          JSONObject p = new JSONObject(payload);
          String key = p.getString("cacheKey");
          byte[] digest = MessageDigest
            .getInstance("SHA-256")
            .digest(key.getBytes(StandardCharsets.UTF_8));
          StringBuilder hex = new StringBuilder();
          for (byte b : digest) hex.append(String.format("%02x", b));
          File file = new File(directory("audio"), hex.toString());
          boolean hit = file.isFile() && file.length() > 0;
          if (!hit) {
            File temp = File.createTempFile(
              "download-",
              ".tmp",
              directory("audio")
            );
            try {
              try (
                Response response = http
                  .newCall(
                    new Request.Builder()
                      .url(normalizeHttpUrl(p.getString("url")))
                      .build()
                  )
                  .execute()
              ) {
                if (
                  !response.isSuccessful() || response.body() == null
                ) throw new IOException("下载失败(" + response.code() + ")");
                try (
                  InputStream in = response.body().byteStream();
                  OutputStream out = new FileOutputStream(temp)
                ) {
                  byte[] buffer = new byte[32768];
                  int n;
                  while ((n = in.read(buffer)) != -1) out.write(buffer, 0, n);
                }
              }
              if (
                temp.length() == 0 || !temp.renameTo(file)
              ) throw new IOException("缓存保存失败");
            } finally {
              if (temp.exists()) temp.delete();
            }
          }
          return json(
            "success",
            true,
            "cacheKey",
            key,
            "localUri",
            Uri.fromFile(file).toString(),
            "localPath",
            file.getAbsolutePath(),
            "hit",
            hit
          );
        }
      }
    );
  }

  @ReactMethod
  public void cleanupListenBookAudioCache(String payload, Callback cb) {
    task(
      cb,
      () -> {
        synchronized (cacheLock) {
          JSONObject p = new JSONObject(payload);
          java.util.Set<String> paths = new java.util.HashSet<>();
          for (String key : new String[] { "localUris", "localPaths" }) {
            JSONArray values = p.optJSONArray(key);
            if (values != null) for (int i = 0; i < values.length(); i++) {
              String value = values.getString(i);
              paths.add(
                value.startsWith("file:") ? Uri.parse(value).getPath() : value
              );
            }
          }
          int deleted = 0, failed = 0;
          File root = directory("audio").getCanonicalFile();
          for (String path : paths) {
            File f = new File(path).getCanonicalFile();
            if (
              !CacheFiles.isOwnedChild(root, f) ||
              AudioPlaybackService.usesFile(f)
            ) {
              failed++;
              continue;
            }
            if (!f.exists()) continue;
            if (f.delete()) deleted++; else failed++;
          }
          return json(
            "success",
            failed == 0,
            "deletedCount",
            deleted,
            "failedCount",
            failed
          );
        }
      }
    );
  }

  @ReactMethod
  public void openBookSourceLogin(String sourceId, String url, Callback cb) {
    getReactApplicationContext()
      .runOnUiQueueThread(() -> {
        if (getCurrentActivity() == null || loginCallback != null) {
          cb.invoke(
            json("status", "failed", "message", "登录页面不可用").toString()
          );
          return;
        }
        loginCallback = cb;
        try {
          getCurrentActivity()
            .startActivityForResult(
              new Intent(getCurrentActivity(), BookSourceLoginActivity.class)
                .putExtra("sourceId", sourceId)
                .putExtra("url", url),
              LOGIN
            );
        } catch (Exception e) {
          loginCallback = null;
          cb.invoke(
            json("status", "failed", "message", "无法打开登录页面").toString()
          );
        }
      });
  }

  @ReactMethod
  public void getBookSourceSession(String source, Callback cb) {
    task(
      cb,
      () ->
        json(
          "success",
          true,
          "session",
          SessionStore
            .read(getReactApplicationContext(), source)
            .optJSONObject("headers")
        )
    );
  }

  @ReactMethod
  public void clearBookSourceSession(String source, Callback cb) {
    getReactApplicationContext()
      .runOnUiQueueThread(() -> {
        try {
          SessionStore.clear(getReactApplicationContext(), source);
          cb.invoke(json("success", true).toString());
        } catch (Exception e) {
          cb.invoke(
            json("success", false, "message", "清除会话失败").toString()
          );
        }
      });
  }

  private void audio(String command, String payload) {
    AudioPlaybackService.dispatch(
      getReactApplicationContext(),
      command,
      payload
    );
  }

  @ReactMethod
  public void initAVSession(String tag) {
    AudioPlaybackService.attach(getReactApplicationContext());
  }

  @ReactMethod
  public void updateAVSessionMetadata(String payload) {
    audio("metadata", payload);
  }

  @ReactMethod
  public void loadNativeAudioQueue(String payload) {
    audio("queue", payload);
  }

  @ReactMethod
  public void playNativeAudio() {
    audio("play", "");
  }

  @ReactMethod
  public void pauseNativeAudio() {
    audio("pause", "");
  }

  @ReactMethod
  public void stopNativeAudio() {
    audio("stop", "");
  }

  @ReactMethod
  public void seekNativeAudio(double ms) {
    audio("seek", String.valueOf((long) ms));
  }

  @ReactMethod
  public void skipToNextNativeAudio() {
    audio("next", "");
  }

  @ReactMethod
  public void skipToPreviousNativeAudio() {
    audio("previous", "");
  }

  @ReactMethod
  public void releaseNativeAudio() {
    audio("release", "");
  }

  @ReactMethod
  public void destroyAVSession() {
    audio("release", "");
  }

  @ReactMethod
  public void back(String param, Callback cb) {
    getReactApplicationContext()
      .runOnUiQueueThread(() -> {
        if (getCurrentActivity() != null) getCurrentActivity().onBackPressed();
        if (cb != null) cb.invoke(param == null ? "" : param);
      });
  }

  @ReactMethod
  public void addListener(String event) {}

  @ReactMethod
  public void removeListeners(double count) {}

  @Override
  public void invalidate() {
    http.dispatcher().cancelAll();
    io.shutdown();
    storage.shutdown();
    if (pickerCallback != null) {
      pickerCallback.invoke(
        json("success", false, "cancelled", true).toString()
      );
      pickerCallback = null;
    }
    if (loginCallback != null) {
      loginCallback.invoke(json("status", "cancelled").toString());
      loginCallback = null;
    }
    super.invalidate();
  }
}
