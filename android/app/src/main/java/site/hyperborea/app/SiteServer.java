package site.hyperborea.app;

import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.content.res.AssetManager;
import android.net.Uri;
import android.util.Log;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Отдаёт странице файлы сайта, которые лежат внутри приложения (assets),
 * а запросы к /api/ пересылает на сервер сайта.
 */
final class SiteServer {
    static final String HOST = "appassets.androidplatform.net";
    // Адрес страницы внутри приложения. Не менять: к нему привязаны сохранённые данные (localStorage).
    static final String ORIGIN = "https://" + HOST;
    // Скрипт приложения, который подключается первым на каждой странице (см. res/raw/android_bridge.js).
    private static final String BRIDGE_PATH = "/__android/bridge.js";
    private static final Pattern HEAD = Pattern.compile("<head(\\s[^>]*)?>", Pattern.CASE_INSENSITIVE);
    private static final Pattern RANGE = Pattern.compile("^bytes=(\\d*)-(\\d*)$");
    private static final Map<String, String> MIME = new HashMap<>();

    static {
        MIME.put("html", "text/html; charset=utf-8");
        MIME.put("js", "text/javascript; charset=utf-8");
        MIME.put("mjs", "text/javascript; charset=utf-8");
        MIME.put("css", "text/css; charset=utf-8");
        MIME.put("json", "application/json; charset=utf-8");
        MIME.put("webmanifest", "application/manifest+json; charset=utf-8");
        MIME.put("svg", "image/svg+xml");
        MIME.put("png", "image/png");
        MIME.put("jpg", "image/jpeg");
        MIME.put("jpeg", "image/jpeg");
        MIME.put("webp", "image/webp");
        MIME.put("gif", "image/gif");
        MIME.put("ico", "image/x-icon");
        MIME.put("mp3", "audio/mpeg");
        MIME.put("ogg", "audio/ogg");
        MIME.put("wav", "audio/wav");
        MIME.put("mp4", "video/mp4");
        MIME.put("webm", "video/webm");
        MIME.put("woff", "font/woff");
        MIME.put("woff2", "font/woff2");
        MIME.put("ttf", "font/ttf");
        MIME.put("otf", "font/otf");
        MIME.put("txt", "text/plain; charset=utf-8");
        MIME.put("md", "text/plain; charset=utf-8");
    }

    private final Context context;
    private final AssetManager assets;
    private final ApiClient api;
    private volatile byte[] bridge;

    SiteServer(Context context, ApiClient api) {
        this.context = context.getApplicationContext();
        this.assets = context.getAssets();
        this.api = api;
    }

    static boolean isOwn(Uri url) {
        return "https".equals(url.getScheme()) && HOST.equals(url.getHost());
    }

    /** Ответ на запрос страницы или null, если запрос не к приложению (например, к Google Fonts). */
    WebResourceResponse handle(WebResourceRequest request) {
        Uri url = request.getUrl();
        if (!isOwn(url)) return null;
        String path = url.getPath();
        if (path == null || path.isEmpty()) path = "/";
        try {
            if (path.startsWith("/api/")) return api(request, url);
            if (path.equals(BRIDGE_PATH)) return respond(200, "text/javascript; charset=utf-8", bridge(), null);
            return file(path, request.getRequestHeaders());
        } catch (Exception e) {
            Log.e(MainActivity.TAG, "Не удалось отдать " + path, e);
            return respond(500, "text/plain; charset=utf-8", "Internal error".getBytes(StandardCharsets.UTF_8), null);
        }
    }

    // GET-запросы к серверу (получение формы) пересылаются прямо отсюда.
    // Запросы с телом (отправка карточки) сюда не доходят: их передаёт android_bridge.js, потому что WebView не показывает приложению тело запроса.
    private WebResourceResponse api(WebResourceRequest request, Uri url) {
        String method = request.getMethod();
        if (!"GET".equals(method) && !"HEAD".equals(method)) {
            return respond(405, "application/json; charset=utf-8", "{\"error\":\"Unsupported request\"}".getBytes(StandardCharsets.UTF_8), null);
        }
        String query = url.getEncodedQuery();
        ApiClient.Result result = api.send(method, url.getEncodedPath() + (query == null ? "" : "?" + query), null, null);
        return respond(result.status, result.contentType, result.body, null);
    }

    private WebResourceResponse file(String path, Map<String, String> requestHeaders) throws IOException {
        String name = path.substring(1);
        if (name.isEmpty() || name.endsWith("/")) name += "index.html";
        if (name.contains("..")) return respond(403, "text/plain; charset=utf-8", "Forbidden".getBytes(StandardCharsets.UTF_8), null);
        String type = mime(name);
        if (name.endsWith(".html")) return html(name, type);

        // Размер известен для несжатых файлов (музыка, картинки, видео) — для них работает перемотка.
        long size = -1;
        try (AssetFileDescriptor descriptor = assets.openFd(name)) {
            size = descriptor.getLength();
        } catch (IOException compressedOrMissing) {
            // Сжатый файл (скрипты, стили) отдаём целиком.
        }
        InputStream stream;
        try {
            stream = assets.open(name);
        } catch (IOException missing) {
            return respond(404, "text/plain; charset=utf-8", "Not found".getBytes(StandardCharsets.UTF_8), null);
        }

        Map<String, String> headers = new HashMap<>();
        headers.put("Accept-Ranges", size >= 0 ? "bytes" : "none");
        Matcher range = RANGE.matcher(header(requestHeaders, "Range"));
        if (size >= 0 && range.matches() && !(range.group(1).isEmpty() && range.group(2).isEmpty())) {
            long start;
            long end;
            if (range.group(1).isEmpty()) {
                start = Math.max(size - Long.parseLong(range.group(2)), 0);
                end = size - 1;
            } else {
                start = Long.parseLong(range.group(1));
                end = range.group(2).isEmpty() ? size - 1 : Math.min(Long.parseLong(range.group(2)), size - 1);
            }
            if (start > end || start >= size) {
                stream.close();
                headers.put("Content-Range", "bytes */" + size);
                return respond(416, type, new byte[0], headers);
            }
            skip(stream, start);
            headers.put("Content-Range", "bytes " + start + "-" + end + "/" + size);
            headers.put("Content-Length", String.valueOf(end - start + 1));
            return respond(206, type, new Limited(stream, end - start + 1), headers);
        }
        if (size >= 0) headers.put("Content-Length", String.valueOf(size));
        return respond(200, type, stream, headers);
    }

    /** Страница сайта с подключённым первым скриптом приложения. */
    private WebResourceResponse html(String name, String type) throws IOException {
        String html;
        try (InputStream stream = assets.open(name)) {
            html = new String(read(stream), StandardCharsets.UTF_8);
        } catch (IOException missing) {
            return respond(404, "text/plain; charset=utf-8", "Not found".getBytes(StandardCharsets.UTF_8), null);
        }
        String script = "<script src=\"" + BRIDGE_PATH + "\"></script>";
        Matcher head = HEAD.matcher(html);
        html = head.find() ? html.substring(0, head.end()) + script + html.substring(head.end()) : script + html;
        return respond(200, type, html.getBytes(StandardCharsets.UTF_8), null);
    }

    private byte[] bridge() throws IOException {
        if (bridge == null) {
            try (InputStream stream = context.getResources().openRawResource(R.raw.android_bridge)) {
                bridge = read(stream);
            }
        }
        return bridge;
    }

    private static WebResourceResponse respond(int status, String type, byte[] body, Map<String, String> headers) {
        if (headers == null) headers = new HashMap<>();
        headers.put("Content-Length", String.valueOf(body.length));
        return respond(status, type, new ByteArrayInputStream(body), headers);
    }

    private static WebResourceResponse respond(int status, String type, InputStream body, Map<String, String> headers) {
        if (headers == null) headers = new HashMap<>();
        headers.put("Cache-Control", "no-cache");
        // WebView не принимает перенаправления (3xx) и нестандартные коды в ответе приложения.
        if (status < 100 || status > 599 || (status >= 300 && status < 400)) status = 502;
        String mime = type;
        String charset = null;
        int semicolon = type.indexOf(';');
        if (semicolon >= 0) {
            mime = type.substring(0, semicolon).trim();
            Matcher match = Pattern.compile("charset=\"?([^\";]+)", Pattern.CASE_INSENSITIVE).matcher(type);
            if (match.find()) charset = match.group(1).trim();
        }
        return new WebResourceResponse(mime, charset, status, reason(status), headers, body);
    }

    private static String reason(int status) {
        switch (status) {
            case 200: return "OK";
            case 206: return "Partial Content";
            case 404: return "Not Found";
            case 416: return "Range Not Satisfiable";
            default: return status < 400 ? "OK" : "Error";
        }
    }

    private static String mime(String name) {
        int dot = name.lastIndexOf('.');
        String type = dot < 0 ? null : MIME.get(name.substring(dot + 1).toLowerCase(Locale.ROOT));
        return type == null ? "application/octet-stream" : type;
    }

    private static String header(Map<String, String> headers, String name) {
        if (headers != null) {
            for (Map.Entry<String, String> entry : headers.entrySet()) {
                if (name.equalsIgnoreCase(entry.getKey()) && entry.getValue() != null) return entry.getValue().trim();
            }
        }
        return "";
    }

    static byte[] read(InputStream stream) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[16384];
        for (int count; (count = stream.read(buffer)) != -1; ) out.write(buffer, 0, count);
        return out.toByteArray();
    }

    private static void skip(InputStream stream, long count) throws IOException {
        while (count > 0) {
            long skipped = stream.skip(count);
            if (skipped <= 0) {
                if (stream.read() == -1) return;
                skipped = 1;
            }
            count -= skipped;
        }
    }

    /** Отдаёт не больше заданного числа байт — для частичной загрузки музыки и видео. */
    private static final class Limited extends FilterInputStream {
        private long left;

        Limited(InputStream stream, long length) {
            super(stream);
            left = length;
        }

        @Override
        public int read() throws IOException {
            if (left <= 0) return -1;
            int value = super.read();
            if (value >= 0) left--;
            return value;
        }

        @Override
        public int read(byte[] buffer, int offset, int length) throws IOException {
            if (left <= 0) return -1;
            int count = super.read(buffer, offset, (int) Math.min(length, left));
            if (count > 0) left -= count;
            return count;
        }

        @Override
        public long skip(long count) throws IOException {
            long skipped = super.skip(Math.min(count, left));
            left -= skipped;
            return skipped;
        }

        @Override
        public int available() throws IOException {
            return (int) Math.min(super.available(), left);
        }
    }
}
