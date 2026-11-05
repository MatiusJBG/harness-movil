package com.harnessmovil.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import org.junit.Test;

/**
 * Contrato del flujo de configuración del servidor. Son las nueve pruebas
 * originales de {@link ServerStore} (mismos casos y aserciones) apuntando ahora
 * a los objetos de valor donde vive esa lógica desde el ADR 0003; la persistencia
 * quedó exclusivamente en {@code ServerStore}.
 */
public class ServerStoreTest {

    @Test
    public void normalizesHostAndPort() {
        assertEquals("https://192.168.1.44:8443", ConnectionUrl.normalize("192.168.1.44:8443"));
        assertEquals("https://192.168.1.44:8443", ConnectionUrl.normalize("https://192.168.1.44:8443/_hm/"));
        assertEquals("https://harness.local", ConnectionUrl.normalize("https://harness.local"));
        assertEquals("https://192.168.1.44:8443", ConnectionUrl.normalize("  https://192.168.1.44:8443  "));
    }

    @Test(expected = IllegalArgumentException.class)
    public void rejectsPlainHttp() {
        ConnectionUrl.normalize("http://192.168.1.44:8443");
    }

    @Test(expected = IllegalArgumentException.class)
    public void rejectsEmptyUrl() {
        ConnectionUrl.normalize("   ");
    }

    @Test
    public void buildsHostKeyWithDefaultPort() {
        assertEquals("192.168.1.44:8443", ConnectionUrl.hostKeyOf("https://192.168.1.44:8443"));
        assertEquals("harness.local:443", ConnectionUrl.hostKeyOf("https://harness.local"));
    }

    @Test
    public void parsesPairQrWithFragment() {
        PairTarget target = PairTarget.parseBridgeQr("https://10.0.2.2:8443/_hm/#p=secreto_123");
        assertNotNull(target);
        assertEquals("https://10.0.2.2:8443", target.baseUrl());
        assertEquals("https://10.0.2.2:8443/_hm/#p=secreto_123", target.initialUrl());
    }

    @Test
    public void parsesPlainBaseUrl() {
        PairTarget target = PairTarget.parseBridgeQr("https://192.168.1.44:8443");
        assertNotNull(target);
        assertEquals("https://192.168.1.44:8443/", target.initialUrl());
    }

    @Test
    public void rejectsNonHttpsQr() {
        assertNull(PairTarget.parseBridgeQr("http://192.168.1.44:8443"));
        assertNull(PairTarget.parseBridgeQr("no-es-url"));
        assertNull(PairTarget.parseBridgeQr(null));
    }

    @Test
    public void parsesDeepLinkWithEncodedUrl() {
        PairTarget target = PairTarget.parseDeepLink(
                "harnessmovil://open?url=https%3A%2F%2F10.0.2.2%3A8443%2F_hm%2F%23p%3Dabc");
        assertNotNull(target);
        assertEquals("https://10.0.2.2:8443", target.baseUrl());
        assertEquals("https://10.0.2.2:8443/_hm/#p=abc", target.initialUrl());
    }

    @Test
    public void ignoresForeignDeepLinks() {
        assertNull(PairTarget.parseDeepLink("https://example.com/open?url=x"));
        assertNull(PairTarget.parseDeepLink(null));
    }
}
