package de.npp.mobil;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Arrays;

/**
 * Selbst-Update ohne Play Store:
 * liest version.json vom Update-Server (GitHub-Release), lädt die APK,
 * prüft Paketname, Versionsnummer und Signatur und installiert über den PackageInstaller.
 */
class Updater {
    static final String ACTION_STATUS = "de.npp.mobil.INSTALL_STATUS";

    interface Callback { void js(String code); }

    private final Activity act;
    private final Callback cb;
    private File pendingApk;   // wartet auf Erlaubnis "Unbekannte Apps installieren"

    Updater(Activity act, Callback cb) { this.act = act; this.cb = cb; }

    int versionCode() {
        try {
            PackageInfo pi = act.getPackageManager().getPackageInfo(act.getPackageName(), 0);
            return Build.VERSION.SDK_INT >= 28 ? (int) pi.getLongVersionCode() : pi.versionCode;
        } catch (Exception e) { return 0; }
    }

    String versionName() {
        try { return act.getPackageManager().getPackageInfo(act.getPackageName(), 0).versionName; }
        catch (Exception e) { return "?"; }
    }

    private static String fetch(String url) throws Exception {
        HttpURLConnection c = open(url);
        try (InputStream in = c.getInputStream()) {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            return bos.toString("UTF-8");
        } finally { c.disconnect(); }
    }

    private static HttpURLConnection open(String url) throws Exception {
        // GitHub leitet auf einen Download-Server um; Umleitungen von Hand folgen (nur https)
        for (int i = 0; i < 6; i++) {
            if (!url.startsWith("https://")) throw new Exception("Unsichere Update-Adresse");
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            c.setRequestProperty("User-Agent", "NppFold-Updater");
            c.setRequestProperty("Cache-Control", "no-cache");
            int code = c.getResponseCode();
            if (code >= 300 && code < 400) {
                String loc = c.getHeaderField("Location");
                c.disconnect();
                if (loc == null) throw new Exception("Umleitung ohne Ziel");
                url = new URL(new URL(url), loc).toString();
                continue;
            }
            if (code == 404) { c.disconnect(); throw new Exception("Noch kein Update veröffentlicht"); }
            if (code != 200) { c.disconnect(); throw new Exception("Server antwortet mit " + code); }
            return c;
        }
        throw new Exception("Zu viele Umleitungen");
    }

    /** Ergebnis als JSON: {available, current, versionCode, versionName, notes} oder {error} */
    String check() {
        JSONObject o = new JSONObject();
        try {
            o.put("current", versionName());
            if (Config.UPDATE_URL.isEmpty()) throw new Exception("Keine Update-Adresse eingerichtet");
            JSONObject v = new JSONObject(fetch(Config.UPDATE_URL + "version.json"));
            int remote = v.getInt("versionCode");
            o.put("available", remote > versionCode());
            o.put("versionCode", remote);
            o.put("versionName", v.optString("versionName", String.valueOf(remote)));
            o.put("notes", v.optString("notes", ""));
        } catch (Exception e) {
            try { o.put("error", e.getMessage()); } catch (Exception ignored) { }
        }
        return o.toString();
    }

    /** Lädt und installiert das Update (im Hintergrund-Thread aufrufen). */
    void downloadAndInstall() {
        try {
            JSONObject v = new JSONObject(fetch(Config.UPDATE_URL + "version.json"));
            String apkName = v.optString("apk", "NppFold.apk");
            File dir = new File(act.getCacheDir(), "update");
            dir.mkdirs();
            for (File f : dir.listFiles()) f.delete();
            File apk = new File(dir, "update.apk");

            HttpURLConnection c = open(Config.UPDATE_URL + apkName);
            long total = c.getContentLengthLong();
            try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(apk)) {
                byte[] buf = new byte[65536];
                long done = 0;
                int n, last = -1;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    done += n;
                    int pct = total > 0 ? (int) (done * 100 / total) : -1;
                    if (pct != last) { last = pct; cb.js("nppNative.updProgress(" + pct + ")"); }
                }
            } finally { c.disconnect(); }

            verify(apk);
            cb.js("nppNative.updProgress(100)");
            act.runOnUiThread(() -> install(apk));
        } catch (Exception e) {
            fail(e.getMessage());
        }
    }

    // Nur Updates akzeptieren, die zu dieser App gehören, neuer sind und denselben Schlüssel haben
    @SuppressWarnings("deprecation")
    private void verify(File apk) throws Exception {
        PackageManager pm = act.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo neu = pm.getPackageArchiveInfo(apk.getPath(), flags);
        PackageInfo alt = pm.getPackageInfo(act.getPackageName(), flags);
        if (neu == null) throw new Exception("Heruntergeladene Datei ist keine gültige App");
        if (!act.getPackageName().equals(neu.packageName)) throw new Exception("Update gehört zu einer anderen App");
        long nv = Build.VERSION.SDK_INT >= 28 ? neu.getLongVersionCode() : neu.versionCode;
        if (nv <= versionCode()) throw new Exception("Update ist nicht neuer als die installierte Version");
        Signature[] a = sigs(alt), b = sigs(neu);
        if (a == null || b == null || !Arrays.equals(a, b)) throw new Exception("Signatur des Updates passt nicht – Installation abgebrochen");
    }

    @SuppressWarnings("deprecation")
    private static Signature[] sigs(PackageInfo pi) {
        if (Build.VERSION.SDK_INT >= 28) {
            if (pi.signingInfo == null) return null;
            return pi.signingInfo.getApkContentsSigners();
        }
        return pi.signatures;
    }

    void install(File apk) {
        if (Build.VERSION.SDK_INT >= 26 && !act.getPackageManager().canRequestPackageInstalls()) {
            pendingApk = apk;
            cb.js("nppNative.updMessage('Bitte „Apps aus dieser Quelle zulassen“ einschalten und dann zurückkehren')");
            Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + act.getPackageName()));
            act.startActivity(i);
            return;
        }
        try {
            cb.js("window.nppSaveSession && nppSaveSession()");
            PackageInstaller pi = act.getPackageManager().getPackageInstaller();
            PackageInstaller.SessionParams p = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            p.setAppPackageName(act.getPackageName());
            if (Build.VERSION.SDK_INT >= 31) p.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
            int id = pi.createSession(p);
            try (PackageInstaller.Session s = pi.openSession(id)) {
                try (InputStream in = new FileInputStream(apk); OutputStream out = s.openWrite("base.apk", 0, apk.length())) {
                    byte[] buf = new byte[65536];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                    s.fsync(out);
                }
                Intent status = new Intent(act, MainActivity.class).setAction(ACTION_STATUS);
                int fl = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
                PendingIntent pend = PendingIntent.getActivity(act, 77, status, fl);
                s.commit(pend.getIntentSender());
            }
        } catch (Exception e) {
            fail(e.getMessage());
        }
    }

    /** Nach Rückkehr aus den Einstellungen erneut versuchen. */
    void onResume() {
        if (pendingApk != null && Build.VERSION.SDK_INT >= 26 && act.getPackageManager().canRequestPackageInstalls()) {
            File f = pendingApk;
            pendingApk = null;
            install(f);
        }
    }

    /** Rückmeldung des PackageInstallers */
    @SuppressWarnings("deprecation")
    void onStatus(Intent intent) {
        int st = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (st == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirm != null) { confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); act.startActivity(confirm); }
        } else if (st != PackageInstaller.STATUS_SUCCESS) {
            String msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
            fail(st == PackageInstaller.STATUS_FAILURE_ABORTED ? "Update abgebrochen" : "Installation fehlgeschlagen" + (msg != null ? ": " + msg : ""));
        }
        // Bei Erfolg beendet Android die App; beim nächsten Öffnen läuft die neue Version
    }

    private void fail(String msg) {
        cb.js("nppNative.updFailed(" + JSONObject.quote(msg == null ? "Unbekannter Fehler" : msg) + ")");
    }
}
