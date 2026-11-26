package com.tagandgo.pilot;

import android.app.Activity;
import android.graphics.Color;
import android.nfc.NfcAdapter;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.HapticFeedbackConstants;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.util.Log;
import android.widget.TextView;
import android.widget.Toast;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

public final class MainActivity extends Activity {
    private static final String APP_ORIGIN = "https://appassets.androidplatform.net/index.html";
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable scanTimeout = () -> stopScan("태그를 찾지 못했어요. 다시 시도해 주세요.");
    private WebView web;
    private NfcAdapter nfc;
    private boolean scanning;
    private boolean foreground;

    @Override public void onCreate(Bundle savedState) {
        super.onCreate(savedState);
        nfc = NfcAdapter.getDefaultAdapter(this);
        web = new WebView(this);
        web.setBackgroundColor(Color.WHITE);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.getSettings().setBlockNetworkLoads(true);
        web.addJavascriptInterface(new Bridge(), "TagGoAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return true;
            }
        });
        setContentView(web);
        loadHome();
    }

    private void loadHome() {
        try (InputStream input = getResources().openRawResource(R.raw.taggo_page);
             ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
            byte[] chunk = new byte[8192];
            int size;
            while ((size = input.read(chunk)) != -1) bytes.write(chunk, 0, size);
            web.loadDataWithBaseURL(APP_ORIGIN, bytes.toString("UTF-8"), "text/html", null, APP_ORIGIN);
        } catch (IOException | android.content.res.Resources.NotFoundException error) {
            Log.e("TagAndGo", "Could not read packaged home screen", error);
            TextView message = new TextView(this);
            message.setGravity(android.view.Gravity.CENTER);
            message.setText("MOA 화면을 읽지 못했어요. 최신 APK를 다시 설치해 주세요.");
            setContentView(message);
        }
    }

    @Override protected void onResume() {
        super.onResume();
        foreground = true;
    }

    @Override protected void onPause() {
        foreground = false;
        stopScan(null);
        super.onPause();
    }

    @Override protected void onDestroy() {
        worker.shutdownNow();
        web.removeJavascriptInterface("TagGoAndroid");
        web.destroy();
        super.onDestroy();
    }

    private void stopScan(String message) {
        if (!scanning) return;
        scanning = false;
        handler.removeCallbacks(scanTimeout);
        nfc.disableReaderMode(this);
        if (message != null) Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }

    private void scanOnce() {
        if (scanning || !foreground) return;
        int flags = NfcAdapter.FLAG_READER_NFC_A | NfcAdapter.FLAG_READER_NFC_B
            | NfcAdapter.FLAG_READER_NFC_F | NfcAdapter.FLAG_READER_NFC_V
            | NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK;
        scanning = true;
        nfc.enableReaderMode(this, tag -> runOnUiThread(() -> {
            if (!scanning || !foreground) return;
            byte[] uid = tag.getId();
            stopScan(null);
            if (uid == null || uid.length == 0) {
                Toast.makeText(this, "이 키링의 ID를 읽지 못했어요.", Toast.LENGTH_SHORT).show();
                return;
            }
            StringBuilder hex = new StringBuilder();
            for (byte value : uid) hex.append(String.format(Locale.ROOT, "%02X", value & 0xff));
            web.evaluateJavascript("window.tagGoRead(" + JSONObject.quote(hex.toString()) + ")", null);
        }), flags, null);
        handler.postDelayed(scanTimeout, 15000);
    }

    public final class Bridge {
        @JavascriptInterface public void stampFeedback() {
            runOnUiThread(() -> {
                if (foreground) web.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK);
            });
        }

        @JavascriptInterface public String startScan() {
            if (nfc == null) return "이 기기에는 NFC 리더가 없어요.";
            if (!nfc.isEnabled()) return "휴대폰 설정에서 NFC를 켜 주세요.";
            runOnUiThread(MainActivity.this::scanOnce);
            return "15초 안에 키링을 휴대폰 뒷면에 대 주세요.";
        }

        @JavascriptInterface public void request(int id, String server, String path, String body, String token) {
            worker.submit(() -> callServer(id, server, path, body, token));
        }
    }

    private static URI endpoint(String base, String path) throws Exception {
        URI uri = new URI(base);
        if (!("http".equals(uri.getScheme()) || "https".equals(uri.getScheme()))
            || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null
            || !uri.getPath().isEmpty() || !isPrivateAddress(uri.getHost())
            || !path.matches("/api/(catalog|join|recover|member|pos|counter)")) {
            throw new IllegalArgumentException("같은 와이파이의 테스트 서버 IPv4 주소를 입력해 주세요.");
        }
        return uri.resolve(path);
    }

    private static boolean isPrivateAddress(String address) {
        if (address == null || !address.matches("[0-9]{1,3}(\\.[0-9]{1,3}){3}")) return false;
        String[] parts = address.split("\\.");
        int first = Integer.parseInt(parts[0]);
        int second = Integer.parseInt(parts[1]);
        for (String part : parts) if (Integer.parseInt(part) > 255) return false;
        return first == 10 || first == 127 || (first == 192 && second == 168)
            || (first == 172 && second >= 16 && second <= 31);
    }

    private void callServer(int id, String base, String path, String body, String token) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) endpoint(base, path).toURL().openConnection();
            connection.setConnectTimeout(4500);
            connection.setReadTimeout(4500);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestMethod("POST");
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            if (!token.isEmpty()) connection.setRequestProperty("Authorization", "Bearer " + token);
            connection.setDoOutput(true);
            try (OutputStream output = connection.getOutputStream()) {
                output.write(body.getBytes(StandardCharsets.UTF_8));
            }
            int status = connection.getResponseCode();
            try (InputStream input = status < 400 ? connection.getInputStream() : connection.getErrorStream()) {
                if (input == null) throw new IllegalStateException();
                ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                byte[] chunk = new byte[4096];
                int size;
                while ((size = input.read(chunk)) != -1) {
                    if (bytes.size() + size > 1_000_000) throw new IllegalStateException();
                    bytes.write(chunk, 0, size);
                }
                JSONObject result = new JSONObject(bytes.toString("UTF-8"));
                reply(id, status, result.toString());
            }
        } catch (IllegalArgumentException error) {
            reply(id, 400, "{\"error\":" + JSONObject.quote(error.getMessage()) + "}");
        } catch (Exception error) {
            reply(id, 503, "{\"error\":\"테스트 서버 주소와 와이파이 연결을 확인해 주세요.\"}");
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void reply(int id, int status, String body) {
        runOnUiThread(() -> {
            if (!isDestroyed()) web.evaluateJavascript(
                "window.tagGoReply(" + id + "," + status + ",JSON.parse(" + JSONObject.quote(body) + "))", null);
        });
    }
}
