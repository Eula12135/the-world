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
import android.speech.tts.UtteranceProgressListener;
import android.util.Base64;
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
import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.Locale;
import java.util.UUID;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private boolean lastImeVisible = false;
    private TextToSpeech tts;
    private volatile boolean ttsReady = false;
    private static final int REQ_CODE_STT = 9042;
    private static final int REQ_CODE_INSTALL_PACKAGES = 9043;
    private static final int REQ_CODE_EXPORT_FILE = 9044;
    private static final String STATE_PENDING_INSTALL_APK = "pendingInstallApk";
    private static final String STATE_PENDING_EXPORT_FILE = "pendingExportTempFile";
    private static final String STATE_PENDING_EXPORT_MIME = "pendingExportMime";
    private File pendingInstallApk = null;
    private File pendingExportTempFile = null;
    private String pendingExportMime = "text/plain";
    private volatile boolean apkDownloading = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (savedInstanceState != null) {
            String apkPath = savedInstanceState.getString(STATE_PENDING_INSTALL_APK);
            if (apkPath != null && !apkPath.isEmpty()) {
                pendingInstallApk = new File(apkPath);
            }
            String expPath = savedInstanceState.getString(STATE_PENDING_EXPORT_FILE);
            if (expPath != null && !expPath.isEmpty()) {
                pendingExportTempFile = new File(expPath);
            }
            String expMime = savedInstanceState.getString(STATE_PENDING_EXPORT_MIME);
            if (expMime != null && !expMime.isEmpty()) {
                pendingExportMime = expMime;
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        }
        applySystemBarAppearance(true);

        tts = new TextToSpeech(this, status -> {
            if (isFinishing() || isDestroyed() || tts == null) {
                return;
            }
            if (status == TextToSpeech.SUCCESS) {
                int res = tts.setLanguage(Locale.CHINA);
                if (res == TextToSpeech.LANG_MISSING_DATA || res == TextToSpeech.LANG_NOT_SUPPORTED) {
                    tts.setLanguage(Locale.getDefault());
                }
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override
                    public void onStart(String utteranceId) {}

                    @Override
                    public void onDone(String utteranceId) {
                        dispatchTtsEvent("done", utteranceId, "");
                    }

                    @Override
                    public void onStop(String utteranceId, boolean interrupted) {
                        dispatchTtsEvent("done", utteranceId, "");
                    }

                    @Override
                    public void onError(String utteranceId) {
                        dispatchTtsEvent("error", utteranceId, "系统语音朗读失败");
                    }

                    @Override
                    public void onError(String utteranceId, int errorCode) {
                        dispatchTtsEvent("error", utteranceId, "系统语音朗读失败 (code " + errorCode + ")");
                    }
                });
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
    public void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (pendingInstallApk != null) {
            outState.putString(STATE_PENDING_INSTALL_APK, pendingInstallApk.getAbsolutePath());
        }
        if (pendingExportTempFile != null) {
            outState.putString(STATE_PENDING_EXPORT_FILE, pendingExportTempFile.getAbsolutePath());
        }
        if (pendingExportMime != null) {
            outState.putString(STATE_PENDING_EXPORT_MIME, pendingExportMime);
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

    private void dispatchTtsEvent(String status, String utteranceId, String message) {
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            String detail =
                "{\"status\":" + JSONObject.quote(status) +
                ",\"utteranceId\":" + JSONObject.quote(utteranceId != null ? utteranceId : "") +
                ",\"message\":" + JSONObject.quote(message != null ? message : "") +
                "}";
            String js = "window.dispatchEvent(new CustomEvent('theworld-tts',{detail:" + detail + "}));";
            webView.post(() -> webView.evaluateJavascript(js, null));
        }
    }

    private void dispatchExportEvent(boolean ok, boolean canceled, String message) {
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            String detail =
                "{\"ok\":" + ok +
                ",\"canceled\":" + canceled +
                ",\"message\":" + JSONObject.quote(message != null ? message : "") +
                "}";
            String js = "window.dispatchEvent(new CustomEvent('theworld-export',{detail:" + detail + "}));";
            webView.post(() -> webView.evaluateJavascript(js, null));
        }
    }

    private void dispatchMultipartEvent(String reqId, boolean ok, int status, String text) {
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            String detail =
                "{\"reqId\":" + JSONObject.quote(reqId != null ? reqId : "") +
                ",\"ok\":" + ok +
                ",\"status\":" + status +
                ",\"text\":" + JSONObject.quote(text != null ? text : "") +
                "}";
            String js = "window.dispatchEvent(new CustomEvent('theworld-multipart',{detail:" + detail + "}));";
            webView.post(() -> webView.evaluateJavascript(js, null));
        }
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

    private String sanitizeExportFilename(String raw) {
        if (raw == null) return "export.txt";
        String cleaned = raw.replaceAll("[/\\\\:*?\"<>|\\r\\n\\t]+", "_").trim();
        while (cleaned.startsWith(".")) {
            cleaned = cleaned.substring(1).trim();
        }
        return cleaned.isEmpty() ? "export.txt" : cleaned;
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
        if (requestCode == REQ_CODE_EXPORT_FILE) {
            File srcFile = pendingExportTempFile;
            pendingExportTempFile = null;
            if (resultCode == Activity.RESULT_OK && data != null && data.getData() != null && srcFile != null && srcFile.exists()) {
                Uri destUri = data.getData();
                new Thread(() -> {
                    try (
                        InputStream in = new FileInputStream(srcFile);
                        OutputStream out = getContentResolver().openOutputStream(destUri)
                    ) {
                        if (out == null) {
                            throw new Exception("无法写入目标文件");
                        }
                        byte[] buf = new byte[8192];
                        int len;
                        while ((len = in.read(buf)) != -1) {
                            out.write(buf, 0, len);
                        }
                        out.flush();
                        dispatchExportEvent(true, false, "");
                    } catch (Exception e) {
                        dispatchExportEvent(false, false, e.getMessage() != null ? e.getMessage() : "写入导出文件失败");
                    } finally {
                        srcFile.delete();
                    }
                }, "theworld-file-export").start();
            } else {
                if (srcFile != null && srcFile.exists()) {
                    srcFile.delete();
                }
                if (resultCode == Activity.RESULT_CANCELED) {
                    dispatchExportEvent(false, true, "");
                } else {
                    dispatchExportEvent(false, false, "导出文件失败");
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
            speakWithId(text, rate, 1.0f, 1.0f, "tw_tts");
        }

        @JavascriptInterface
        public void speak(String text, float rate, float pitch) {
            speakWithId(text, rate, pitch, 1.0f, "tw_tts");
        }

        @JavascriptInterface
        public void speakWithId(String text, float rate, float pitch, float volume, String utteranceId) {
            String uid = (utteranceId != null && !utteranceId.isEmpty()) ? utteranceId : "tw_tts";
            runOnUiThread(() -> {
                if (tts == null || !ttsReady) {
                    dispatchTtsEvent("error", uid, "系统语音引擎尚未就绪，请检查系统 TTS 服务或切换云端 TTS");
                    return;
                }
                if (text == null || text.trim().isEmpty()) {
                    dispatchTtsEvent("done", uid, "");
                    return;
                }
                float clampedRate = Math.max(0.5f, Math.min(2.0f, rate));
                float clampedPitch = Math.max(0.5f, Math.min(2.0f, pitch));
                float clampedVolume = Math.max(0.1f, Math.min(1.0f, volume));
                tts.setSpeechRate(clampedRate);
                tts.setPitch(clampedPitch);
                Bundle params = new Bundle();
                params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, clampedVolume);
                String safeText = text.length() > 3800 ? text.substring(0, 3800) : text;
                int rc = tts.speak(safeText, TextToSpeech.QUEUE_FLUSH, params, uid);
                if (rc == TextToSpeech.ERROR) {
                    dispatchTtsEvent("error", uid, "系统语音朗读调用失败");
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
        public void exportTextFile(String filename, String content, String mimeType) {
            String safeName = sanitizeExportFilename(filename);
            String cleanMime = (mimeType != null && !mimeType.trim().isEmpty())
                ? mimeType.split(";")[0].trim()
                : "text/plain";
            String safeContent = content != null ? content : "";

            new Thread(() -> {
                try {
                    File exportsDir = new File(getCacheDir(), "exports");
                    if (!exportsDir.exists()) {
                        exportsDir.mkdirs();
                    }
                    File tmp = new File(exportsDir, safeName);
                    try (FileOutputStream fos = new FileOutputStream(tmp)) {
                        fos.write(safeContent.getBytes(StandardCharsets.UTF_8));
                        fos.flush();
                    }
                    runOnUiThread(() -> {
                        pendingExportTempFile = tmp;
                        pendingExportMime = cleanMime;
                        try {
                            Intent createIntent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                            createIntent.addCategory(Intent.CATEGORY_OPENABLE);
                            createIntent.setType(cleanMime);
                            createIntent.putExtra(Intent.EXTRA_TITLE, safeName);
                            startActivityForResult(createIntent, REQ_CODE_EXPORT_FILE);
                        } catch (Exception safErr) {
                            pendingExportTempFile = null;
                            try {
                                Uri fileUri = FileProvider.getUriForFile(
                                    MainActivity.this,
                                    getPackageName() + ".fileprovider",
                                    tmp
                                );
                                Intent shareIntent = new Intent(Intent.ACTION_SEND);
                                shareIntent.setType(cleanMime);
                                shareIntent.putExtra(Intent.EXTRA_STREAM, fileUri);
                                shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                                startActivity(Intent.createChooser(shareIntent, "导出文件"));
                                dispatchExportEvent(true, false, "");
                            } catch (Exception shareErr) {
                                tmp.delete();
                                dispatchExportEvent(
                                    false,
                                    false,
                                    shareErr.getMessage() != null ? shareErr.getMessage() : "无法启动导出界面"
                                );
                            }
                        }
                    });
                } catch (Exception e) {
                    dispatchExportEvent(false, false, e.getMessage() != null ? e.getMessage() : "写入导出临时文件失败");
                }
            }, "theworld-prepare-export").start();
        }

        @JavascriptInterface
        public void uploadMultipart(String reqId, String jsonSpec) {
            new Thread(() -> {
                HttpURLConnection conn = null;
                try {
                    JSONObject spec = new JSONObject(jsonSpec);
                    String rawUrl = spec.optString("url", "").trim();
                    if (!rawUrl.startsWith("http://") && !rawUrl.startsWith("https://")) {
                        dispatchMultipartEvent(reqId, false, 400, "Unsupported URL protocol");
                        return;
                    }
                    JSONObject headersObj = spec.optJSONObject("headers");
                    JSONObject fieldsObj = spec.optJSONObject("fields");
                    String fileField = spec.optString("fileField", "file");
                    String fileName = spec.optString("fileName", "audio.webm");
                    String fileMime = spec.optString("fileMime", "audio/webm");
                    String fileBase64 = spec.optString("fileBase64", "");

                    byte[] fileBytes = Base64.decode(fileBase64, Base64.DEFAULT);
                    String boundary = "----TheWorldBoundary" + UUID.randomUUID().toString().replace("-", "");

                    URL url = new URL(rawUrl);
                    conn = (HttpURLConnection) url.openConnection();
                    conn.setRequestMethod("POST");
                    conn.setDoOutput(true);
                    conn.setDoInput(true);
                    conn.setConnectTimeout(15000);
                    conn.setReadTimeout(90000);
                    conn.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);

                    if (headersObj != null) {
                        Iterator<String> keys = headersObj.keys();
                        while (keys.hasNext()) {
                            String k = keys.next();
                            if (!"content-type".equalsIgnoreCase(k)) {
                                conn.setRequestProperty(k, headersObj.optString(k, ""));
                            }
                        }
                    }

                    try (DataOutputStream dos = new DataOutputStream(conn.getOutputStream())) {
                        if (fieldsObj != null) {
                            Iterator<String> fkeys = fieldsObj.keys();
                            while (fkeys.hasNext()) {
                                String fk = fkeys.next();
                                String fv = fieldsObj.optString(fk, "");
                                String safeFk = fk.replace("\"", "").replace("\r", "").replace("\n", "");
                                dos.write(("--" + boundary + "\r\n").getBytes(StandardCharsets.UTF_8));
                                dos.write(
                                    ("Content-Disposition: form-data; name=\"" + safeFk + "\"\r\n\r\n")
                                        .getBytes(StandardCharsets.UTF_8)
                                );
                                dos.write(fv.getBytes(StandardCharsets.UTF_8));
                                dos.write("\r\n".getBytes(StandardCharsets.UTF_8));
                            }
                        }

                        String safeField = fileField.replace("\"", "").replace("\r", "").replace("\n", "");
                        String safeFileName = fileName.replace("\"", "").replace("\r", "").replace("\n", "");
                        String safeMime = fileMime.replace("\r", "").replace("\n", "");
                        dos.write(("--" + boundary + "\r\n").getBytes(StandardCharsets.UTF_8));
                        dos.write(
                            ("Content-Disposition: form-data; name=\"" + safeField + "\"; filename=\"" + safeFileName + "\"\r\n")
                                .getBytes(StandardCharsets.UTF_8)
                        );
                        dos.write(("Content-Type: " + safeMime + "\r\n\r\n").getBytes(StandardCharsets.UTF_8));
                        dos.write(fileBytes);
                        dos.write(("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
                        dos.flush();
                    }

                    int status = conn.getResponseCode();
                    InputStream respStream = (status >= 200 && status < 300)
                        ? conn.getInputStream()
                        : conn.getErrorStream();
                    String respText = "";
                    if (respStream != null) {
                        try (InputStream is = respStream; ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
                            byte[] buf = new byte[8192];
                            int len;
                            while ((len = is.read(buf)) != -1) {
                                baos.write(buf, 0, len);
                            }
                            respText = new String(baos.toByteArray(), StandardCharsets.UTF_8);
                        }
                    }
                    dispatchMultipartEvent(reqId, status >= 200 && status < 300, status, respText);
                } catch (Exception e) {
                    dispatchMultipartEvent(
                        reqId,
                        false,
                        0,
                        e.getMessage() != null ? e.getMessage() : "Multipart upload failed"
                    );
                } finally {
                    if (conn != null) {
                        conn.disconnect();
                    }
                }
            }, "theworld-multipart-upload").start();
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
                            String nextUrl = new URL(url, location).toString();
                            if (!nextUrl.startsWith("http://") && !nextUrl.startsWith("https://")) {
                                throw new Exception("不支持的重定向下载协议");
                            }
                            currentUrl = nextUrl;
                            continue;
                        }
                        break;
                    }

                    if (conn == null) {
                        throw new Exception("下载重定向次数过多或无法建立连接");
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
