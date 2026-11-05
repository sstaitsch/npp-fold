package de.npp.mobil;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.Charset;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public class MainActivity extends Activity {
    private static final int REQ_OPEN = 1, REQ_SAVE_AS = 2;
    private static final int MAX_BYTES = 64 * 1024 * 1024;

    private WebView web;
    private FrameLayout root;
    private final Map<String, String> results = new ConcurrentHashMap<>();
    private int seq = 0;
    private boolean pageReady = false;
    private final List<Runnable> queue = new ArrayList<>();

    // Daten für einen laufenden "Speichern unter"-Vorgang
    private String saReq, saText, saEnc;
    private boolean saBom;

    private Updater updater;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#f0f0f0"));
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        setupInsets();
        updater = new Updater(this, this::runJs);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setTextZoom(100);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setAllowContentAccess(false);
        s.setAllowFileAccess(false);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.addJavascriptInterface(new Bridge(), "Android");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) { return true; }
        });
        web.loadUrl("file:///android_asset/index.html");

        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(0, this::handleBack);
        }
        handleIntent(getIntent());
    }

    // Randabstände für Statusleiste, Navigationsleiste, Kamera-Aussparung und Tastatur
    private void setupInsets() {
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            getWindow().setStatusBarColor(Color.TRANSPARENT);
            getWindow().setNavigationBarColor(Color.TRANSPARENT);
            root.setOnApplyWindowInsetsListener((v, insets) -> {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                Insets ime = insets.getInsets(WindowInsets.Type.ime());
                v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
                return WindowInsets.CONSUMED;
            });
        } else {
            getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        }
    }

    private void handleBack() {
        web.evaluateJavascript("window.nppBack ? nppBack() : false", v -> {
            if (!"true".equals(v)) moveTaskToBack(true);
        });
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() { handleBack(); }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (Updater.ACTION_STATUS.equals(intent.getAction())) { updater.onStatus(intent); return; }
        handleIntent(intent);
    }

    @Override
    protected void onResume() {
        super.onResume();
        updater.onResume();
    }

    @Override
    protected void onPause() {
        super.onPause();
        web.evaluateJavascript("window.nppSaveSession && nppSaveSession()", null);
    }

    // "Öffnen mit …" und "Teilen" von anderen Apps
    private void handleIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        Uri uri = null;
        if (Intent.ACTION_VIEW.equals(action) || Intent.ACTION_EDIT.equals(action)) {
            uri = intent.getData();
        } else if (Intent.ACTION_SEND.equals(action)) {
            uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (uri == null) {
                String text = intent.getStringExtra(Intent.EXTRA_TEXT);
                if (text != null) {
                    try {
                        JSONObject o = new JSONObject();
                        String subj = intent.getStringExtra(Intent.EXTRA_SUBJECT);
                        o.put("name", subj != null && subj.length() < 60 ? subj : "geteilt.txt");
                        o.put("uri", JSONObject.NULL);
                        o.put("text", text);
                        o.put("encoding", "UTF-8");
                        o.put("bom", false);
                        deliverOpened(o.toString());
                    } catch (Exception ignored) { }
                }
                return;
            }
        }
        if (uri == null) return;
        final Uri u = uri;
        takePermission(u, intent.getFlags());
        new Thread(() -> deliverOpened(readToJson(u))).start();
        setIntent(new Intent()); // nicht beim Neustart erneut öffnen
    }

    private void deliverOpened(String json) {
        String id = "o" + (++seq);
        results.put(id, json);
        runJs("nppNative.opened('" + id + "')");
    }

    private void runJs(String js) {
        runOnUiThread(() -> {
            if (pageReady) web.evaluateJavascript(js, null);
            else queue.add(() -> web.evaluateJavascript(js, null));
        });
    }

    private void takePermission(Uri uri, int flags) {
        if (!"content".equals(uri.getScheme())) return;
        ContentResolver cr = getContentResolver();
        try {
            cr.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (Exception e) {
            try { cr.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION); } catch (Exception ignored) { }
        }
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req == REQ_OPEN) {
            if (res != RESULT_OK || data == null) return;
            List<Uri> uris = new ArrayList<>();
            if (data.getClipData() != null) {
                for (int i = 0; i < data.getClipData().getItemCount(); i++) uris.add(data.getClipData().getItemAt(i).getUri());
            } else if (data.getData() != null) uris.add(data.getData());
            for (Uri u : uris) takePermission(u, data.getFlags());
            new Thread(() -> { for (Uri u : uris) deliverOpened(readToJson(u)); }).start();
        } else if (req == REQ_SAVE_AS) {
            final String reqId = saReq, text = saText, enc = saEnc;
            final boolean bom = saBom;
            saText = null;
            if (reqId == null) return;
            final Uri u = (res == RESULT_OK && data != null) ? data.getData() : null;
            if (u != null) takePermission(u, data.getFlags());
            new Thread(() -> {
                JSONObject o = new JSONObject();
                try {
                    if (u == null) o.put("cancelled", true);
                    else {
                        write(u, text, enc, bom);
                        o.put("uri", u.toString());
                        o.put("name", displayName(u));
                    }
                } catch (Exception e) {
                    try { o.put("error", "Speichern fehlgeschlagen: " + e.getMessage()); } catch (Exception ignored) { }
                }
                String id = "s" + (++seq);
                results.put(id, o.toString());
                runJs("nppNative.savedAs('" + reqId + "','" + id + "')");
            }).start();
        }
    }

    // ------------------------------------------------------------------ Lesen / Schreiben
    private String displayName(Uri uri) {
        String name = null;
        try (Cursor c = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) name = c.getString(0);
        } catch (Exception ignored) { }
        if (name == null) {
            name = uri.getLastPathSegment();
            if (name != null && name.contains("/")) name = name.substring(name.lastIndexOf('/') + 1);
        }
        return name == null ? "Datei" : name;
    }

    private String readToJson(Uri uri) {
        JSONObject o = new JSONObject();
        try {
            byte[] b;
            try (InputStream in = getContentResolver().openInputStream(uri)) {
                if (in == null) throw new Exception("Datei kann nicht gelesen werden");
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) {
                    bos.write(buf, 0, n);
                    if (bos.size() > MAX_BYTES) throw new Exception("Datei ist zu groß (max. 64 MB)");
                }
                b = bos.toByteArray();
            }
            String enc = "UTF-8", text;
            boolean bom = false;
            if (b.length >= 3 && (b[0] & 0xff) == 0xEF && (b[1] & 0xff) == 0xBB && (b[2] & 0xff) == 0xBF) {
                bom = true; text = new String(b, 3, b.length - 3, StandardCharsets.UTF_8);
            } else if (b.length >= 2 && (b[0] & 0xff) == 0xFF && (b[1] & 0xff) == 0xFE) {
                bom = true; enc = "UTF-16LE"; text = new String(b, 2, b.length - 2, StandardCharsets.UTF_16LE);
            } else if (b.length >= 2 && (b[0] & 0xff) == 0xFE && (b[1] & 0xff) == 0xFF) {
                bom = true; enc = "UTF-16BE"; text = new String(b, 2, b.length - 2, StandardCharsets.UTF_16BE);
            } else {
                try {
                    CharBuffer cb = StandardCharsets.UTF_8.newDecoder()
                            .onMalformedInput(CodingErrorAction.REPORT)
                            .onUnmappableCharacter(CodingErrorAction.REPORT)
                            .decode(ByteBuffer.wrap(b));
                    text = cb.toString();
                } catch (CharacterCodingException e) {
                    enc = "windows-1252"; // ANSI wie unter Windows/Notepad++
                    text = new String(b, Charset.forName("windows-1252"));
                }
            }
            o.put("name", displayName(uri));
            o.put("uri", uri.toString());
            o.put("text", text);
            o.put("encoding", enc);
            o.put("bom", bom);
        } catch (Exception e) {
            try { o.put("error", "Öffnen fehlgeschlagen: " + e.getMessage()); } catch (Exception ignored) { }
        }
        return o.toString();
    }

    private void write(Uri uri, String text, String enc, boolean bom) throws Exception {
        Charset cs = Charset.forName(enc);
        byte[] body = text.getBytes(cs);
        byte[] head = new byte[0];
        if (bom) {
            if (cs.equals(StandardCharsets.UTF_8)) head = new byte[]{(byte) 0xEF, (byte) 0xBB, (byte) 0xBF};
            else if (cs.equals(StandardCharsets.UTF_16LE)) head = new byte[]{(byte) 0xFF, (byte) 0xFE};
            else if (cs.equals(StandardCharsets.UTF_16BE)) head = new byte[]{(byte) 0xFE, (byte) 0xFF};
        }
        OutputStream out;
        try { out = getContentResolver().openOutputStream(uri, "wt"); }
        catch (Exception e) { out = getContentResolver().openOutputStream(uri, "w"); }
        if (out == null) throw new Exception("Datei kann nicht geschrieben werden");
        try (OutputStream o = out) {
            o.write(head);
            o.write(body);
            o.flush();
        }
    }

    private static String mimeFor(String name) {
        String ext = name.contains(".") ? name.substring(name.lastIndexOf('.') + 1).toLowerCase() : "";
        if (ext.equals("txt")) return "text/plain";
        String m = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
        // Unbekannte Endungen (z.B. .JBI) nicht als text/plain anlegen, sonst hängt Android ".txt" an
        return m != null ? m : "application/octet-stream";
    }

    // ------------------------------------------------------------------ Brücke zu JavaScript
    private class Bridge {
        @JavascriptInterface
        public void ready() {
            runOnUiThread(() -> {
                pageReady = true;
                for (Runnable r : queue) r.run();
                queue.clear();
            });
        }

        @JavascriptInterface
        public void openFile() {
            runOnUiThread(() -> {
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                        | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                startActivityForResult(i, REQ_OPEN);
            });
        }

        @JavascriptInterface
        public String take(String id) {
            String r = results.remove(id);
            return r != null ? r : "{\"error\":\"Interner Fehler\"}";
        }

        @JavascriptInterface
        public String save(String uri, String text, String enc, boolean bom) {
            try {
                write(Uri.parse(uri), text, enc, bom);
                return "";
            } catch (Exception e) {
                return "Speichern nicht möglich (" + e.getMessage() + ") – bitte neuen Speicherort wählen";
            }
        }

        @JavascriptInterface
        public void saveAs(String req, String name, String text, String enc, boolean bom) {
            saReq = req; saText = text; saEnc = enc; saBom = bom;
            runOnUiThread(() -> {
                Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType(mimeFor(name));
                i.putExtra(Intent.EXTRA_TITLE, name);
                startActivityForResult(i, REQ_SAVE_AS);
            });
        }

        @JavascriptInterface
        public void setTheme(boolean dark, String color) {
            runOnUiThread(() -> {
                try { root.setBackgroundColor(Color.parseColor(color)); } catch (Exception ignored) { }
                if (Build.VERSION.SDK_INT >= 30) {
                    WindowInsetsController c = getWindow().getInsetsController();
                    if (c != null) {
                        int light = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                        c.setSystemBarsAppearance(dark ? 0 : light, light);
                    }
                } else {
                    getWindow().setStatusBarColor(Color.parseColor(color));
                    getWindow().setNavigationBarColor(Color.parseColor(color));
                    View d = getWindow().getDecorView();
                    int f = d.getSystemUiVisibility();
                    f = dark ? (f & ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR) : (f | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
                    d.setSystemUiVisibility(f);
                }
            });
        }

        @JavascriptInterface
        public String appInfo() {
            try {
                return new JSONObject().put("versionName", updater.versionName())
                        .put("versionCode", updater.versionCode())
                        .put("updates", !Config.UPDATE_URL.isEmpty()).toString();
            } catch (Exception e) { return "{}"; }
        }

        @JavascriptInterface
        public void checkUpdate() {
            new Thread(() -> {
                String id = "u" + (++seq);
                results.put(id, updater.check());
                runJs("nppNative.updChecked('" + id + "')");
            }).start();
        }

        @JavascriptInterface
        public void installUpdate() {
            new Thread(updater::downloadAndInstall).start();
        }

        @JavascriptInterface
        public void toast(String msg) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show());
        }
    }
}
