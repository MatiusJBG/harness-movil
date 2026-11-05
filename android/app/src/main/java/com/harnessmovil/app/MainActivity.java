package com.harnessmovil.app;

import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;
import android.os.Environment;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ProgressBar;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.google.android.material.appbar.MaterialToolbar;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;

import java.util.ArrayList;
import java.util.List;

/**
 * Envoltorio Android de la UI web oficial de DeepSeek Harness.
 * No reimplementa el chat: solo presenta el puente con una ventana nativa,
 * pinning del certificado, subida de archivos, descargas y atrás del sistema.
 */
public class MainActivity extends AppCompatActivity {

    public static final String EXTRA_INITIAL_URL = "com.harnessmovil.app.INITIAL_URL";

    private ServerStore store;
    private MaterialToolbar toolbar;
    private WebView webView;
    private ProgressBar progress;
    private SslTrust sslTrust;

    private ValueCallback<Uri[]> pendingFileCallback;
    private ActivityResultLauncher<String[]> fileChooser;
    private ActivityResultLauncher<Intent> settingsLauncher;

    private String loadedBase;
    private boolean offlineDialogShowing;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        store = new ServerStore(this);
        sslTrust = new SslTrust(this, store);

        String initialUrl = getIntent().getStringExtra(EXTRA_INITIAL_URL);
        PairTarget deepLink = PairTarget.parseDeepLink(
                getIntent().getData() == null ? null : getIntent().getData().toString());
        if (deepLink != null) {
            store.setBaseUrl(deepLink.baseUrl());
            initialUrl = deepLink.initialUrl();
        }

        if (store.baseUrl() == null && initialUrl == null) {
            startActivity(new Intent(this, SetupActivity.class));
            finish();
            return;
        }

        setContentView(R.layout.activity_main);
        View root = findViewById(R.id.root);
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
            return insets;
        });
        toolbar = findViewById(R.id.toolbar);
        progress = findViewById(R.id.progress);
        webView = findViewById(R.id.webview);

        toolbar.setOnMenuItemClickListener(item -> {
            int id = item.getItemId();
            if (id == R.id.action_reload) {
                webView.reload();
                return true;
            }
            if (id == R.id.action_settings) {
                settingsLauncher.launch(new Intent(this, SetupActivity.class));
                return true;
            }
            if (id == R.id.action_browser) {
                openExternal(Uri.parse(currentUrl()));
                return true;
            }
            if (id == R.id.action_forget) {
                store.clearFingerprint();
                Toast.makeText(this, R.string.fingerprint_forgotten, Toast.LENGTH_LONG).show();
                webView.clearCache(false);
                reloadRoot();
                return true;
            }
            if (id == R.id.action_about) {
                showAbout();
                return true;
            }
            return false;
        });

        configureWebView();

        fileChooser = registerForActivityResult(new ActivityResultContracts.OpenMultipleDocuments(), uris -> {
            if (pendingFileCallback == null) return;
            Uri[] result = uris == null || uris.isEmpty() ? null : uris.toArray(new Uri[0]);
            pendingFileCallback.onReceiveValue(result);
            pendingFileCallback = null;
        });

        settingsLauncher = registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
            if (result.getResultCode() == RESULT_OK) reloadRoot();
        });

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView != null && webView.canGoBack()) {
                    webView.goBack();
                    return;
                }
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
            }
        });

        loadInitial(initialUrl);
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setUserAgentString(settings.getUserAgentString() + " HarnessMovil/" + BuildConfig.VERSION_NAME);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, false);

        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String baseHost = Uri.parse(store.baseUrl()).getHost();
                if (baseHost != null && baseHost.equalsIgnoreCase(uri.getHost())
                        && "https".equalsIgnoreCase(uri.getScheme())) {
                    return false;
                }
                openExternal(uri);
                return true;
            }

            @Override
            public void onReceivedSslError(WebView view, android.webkit.SslErrorHandler handler, SslError error) {
                sslTrust.handle(handler, error);
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                progress.setVisibility(View.VISIBLE);
                progress.setProgress(0);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                progress.setVisibility(View.GONE);
                toolbar.setSubtitle(Uri.parse(url).getHost());
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    showOffline(request.getUrl().toString());
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progress.setVisibility(newProgress >= 100 ? View.GONE : View.VISIBLE);
                progress.setProgress(newProgress);
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pendingFileCallback != null) {
                    pendingFileCallback.onReceiveValue(null);
                    pendingFileCallback = null;
                }
                pendingFileCallback = callback;
                fileChooser.launch(resolveMimeTypes(params));
                return true;
            }
        });

        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            try {
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                String cookie = CookieManager.getInstance().getCookie(url);
                if (cookie != null) request.addRequestHeader("Cookie", cookie);
                request.setMimeType(mimeType);
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalPublicDir(
                        Environment.DIRECTORY_DOWNLOADS,
                        URLUtil.guessFileName(url, contentDisposition, mimeType));
                DownloadManager manager = getSystemService(DownloadManager.class);
                manager.enqueue(request);
            } catch (Exception error) {
                Toast.makeText(this, R.string.download_failed, Toast.LENGTH_LONG).show();
            }
        });
    }

    private static String[] resolveMimeTypes(WebChromeClient.FileChooserParams params) {
        List<String> types = new ArrayList<>();
        String[] accepted = params.getAcceptTypes();
        if (accepted != null) {
            for (String type : accepted) {
                if (type != null && type.contains("/") && !type.startsWith(".")) {
                    types.add(type);
                }
            }
        }
        if (types.isEmpty()) types.add("*/*");
        return types.toArray(new String[0]);
    }

    private void loadInitial(String initialUrl) {
        loadedBase = store.baseUrl();
        String target = initialUrl == null ? store.baseUrl() + "/" : initialUrl;
        webView.loadUrl(target);
    }

    private void reloadRoot() {
        if (store.baseUrl() == null) {
            startActivity(new Intent(this, SetupActivity.class));
            return;
        }
        loadedBase = store.baseUrl();
        webView.loadUrl(store.baseUrl() + "/");
    }

    private String currentUrl() {
        String url = webView.getUrl();
        return url == null ? store.baseUrl() + "/" : url;
    }

    private void openExternal(Uri uri) {
        if (uri == null) return;
        String scheme = uri.getScheme();
        if (scheme != null && !"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme)
                && !"mailto".equalsIgnoreCase(scheme) && !"tel".equalsIgnoreCase(scheme)) {
            return;
        }
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException error) {
            Toast.makeText(this, R.string.no_app_for_link, Toast.LENGTH_SHORT).show();
        }
    }

    private void showOffline(String failedUrl) {
        if (offlineDialogShowing) return;
        offlineDialogShowing = true;
        new MaterialAlertDialogBuilder(this)
                .setTitle(R.string.offline_title)
                .setMessage(getString(R.string.offline_message, failedUrl))
                .setCancelable(false)
                .setPositiveButton(R.string.offline_retry, (dialog, which) -> {
                    offlineDialogShowing = false;
                    reloadRoot();
                })
                .setNegativeButton(R.string.offline_settings, (dialog, which) -> {
                    offlineDialogShowing = false;
                    settingsLauncher.launch(new Intent(this, SetupActivity.class));
                })
                .show();
    }

    private void showAbout() {
        new MaterialAlertDialogBuilder(this)
                .setTitle(R.string.menu_about_title)
                .setMessage(getString(R.string.menu_about_message, BuildConfig.VERSION_NAME))
                .setPositiveButton(R.string.about_close, null)
                .show();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        PairTarget deepLink = PairTarget.parseDeepLink(
                intent.getData() == null ? null : intent.getData().toString());
        if (deepLink != null) {
            store.setBaseUrl(deepLink.baseUrl());
            loadedBase = deepLink.baseUrl();
            webView.loadUrl(deepLink.initialUrl());
            return;
        }
        String initial = intent.getStringExtra(EXTRA_INITIAL_URL);
        if (initial != null) {
            loadedBase = store.baseUrl();
            webView.loadUrl(initial);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
        if (webView != null && loadedBase != null && store.baseUrl() != null
                && !loadedBase.equals(store.baseUrl())) {
            reloadRoot();
        }
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
