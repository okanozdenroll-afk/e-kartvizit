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
    private static final int REQ_FILE = 41, REQ_CONTACT = 42, REQ_SPEECH = 43;
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
            public boolean shouldOverrideUrlLoading(WebView v, String url) {
                if (url.startsWith("file:")) return false;
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
        if (state != null) web.restoreState(state);
        else web.loadUrl("file:///android_asset/defter.html");
    }

    @Override
    protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }

    private void js(String code) { web.evaluateJavascript(code, null); }

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
