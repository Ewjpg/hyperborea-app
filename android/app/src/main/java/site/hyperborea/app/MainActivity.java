package site.hyperborea.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.ConsoleMessage;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.util.Arrays;
import java.util.List;

/**
 * HYPERBOREA для Android: сайт открывается во весь экран из файлов внутри приложения,
 * поэтому интернет и VPN для работы не нужны. Только отправка карточек (/api/...) идёт на сервер сайта.
 */
public class MainActivity extends Activity {
    static final String TAG = "HYPERBOREA";
    // Какие ссылки можно открыть в других приложениях (браузер, Telegram, почта).
    private static final List<String> EXTERNAL_SCHEMES = Arrays.asList("http", "https", "mailto", "tel", "tg");

    private FrameLayout root;
    private WebView web;
    private SiteServer site;
    private ApiClient api;
    private Updater updater;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        api = new ApiClient(WebSettings.getDefaultUserAgent(this));
        site = new SiteServer(this, api);
        updater = new Updater(this);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        setContentView(root);
        fitSystemBars();

        // В проверочных сборках страницу можно открыть в chrome://inspect.
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) WebView.setWebContentsDebuggingEnabled(true);
        openSite();
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void openSite() {
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        // Музыка сайта играет так же, как в приложении для ПК, без лишнего касания.
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        // Размер шрифта в настройках телефона не должен ломать вёрстку сайта.
        settings.setTextZoom(100);
        settings.setUserAgentString(settings.getUserAgentString() + " HYPERBOREA-Android/" + BuildConfig.VERSION_NAME);

        web.addJavascriptInterface(new ApiBridge(web, api), ApiBridge.NAME);
        web.setWebViewClient(new SiteClient());
        web.setWebChromeClient(new SiteChrome());
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        web.loadUrl(SiteServer.ORIGIN + "/");
    }

    /** Страница не заходит под строку состояния, вырез камеры, кнопки навигации и клавиатуру. */
    private void fitSystemBars() {
        // На Android 10 и старше система сама отодвигает страницу от панелей и клавиатуры (adjustResize).
        if (Build.VERSION.SDK_INT < 30) return;
        getWindow().setDecorFitsSystemWindows(false);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            Insets keyboard = insets.getInsets(WindowInsets.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard.bottom));
            return WindowInsets.CONSUMED;
        });
    }

    private void openExternal(Uri url) {
        if (!EXTERNAL_SCHEMES.contains(url.getScheme())) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, url).addCategory(Intent.CATEGORY_BROWSABLE));
        } catch (ActivityNotFoundException e) {
            Log.w(TAG, "Нечем открыть " + url);
        }
    }

    // «Назад» работает как Escape на ПК: закрывает открытый раздел сайта.
    // Если закрывать нечего, приложение уходит в фон, а не закрывается.
    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (web == null) {
            super.onBackPressed();
            return;
        }
        WebView page = web;
        page.evaluateJavascript("typeof window.__hyperboreaBack === 'function' && window.__hyperboreaBack()", handled -> {
            if ("true".equals(handled) || page != web) return;
            if (page.canGoBack()) page.goBack();
            else moveTaskToBack(true);
        });
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
        updater.onResume();
    }

    @Override
    protected void onPause() {
        // Страница узнаёт, что её свернули, и сама приглушает музыку.
        if (web != null) web.onPause();
        updater.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        updater.close();
        if (web != null) {
            root.removeView(web);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    private class SiteClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            return site.handle(request);
        }

        // Ссылки на другие сайты открываются в обычном браузере.
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            String scheme = url.getScheme();
            if (SiteServer.isOwn(url) || "about".equals(scheme) || "data".equals(scheme) || "blob".equals(scheme)) return false;
            openExternal(url);
            return true;
        }

        // Если страница упала (например, телефону не хватило памяти), открываем её заново, а не закрываем приложение.
        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            Log.w(TAG, "Страница упала, открываю заново");
            root.removeView(view);
            view.destroy();
            if (view == web) {
                web = null;
                openSite();
            }
            return true;
        }
    }

    private static class SiteChrome extends WebChromeClient {
        // Вместо серого значка «play» на видео без заставки — пустота.
        @Override
        public Bitmap getDefaultVideoPoster() {
            return Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
        }

        @Override
        public boolean onConsoleMessage(ConsoleMessage message) {
            Log.d(TAG, message.message() + " (" + message.sourceId() + ":" + message.lineNumber() + ")");
            return true;
        }
    }
}
