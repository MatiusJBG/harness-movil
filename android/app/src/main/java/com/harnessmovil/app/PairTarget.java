package com.harnessmovil.app;

import java.net.URI;
import java.net.URLDecoder;

/**
 * Objeto de valor del destino de emparejamiento: la conexión normalizada y la
 * URL inicial que debe abrir el WebView.
 *
 * <p>Reúne los parsers puros que antes vivían en {@link ServerStore}: el QR del
 * panel ({@code https://ip:8443/_hm/#p=secreto}) y el deep link
 * ({@code harnessmovil://open?base=...} o {@code ?url=...}).</p>
 */
public final class PairTarget {

    private final ConnectionUrl connection;
    private final String initialUrl;

    private PairTarget(ConnectionUrl connection, String initialUrl) {
        this.connection = connection;
        this.initialUrl = initialUrl;
    }

    public ConnectionUrl connection() {
        return connection;
    }

    public String baseUrl() {
        return connection.baseUrl();
    }

    public String initialUrl() {
        return initialUrl;
    }

    /**
     * Acepta el QR del puente (https://ip:8443/_hm/#p=secreto) o una URL base.
     * Devuelve {@code null} cuando no es una URL https válida.
     */
    public static PairTarget parseBridgeQr(String raw) {
        if (raw == null) return null;
        String value = raw.trim();
        if (value.isEmpty()) return null;
        try {
            URI uri = new URI(value);
            if (uri.getScheme() == null || !"https".equalsIgnoreCase(uri.getScheme())) return null;
            if (uri.getHost() == null) return null;
            ConnectionUrl connection = ConnectionUrl.parse(value);
            String initial = value.contains("/_hm/") ? value : connection.initialUrl();
            return new PairTarget(connection, initial);
        } catch (Exception error) {
            return null;
        }
    }

    /**
     * Acepta harnessmovil://open?base=https://ip:8443 o
     * ?url=https://ip:8443/_hm/#p=...; {@code url} tiene prioridad sobre {@code base}.
     */
    public static PairTarget parseDeepLink(String raw) {
        if (raw == null) return null;
        try {
            URI uri = new URI(raw);
            if (!"harnessmovil".equalsIgnoreCase(uri.getScheme())) return null;
            String query = uri.getRawQuery();
            if (query == null) return null;
            String base = null;
            String url = null;
            for (String part : query.split("&")) {
                int separator = part.indexOf('=');
                if (separator <= 0) continue;
                String key = part.substring(0, separator);
                String value = URLDecoder.decode(part.substring(separator + 1), "UTF-8");
                if ("base".equals(key)) base = value;
                if ("url".equals(key)) url = value;
            }
            if (url != null) return parseBridgeQr(url);
            if (base != null) return parseBridgeQr(base);
        } catch (Exception ignored) {
            // cae a null
        }
        return null;
    }

    @Override
    public boolean equals(Object other) {
        if (this == other) return true;
        if (!(other instanceof PairTarget)) return false;
        PairTarget target = (PairTarget) other;
        return baseUrl().equals(target.baseUrl()) && initialUrl.equals(target.initialUrl);
    }

    @Override
    public int hashCode() {
        return 31 * baseUrl().hashCode() + initialUrl.hashCode();
    }

    @Override
    public String toString() {
        return initialUrl;
    }
}
