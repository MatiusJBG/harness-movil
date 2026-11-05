package com.harnessmovil.app;

import java.security.MessageDigest;
import java.security.cert.X509Certificate;
import java.util.Arrays;
import java.util.Locale;

/**
 * Objeto de valor de la huella SHA-256 de un certificado.
 *
 * <p>Acepta el formato persistido por la app (hex mayúsculas separado por dos
 * puntos) y también hex sin separadores o en minúsculas; normaliza siempre al
 * formato con dos puntos y mayúsculas. La comparación usa
 * {@link MessageDigest#isEqual(byte[], byte[])} para no filtrar el prefijo
 * coincidente por tiempo.</p>
 */
public final class CertificatePin {

    private static final int DIGEST_BYTES = 32;
    private static final int HEX_CHARS = DIGEST_BYTES * 2;

    private final byte[] digest;

    private CertificatePin(byte[] digest) {
        this.digest = digest.clone();
    }

    /**
     * Lee una huella SHA-256 en hex (64 caracteres, con o sin ':' y en cualquier
     * caja). Devuelve {@code null} si no es una huella legible.
     */
    public static CertificatePin parse(String raw) {
        if (raw == null) return null;
        StringBuilder hex = new StringBuilder(HEX_CHARS);
        for (int index = 0; index < raw.length(); index++) {
            char current = raw.charAt(index);
            if (current == ':' || Character.isWhitespace(current)) continue;
            if (Character.digit(current, 16) < 0) return null;
            hex.append(current);
        }
        if (hex.length() != HEX_CHARS) return null;
        byte[] bytes = new byte[DIGEST_BYTES];
        for (int index = 0; index < DIGEST_BYTES; index++) {
            bytes[index] = (byte) Integer.parseInt(hex.substring(index * 2, index * 2 + 2), 16);
        }
        return new CertificatePin(bytes);
    }

    /** Construye la huella desde un digest SHA-256 crudo de 32 bytes. */
    public static CertificatePin of(byte[] sha256) {
        if (sha256 == null || sha256.length != DIGEST_BYTES) return null;
        return new CertificatePin(sha256);
    }

    /** Huella SHA-256 de un certificado X.509, o {@code null} si no se puede leer. */
    public static CertificatePin fromCertificate(X509Certificate certificate) {
        if (certificate == null) return null;
        try {
            MessageDigest messageDigest = MessageDigest.getInstance("SHA-256");
            return new CertificatePin(messageDigest.digest(certificate.getEncoded()));
        } catch (Exception error) {
            return null;
        }
    }

    /** Formato canónico persistido y mostrado: {@code AA:BB:...} en mayúsculas. */
    public String formatted() {
        StringBuilder builder = new StringBuilder(HEX_CHARS + DIGEST_BYTES - 1);
        for (int index = 0; index < digest.length; index++) {
            if (index > 0) builder.append(':');
            builder.append(String.format(Locale.ROOT, "%02X", digest[index] & 0xFF));
        }
        return builder.toString();
    }

    /** Hex sin separadores, en mayúsculas. */
    public String hex() {
        return formatted().replace(":", "");
    }

    /** Comparación en tiempo constante contra otra huella normalizada. */
    public boolean matches(CertificatePin other) {
        return other != null && MessageDigest.isEqual(digest, other.digest);
    }

    /** Comparación en tiempo constante contra una huella sin normalizar. */
    public boolean matches(String raw) {
        return matches(parse(raw));
    }

    /** true si {@code other} es una huella distinta de esta. */
    public boolean differsFrom(CertificatePin other) {
        return other != null && !matches(other);
    }

    /**
     * Detección de cambio de pin: hay huella guardada y no coincide con la actual.
     * Una huella guardada ilegible cuenta como cambio (igual que antes de extraer
     * el objeto de valor).
     */
    public static boolean changed(String storedRaw, CertificatePin current) {
        if (storedRaw == null || current == null) return false;
        CertificatePin storedPin = parse(storedRaw);
        return storedPin == null || !storedPin.matches(current);
    }

    @Override
    public boolean equals(Object other) {
        if (this == other) return true;
        if (!(other instanceof CertificatePin)) return false;
        return Arrays.equals(digest, ((CertificatePin) other).digest);
    }

    @Override
    public int hashCode() {
        return Arrays.hashCode(digest);
    }

    @Override
    public String toString() {
        return formatted();
    }
}
