package com.harnessmovil.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.result.ActivityResultLauncher;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;

import com.google.android.material.button.MaterialButton;
import com.google.android.material.textfield.TextInputEditText;
import com.google.android.material.textfield.TextInputLayout;
import com.journeyapps.barcodescanner.ScanContract;
import com.journeyapps.barcodescanner.ScanOptions;

/** Alta y edición del servidor; escanea el QR del puente o acepta la URL a mano. */
public class SetupActivity extends AppCompatActivity {

    private static final int CAMERA_REQUEST = 41;

    private ServerStore store;
    private TextInputLayout serverLayout;
    private TextInputEditText serverUrl;
    private TextView fingerprint;
    private ActivityResultLauncher<ScanOptions> scanLauncher;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_setup);
        store = new ServerStore(this);

        serverLayout = findViewById(R.id.server_layout);
        serverUrl = findViewById(R.id.server_url);
        fingerprint = findViewById(R.id.fingerprint);

        String current = store.baseUrl();
        if (current != null) serverUrl.setText(current);

        scanLauncher = registerForActivityResult(new ScanContract(), result -> {
            if (result.getContents() == null) return;
            ServerStore.PairInfo info = ServerStore.parseBridgeQr(result.getContents());
            if (info == null) {
                serverLayout.setError(getString(R.string.error_qr));
                return;
            }
            store.setBaseUrl(info.baseUrl);
            startMain(info.initialUrl);
        });

        MaterialButton scan = findViewById(R.id.scan_qr);
        scan.setOnClickListener(view -> requestScan());

        MaterialButton save = findViewById(R.id.save_open);
        save.setOnClickListener(view -> saveAndOpen());

        MaterialButton forget = findViewById(R.id.forget_cert);
        forget.setOnClickListener(view -> {
            store.clearFingerprint();
            updateFingerprint();
            Toast.makeText(this, R.string.fingerprint_forgotten, Toast.LENGTH_SHORT).show();
        });

        updateFingerprint();
    }

    @Override
    protected void onResume() {
        super.onResume();
        updateFingerprint();
    }

    private void requestScan() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.CAMERA}, CAMERA_REQUEST);
            return;
        }
        launchScanner();
    }

    private void launchScanner() {
        ScanOptions options = new ScanOptions();
        options.setDesiredBarcodeFormats(ScanOptions.QR_CODE);
        options.setPrompt(getString(R.string.scan_qr));
        options.setBeepEnabled(false);
        options.setOrientationLocked(false);
        scanLauncher.launch(options);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != CAMERA_REQUEST) return;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            launchScanner();
        } else {
            serverLayout.setError(getString(R.string.error_qr));
        }
    }

    private void saveAndOpen() {
        serverLayout.setError(null);
        String raw = serverUrl.getText() == null ? "" : serverUrl.getText().toString();
        try {
            String base = ServerStore.normalizeBase(raw);
            store.setBaseUrl(base);
            startMain(base + "/");
        } catch (IllegalArgumentException error) {
            String reason = error.getMessage();
            if ("empty".equals(reason)) serverLayout.setError(getString(R.string.error_url_empty));
            else if ("scheme".equals(reason)) serverLayout.setError(getString(R.string.error_url_scheme));
            else serverLayout.setError(getString(R.string.error_url_invalid));
        }
    }

    private void startMain(String initialUrl) {
        setResult(RESULT_OK);
        Intent intent = new Intent(this, MainActivity.class);
        intent.putExtra(MainActivity.EXTRA_INITIAL_URL, initialUrl);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(intent);
        finish();
    }

    private void updateFingerprint() {
        String value = store.fingerprint();
        if (value == null) {
            fingerprint.setText(R.string.fingerprint_none);
            return;
        }
        String host = store.fingerprintHost();
        fingerprint.setText(getString(R.string.fingerprint_saved, (host == null ? "" : host + "\n") + value));
    }
}
