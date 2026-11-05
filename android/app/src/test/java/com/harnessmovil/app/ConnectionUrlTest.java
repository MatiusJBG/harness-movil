package com.harnessmovil.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertThrows;

import org.junit.Test;

public class ConnectionUrlTest {

    @Test
    public void stripsPathQueryAndFragment() {
        assertEquals("https://10.0.2.2:8443", ConnectionUrl.normalize("https://10.0.2.2:8443/_hm/?x=1#p=abc"));
    }

    @Test
    public void lowercasesHostAndKeepsPort() {
        ConnectionUrl url = ConnectionUrl.parse("  HTTPS://Harness.Local:8443  ");
        assertEquals("harness.local", url.host());
        assertEquals(8443, url.port());
        assertEquals("https://harness.local:8443", url.baseUrl());
        assertEquals("harness.local:8443", url.hostKey());
    }

    @Test
    public void omitsDefaultPortFromBaseUrl() {
        assertEquals("https://harness.local", ConnectionUrl.normalize("https://harness.local:443"));
        ConnectionUrl url = ConnectionUrl.parse("https://harness.local");
        assertEquals(443, url.port());
        assertEquals("harness.local:443", url.hostKey());
    }

    @Test
    public void keepsIpv6HostInBrackets() {
        ConnectionUrl url = ConnectionUrl.parse("https://[::1]");
        assertEquals("https://[::1]", url.baseUrl());
        assertEquals("[::1]:443", url.hostKey());
        assertEquals("https://[::1]:8443", ConnectionUrl.normalize("https://[::1]:8443/_hm/"));
    }

    @Test
    public void buildsInitialUrlAtRoot() {
        assertEquals("https://192.168.1.44:8443/", ConnectionUrl.parse("https://192.168.1.44:8443").initialUrl());
        assertEquals("https://harness.local/", ConnectionUrl.parse("harness.local").initialUrl());
    }

    @Test
    public void rejectsNonHttpsSchemes() {
        assertEquals("scheme", assertThrows(IllegalArgumentException.class,
                () -> ConnectionUrl.normalize("http://192.168.1.44:8443")).getMessage());
        assertEquals("scheme", assertThrows(IllegalArgumentException.class,
                () -> ConnectionUrl.normalize("ftp://harness.local")).getMessage());
    }

    @Test
    public void rejectsUserInfo() {
        assertEquals("userinfo", assertThrows(IllegalArgumentException.class,
                () -> ConnectionUrl.normalize("https://user:pass@harness.local")).getMessage());
    }

    @Test
    public void reportsErrorCodesForUi() {
        assertEquals("empty", assertThrows(IllegalArgumentException.class,
                () -> ConnectionUrl.normalize("   ")).getMessage());
        assertEquals("host", assertThrows(IllegalArgumentException.class,
                () -> ConnectionUrl.normalize("https:///path")).getMessage());
        assertEquals("invalid", assertThrows(IllegalArgumentException.class,
                () -> ConnectionUrl.normalize("https://harness local")).getMessage());
        assertEquals("port", assertThrows(IllegalArgumentException.class,
                () -> ConnectionUrl.normalize("https://harness.local:0")).getMessage());
    }

    @Test
    public void hostKeyFromUrlIgnoresPath() {
        assertEquals("10.0.2.2:8443", ConnectionUrl.hostKeyFromUrl("https://10.0.2.2:8443/_hm/#p=abc"));
        assertEquals("harness.local:443", ConnectionUrl.hostKeyFromUrl("https://harness.local/x"));
        assertEquals("", ConnectionUrl.hostKeyFromUrl(null));
        assertEquals("", ConnectionUrl.hostKeyFromUrl("no es url"));
    }

    @Test
    public void hostKeyOfReturnsEmptyForInvalidBase() {
        assertEquals("", ConnectionUrl.hostKeyOf(null));
        assertEquals("", ConnectionUrl.hostKeyOf(""));
        assertEquals("", ConnectionUrl.hostKeyOf("http://harness.local"));
    }

    @Test
    public void valueEqualityIgnoresInputFormatting() {
        assertEquals(ConnectionUrl.parse("192.168.1.44:8443"),
                ConnectionUrl.parse("https://192.168.1.44:8443/_hm/"));
        assertEquals(ConnectionUrl.parse("192.168.1.44:8443").hashCode(),
                ConnectionUrl.parse("https://192.168.1.44:8443/_hm/").hashCode());
        assertNotEquals(ConnectionUrl.parse("https://a.local"), ConnectionUrl.parse("https://b.local"));
    }
}
