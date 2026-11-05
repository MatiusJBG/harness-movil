package com.harnessmovil.app;

import android.app.Activity;
import android.net.http.SslError;
import android.webkit.SslErrorHandler;

import com.google.android.material.dialog.MaterialAlertDialogBuilder;

import java.security.cert.X509Certificate;

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
        String hostKey = ConnectionUrl.hostKeyFromUrl(error.getUrl());
        String expected = ConnectionUrl.hostKeyOf(store.baseUrl());
        if (hostKey.isEmpty() || expected.isEmpty() || !hostKey.equals(expected)) {
            handler.cancel();
            return;
        }

        CertificatePin pin = CertificatePin.fromCertificate(certificateOf(error));
        if (pin == null) {
            handler.cancel();
            return;
        }

        String stored = store.fingerprint();
        boolean sameHost = hostKey.equals(store.fingerprintHost());
        CertificatePin storedPin = CertificatePin.parse(stored);
        if (storedPin != null && sameHost && storedPin.matches(pin)) {
            handler.proceed();
            return;
        }
        if (dialogShowing) {
            handler.cancel();
            return;
        }

        dialogShowing = true;
        boolean changed = sameHost && CertificatePin.changed(stored, pin);
        String message = changed
                ? activity.getString(R.string.cert_changed) + "\n\n" + activity.getString(
                        R.string.cert_message, hostKey, pin.formatted())
                : activity.getString(R.string.cert_message, hostKey, pin.formatted());

        new MaterialAlertDialogBuilder(activity)
                .setTitle(R.string.cert_title)
                .setMessage(message)
                .setCancelable(false)
                .setPositiveButton(R.string.cert_trust, (dialog, which) -> {
                    dialogShowing = false;
                    store.saveFingerprint(hostKey, pin.formatted());
                    handler.proceed();
                })
                .setNegativeButton(R.string.cert_reject, (dialog, which) -> {
                    dialogShowing = false;
                    handler.cancel();
                })
                .show();
    }

    private static X509Certificate certificateOf(SslError error) {
        try {
            if (error.getCertificate() == null) return null;
            return error.getCertificate().getX509Certificate();
        } catch (Exception error2) {
            return null;
        }
    }
}
