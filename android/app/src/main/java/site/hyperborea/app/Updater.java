package site.hyperborea.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.File;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Обновления. Приложение смотрит файл latest-android.json в последнем выпуске на GitHub
 * (github.com/Ewjpg/hyperborea-app/releases) и, если там версия новее, предлагает скачать и установить её.
 * Проверка — при запуске и потом раз в 2 часа, пока приложение открыто.
 */
final class Updater {
    private static final long INTERVAL = 2 * 60 * 60 * 1000L;
    private static final String APK = "application/vnd.android.package-archive";
    private static final Pattern APK_NAME = Pattern.compile("^HYPERBOREA-(\\d+\\.\\d+\\.\\d+)\\.apk$");

    private final Activity activity;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable check = this::checkNow;
    private boolean resumed;
    private boolean asked;
    private long lastCheck;
    private long download = -1;
    private Uri readyToInstall;
    private BroadcastReceiver receiver;

    Updater(Activity activity) {
        this.activity = activity;
        removeOldDownloads();
    }

    void onResume() {
        resumed = true;
        if (readyToInstall != null) {
            Uri file = readyToInstall;
            readyToInstall = null;
            install(file);
        }
        long wait = lastCheck == 0 ? 0 : Math.max(0, lastCheck + INTERVAL - SystemClock.elapsedRealtime());
        main.removeCallbacks(check);
        main.postDelayed(check, wait);
    }

    void onPause() {
        resumed = false;
        main.removeCallbacks(check);
    }

    void close() {
        main.removeCallbacks(check);
        if (receiver != null) {
            try {
                activity.unregisterReceiver(receiver);
            } catch (IllegalArgumentException ignored) {
            }
            receiver = null;
        }
    }

    private void checkNow() {
        lastCheck = SystemClock.elapsedRealtime();
        main.postDelayed(check, INTERVAL);
        if (asked) return;
        new Thread(() -> {
            try {
                JSONObject latest = new JSONObject(get(BuildConfig.UPDATE_FEED));
                String version = latest.getString("version");
                if (compare(version, BuildConfig.VERSION_NAME) <= 0) return;
                String url = latest.getString("url");
                main.post(() -> offer(version, url));
            } catch (Exception e) {
                // Без интернета проверка просто не удастся — приложение работает дальше как обычно.
                Log.i(MainActivity.TAG, "Проверка обновлений не удалась: " + e);
            }
        }, "updates").start();
    }

    private void offer(String version, String url) {
        if (asked || activity.isFinishing() || activity.isDestroyed()) return;
        asked = true;
        new AlertDialog.Builder(activity)
                .setTitle("HYPERBOREA")
                .setMessage("Доступна новая версия " + version + ".\nСкачать и установить её сейчас?")
                .setPositiveButton("Обновить", (dialog, which) -> download(version, url))
                .setNegativeButton("Позже", null)
                .show();
    }

    private void download(String version, String url) {
        String name = "HYPERBOREA-" + version + ".apk";
        try {
            File folder = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            if (folder == null) throw new IllegalStateException("Нет места для загрузки");
            File old = new File(folder, name);
            if (old.exists() && !old.delete()) Log.w(MainActivity.TAG, "Не удалось удалить " + old);
            DownloadManager downloads = activity.getSystemService(DownloadManager.class);
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url))
                    .setTitle("HYPERBOREA " + version)
                    .setDescription("Обновление приложения")
                    .setMimeType(APK)
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationInExternalFilesDir(activity, Environment.DIRECTORY_DOWNLOADS, name);
            listenForDownload();
            download = downloads.enqueue(request);
            Toast.makeText(activity, "Скачиваю обновление…", Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            Log.w(MainActivity.TAG, "Не удалось начать загрузку", e);
            openInBrowser(url);
        }
    }

    private void listenForDownload() {
        if (receiver != null) return;
        receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -2) == download) downloaded();
            }
        };
        IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        // Сообщение о готовой загрузке присылает системное приложение «Загрузки», поэтому EXPORTED.
        if (Build.VERSION.SDK_INT >= 33) activity.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED);
        else activity.registerReceiver(receiver, filter);
    }

    private void downloaded() {
        DownloadManager downloads = activity.getSystemService(DownloadManager.class);
        boolean ok = false;
        try (Cursor cursor = downloads.query(new DownloadManager.Query().setFilterById(download))) {
            ok = cursor != null && cursor.moveToFirst()
                    && cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)) == DownloadManager.STATUS_SUCCESSFUL;
        }
        Uri file = ok ? downloads.getUriForDownloadedFile(download) : null;
        if (file == null) {
            asked = false;
            Toast.makeText(activity, "Не удалось скачать обновление. Попробуйте позже.", Toast.LENGTH_LONG).show();
            return;
        }
        if (resumed) install(file);
        else readyToInstall = file; // покажем установку, когда приложение снова откроют
    }

    private void install(Uri file) {
        Intent intent = new Intent(Intent.ACTION_VIEW)
                .setDataAndType(file, APK)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            activity.startActivity(intent);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(activity, "Не удалось открыть установку обновления.", Toast.LENGTH_LONG).show();
        }
    }

    private void openInBrowser(String url) {
        try {
            activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (ActivityNotFoundException ignored) {
        }
    }

    /** Удаляет скачанные установщики версий, которые уже стоят. */
    private void removeOldDownloads() {
        File folder = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        File[] files = folder == null ? null : folder.listFiles();
        if (files == null) return;
        for (File file : files) {
            Matcher name = APK_NAME.matcher(file.getName());
            if (name.matches() && compare(name.group(1), BuildConfig.VERSION_NAME) <= 0 && !file.delete()) {
                Log.w(MainActivity.TAG, "Не удалось удалить " + file);
            }
        }
    }

    private static String get(String address) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        try {
            connection.setConnectTimeout(20000);
            connection.setReadTimeout(20000);
            connection.setUseCaches(false);
            if (connection.getResponseCode() != 200) throw new IllegalStateException("HTTP " + connection.getResponseCode());
            try (InputStream in = connection.getInputStream()) {
                return new String(SiteServer.read(in), StandardCharsets.UTF_8);
            }
        } finally {
            connection.disconnect();
        }
    }

    /** Сравнивает версии вида 1.2.3: больше нуля, если a новее b. */
    static int compare(String a, String b) {
        String[] left = a.split("\\.");
        String[] right = b.split("\\.");
        for (int i = 0; i < Math.max(left.length, right.length); i++) {
            int difference = Integer.compare(number(left, i), number(right, i));
            if (difference != 0) return difference;
        }
        return 0;
    }

    private static int number(String[] parts, int index) {
        try {
            return index < parts.length ? Integer.parseInt(parts[index].trim()) : 0;
        } catch (NumberFormatException e) {
            return 0;
        }
    }
}
