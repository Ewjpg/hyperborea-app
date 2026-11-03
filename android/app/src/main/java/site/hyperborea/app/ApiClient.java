package site.hyperborea.app;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Пересылает запросы страницы к /api/ на сервер сайта — так же, как приложение для ПК. */
final class ApiClient {
    static final String SITE_URL = "https://hyperborea.sharpsong66.chatgpt.site";
    private static final String OFFLINE = "Нет связи с сервером. Попробуйте позже или включите VPN. Черновик остаётся на устройстве.";

    static final class Result {
        final int status;
        final String contentType;
        final byte[] body;

        Result(int status, String contentType, byte[] body) {
            this.status = status;
            this.contentType = contentType;
            this.body = body;
        }
    }

    private final String userAgent;

    ApiClient(String userAgent) {
        this.userAgent = userAgent;
    }

    /** Выполняет запрос и всегда возвращает ответ: при обрыве связи — ошибку 503 с понятным текстом. */
    Result send(String method, String pathAndQuery, String contentType, byte[] body) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(SITE_URL + pathAndQuery).openConnection();
            connection.setRequestMethod(method);
            connection.setConnectTimeout(20000);
            connection.setReadTimeout(45000);
            connection.setUseCaches(false);
            // Сервер принимает карточки только «со своего сайта».
            connection.setRequestProperty("Origin", SITE_URL);
            connection.setRequestProperty("Content-Type", contentType == null || contentType.isEmpty() ? "application/json" : contentType);
            connection.setRequestProperty("Accept", "application/json");
            if (userAgent != null) connection.setRequestProperty("User-Agent", userAgent);
            if (body != null && !"GET".equals(method) && !"HEAD".equals(method)) {
                connection.setDoOutput(true);
                connection.setFixedLengthStreamingMode(body.length);
                try (OutputStream out = connection.getOutputStream()) {
                    out.write(body);
                }
            }
            int status = connection.getResponseCode();
            InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            byte[] data = new byte[0];
            if (stream != null) {
                try (InputStream in = stream) {
                    data = SiteServer.read(in);
                }
            }
            String type = connection.getContentType();
            return new Result(status, type == null ? "application/json" : type, data);
        } catch (IOException e) {
            return offline();
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    static Result error(int status, String message) {
        try {
            return new Result(status, "application/json; charset=utf-8",
                    new JSONObject().put("error", message).toString().getBytes(StandardCharsets.UTF_8));
        } catch (JSONException e) {
            throw new IllegalStateException(e);
        }
    }

    private static Result offline() {
        return error(503, OFFLINE);
    }
}
