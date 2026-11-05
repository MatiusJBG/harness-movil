package com.harnessmovil.app;

import android.app.Activity;
import android.net.http.SslError;
import android.webkit.SslErrorHandler;

import com.google.android.material.dialog.MaterialAlertDialogBuilder;

import java.security.MessageDigest;
import java.security.cert.X509Certificate;
import java.util.Locale;

/** Trust-on-first-use para el certificado autofirmado del puente. */
public final class SslTrust {

    private final Activity activity;
    private final ServerStore store;
    private boolean dialogShowing = false;

    public SslTrust(Activity activity, ServerStore store) {
        this.activity = activity;
        this.store = store;
    }

    public void handle(SslErrorHandler handler, SslError error) {
        String hostKey = ServerStore.hostKeyFromUrl(error.getUrl());
        String expected = ServerStore.hostKey(store.baseUrl() == null ? "" : store.baseUrl());
        if (hostKey.isEmpty() || expected.isEmpty() || !hostKey.equals(expected)) {
            handler.cancel();
            return;
        }

        String fingerprint = fingerprintOf(error);
        if (fingerprint == null) {
            handler.cancel();
            return;
        }

        String stored = store.fingerprint();
        boolean sameHost = hostKey.equals(store.fingerprintHost());
        if (stored != null && sameHost && stored.equalsIgnoreCase(fingerprint)) {
            handler.proceed();
            return;
        }
        if (dialogShowing) {
            handler.cancel();
            return;
        }

        dialogShowing = true;
        boolean changed = stored != null && sameHost && !stored.equalsIgnoreCase(fingerprint);
        String message = changed
                ? activity.getString(R.string.cert_changed) + "\n\n" + activity.getString(
                        R.string.cert_message, hostKey, format(fingerprint))
                : activity.getString(R.string.cert_message, hostKey, format(fingerprint));

        new MaterialAlertDialogBuilder(activity)
                .setTitle(R.string.cert_title)
                .setMessage(message)
                .setCancelable(false)
                .setPositiveButton(R.string.cert_trust, (dialog, which) -> {
                    dialogShowing = false;
                    store.saveFingerprint(hostKey, fingerprint);
                    handler.proceed();
                })
                .setNegativeButton(R.string.cert_reject, (dialog, which) -> {
                    dialogShowing = false;
                    handler.cancel();
                })
                .show();
    }

    private static String fingerprintOf(SslError error) {
        try {
            X509Certificate certificate = error.getCertificate().getX509Certificate();
            if (certificate == null) return null;
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(certificate.getEncoded());
            StringBuilder builder = new StringBuilder(bytes.length * 3);
            for (int index = 0; index < bytes.length; index++) {
                if (index > 0) builder.append(':');
                builder.append(String.format(Locale.ROOT, "%02X", bytes[index]));
            }
            return builder.toString();
        } catch (Exception error2) {
            return null;
        }
    }

    private static String format(String fingerprint) {
        return fingerprint;
    }
}
