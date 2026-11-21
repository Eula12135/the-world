package io.github.theworld.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.speech.RecognizerIntent;
import android.speech.tts.TextToSpeech;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.core.content.FileProvider;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Locale;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private boolean lastImeVisible = false;
    private TextToSpeech tts;
    private boolean ttsReady = false;
    private static final int REQ_CODE_STT = 9042;
    private static final int REQ_CODE_INSTALL_PACKAGES = 9043;
    private File pendingInstallApk = null;
    private volatile boolean apkDownloading = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        }
        applySystemBarAppearance(true);

        tts = new TextToSpeech(this, status -> {
            if (status == TextToSpeech.SUCCESS) {
                int res = tts.setLanguage(Locale.CHINA);
                if (res == TextToSpeech.LANG_MISSING_DATA || res == TextToSpeech.LANG_NOT_SUPPORTED) {
                    tts.setLanguage(Locale.getDefault());
                }
                ttsReady = true;
            }
        });

        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            webView.addJavascriptInterface(new AndroidThemeBridge(), "TheWorldAndroid");
            setupSystemAndImeInsets(webView);
        }
    }

    @Override
    public void onDestroy() {
        if (tts != null) {
            try {
                tts.stop();
                tts.shutdown();
            } catch (Exception ignored) {
            }
            tts = null;
            ttsReady = false;
        }
        super.onDestroy();
    }

    private void dispatchSttDetail(String jsonDetailLiteral) {
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            String js = "window.dispatchEvent(new CustomEvent('theworld-stt',{detail:" + jsonDetailLiteral + "}));";
            webView.post(() -> webView.evaluateJavascript(js, null));
        }
    }

    private void dispatchApkUpdateEvent(String status, int progress, String message) {
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            String detail =
                "{\"status\":" + JSONObject.quote(status) +
                ",\"progress\":" + progress +
                ",\"message\":" + JSONObject.quote(message != null ? message : "") +
                "}";
            String js = "window.dispatchEvent(new CustomEvent('theworld-apk-update',{detail:" + detail + "}));";
            webView.post(() -> webView.evaluateJavascript(js, null));
        }
    }

    private boolean isApkZipHeader(File file) {
        if (file == null || !file.isFile() || file.length() < 4) {
            return false;
        }
        try (FileInputStream fis = new FileInputStream(file)) {
            int b0 = fis.read();
            int b1 = fis.read();
            return b0 == 0x50 && b1 == 0x4B;
        } catch (Exception ignored) {
            return false;
        }
    }

    private void installApkFile(File apkFile) {
        if (apkFile == null || !apkFile.exists()) {
            dispatchApkUpdateEvent("error", 0, "安装包文件不存在，请重试下载");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (!getPackageManager().canRequestPackageInstalls()) {
                pendingInstallApk = apkFile;
                dispatchApkUpdateEvent(
                    "permission",
                    100,
                    "请在系统设置中允许本应用安装未知来源应用，授权后返回将自动继续安装"
                );
                try {
                    Intent permIntent = new Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getPackageName())
                    );
                    startActivityForResult(permIntent, REQ_CODE_INSTALL_PACKAGES);
                } catch (Exception e) {
                    dispatchApkUpdateEvent("error", 0, "无法打开安装授权设置页：" + e.getMessage());
                }
                return;
            }
        }
        pendingInstallApk = null;
        try {
            Uri apkUri = FileProvider.getUriForFile(
                this,
                getPackageName() + ".fileprovider",
                apkFile
            );
            Intent installIntent = new Intent(Intent.ACTION_VIEW);
            installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            installIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(installIntent);
            dispatchApkUpdateEvent("installing", 100, "正在拉起系统安装界面...");
        } catch (Exception e) {
            dispatchApkUpdateEvent("error", 0, "拉起系统安装器失败：" + e.getMessage());
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_CODE_STT) {
            if (resultCode == Activity.RESULT_OK && data != null) {
                ArrayList<String> results = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
                String text = (results != null && !results.isEmpty()) ? results.get(0) : "";
                dispatchSttDetail("{\"text\":" + JSONObject.quote(text) + "}");
            } else {
                dispatchSttDetail("{\"canceled\":true}");
            }
            return;
        }
        if (requestCode == REQ_CODE_INSTALL_PACKAGES) {
            if (pendingInstallApk != null && pendingInstallApk.exists()) {
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getPackageManager().canRequestPackageInstalls()) {
                    File target = pendingInstallApk;
                    pendingInstallApk = null;
                    installApkFile(target);
                } else {
                    pendingInstallApk = null;
                    dispatchApkUpdateEvent("error", 0, "未授予「安装未知应用」权限，请开启后重试");
                }
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    private void setupSystemAndImeInsets(WebView webView) {
        ViewCompat.setOnApplyWindowInsetsListener(webView, (v, windowInsets) -> {
            Insets sysInsets = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            Insets imeInsets = windowInsets.getInsets(WindowInsetsCompat.Type.ime());

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                int left = sysInsets.left;
                int top = sysInsets.top;
                int right = sysInsets.right;
                int bottom = Math.max(sysInsets.bottom, imeInsets.bottom);

                ViewGroup.LayoutParams lp = v.getLayoutParams();
                if (lp instanceof ViewGroup.MarginLayoutParams) {
                    ViewGroup.MarginLayoutParams mlp = (ViewGroup.MarginLayoutParams) lp;
                    if (
                        mlp.leftMargin != left ||
                        mlp.topMargin != top ||
                        mlp.rightMargin != right ||
                        mlp.bottomMargin != bottom
                    ) {
                        mlp.leftMargin = left;
                        mlp.topMargin = top;
                        mlp.rightMargin = right;
                        mlp.bottomMargin = bottom;
                        v.setLayoutParams(mlp);
                    }
                }
            }

            boolean imeVisible = imeInsets.bottom > sysInsets.bottom;
            if (imeVisible != lastImeVisible) {
                lastImeVisible = imeVisible;
                int imeHeight = Math.max(0, imeInsets.bottom - sysInsets.bottom);
                String js =
                    "window.dispatchEvent(new CustomEvent('theworld-keyboard',{detail:{visible:" +
                    imeVisible +
                    ",height:" +
                    imeHeight +
                    "}}));";
                webView.post(() -> webView.evaluateJavascript(js, null));
            }

            return Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                ? WindowInsetsCompat.CONSUMED
                : windowInsets;
        });
        ViewCompat.requestApplyInsets(webView);
    }

    private void applySystemBarAppearance(boolean isDark) {
        int bgColor = Color.parseColor(isDark ? "#0F1117" : "#FFFFFF");
        getWindow().getDecorView().setBackgroundColor(bgColor);
        if (getBridge() != null && getBridge().getWebView() != null) {
            Object parent = getBridge().getWebView().getParent();
            if (parent instanceof View) {
                ((View) parent).setBackgroundColor(bgColor);
            }
        }
        getWindow().setStatusBarColor(bgColor);
        getWindow().setNavigationBarColor(Color.parseColor(isDark ? "#151821" : "#F7F8FA"));
        WindowInsetsControllerCompat controller =
            new WindowInsetsControllerCompat(getWindow(), getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(!isDark);
        controller.setAppearanceLightNavigationBars(!isDark);
    }

    private class AndroidThemeBridge {
        @JavascriptInterface
        public void setTheme(boolean isDark) {
            runOnUiThread(() -> applySystemBarAppearance(isDark));
        }

        @JavascriptInterface
        public void speak(String text, float rate) {
            speak(text, rate, 1.0f);
        }

        @JavascriptInterface
        public void speak(String text, float rate, float pitch) {
            runOnUiThread(() -> {
                if (tts != null && ttsReady && text != null && !text.trim().isEmpty()) {
                    float clampedRate = Math.max(0.5f, Math.min(2.0f, rate));
                    float clampedPitch = Math.max(0.5f, Math.min(2.0f, pitch));
                    tts.setSpeechRate(clampedRate);
                    tts.setPitch(clampedPitch);
                    String safeText = text.length() > 3800 ? text.substring(0, 3800) : text;
                    tts.speak(safeText, TextToSpeech.QUEUE_FLUSH, null, "tw_tts");
                }
            });
        }

        @JavascriptInterface
        public void stopSpeaking() {
            runOnUiThread(() -> {
                if (tts != null) {
                    try {
                        tts.stop();
                    } catch (Exception ignored) {
                    }
                }
            });
        }

        @JavascriptInterface
        public void startNativeStt(String lang) {
            runOnUiThread(() -> {
                try {
                    Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                    intent.putExtra(
                        RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                        RecognizerIntent.LANGUAGE_MODEL_FREE_FORM
                    );
                    intent.putExtra(
                        RecognizerIntent.EXTRA_LANGUAGE,
                        (lang != null && !lang.trim().isEmpty()) ? lang.trim() : "zh-CN"
                    );
                    intent.putExtra(RecognizerIntent.EXTRA_PROMPT, "请开始说话...");
                    startActivityForResult(intent, REQ_CODE_STT);
                } catch (ActivityNotFoundException e) {
                    dispatchSttDetail(
                        "{\"error\":" +
                        JSONObject.quote("当前系统未安装语音识别服务，可在「模型 → 语音」改用硅基流动 SenseVoice 等 API 识别") +
                        "}"
                    );
                } catch (Exception e) {
                    dispatchSttDetail(
                        "{\"error\":" +
                        JSONObject.quote("无法调起系统语音识别，可在「模型 → 语音」改用 API 语音识别") +
                        "}"
                    );
                }
            });
        }

        @JavascriptInterface
        public void downloadAndInstallApk(String apkUrl) {
            if (apkDownloading) {
                dispatchApkUpdateEvent("error", 0, "已有更新安装包正在下载中");
                return;
            }
            String trimmedUrl = apkUrl != null ? apkUrl.trim() : "";
            if (!trimmedUrl.startsWith("http://") && !trimmedUrl.startsWith("https://")) {
                dispatchApkUpdateEvent("error", 0, "无效的 APK 下载地址");
                return;
            }

            apkDownloading = true;
            dispatchApkUpdateEvent("downloading", 0, "正在连接下载服务器...");

            new Thread(() -> {
                HttpURLConnection conn = null;
                File tmpFile = new File(getCacheDir(), "theworld-update.apk.tmp");
                File outFile = new File(getCacheDir(), "theworld-update.apk");
                try {
                    if (tmpFile.exists()) {
                        tmpFile.delete();
                    }
                    String currentUrl = trimmedUrl;
                    for (int hop = 0; hop < 6; hop++) {
                        URL url = new URL(currentUrl);
                        conn = (HttpURLConnection) url.openConnection();
                        conn.setInstanceFollowRedirects(false);
                        conn.setConnectTimeout(15000);
                        conn.setReadTimeout(30000);
                        conn.setRequestProperty("User-Agent", "TheWorld-Android-Updater");
                        int code = conn.getResponseCode();
                        if (
                            code == HttpURLConnection.HTTP_MOVED_PERM ||
                            code == HttpURLConnection.HTTP_MOVED_TEMP ||
                            code == HttpURLConnection.HTTP_SEE_OTHER ||
                            code == 307 ||
                            code == 308
                        ) {
                            String location = conn.getHeaderField("Location");
                            conn.disconnect();
                            conn = null;
                            if (location == null || location.trim().isEmpty()) {
                                throw new Exception("下载重定向缺少目标地址");
                            }
                            currentUrl = new URL(url, location).toString();
                            continue;
                        }
                        break;
                    }

                    if (conn == null) {
                        throw new Exception("无法建立下载连接");
                    }
                    int status = conn.getResponseCode();
                    if (status < 200 || status >= 300) {
                        throw new Exception("下载失败 (HTTP " + status + ")");
                    }
                    String contentType = conn.getContentType();
                    if (contentType != null && contentType.toLowerCase(Locale.ROOT).contains("text/html")) {
                        throw new Exception("更新链接返回网页而非 APK，请确认发布源已上传 .apk 安装包或使用浏览器下载");
                    }

                    long totalBytes = conn.getContentLengthLong();
                    long downloaded = 0;
                    int lastProgress = -1;
                    long lastNotifyAt = 0;

                    try (
                        InputStream in = new BufferedInputStream(conn.getInputStream());
                        FileOutputStream out = new FileOutputStream(tmpFile)
                    ) {
                        byte[] buf = new byte[16384];
                        int len;
                        while ((len = in.read(buf)) != -1) {
                            out.write(buf, 0, len);
                            downloaded += len;
                            long now = System.currentTimeMillis();
                            if (totalBytes > 0) {
                                int pct = (int) Math.min(99, (downloaded * 100L) / totalBytes);
                                if (pct != lastProgress && (pct - lastProgress >= 2 || now - lastNotifyAt >= 200)) {
                                    lastProgress = pct;
                                    lastNotifyAt = now;
                                    dispatchApkUpdateEvent("downloading", pct, "正在下载安装包 " + pct + "%");
                                }
                            } else if (now - lastNotifyAt >= 350) {
                                lastNotifyAt = now;
                                String mb = String.format(Locale.US, "%.1f MB", downloaded / 1048576.0);
                                dispatchApkUpdateEvent("downloading", 0, "正在下载安装包（已下载 " + mb + "）");
                            }
                        }
                        out.getFD().sync();
                    }

                    if (!isApkZipHeader(tmpFile)) {
                        tmpFile.delete();
                        throw new Exception("下载的文件不是有效的 APK 安装包，请检查更新源配置");
                    }

                    if (outFile.exists() && !outFile.delete()) {
                        throw new Exception("无法替换旧的缓存安装包");
                    }
                    if (!tmpFile.renameTo(outFile)) {
                        throw new Exception("保存安装包失败");
                    }

                    dispatchApkUpdateEvent("downloading", 100, "下载完成，准备安装...");
                    runOnUiThread(() -> installApkFile(outFile));
                } catch (Exception e) {
                    if (tmpFile.exists()) {
                        tmpFile.delete();
                    }
                    String errMsg = e.getMessage() != null && !e.getMessage().isEmpty()
                        ? e.getMessage()
                        : "APK 下载失败，请检查网络连接";
                    dispatchApkUpdateEvent("error", 0, errMsg);
                } finally {
                    if (conn != null) {
                        conn.disconnect();
                    }
                    apkDownloading = false;
                }
            }, "theworld-apk-updater").start();
        }
    }
}
