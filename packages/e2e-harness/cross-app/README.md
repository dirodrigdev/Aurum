# Escenario sintético GastApp → Aurum → MIDAS

Desde la raíz de Aurum, con Node 22, Java 17+ y las dependencias de ambos repositorios:

```sh
GASTAPP_REPO_DIR=/ruta/absoluta/Gastapp npm run test:e2e:cross-app:synthetic
```

Opcionales: `E2E_NODE_BINARY`, `E2E_JAVA_HOME` y `CROSS_APP_E2E_ARTIFACT_DIR` (directorio de evidencia fuera de Git). Se genera `scenario.json`; no hay datos reales ni escenario secreto que descargar. Los tres proyectos terminan en `-e2e-local`. Cada etapa inicia y apaga sus emuladores secuencialmente y comprueba los puertos.

## Fronteras que se ejecutan

1. GastApp ejecuta las mutaciones y publicadores reales. Certifica julio una vez; la corrección posterior se recertifica automáticamente. Conserva los documentos crudos iniciales/actuales, hashes, familias y procedencia. Mayo parte de una cobertura histórica sintética persistida del 12 al 31: se modifica pero no se certifica como mes completo. Se concilian las celdas y totales de ocho XLSX y el contenido de cuatro JSON contra las filas publicadas.
2. Aurum consume esos documentos crudos con sus lectores/normalizadores reales y Rules de GastApp. Una sesión secundaria sintética usa Auth Emulator. No se inyecta el resultado del resolver. Verifica revisión histórica, versiones, reconocimiento persistido, rentabilidad indicativa y recarga. También lee un cierre sin snapshot embebido desde el sidecar.
3. El publicador browser real llama por HTTP al handler Node real de `/api/midas/publish-snapshot`. El adaptador Vite, exclusivamente `mode=e2e` más `CROSS_APP_SCENARIO_PATH`, dirige Firebase y el lookup del token real a los emuladores. No sustituye autorización, normalización ni transacciones. Dos solicitudes concurrentes producen una publicación y un `unchanged`; credenciales ausentes/inválidas y otro usuario válido se rechazan.
4. El documento publicado y sus variantes reales se transportan **sin reconstruirlos** por `scenario.json` al namespace del emulador MIDAS. Su lector real, M8 y persistencia verifican identidad, ajustes manuales, recuperación tras error del mismo hash sin recálculo, nueva base económica y recarga.

Son emuladores sucesivos con el mismo escenario compartido, no una conexión simultánea entre proyectos productivos. Los cambios de transporte viven en el arnés; no añaden rutas de prueba a las aplicaciones desplegadas. El fallo de transporte se inyecta sobre el callback de la suscripción real desde Playwright.

Las suites autenticadas normales omiten este escenario cuando falta `CROSS_APP_SCENARIO_PATH`; solo el orquestador demuestra la cadena completa. No confundir esas omisiones con una certificación transversal. Traces y sesiones del navegador no deben exportarse en los ZIP.

La base manual guardada del escenario MIDAS usa11años y el ensayo temporal12años. Se exige que el ensayo sobreviva al fallo/reintento y al rebase sin otro cálculo por el mismo hash. Al recargar se exige la base guardada de11años y la nueva fuente patrimonial: no se convierte silenciosamente una simulación temporal en configuración oficial. El resultado completado solo se vuelve a mostrar si su firma coincide con los inputs efectivos que el gate valida.
