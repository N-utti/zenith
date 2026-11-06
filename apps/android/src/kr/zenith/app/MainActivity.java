package kr.zenith.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import java.io.OutputStream;

/**
 * 제니스 서버 주소를 그대로 여는 웹 화면 한 장. 화면은 서버가 내주므로 프론트를 고쳐도 APK 를
 * 다시 줄 필요가 없다. 같은 오리진이라 로그인 쿠키도 웹과 똑같이 붙는다.
 *
 * 브라우저가 해 주던 것 중 웹 화면(WebView)이 안 해 주는 것만 받아 준다. 파일 고르기(첨부),
 * 프론트가 blob 으로 만드는 내려받기(lib/download.ts 의 downloadBytes), 인쇄(문서 PDF 내보내기).
 */
public class MainActivity extends Activity {
  private static final int PICK_FILES = 1;

  /**
   * downloadBytes 는 blob 주소를 만든 a 를 문서에 붙이지 않고 click() 한다. 그 click 을 가로채
   * blob 을 base64 로 읽어 앱에 넘긴다. blob 은 주소를 거두기(revoke) 전에 만들 때 잡아 둔다.
   * window.print 도 앱으로 넘긴다.
   */
  private static final String PATCH_DOWNLOADS =
      "(function(){"
          + "if(window.__zenithAndroid)return;window.__zenithAndroid=1;"
          + "var blobs=new Map(),create=URL.createObjectURL,revoke=URL.revokeObjectURL,click=HTMLAnchorElement.prototype.click;"
          + "URL.createObjectURL=function(o){var u=create.call(URL,o);if(o instanceof Blob)blobs.set(u,o);return u};"
          + "URL.revokeObjectURL=function(u){blobs.delete(u);return revoke.call(URL,u)};"
          + "HTMLAnchorElement.prototype.click=function(){"
          + "var b=this.download&&blobs.get(this.href);if(!b)return click.call(this);"
          + "var name=this.download,r=new FileReader();"
          + "r.onload=function(){ZenithAndroid.save(name,b.type,String(r.result).split(',')[1]||'')};"
          + "r.readAsDataURL(b)};"
          // 문서 PDF 내보내기는 window.print() 다. 웹 화면에는 인쇄가 없어서 안드로이드 인쇄(PDF 저장)로 넘긴다.
          + "window.print=function(){ZenithAndroid.print(document.title)};"
          + "})()";

  private static final String OFFLINE_PAGE =
      "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'>"
          + "<style>body{font:16px sans-serif;display:flex;flex-direction:column;align-items:center;"
          + "justify-content:center;height:90vh;margin:0 24px;text-align:center;color-scheme:light dark}"
          + "button{font:inherit;padding:10px 20px;margin-top:16px;border-radius:8px}</style>"
          + "<p>제니스 서버에 연결할 수 없습니다.<br>와이파이나 Tailscale 이 켜져 있는지 확인해 주세요.</p>"
          + "<button onclick=\"location.href='"
          + Server.URL
          + "'\">다시 시도</button>";

  private final String host = Uri.parse(Server.URL).getHost();
  private WebView web;
  private ValueCallback<Uri[]> pendingPick;
  private boolean offline;

  @Override
  protected void onCreate(Bundle state) {
    super.onCreate(state);
    web = new WebView(this);
    setContentView(web);

    WebSettings settings = web.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    // ponytail: 브리지는 우리 서버 화면에서만 쓴다. 다른 호스트로 가는 이동은 아래에서 브라우저로 넘기므로
    // 남는 길은 우리 화면 안의 다른 오리진 iframe 뿐이고, 할 수 있는 일은 다운로드 폴더에 파일 쓰기뿐이다.
    web.addJavascriptInterface(new Bridge(), "ZenithAndroid");

    web.setWebViewClient(
        new WebViewClient() {
          @Override
          public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (isOurs(url.toString())) return false;
            // 바깥 링크(메일·전화·다른 사이트)는 앱 안에서 열지 않는다.
            try {
              startActivity(new Intent(Intent.ACTION_VIEW, url));
            } catch (ActivityNotFoundException ignored) {
            }
            return true;
          }

          @Override
          public void onReceivedError(
              WebView view, WebResourceRequest request, WebResourceError error) {
            // 서버에 못 닿으면(대개 Tailscale 이 꺼져 있다) 영어 오류 화면 대신 안내와 다시 시도를 띄운다.
            if (!request.isForMainFrame()) return;
            offline = true;
            view.loadDataWithBaseURL(null, OFFLINE_PAGE, "text/html", "UTF-8", null);
          }

          @Override
          public void onPageFinished(WebView view, String url) {
            view.evaluateJavascript(PATCH_DOWNLOADS, null);
          }
        });

    web.setWebChromeClient(
        new WebChromeClient() {
          @Override
          public boolean onShowFileChooser(
              WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (pendingPick != null) pendingPick.onReceiveValue(null);
            pendingPick = callback;
            // params.createIntent() 는 accept 의 첫 형식만 넘겨서, AI 첨부(.txt,...,.pdf)에서 PDF 가 막힌다.
            // 전부 MIME 으로 풀렸을 때만 그 목록으로 거르고, 하나라도 못 풀렸으면(.hwpx 등) 다 보여 준다.
            Intent intent =
                new Intent(Intent.ACTION_GET_CONTENT)
                    .addCategory(Intent.CATEGORY_OPENABLE)
                    .setType("*/*");
            String[] types = params.getAcceptTypes();
            boolean allMime = types.length > 0;
            for (String type : types) if (!type.contains("/")) allMime = false;
            if (allMime) intent.putExtra(Intent.EXTRA_MIME_TYPES, types);
            if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) {
              intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            }
            try {
              startActivityForResult(intent, PICK_FILES);
            } catch (ActivityNotFoundException e) {
              pendingPick = null;
              return false;
            }
            return true;
          }
        });

    // 첫 화면이 뜨기 전에 다시 만들어지면 되살릴 기록이 없다(null). 그땐 새로 연다.
    if (state == null || web.restoreState(state) == null) web.loadUrl(Server.URL);
  }

  @Override
  protected void onResume() {
    super.onResume();
    // 안내 화면을 띄운 채 나갔다 오면(Tailscale 을 켜고 돌아오면) 바로 다시 붙어 본다.
    if (offline) {
      offline = false;
      web.loadUrl(Server.URL);
    }
  }

  @Override
  protected void onDestroy() {
    // 다크 모드 전환으로 화면을 다시 만들 때 옛 웹 화면의 소켓·타이머가 남지 않게.
    web.destroy();
    super.onDestroy();
  }

  private boolean isOurs(String url) {
    return url != null && host.equalsIgnoreCase(Uri.parse(url).getHost());
  }

  @Override
  protected void onActivityResult(int requestCode, int resultCode, Intent data) {
    if (requestCode != PICK_FILES || pendingPick == null) return;
    Uri[] picked = null;
    if (resultCode == RESULT_OK && data != null) {
      ClipData clip = data.getClipData();
      if (clip != null) {
        picked = new Uri[clip.getItemCount()];
        for (int i = 0; i < picked.length; i++) picked[i] = clip.getItemAt(i).getUri();
      } else if (data.getData() != null) {
        picked = new Uri[] {data.getData()};
      }
    }
    pendingPick.onReceiveValue(picked);
    pendingPick = null;
  }

  @Override
  public void onBackPressed() {
    // 안내 화면(서버 밖 주소)에서 뒤로 가면 실패한 주소로 돌아가 같은 화면이 반복된다. 그땐 앱을 닫는다.
    if (web.canGoBack() && isOurs(web.getUrl())) web.goBack();
    else super.onBackPressed();
  }

  @Override
  protected void onSaveInstanceState(Bundle out) {
    super.onSaveInstanceState(out);
    web.saveState(out);
  }

  @Override
  protected void onPause() {
    super.onPause();
    // 앱을 바로 끄면 방금 받은 로그인 쿠키가 디스크에 안 남을 수 있다.
    CookieManager.getInstance().flush();
  }

  private void toast(final String text) {
    runOnUiThread(() -> Toast.makeText(this, text, Toast.LENGTH_SHORT).show());
  }

  private class Bridge {
    /** 다운로드 폴더에 저장한다. ponytail: 파일 전체가 base64 문자열로 건너온다. 수백 MB 를 받게 되면 스트림으로 바꾼다. */
    @JavascriptInterface
    public void save(String name, String mime, String base64) {
      ContentValues values = new ContentValues();
      values.put(MediaStore.Downloads.DISPLAY_NAME, name);
      values.put(MediaStore.Downloads.MIME_TYPE, mime.isEmpty() ? "application/octet-stream" : mime);
      ContentResolver resolver = getContentResolver();
      Uri uri = null;
      try {
        uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        try (OutputStream out = resolver.openOutputStream(uri)) {
          out.write(Base64.decode(base64, Base64.DEFAULT));
        }
        toast("다운로드 폴더에 저장했습니다: " + name);
      } catch (Exception e) {
        if (uri != null) resolver.delete(uri, null, null); // 반쯤 쓴 파일을 남기지 않는다.
        toast("파일을 저장하지 못했습니다.");
      }
    }

    @JavascriptInterface
    public void print(String title) {
      // 이름이 비면 PrintManager 가 예외를 던져 앱이 죽는다(가상 폰에서 확인).
      final String name = title.trim().isEmpty() ? "제니스" : title;
      runOnUiThread(
          () -> {
            PrintManager printer = (PrintManager) getSystemService(PRINT_SERVICE);
            printer.print(name, web.createPrintDocumentAdapter(name), null);
          });
    }
  }
}
