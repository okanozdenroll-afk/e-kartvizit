package com.kvk.kartvizit;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.ContactsContract;
import android.speech.RecognizerIntent;
import android.util.Base64;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.provider.MediaStore;
import android.content.ContentValues;
import java.io.ByteArrayOutputStream;
import java.util.HashMap;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;

/* Saha Defteri: WebView kabuğu. Sesli not (Google konuşma tanıma), rehberden kişi seçme, paylaşma. */
public class MainActivity extends Activity {
    private static final int REQ_FILE = 41, REQ_CONTACT = 42, REQ_SPEECH = 43, REQ_CAM = 44, REQ_GAL = 45;
    /* uygulama dosyaları bu sanal adresten sunulur (kartvizit okuma modülü için gerekli) */
    static final String HOST = "appassets.androidplatform.net";
    static final String HOME = "https://" + HOST + "/defter.html";
    private volatile String migrated = null;
    private WebView web;
    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        final FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFFFFFFFF);
        final View topBar = new View(this);
        topBar.setBackgroundColor(0xFF1D428F);
        root.addView(topBar, new FrameLayout.LayoutParams(-1, 0, android.view.Gravity.TOP));
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View v, WindowInsets in) {
                int l = in.getSystemWindowInsetLeft(), t = in.getSystemWindowInsetTop(), r = in.getSystemWindowInsetRight(), b = in.getSystemWindowInsetBottom();
                FrameLayout.LayoutParams wp = (FrameLayout.LayoutParams) web.getLayoutParams();
                wp.setMargins(l, t, r, b); web.setLayoutParams(wp);
                FrameLayout.LayoutParams tp = (FrameLayout.LayoutParams) topBar.getLayoutParams();
                tp.height = t; topBar.setLayoutParams(tp);
                return in.consumeSystemWindowInsets();
            }
        });
        setContentView(root);
        if (android.os.Build.VERSION.SDK_INT >= 26) getWindow().getDecorView().setSystemUiVisibility(0x00000010);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setTextZoom(100);
        web.addJavascriptInterface(new Bridge(), "Android");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) {
                return asset(req.getUrl());
            }
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, String url) {
                return asset(Uri.parse(url));
            }
            @Override
            public void onPageFinished(WebView v, String url) {
                if (url.startsWith("file:")) {
                    /* eski sürüm (file://) verisini yeni adrese taşı */
                    v.evaluateJavascript("(function(){try{return localStorage.getItem('kvk_defter_v1')||''}catch(e){return ''}})()", new ValueCallback<String>() {
                        @Override public void onReceiveValue(String val) {
                            String data = "";
                            try { if (val != null && !"null".equals(val)) data = new org.json.JSONArray("[" + val + "]").getString(0); } catch (Exception e) { }
                            SharedPreferences sp = getSharedPreferences("app", MODE_PRIVATE);
                            sp.edit().putString("migrated", data).putBoolean("migDone", true).apply();
                            web.loadUrl(HOME);
                        }
                    });
                }
            }
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, String url) {
                if (url.startsWith("file:") || url.startsWith("https://" + HOST + "/")) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); }
                catch (Exception e) { Toast.makeText(MainActivity.this, "Açılamadı", Toast.LENGTH_SHORT).show(); }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onCreateWindow(WebView v, boolean dialog, boolean user, android.os.Message msg) { return false; }
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                try { startActivityForResult(Intent.createChooser(i, "Yedek dosyasını seç"), REQ_FILE); }
                catch (Exception e) { fileCallback = null; return false; }
                return true;
            }
        });
        s.setSupportMultipleWindows(false);
        SharedPreferences sp = getSharedPreferences("app", MODE_PRIVATE);
        if (state != null) web.restoreState(state);
        else if (!sp.getBoolean("migDone", false)) web.loadUrl("file:///android_asset/migrate.html");
        else web.loadUrl(HOME);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }

    private void js(String code) { web.evaluateJavascript(code, null); }

    private WebResourceResponse asset(Uri u) {
        if (u == null || !HOST.equals(u.getHost())) return null;
        String path = u.getPath();
        if (path == null || path.equals("/")) path = "/defter.html";
        path = path.substring(1);
        if (path.contains("..")) return null;
        String mime = "application/octet-stream";
        if (path.endsWith(".html")) mime = "text/html";
        else if (path.endsWith(".js")) mime = "application/javascript";
        else if (path.endsWith(".css")) mime = "text/css";
        else if (path.endsWith(".png")) mime = "image/png";
        else if (path.endsWith(".jpg")) mime = "image/jpeg";
        else if (path.endsWith(".pdf")) mime = "application/pdf";
        else if (path.endsWith(".wasm")) mime = "application/wasm";
        else if (path.endsWith(".vcf")) mime = "text/x-vcard";
        HashMap<String, String> h = new HashMap<String, String>();
        h.put("Access-Control-Allow-Origin", "*");
        h.put("Cache-Control", "no-cache");
        try {
            return new WebResourceResponse(mime, mime.startsWith("text/") || mime.endsWith("javascript") ? "UTF-8" : null, 200, "OK", h, getAssets().open(path));
        } catch (Exception e) {
            return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", h, new java.io.ByteArrayInputStream(new byte[0]));
        }
    }

    private File camFile() { File d = new File(getCacheDir(), "cam"); d.mkdirs(); return new File(d, "kart.jpg"); }

    /* kartvizit fotoğrafını küçült, yönünü düzelt, sayfaya gönder */
    private void sendPhoto(final Uri src, final String p0) {
        new Thread(new Runnable() { public void run() {
            try {
                String path = p0;
                if (path == null) {  /* galeriden gelen: önce dosyaya kopyala (yön bilgisini okuyabilmek için) */
                    File g = new File(camFile().getParentFile(), "galeri.jpg");
                    InputStream gi = getContentResolver().openInputStream(src);
                    FileOutputStream go = new FileOutputStream(g);
                    byte[] buf = new byte[65536]; int n;
                    while ((n = gi.read(buf)) > 0) go.write(buf, 0, n);
                    gi.close(); go.close();
                    path = g.getAbsolutePath();
                }
                BitmapFactory.Options o = new BitmapFactory.Options(); o.inJustDecodeBounds = true;
                InputStream in = path != null ? new java.io.FileInputStream(path) : getContentResolver().openInputStream(src);
                BitmapFactory.decodeStream(in, null, o); in.close();
                int sample = 1; while (Math.max(o.outWidth, o.outHeight) / sample > 2600) sample *= 2;
                BitmapFactory.Options o2 = new BitmapFactory.Options(); o2.inSampleSize = sample;
                in = path != null ? new java.io.FileInputStream(path) : getContentResolver().openInputStream(src);
                Bitmap bm = BitmapFactory.decodeStream(in, null, o2); in.close();
                int rot = 0;
                try {
                    if (path != null) {
                        int or = new ExifInterface(path).getAttributeInt(ExifInterface.TAG_ORIENTATION, 1);
                        rot = or == 6 ? 90 : or == 3 ? 180 : or == 8 ? 270 : 0;
                    }
                } catch (Exception e) { }
                float k = Math.min(1f, 2000f / Math.max(bm.getWidth(), bm.getHeight()));
                Matrix m = new Matrix(); m.postScale(k, k); if (rot != 0) m.postRotate(rot);
                Bitmap out = Bitmap.createBitmap(bm, 0, 0, bm.getWidth(), bm.getHeight(), m, true);
                ByteArrayOutputStream bo = new ByteArrayOutputStream();
                out.compress(Bitmap.CompressFormat.JPEG, 88, bo);
                final String url = "data:image/jpeg;base64," + Base64.encodeToString(bo.toByteArray(), Base64.NO_WRAP);
                runOnUiThread(new Runnable() { public void run() { js("window.onCardPhoto && window.onCardPhoto(" + JSONObject.quote(url) + ")"); } });
            } catch (Throwable e) {
                runOnUiThread(new Runnable() { public void run() { js("window.onCardPhotoErr && window.onCardPhotoErr()"); } });
            }
        } }).start();
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        if (req == REQ_SPEECH) {
            String text = "";
            if (res == RESULT_OK && data != null) {
                ArrayList<String> r = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
                if (r != null && r.size() > 0) text = r.get(0);
            }
            if (text.length() > 0) js("window.onSpeech && window.onSpeech(" + JSONObject.quote(text) + ")");
            else js("window.onSpeechErr && window.onSpeechErr('Ses alınamadı, tekrar deneyin')");
            return;
        }
        if (req == REQ_CAM) {
            if (res == RESULT_OK && camFile().exists() && camFile().length() > 0) sendPhoto(null, camFile().getAbsolutePath());
            else js("window.onCardPhotoErr && window.onCardPhotoErr('cancel')");
            return;
        }
        if (req == REQ_GAL) {
            if (res == RESULT_OK && data != null && data.getData() != null) sendPhoto(data.getData(), null);
            else js("window.onCardPhotoErr && window.onCardPhotoErr('cancel')");
            return;
        }
        if (req == REQ_CONTACT) {
            if (res == RESULT_OK && data != null && data.getData() != null) readContact(data.getData());
            return;
        }
        if (req == REQ_FILE && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data));
            fileCallback = null;
            return;
        }
        super.onActivityResult(req, res, data);
    }

    private void readContact(Uri uri) {
        Cursor c = null;
        try {
            JSONObject o = new JSONObject();
            c = getContentResolver().query(uri, new String[]{
                ContactsContract.CommonDataKinds.Phone.NUMBER, ContactsContract.Contacts.DISPLAY_NAME, ContactsContract.CommonDataKinds.Phone.CONTACT_ID}, null, null, null);
            String id = null;
            if (c != null && c.moveToFirst()) { o.put("phone", c.getString(0)); o.put("name", c.getString(1)); id = c.getString(2); }
            if (c != null) c.close(); c = null;
            if (id != null) {
                try {
                    c = getContentResolver().query(ContactsContract.CommonDataKinds.Email.CONTENT_URI, new String[]{ContactsContract.CommonDataKinds.Email.ADDRESS},
                        ContactsContract.CommonDataKinds.Email.CONTACT_ID + "=?", new String[]{id}, null);
                    if (c != null && c.moveToFirst()) o.put("email", c.getString(0));
                    if (c != null) c.close(); c = null;
                    c = getContentResolver().query(ContactsContract.Data.CONTENT_URI, new String[]{ContactsContract.CommonDataKinds.Organization.COMPANY},
                        ContactsContract.Data.CONTACT_ID + "=? AND " + ContactsContract.Data.MIMETYPE + "=?",
                        new String[]{id, ContactsContract.CommonDataKinds.Organization.CONTENT_ITEM_TYPE}, null);
                    if (c != null && c.moveToFirst()) o.put("company", c.getString(0));
                } catch (Exception e) { /* e-posta/firma okunamazsa yalnız isim ve numara */ }
            }
            js("window.onContactPicked && window.onContactPicked(" + JSONObject.quote(o.toString()) + ")");
        } catch (Exception e) {
            Toast.makeText(this, "Kişi okunamadı", Toast.LENGTH_SHORT).show();
        } finally { if (c != null) c.close(); }
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("(window.onBackPressed && window.onBackPressed()) ? 1 : 0", new ValueCallback<String>() {
            @Override public void onReceiveValue(String v) { if (!"1".equals(v)) MainActivity.super.onBackPressed(); }
        });
    }

    private File shareDir() {
        File dir = new File(getCacheDir(), "share");
        dir.mkdirs();
        File[] old = dir.listFiles();
        if (old != null) for (File f : old) f.delete();
        return dir;
    }

    private void shareUri(String name, String mime) {
        Uri uri = Uri.parse("content://com.kvk.kartvizit.files/" + Uri.encode(name));
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType(mime);
        send.putExtra(Intent.EXTRA_STREAM, uri);
        send.putExtra(Intent.EXTRA_SUBJECT, name);
        send.setClipData(android.content.ClipData.newRawUri(name, uri));
        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivity(Intent.createChooser(send, "Gönder: " + name));
    }

    public class Bridge {
        @JavascriptInterface
        public String takeMigrated() {
            SharedPreferences sp = getSharedPreferences("app", MODE_PRIVATE);
            String s = sp.getString("migrated", "");
            sp.edit().remove("migrated").apply();
            return s;
        }

        @JavascriptInterface
        public void takeCardPhoto() {
            runOnUiThread(new Runnable() { public void run() {
                try {
                    File f = camFile(); if (f.exists()) f.delete();
                    Uri out = Uri.parse("content://com.kvk.kartvizit.files/cam/kart.jpg");
                    Intent i = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                    i.putExtra(MediaStore.EXTRA_OUTPUT, out);
                    i.setClipData(android.content.ClipData.newRawUri("kart", out));
                    i.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivityForResult(i, REQ_CAM);
                } catch (Exception e) { js("window.onCardPhotoErr && window.onCardPhotoErr('Kamera açılamadı')"); }
            } });
        }

        @JavascriptInterface
        public void pickCardImage() {
            runOnUiThread(new Runnable() { public void run() {
                Intent i = new Intent(Intent.ACTION_GET_CONTENT); i.setType("image/*"); i.addCategory(Intent.CATEGORY_OPENABLE);
                try { startActivityForResult(Intent.createChooser(i, "Kartvizit fotoğrafı seç"), REQ_GAL); }
                catch (Exception e) { js("window.onCardPhotoErr && window.onCardPhotoErr('Galeri açılamadı')"); }
            } });
        }

        /* telefon rehberine ekle: rehberin "yeni kişi" ekranı dolu açılır, Kaydet'e basmak yeter */
        @JavascriptInterface
        public void addToPhone(final String json) {
            runOnUiThread(new Runnable() { public void run() {
                try {
                    JSONObject o = new JSONObject(json);
                    Intent i = new Intent(ContactsContract.Intents.Insert.ACTION);
                    i.setType(ContactsContract.RawContacts.CONTENT_TYPE);
                    i.putExtra(ContactsContract.Intents.Insert.NAME, o.optString("name"));
                    if (o.optString("phone").length() > 0) {
                        i.putExtra(ContactsContract.Intents.Insert.PHONE, o.optString("phone"));
                        i.putExtra(ContactsContract.Intents.Insert.PHONE_TYPE, ContactsContract.CommonDataKinds.Phone.TYPE_MOBILE);
                    }
                    if (o.optString("phone2").length() > 0) {
                        i.putExtra(ContactsContract.Intents.Insert.SECONDARY_PHONE, o.optString("phone2"));
                        i.putExtra(ContactsContract.Intents.Insert.SECONDARY_PHONE_TYPE, ContactsContract.CommonDataKinds.Phone.TYPE_WORK);
                    }
                    if (o.optString("email").length() > 0) {
                        i.putExtra(ContactsContract.Intents.Insert.EMAIL, o.optString("email"));
                        i.putExtra(ContactsContract.Intents.Insert.EMAIL_TYPE, ContactsContract.CommonDataKinds.Email.TYPE_WORK);
                    }
                    if (o.optString("company").length() > 0) i.putExtra(ContactsContract.Intents.Insert.COMPANY, o.optString("company"));
                    if (o.optString("title").length() > 0) i.putExtra(ContactsContract.Intents.Insert.JOB_TITLE, o.optString("title"));
                    if (o.optString("address").length() > 0) i.putExtra(ContactsContract.Intents.Insert.POSTAL, o.optString("address"));
                    if (o.optString("note").length() > 0) i.putExtra(ContactsContract.Intents.Insert.NOTES, o.optString("note"));
                    if (o.optString("web").length() > 0) {
                        ArrayList<ContentValues> rows = new ArrayList<ContentValues>();
                        ContentValues w = new ContentValues();
                        w.put(ContactsContract.Data.MIMETYPE, ContactsContract.CommonDataKinds.Website.CONTENT_ITEM_TYPE);
                        w.put(ContactsContract.CommonDataKinds.Website.URL, o.optString("web"));
                        w.put(ContactsContract.CommonDataKinds.Website.TYPE, ContactsContract.CommonDataKinds.Website.TYPE_WORK);
                        rows.add(w);
                        i.putParcelableArrayListExtra(ContactsContract.Intents.Insert.DATA, rows);
                    }
                    i.putExtra("finishActivityOnSaveCompleted", true);
                    startActivity(i);
                } catch (Exception e) { Toast.makeText(MainActivity.this, "Rehber açılamadı", Toast.LENGTH_LONG).show(); }
            } });
        }

        @JavascriptInterface
        public void speech() {
            runOnUiThread(new Runnable() { public void run() {
                Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "tr-TR");
                i.putExtra(RecognizerIntent.EXTRA_PROMPT, "Ziyaret notunu söyleyin");
                try { startActivityForResult(i, REQ_SPEECH); }
                catch (Exception e) { js("window.onSpeechErr && window.onSpeechErr('Telefonda ses tanıma yok. Klavyedeki mikrofonu kullanın.')"); }
            } });
        }

        @JavascriptInterface
        public void pickContact() {
            runOnUiThread(new Runnable() { public void run() {
                try { startActivityForResult(new Intent(Intent.ACTION_PICK, ContactsContract.CommonDataKinds.Phone.CONTENT_URI), REQ_CONTACT); }
                catch (Exception e) { Toast.makeText(MainActivity.this, "Rehber açılamadı", Toast.LENGTH_SHORT).show(); }
            } });
        }

        @JavascriptInterface
        public void shareText(final String text) {
            runOnUiThread(new Runnable() { public void run() {
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType("text/plain");
                send.putExtra(Intent.EXTRA_TEXT, text);
                startActivity(Intent.createChooser(send, "Paylaş"));
            } });
        }

        @JavascriptInterface
        public void shareFile(final String name, final String mime, final String b64) {
            runOnUiThread(new Runnable() { public void run() {
                try {
                    FileOutputStream os = new FileOutputStream(new File(shareDir(), name));
                    os.write(Base64.decode(b64, Base64.DEFAULT));
                    os.close();
                    shareUri(name, mime);
                } catch (Exception e) { Toast.makeText(MainActivity.this, "Dosya oluşturulamadı", Toast.LENGTH_LONG).show(); }
            } });
        }

        /* birden çok sunumu tek seferde gönder (WhatsApp seçilince hepsi aynı kişiye gider) */
        @JavascriptInterface
        public void shareAssets(final String json, final String mime) {
            runOnUiThread(new Runnable() { public void run() {
                try {
                    org.json.JSONArray arr = new org.json.JSONArray(json);
                    File dir = shareDir();
                    ArrayList<Uri> uris = new ArrayList<Uri>();
                    android.content.ClipData clip = null;
                    for (int k = 0; k < arr.length(); k++) {
                        JSONObject o = arr.getJSONObject(k);
                        String name = o.getString("name");
                        InputStream in = getAssets().open(o.getString("asset"));
                        FileOutputStream os = new FileOutputStream(new File(dir, name));
                        byte[] b = new byte[65536]; int n;
                        while ((n = in.read(b)) > 0) os.write(b, 0, n);
                        in.close(); os.close();
                        Uri u = Uri.parse("content://com.kvk.kartvizit.files/" + Uri.encode(name));
                        uris.add(u);
                        if (clip == null) clip = android.content.ClipData.newRawUri(name, u); else clip.addItem(new android.content.ClipData.Item(u));
                    }
                    Intent send = new Intent(uris.size() > 1 ? Intent.ACTION_SEND_MULTIPLE : Intent.ACTION_SEND);
                    send.setType(mime);
                    if (uris.size() > 1) send.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
                    else send.putExtra(Intent.EXTRA_STREAM, uris.get(0));
                    send.setClipData(clip);
                    send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivity(Intent.createChooser(send, "Sunumları gönder"));
                } catch (Exception e) { Toast.makeText(MainActivity.this, "Sunumlar gönderilemedi", Toast.LENGTH_LONG).show(); }
            } });
        }

        @JavascriptInterface
        public void shareAsset(final String asset, final String name, final String mime) {
            runOnUiThread(new Runnable() { public void run() {
                try {
                    InputStream in = getAssets().open(asset);
                    FileOutputStream os = new FileOutputStream(new File(shareDir(), name));
                    byte[] b = new byte[16384]; int n;
                    while ((n = in.read(b)) > 0) os.write(b, 0, n);
                    in.close(); os.close();
                    shareUri(name, mime);
                } catch (Exception e) { Toast.makeText(MainActivity.this, "Dosya gönderilemedi", Toast.LENGTH_LONG).show(); }
            } });
        }
    }
}
