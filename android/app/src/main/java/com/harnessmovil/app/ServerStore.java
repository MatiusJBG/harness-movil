package com.harnessmovil.app;

import android.content.Context;
import android.content.SharedPreferences;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

/**
 * Persistencia mínima del envoltorio: URL del puente y huella del certificado
 * aceptada (trust-on-first-use). Sin secretos de Harness: el emparejamiento y
 * la cookie de dispositivo viven en el WebView.
 */
public final class ServerStore {

    private static final String PREFS = "harness_movil";
    private static final String KEY_BASE = "base_url";
    private static final String KEY_FINGERPRINT = "cert_fingerprint";
    private static final String KEY_FINGERPRINT_HOST = "cert_fingerprint_host";

    private final SharedPreferences preferences;

    public ServerStore(Context context) {
        this.preferences = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public String baseUrl() {
        return preferences.getString(KEY_BASE, null);
    }

    public void setBaseUrl(String baseUrl) {
        preferences.edit().putString(KEY_BASE, baseUrl).apply();
    }

    public void clearBaseUrl() {
        preferences.edit().remove(KEY_BASE).apply();
    }

    public String fingerprint() {
        return preferences.getString(KEY_FINGERPRINT, null);
    }

    public String fingerprintHost() {
        return preferences.getString(KEY_FINGERPRINT_HOST, null);
    }

    public void saveFingerprint(String hostKey, String fingerprint) {
        preferences.edit()
                .putString(KEY_FINGERPRINT, fingerprint)
                .putString(KEY_FINGERPRINT_HOST, hostKey)
                .apply();
    }

    public void clearFingerprint() {
        preferences.edit().remove(KEY_FINGERPRINT).remove(KEY_FINGERPRINT_HOST).apply();
    }

    /** Normaliza a un origen https://host[:puerto] sin ruta, query ni fragmento. */
    public static String normalizeBase(String input) throws IllegalArgumentException {
        String value = input == null ? "" : input.trim();
        if (value.isEmpty()) throw new IllegalArgumentException("empty");
        if (!value.contains("://")) value = "https://" + value;

        URI uri;
        try {
            uri = new URI(value);
        } catch (URISyntaxException error) {
            throw new IllegalArgumentException("invalid");
        }
        if (uri.getScheme() == null || !"https".equalsIgnoreCase(uri.getScheme())) {
            throw new IllegalArgumentException("scheme");
        }
        if (uri.getUserInfo() != null) throw new IllegalArgumentException("userinfo");
        String host = uri.getHost();
        if (host == null || host.isEmpty()) throw new IllegalArgumentException("host");

        int port = uri.getPort();
        if (port == -1) port = 443;
        if (port < 1 || port > 65535) throw new IllegalArgumentException("port");

        String hostPart = host;
        if (hostPart.startsWith("[") && hostPart.endsWith("]")) {
            hostPart = hostPart.substring(1, hostPart.length() - 1);
        }
        if (hostPart.contains(":")) hostPart = "[" + hostPart + "]";
        hostPart = hostPart.toLowerCase(Locale.ROOT);

        return "https://" + hostPart + (port == 443 ? "" : ":" + port);
    }

    public static String hostKey(String baseUrl) {
        try {
            URI uri = new URI(baseUrl);
            String host = uri.getHost();
            if (host == null) return "";
            int port = uri.getPort() == -1 ? 443 : uri.getPort();
            return (host + ":" + port).toLowerCase(Locale.ROOT);
        } catch (URISyntaxException error) {
            return "";
        }
    }

    public static String hostKeyFromUrl(String url) {
        try {
            return hostKey(new URI(url).getScheme() + "://" + new URI(url).getRawAuthority());
        } catch (Exception error) {
            return "";
        }
    }

    /** Resultado de leer un QR del puente. */
    public static final class PairInfo {
        public final String baseUrl;
        public final String initialUrl;

        PairInfo(String baseUrl, String initialUrl) {
            this.baseUrl = baseUrl;
            this.initialUrl = initialUrl;
        }
    }

    /**
     * Acepta el QR del puente (https://ip:8443/_hm/#p=secreto) o una URL base.
     * Devuelve null cuando no es una URL https válida.
     */
    public static PairInfo parseBridgeQr(String raw) {
        if (raw == null) return null;
        String value = raw.trim();
        if (value.isEmpty()) return null;
        try {
            URI uri = new URI(value);
            if (uri.getScheme() == null || !"https".equalsIgnoreCase(uri.getScheme())) return null;
            if (uri.getHost() == null) return null;
            String base = normalizeBase(value);
            String initial = value.contains("/_hm/") ? value : base + "/";
            return new PairInfo(base, initial);
        } catch (Exception error) {
            return null;
        }
    }

    /** Acepta harnessmovil://open?base=https://ip:8443 o ?url=https://ip:8443/_hm/#p=... */
    public static PairInfo parseDeepLink(String raw) {
        if (raw == null) return null;
        try {
            URI uri = new URI(raw);
            if (!"harnessmovil".equalsIgnoreCase(uri.getScheme())) return null;
            String query = uri.getRawQuery();
            if (query == null) return null;
            String base = null;
            String url = null;
            for (String part : query.split("&")) {
                int separator = part.indexOf('=');
                if (separator <= 0) continue;
                String key = part.substring(0, separator);
                String value = java.net.URLDecoder.decode(part.substring(separator + 1), "UTF-8");
                if ("base".equals(key)) base = value;
                if ("url".equals(key)) url = value;
            }
            if (url != null) return parseBridgeQr(url);
            if (base != null) return parseBridgeQr(base);
        } catch (Exception ignored) {
            // cae a null
        }
        return null;
    }
}
