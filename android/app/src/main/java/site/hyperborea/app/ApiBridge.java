package site.hyperborea.app;

import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Через этот мост страница отправляет на сервер запросы с телом (карточки FEAR и WAHHIYYY).
 * Его вызывает res/raw/android_bridge.js вместо обычного fetch.
 */
final class ApiBridge {
    static final String NAME = "HyperboreaAndroid";
    private static final List<String> METHODS = Arrays.asList("POST", "PUT", "DELETE");

    private final WebView web;
    private final ApiClient api;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService pool = Executors.newCachedThreadPool();

    ApiBridge(WebView web, ApiClient api) {
        this.web = web;
        this.api = api;
    }

    @JavascriptInterface
    public void request(int id, String method, String path, String contentType, String body) {
        if (path == null || !path.startsWith("/api/") || !METHODS.contains(method)) {
            reply(id, ApiClient.error(400, "Unsupported request"));
            return;
        }
        pool.execute(() -> reply(id, api.send(method, path, contentType, body == null ? null : body.getBytes(StandardCharsets.UTF_8))));
    }

    private void reply(int id, ApiClient.Result result) {
        String script = "window.__hyperboreaApiDone && window.__hyperboreaApiDone(" + id + "," + result.status + ","
                + JSONObject.quote(result.contentType) + "," + JSONObject.quote(new String(result.body, StandardCharsets.UTF_8)) + ")";
        main.post(() -> web.evaluateJavascript(script, null));
    }
}
