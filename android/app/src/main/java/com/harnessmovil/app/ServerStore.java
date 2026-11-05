package com.harnessmovil.app;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Persistencia mínima del envoltorio: URL del puente y huella del certificado
 * aceptada (trust-on-first-use). Sin secretos de Harness: el emparejamiento y
 * la cookie de dispositivo viven en el WebView.
 *
 * <p>Solo persistencia (SRP): la normalización de la URL vive en
 * {@link ConnectionUrl}, la huella en {@link CertificatePin} y los parsers de
 * QR/deep link en {@link PairTarget}.</p>
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
}
