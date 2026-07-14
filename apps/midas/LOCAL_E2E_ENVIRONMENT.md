# Entorno E2E autenticado local de MIDAS

MIDAS usa exclusivamente Firebase Auth Emulator y Firestore Emulator cuando Vite se inicia en modo `e2e`. El proyecto obligatorio es `midas-e2e-local`; cualquier otro projectId hace fallar la inicialización antes de crear clientes Firebase.

## Puertos y comandos

| Servicio | Puerto |
| --- | ---: |
| Vite MIDAS E2E | 4174 |
| Auth Emulator | 9199 |
| Firestore Emulator | 8180 |
| Emulator UI | No se usa |

Desde la raíz del monorepo:

```bash
npm run emulators:midas
npm run seed:e2e:midas
npm run test:e2e:midas:authenticated
npm run clean:e2e:midas
```

El comando autenticado levanta emuladores efímeros, crea el usuario local `midas-e2e-user`, carga una configuración de simulación ficticia en `users/{uid}/midas_config/simulationActiveV1`, ejecuta Playwright y verifica el documento dentro del emulador. No utiliza Google real ni datos personales.

## Aislamiento

El modo requiere `VITE_E2E_USE_FIREBASE_EMULATOR=true` y valores Firebase ficticios en `.env.e2e`. Auth y Firestore se conectan sólo a `127.0.0.1`. El consumidor de snapshots publicados de Aurum se deshabilita explícitamente, por lo que MIDAS no consulta Aurum, Vercel, Firebase real ni servicios externos. Playwright bloquea todo host que no sea local.

MIDAS puede reconciliar automáticamente la configuración de simulación tras la hidratación. Esa escritura se permite sólo en `midas-e2e-local`; la verificación posterior confirma que el documento existe en Firestore Emulator.

## Portabilidad

`scripts/run-firebase-e2e.mjs` acepta `E2E_FIREBASE_RUNTIME_DIR`, `E2E_NODE_BINARY` y `E2E_JAVA_HOME`. Reutiliza un Node 22 y Java compatible instalados; si no existen, descarga Node 22 y Temurin 21 una sola vez a una caché local configurable. No modifica runtimes globales. Aurum conserva su comando existente y puede reutilizar su caché anterior durante la transición.

La implementación MIDAS y la de Aurum son ahora candidatas para extraer un arnés común, pero esa extracción queda pendiente hasta mantener ambas suites estables.
