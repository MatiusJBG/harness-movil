package com.harnessmovil.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class PairTargetTest {

    @Test
    public void parsesQrWithHmPathAndFragment() {
        PairTarget target = PairTarget.parseBridgeQr("https://10.0.2.2:8443/_hm/#p=secreto_123");
        assertNotNull(target);
        assertEquals("https://10.0.2.2:8443", target.baseUrl());
        assertEquals("https://10.0.2.2:8443/_hm/#p=secreto_123", target.initialUrl());
    }

    @Test
    public void parsesQrWithoutPathAtRoot() {
        PairTarget target = PairTarget.parseBridgeQr("https://192.168.1.44:8443");
        assertNotNull(target);
        assertEquals("https://192.168.1.44:8443/", target.initialUrl());
    }

    @Test
    public void trimsQrWhitespace() {
        PairTarget target = PairTarget.parseBridgeQr("  https://10.0.2.2:8443  ");
        assertNotNull(target);
        assertEquals("https://10.0.2.2:8443", target.baseUrl());
        assertEquals("https://10.0.2.2:8443/", target.initialUrl());
    }

    @Test
    public void rejectsInvalidQr() {
        assertNull(PairTarget.parseBridgeQr(null));
        assertNull(PairTarget.parseBridgeQr("   "));
        assertNull(PairTarget.parseBridgeQr("no-es-url"));
        assertNull(PairTarget.parseBridgeQr("http://192.168.1.44:8443"));
        assertNull(PairTarget.parseBridgeQr("https://"));
    }

    @Test
    public void parsesDeepLinkWithBaseParam() {
        PairTarget target = PairTarget.parseDeepLink(
                "harnessmovil://open?base=https%3A%2F%2F10.0.2.2%3A8443");
        assertNotNull(target);
        assertEquals("https://10.0.2.2:8443", target.baseUrl());
        assertEquals("https://10.0.2.2:8443/", target.initialUrl());
    }

    @Test
    public void parsesDeepLinkWithUrlParam() {
        PairTarget target = PairTarget.parseDeepLink(
                "harnessmovil://open?url=https%3A%2F%2F10.0.2.2%3A8443%2F_hm%2F%23p%3Dabc");
        assertNotNull(target);
        assertEquals("https://10.0.2.2:8443/_hm/#p=abc", target.initialUrl());
    }

    @Test
    public void prefersUrlOverBaseParam() {
        PairTarget target = PairTarget.parseDeepLink(
                "harnessmovil://open?base=https%3A%2F%2F192.168.1.44%3A8443"
                        + "&url=https%3A%2F%2F10.0.2.2%3A8443%2F_hm%2F%23p%3Dabc");
        assertNotNull(target);
        assertEquals("https://10.0.2.2:8443", target.baseUrl());
        assertEquals("https://10.0.2.2:8443/_hm/#p=abc", target.initialUrl());
    }

    @Test
    public void ignoresForeignDeepLinks() {
        assertNull(PairTarget.parseDeepLink("https://example.com/open?url=x"));
        assertNull(PairTarget.parseDeepLink("harnessmovil://open"));
        assertNull(PairTarget.parseDeepLink(null));
    }

    @Test
    public void exposesNormalizedConnection() {
        PairTarget target = PairTarget.parseBridgeQr("HTTPS://Harness.Local:8443/_hm/#p=x");
        assertNotNull(target);
        assertEquals("harness.local:8443", target.connection().hostKey());
        assertEquals(8443, target.connection().port());
        assertEquals("https://harness.local:8443", target.connection().baseUrl());
    }

    @Test
    public void valueEqualityUsesBaseAndInitialUrl() {
        assertEquals(PairTarget.parseBridgeQr("https://10.0.2.2:8443"),
                PairTarget.parseBridgeQr("https://10.0.2.2:8443/"));
        assertEquals(PairTarget.parseBridgeQr("https://10.0.2.2:8443").hashCode(),
                PairTarget.parseBridgeQr("https://10.0.2.2:8443/").hashCode());
    }
}
