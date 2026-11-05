# Reglas de ProGuard del envoltorio Harness Móvil.
# El WebView usa JavaScript de la UI de Harness; no hay clases reflejadas propias.
-keep class com.harnessmovil.app.** { *; }
