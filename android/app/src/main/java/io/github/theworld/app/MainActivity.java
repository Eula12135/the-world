package io.github.theworld.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.speech.RecognizerIntent;
import android.speech.tts.TextToSpeech;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import java.util.ArrayList;
import java.util.Locale;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private boolean lastImeVisible = false;
    private TextToSpeech tts;
    private boolean ttsReady = false;
    private static final int REQ_CODE_STT = 9042;

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
            runOnUiThread(() -> {
                if (tts != null && ttsReady && text != null && !text.trim().isEmpty()) {
                    float clampedRate = Math.max(0.5f, Math.min(2.0f, rate));
                    tts.setSpeechRate(clampedRate);
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
    }
}
