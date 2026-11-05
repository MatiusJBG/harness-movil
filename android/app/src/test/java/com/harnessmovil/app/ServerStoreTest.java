package com.harnessmovil.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class ServerStoreTest {

    @Test
    public void normalizesHostAndPort() {
        assertEquals("https://192.168.1.44:8443", ServerStore.normalizeBase("192.168.1.44:8443"));
        assertEquals("https://192.168.1.44:8443", ServerStore.normalizeBase("https://192.168.1.44:8443/_hm/"));
        assertEquals("https://harness.local", ServerStore.normalizeBase("https://harness.local"));
        assertEquals("https://192.168.1.44:8443", ServerStore.normalizeBase("  https://192.168.1.44:8443  "));
    }

    @Test(expected = IllegalArgumentException.class)
    public void rejectsPlainHttp() {
        ServerStore.normalizeBase("http://192.168.1.44:8443");
    }

    @Test(expected = IllegalArgumentException.class)
    public void rejectsEmptyUrl() {
        ServerStore.normalizeBase("   ");
    }

    @Test
    public void buildsHostKeyWithDefaultPort() {
        assertEquals("192.168.1.44:8443", ServerStore.hostKey("https://192.168.1.44:8443"));
        assertEquals("harness.local:443", ServerStore.hostKey("https://harness.local"));
    }

    @Test
    public void parsesPairQrWithFragment() {
        ServerStore.PairInfo info = ServerStore.parseBridgeQr(
                "https://10.0.2.2:8443/_hm/#p=secreto_123");
        assertNotNull(info);
        assertEquals("https://10.0.2.2:8443", info.baseUrl);
        assertEquals("https://10.0.2.2:8443/_hm/#p=secreto_123", info.initialUrl);
    }

    @Test
    public void parsesPlainBaseUrl() {
        ServerStore.PairInfo info = ServerStore.parseBridgeQr("https://192.168.1.44:8443");
        assertNotNull(info);
        assertEquals("https://192.168.1.44:8443/", info.initialUrl);
    }

    @Test
    public void rejectsNonHttpsQr() {
        assertNull(ServerStore.parseBridgeQr("http://192.168.1.44:8443"));
        assertNull(ServerStore.parseBridgeQr("no-es-url"));
        assertNull(ServerStore.parseBridgeQr(null));
    }

    @Test
    public void parsesDeepLinkWithEncodedUrl() {
        ServerStore.PairInfo info = ServerStore.parseDeepLink(
                "harnessmovil://open?url=https%3A%2F%2F10.0.2.2%3A8443%2F_hm%2F%23p%3Dabc");
        assertNotNull(info);
        assertEquals("https://10.0.2.2:8443", info.baseUrl);
        assertEquals("https://10.0.2.2:8443/_hm/#p=abc", info.initialUrl);
    }

    @Test
    public void ignoresForeignDeepLinks() {
        assertNull(ServerStore.parseDeepLink("https://example.com/open?url=x"));
        assertNull(ServerStore.parseDeepLink(null));
    }
}
