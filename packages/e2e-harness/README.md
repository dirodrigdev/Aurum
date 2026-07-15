# Arnés E2E local compartido

Este paquete contiene sólo infraestructura segura y portable para suites E2E locales: launcher Firebase CLI con Node/Java aislados, validación de configuración, preflight de puertos, limpieza de artefactos y guardia Playwright de red local.

Cada aplicación declara su configuración en `e2e/apps/<app>.e2e.config.mjs`. El contrato requiere `appName`, `projectId` terminado en `-e2e-local`, host loopback, puertos `auth`/`firestore`/`app` distintos, configuración Firebase dentro del repositorio, directorios de artefactos y comandos específicos de seed y Playwright.

Nunca se comparten projectId, puertos, usuarios, seeds, stubs, variables, selectores, tests ni integraciones. El arnés rechaza projectIds no locales, hosts no loopback, rutas fuera del repositorio y puertos ocupados; la guardia Playwright registra sólo método, origen y pathname.

Variables opcionales de runtime: `E2E_FIREBASE_RUNTIME_DIR`, `E2E_NODE_BINARY` y `E2E_JAVA_HOME`. Si faltan Node 22 o Java compatible, se descargan una vez a una caché local configurable, sin modificar instalaciones globales.

Los comandos públicos siguen siendo `npm run test:e2e:aurum:authenticated` y `npm run test:e2e:midas:authenticated`. Para incorporar GastApp deberá aportar su propia configuración declarativa, Firebase Emulator, seed, stubs de producción y smoke test; no debe copiar infraestructura desde otra aplicación.

Limitación actual: el arnés ejecuta Auth y Firestore Emulator; no emula APIs Vercel ni integra aplicaciones en paralelo.

## Aplicaciones externas

El arnés admite una aplicación fuera del monorepo mediante `E2E_APP_REPO_DIR`: el directorio debe existir y su configuración E2E, Firebase config y artefactos deben permanecer dentro de ese repositorio. En CI la ruta externa debe declararse explícitamente. El launcher recibe el directorio de trabajo para usar sus propias dependencias `firebase-tools`, sin `file:` dependencies, symlinks ni rutas personales versionadas.

GastApp usa un adaptador propio que recibe `GASTAPP_REPO_DIR` y `E2E_HARNESS_DIR`; sus projectId, puertos, usuario, seed, stubs, reglas, selectores y tests siguen siendo específicos. Para añadir otra aplicación externa, crea ese adaptador local y su configuración declarativa, conserva en el arnés sólo launcher, validación, puertos, teardown y guardia de red, y no conviertas datos o integraciones de la app en componentes compartidos.
