package com.harnessmovil.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;

import org.junit.Test;

public class CertificatePinTest {

    private static final String PLAIN_UPPER = "0123456789ABCDEF".repeat(4);
    private static final String COLON_UPPER = withColons(PLAIN_UPPER);
    private static final String PLAIN_LOWER = PLAIN_UPPER.toLowerCase(Locale.ROOT);
    private static final String OTHER = "FFEEDDCCBBAA99887766554433221100".repeat(2);

    @Test
    public void parsesColonSeparatedUppercase() {
        CertificatePin pin = CertificatePin.parse(COLON_UPPER);
        assertEquals(COLON_UPPER, pin.formatted());
        assertEquals(PLAIN_UPPER, pin.hex());
        assertEquals(COLON_UPPER, pin.toString());
    }

    @Test
    public void parsesPlainLowercaseHex() {
        assertEquals(COLON_UPPER, CertificatePin.parse(PLAIN_LOWER).formatted());
    }

    @Test
    public void ignoresWhitespaceSeparators() {
        assertEquals(COLON_UPPER, CertificatePin.parse(COLON_UPPER.replace(":", " ")).formatted());
    }

    @Test
    public void rejectsMalformedFingerprints() {
        assertNull(CertificatePin.parse(null));
        assertNull(CertificatePin.parse(""));
        assertNull(CertificatePin.parse("AB"));
        assertNull(CertificatePin.parse(PLAIN_UPPER.substring(1)));
        assertNull(CertificatePin.parse(PLAIN_UPPER + "FF"));
        assertNull(CertificatePin.parse(PLAIN_UPPER.replace('0', 'G')));
        assertNull(CertificatePin.of(null));
        assertNull(CertificatePin.of(new byte[31]));
    }

    @Test
    public void matchesEquivalentPins() {
        CertificatePin pin = CertificatePin.parse(COLON_UPPER);
        assertTrue(pin.matches(CertificatePin.parse(PLAIN_LOWER)));
        assertTrue(pin.matches(PLAIN_LOWER));
        assertFalse(pin.matches((CertificatePin) null));
        assertFalse(pin.matches((String) null));
    }

    @Test
    public void detectsDifferentPins() {
        CertificatePin pin = CertificatePin.parse(COLON_UPPER);
        CertificatePin other = CertificatePin.parse(OTHER);
        assertFalse(pin.matches(other));
        assertTrue(pin.differsFrom(other));
        assertFalse(pin.differsFrom(null));
    }

    @Test
    public void detectsChangedStoredPin() {
        CertificatePin current = CertificatePin.parse(COLON_UPPER);
        assertFalse(CertificatePin.changed(COLON_UPPER, current));
        assertFalse(CertificatePin.changed(PLAIN_LOWER, current));
        assertFalse(CertificatePin.changed(null, current));
        assertFalse(CertificatePin.changed(COLON_UPPER, null));
        assertTrue(CertificatePin.changed(OTHER, current));
        assertTrue(CertificatePin.changed("basura", current));
    }

    @Test
    public void buildsFromRawSha256Digest() throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        CertificatePin pin = CertificatePin.of(digest.digest("harness".getBytes(StandardCharsets.UTF_8)));
        assertEquals(64, pin.hex().length());
        assertEquals(pin.formatted(), CertificatePin.parse(pin.hex()).formatted());
        assertNull(CertificatePin.fromCertificate(null));
    }

    @Test
    public void valueEqualityUsesDigestBytes() {
        assertEquals(CertificatePin.parse(COLON_UPPER), CertificatePin.parse(PLAIN_LOWER));
        assertEquals(CertificatePin.parse(COLON_UPPER).hashCode(), CertificatePin.parse(PLAIN_LOWER).hashCode());
        assertNotEquals(CertificatePin.parse(COLON_UPPER), CertificatePin.parse(OTHER));
    }

    private static String withColons(String hex) {
        StringBuilder builder = new StringBuilder();
        for (int index = 0; index < hex.length(); index += 2) {
            if (index > 0) builder.append(':');
            builder.append(hex, index, index + 2);
        }
        return builder.toString();
    }
}
