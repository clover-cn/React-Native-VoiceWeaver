package webpv.voice.weaver;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.webkit.CookieManager;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

/** 书源凭据仅以 Keystore 加密后的密文落盘。 */
final class SessionStore {

  private static final String ALIAS = "voiceweaver.bookSource";

  private static synchronized SecretKey key() throws Exception {
    KeyStore store = KeyStore.getInstance("AndroidKeyStore");
    store.load(null);
    if (store.containsAlias(ALIAS)) return (SecretKey) store.getKey(
      ALIAS,
      null
    );
    KeyGenerator generator = KeyGenerator.getInstance(
      KeyProperties.KEY_ALGORITHM_AES,
      "AndroidKeyStore"
    );
    generator.init(
      new KeyGenParameterSpec.Builder(
        ALIAS,
        KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
      )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .build()
    );
    return generator.generateKey();
  }

  static void write(Context context, String source, JSONObject value)
    throws Exception {
    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(Cipher.ENCRYPT_MODE, key());
    String data =
      Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) +
      ":" +
      Base64.encodeToString(
        cipher.doFinal(value.toString().getBytes(StandardCharsets.UTF_8)),
        Base64.NO_WRAP
      );
    if (
      !context
        .getSharedPreferences("book_source_sessions", 0)
        .edit()
        .putString(source, data)
        .commit()
    ) throw new Exception("无法保存登录信息");
  }

  static JSONObject read(Context context, String source) throws Exception {
    String data = context
      .getSharedPreferences("book_source_sessions", 0)
      .getString(source, null);
    if (data == null) return new JSONObject();
    String[] parts = data.split(":", 2);
    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(
      Cipher.DECRYPT_MODE,
      key(),
      new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP))
    );
    return new JSONObject(
      new String(
        cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)),
        StandardCharsets.UTF_8
      )
    );
  }

  static void clear(Context context, String source) throws Exception {
    String origin = read(context, source).optString("origin");
    if (!origin.isEmpty()) {
      for (String name : new String[] {
        "Authorization",
        "X-Device-ID",
      }) CookieManager
        .getInstance()
        .setCookie(origin + "/", name + "=; Max-Age=0; Path=/");
      CookieManager.getInstance().flush();
    }
    if (
      !context
        .getSharedPreferences("book_source_sessions", 0)
        .edit()
        .remove(source)
        .commit()
    ) throw new Exception("无法清除登录信息");
  }
}
