package webpv.voice.weaver;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.*;
import android.widget.*;
import org.json.JSONObject;

/** 用户确认登录后只读取目标源的认证 Cookie，不注入网页脚本。 */
public final class BookSourceLoginActivity extends Activity {

  private WebView web;
  private String source;
  private String origin;

  static String origin(String url) {
    Uri uri = Uri.parse(url == null ? "" : url);
    if (
      !("https".equalsIgnoreCase(uri.getScheme()) ||
        "http".equalsIgnoreCase(uri.getScheme())) ||
      uri.getHost() == null
    ) throw new IllegalArgumentException("无效登录地址");
    int port = uri.getPort();
    String scheme = uri.getScheme().toLowerCase(java.util.Locale.ROOT);
    boolean defaultPort =
      port == -1 ||
      (scheme.equals("https") && port == 443) ||
      (scheme.equals("http") && port == 80);
    return (
      scheme +
      "://" +
      uri.getHost().toLowerCase(java.util.Locale.ROOT) +
      (defaultPort ? "" : ":" + port)
    );
  }

  @Override
  public void onCreate(Bundle state) {
    super.onCreate(state);
    source = getIntent().getStringExtra("sourceId");
    String url = getIntent().getStringExtra("url");
    try {
      origin = origin(url);
    } catch (Exception e) {
      finishResult("failed", "无效登录地址");
      return;
    }
    LinearLayout layout = new LinearLayout(this);
    layout.setOrientation(LinearLayout.VERTICAL);
    Button finish = new Button(this);
    finish.setText("完成登录");
    finish.setOnClickListener(view -> save());
    layout.addView(finish);
    web = new WebView(this);
    web.getSettings().setJavaScriptEnabled(true);
    web.getSettings().setDomStorageEnabled(true);
    web.getSettings().setAllowFileAccess(false);
    web.getSettings().setAllowContentAccess(false);
    web.setWebViewClient(
      new WebViewClient() {
        @Override
        public boolean shouldOverrideUrlLoading(
          WebView view,
          WebResourceRequest request
        ) {
          String scheme = request.getUrl().getScheme();
          return !(
            "https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme)
          );
        }
      }
    );
    layout.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
    setContentView(layout);
    web.loadUrl(url);
  }

  private String cookie(String name) {
    String values = CookieManager.getInstance().getCookie(origin + "/");
    if (values != null) for (String value : values.split(";")) {
      String trimmed = value.trim();
      int separator = trimmed.indexOf('=');
      if (
        separator > 0 && trimmed.substring(0, separator).equals(name)
      ) return Uri.decode(trimmed.substring(separator + 1));
    }
    return "";
  }

  private void save() {
    try {
      if (!origin.equals(origin(web.getUrl()))) throw new Exception(
        "请返回书源站点完成登录"
      );
      String auth = cookie("Authorization"), device = cookie("X-Device-ID");
      if (
        auth.trim().isEmpty() ||
        device.trim().isEmpty() ||
        (auth + device).contains("\r") ||
        (auth + device).contains("\n")
      ) throw new Exception("尚未取得完整登录信息");
      SessionStore.write(
        this,
        source,
        BridgeModule.json(
          "origin",
          origin,
          "headers",
          BridgeModule.json("Authorization", auth, "X-Device-ID", device)
        )
      );
      CookieManager.getInstance().flush();
      finishResult("authenticated", "");
    } catch (Exception e) {
      Toast.makeText(this, e.getMessage(), Toast.LENGTH_LONG).show();
    }
  }

  private void finishResult(String status, String message) {
    setResult(
      RESULT_OK,
      new Intent()
        .putExtra(
          "result",
          BridgeModule.json("status", status, "message", message).toString()
        )
    );
    finish();
  }

  @Override
  public void onBackPressed() {
    finishResult("cancelled", "");
  }

  @Override
  protected void onDestroy() {
    if (web != null) web.destroy();
    super.onDestroy();
  }
}
