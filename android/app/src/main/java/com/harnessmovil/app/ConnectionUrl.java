package com.harnessmovil.app;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

/**
 * Objeto de valor del servidor del puente: origen https://host[:puerto].
 *
 * <p>Concentra la normalización y validación que antes vivía en {@link ServerStore}:
 * acepta la URL escrita por el usuario (con o sin esquema, con ruta) y la reduce a un
 * origen https sin ruta, query ni fragmento. El puerto 443 se omite.</p>
 */
public final class ConnectionUrl {

    public static final int DEFAULT_PORT = 443;

    private final String host;
    private final int port;

    private ConnectionUrl(String host, int port) {
        this.host = host;
        this.port = port;
    }

    /**
     * Normaliza {@code input} a un origen https.
     *
     * @throws IllegalArgumentException con mensaje {@code empty}, {@code invalid},
     *         {@code scheme}, {@code userinfo}, {@code host} o {@code port}; las
     *         Activities traducen esos códigos a mensajes de UI.
     */
    public static ConnectionUrl parse(String input) throws IllegalArgumentException {
        String value = input == null ? "" : input.trim();
        if (value.isEmpty()) throw new IllegalArgumentException("empty");
        if (!value.contains("://")) value = "https://" + value;

        URI uri;
        try {
            uri = new URI(value);
        } catch (URISyntaxException error) {
            throw new IllegalArgumentException("invalid");
        }
        if (uri.getScheme() == null || !"https".equalsIgnoreCase(uri.getScheme())) {
            throw new IllegalArgumentException("scheme");
        }
        if (uri.getUserInfo() != null) throw new IllegalArgumentException("userinfo");
        String host = uri.getHost();
        if (host == null || host.isEmpty()) throw new IllegalArgumentException("host");

        int port = uri.getPort();
        if (port == -1) port = DEFAULT_PORT;
        if (port < 1 || port > 65535) throw new IllegalArgumentException("port");

        if (host.startsWith("[") && host.endsWith("]")) {
            host = host.substring(1, host.length() - 1);
        }
        host = host.toLowerCase(Locale.ROOT);
        return new ConnectionUrl(host, port);
    }

    /** Atajo de {@link #parse(String)} que devuelve la URL base canónica. */
    public static String normalize(String input) throws IllegalArgumentException {
        return parse(input).baseUrl();
    }

    public String host() {
        return host;
    }

    public int port() {
        return port;
    }

    /** Host listo para URL: minúsculas y entre corchetes si es IPv6. */
    public String authority() {
        String value = host;
        if (value.contains(":")) value = "[" + value + "]";
        return value.toLowerCase(Locale.ROOT);
    }

    /** Origen https canónico, sin puerto cuando es 443. */
    public String baseUrl() {
        return "https://" + authority() + (port == DEFAULT_PORT ? "" : ":" + port);
    }

    /** Clave de host del pinning: host:puerto en minúsculas. */
    public String hostKey() {
        return authority() + ":" + port;
    }

    /** URL inicial a cargar en el WebView: la raíz del puente. */
    public String initialUrl() {
        return baseUrl() + "/";
    }

    /** Clave de host de una URL base ya normalizada; vacío si no es válida. */
    public static String hostKeyOf(String baseUrl) {
        try {
            return parse(baseUrl).hostKey();
        } catch (IllegalArgumentException error) {
            return "";
        }
    }

    /**
     * Clave de host de una URL cualquiera (la del SslError). No exige https para
     * conservar el comportamiento histórico del pinning; vacío si no se puede leer.
     */
    public static String hostKeyFromUrl(String url) {
        try {
            URI uri = new URI(url);
            String host = uri.getHost();
            if (host == null) return "";
            int port = uri.getPort() == -1 ? DEFAULT_PORT : uri.getPort();
            return (host + ":" + port).toLowerCase(Locale.ROOT);
        } catch (Exception error) {
            return "";
        }
    }

    @Override
    public boolean equals(Object other) {
        if (this == other) return true;
        if (!(other instanceof ConnectionUrl)) return false;
        return baseUrl().equals(((ConnectionUrl) other).baseUrl());
    }

    @Override
    public int hashCode() {
        return baseUrl().hashCode();
    }

    @Override
    public String toString() {
        return baseUrl();
    }
}
