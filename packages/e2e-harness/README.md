# Arnés E2E local compartido

Este paquete contiene sólo infraestructura segura y portable para suites E2E locales: launcher Firebase CLI con Node/Java aislados, validación de configuración, preflight de puertos, limpieza de artefactos y guardia Playwright de red local.

Cada aplicación declara su configuración en `e2e/apps/<app>.e2e.config.mjs`. El contrato requiere `appName`, `projectId` terminado en `-e2e-local`, host loopback, puertos `auth`/`firestore`/`app` distintos, configuración Firebase dentro del repositorio, directorios de artefactos y comandos específicos de seed y Playwright.

Nunca se comparten projectId, puertos, usuarios, seeds, stubs, variables, selectores, tests ni integraciones. El arnés rechaza projectIds no locales, hosts no loopback, rutas fuera del repositorio y puertos ocupados; la guardia Playwright registra sólo método, origen y pathname.

Variables opcionales de runtime: `E2E_FIREBASE_RUNTIME_DIR`, `E2E_NODE_BINARY` y `E2E_JAVA_HOME`. Si faltan Node 22 o Java compatible, se descargan una vez a una caché local configurable, sin modificar instalaciones globales.

Los comandos públicos siguen siendo `npm run test:e2e:aurum:authenticated` y `npm run test:e2e:midas:authenticated`. Para incorporar GastApp deberá aportar su propia configuración declarativa, Firebase Emulator, seed, stubs de producción y smoke test; no debe copiar infraestructura desde otra aplicación.

Limitación actual: el arnés ejecuta Auth y Firestore Emulator; no emula APIs Vercel ni integra aplicaciones en paralelo.
