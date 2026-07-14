# Aurum: auditoria y entorno local

Fecha de consolidacion: 2026-07-14

## Alcance y resguardo

Este informe documenta el diagnostico y la reparacion del entorno local de Aurum. No se modifico logica funcional, Firebase Authentication, Firestore Rules, datos, variables de Vercel ni produccion. No se hizo deploy, commit, cierre, sincronizacion, publicacion de Data Room ni operacion administrativa.

## 1. Situacion inicial y causa raiz

El monorepo real es `/Users/diegorodriguezpizarro/Desarrollo/Aurum`, con workspace npm `apps/aurum`. Usa `package-lock.json`, Node v24.14.0, npm 11.9.0 y Vite 5.4.21.

La pantalla blanca inicial no era un problema de puerto ni de compilacion. Las seis `VITE_FIREBASE_*` propias de Aurum faltaban localmente. `src/App.tsx` importa `src/services/firebase.ts`; ese modulo llama a `getAuth(app)` al evaluarse y, sin API key, lanzaba antes de montar React:

```text
FirebaseError: Firebase: Error (auth/invalid-api-key).
```

El build fue correcto: `npm run build:aurum` termino con exit 0. Sus advertencias de tamano de bundle e import dinamico no impedian el render.

## 2. Reparacion local realizada

Se confirmo manualmente en Vercel que el proyecto correcto es Aurum y que su Root Directory es `apps/aurum`. Despues:

1. Se ejecuto `npx vercel link --repo` desde la raiz.
2. El CLI mostro `midas (apps/midas)` y `aurum (apps/aurum)`; MIDAS se desmarco explicitamente y solo se vinculo `diegos-projects-9027bbcb/aurum`.
3. Vercel CLI 56 almacena enlaces multiapp en `.vercel/repo.json`, no en `.vercel/project.json`. El mapa contiene un unico proyecto: `aurum` con directorio `apps/aurum`.
4. Se ejecuto `npx vercel env ls development` y luego `npx vercel env pull apps/aurum/.env.local --environment=development`, seleccionando solo Aurum. Se habia guardado antes una copia temporal del archivo local; solo contenia claves vacias.

Variables cliente presentes y no vacias, sin exponer valores:

```text
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
VITE_GASTAPP_FIREBASE_API_KEY
VITE_GASTAPP_FIREBASE_AUTH_DOMAIN
VITE_GASTAPP_FIREBASE_PROJECT_ID
VITE_GASTAPP_FIREBASE_STORAGE_BUCKET
VITE_GASTAPP_FIREBASE_MESSAGING_SENDER_ID
VITE_GASTAPP_FIREBASE_APP_ID
```

`apps/aurum/.env.local` existe y Git lo ignora. No hay archivos staged ni secretos incluidos en este informe.

## 3. Estado actual y validacion manual posterior al login

El comando de desarrollo visual es:

```text
cd /Users/diegorodriguezpizarro/Desarrollo/Aurum
npm run dev:aurum
```

Vite sirve Aurum en `http://localhost:3000/`. Tras la reparacion, React mostro el login de Google y desaparecio `auth/invalid-api-key`.

El usuario confirmo posteriormente, sin ejecutar acciones mutadoras:

* Login Google exitoso.
* Carga normal de Aurum y de los datos principales.
* Lecturas iniciales permitidas, sin `permission-denied`.
* Sin espera indefinida ni bloqueador visible posterior.
* Sin cierres, ediciones, sincronizaciones, operaciones administrativas ni publicaciones.

Por tanto, Firebase Auth, el primer montaje React y las lecturas Firestore necesarias para la pantalla principal funcionan con el entorno local reparado.

## 4. Inventario de servicios y riesgos

| Servicio o ruta | Metodo | Invocador | Funcion | Tipo y riesgo | Variables principales | Vite directo | Vercel Dev |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Firebase Auth | SDK cliente | `services/firebase.ts`, `App.tsx` | Persistencia, login Google y logout | Sesion; no modifica patrimonio por si sola | Seis `VITE_FIREBASE_*` | Si | Si |
| Firestore de Aurum | SDK cliente | `wealthStorage.ts` | Hidratacion, suscripcion y datos de patrimonio | Lecturas iniciales seguras; guardar, backup, undo, checkpoint y delete son mutadores | `VITE_FIREBASE_*`, reglas existentes | Si | Si |
| Firestore Gastapp mensual | SDK cliente | `gastosMonthly.ts` | Lectura de gastos; tambien existe `setDoc` para materializacion local de mensual | Lectura: bajo riesgo. `setDoc`: escritura, no probar | `VITE_GASTAPP_FIREBASE_*` | Si | Si |
| Data Room Gastapp v2 y ledger | SDK cliente | `services/dataRoom/*Gastapp*Adapter.ts` | Manifest, resumen y filas de Gastapp | Solo lecturas Firestore; puede consumir cuota | `VITE_GASTAPP_FIREBASE_*` | Si | Si |
| Data Room MIDAS | SDK cliente | `midasDataRoomAdapter.ts` | Lee configuracion y publicado para analisis | Solo lecturas Firestore | `VITE_FIREBASE_*` | Si | Si |
| `/api/fx/live` | GET | `wealthStorage.ts` | TC/UF vigentes | Lectura de proveedores externos; no escribir datos Aurum | `BCCH_USER`, `BCCH_PASS`, `BCCH_USD_SERIES` y fallbacks publicos | No: Vite entrega archivo JS | Si |
| `/api/fx/closure` | GET | `closureFxRates.ts` | TC/UF historicos para cierres | Lectura de BCCh/SII; no ejecutar durante esta auditoria | `BCCH_USER`, `BCCH_PASS` | No | Si |
| `/api/fintoc/refresh-intent` | POST | `bankApi.ts` | Crea refresh intent de banco | Sensible: inicia flujo externo y requiere token Firebase | `FINTOC_SECRET_KEY`, `FINTOC_BASE_URL` | No | Si, no probar |
| `/api/fintoc/refresh-status` | GET | `bankApi.ts` | Consulta estado de un refresh existente | Lectura externa autenticada, pero depende de un intent real | `FINTOC_SECRET_KEY`, `FINTOC_BASE_URL` | No | Si, no probar inicialmente |
| `/api/fintoc/discover` | POST | `bankApi.ts` | Descubre cuentas/movimientos vinculados | Sensible: consulta bancaria con token y puede disparar flujo upstream | `FINTOC_SECRET_KEY`, `FINTOC_BASE_URL` | No | Si, no probar |
| `/api/fintoc/webhook` | POST entrante | Fintoc, no UI | Recibe eventos Fintoc | Potencialmente altera estado externo; prohibido invocarlo manualmente | `FINTOC_SECRET_KEY` | No | Si, no probar |
| `/api/midas/publish-snapshot` | POST | `midasPublished.ts` | Publica snapshot Aurum para MIDAS | Escritura Firestore con Admin SDK; prohibido | `FIREBASE_SERVICE_ACCOUNT_JSON`, Auth Firebase | No | Si, no probar |
| `/api/admin/historical-closure?action=read/export/audit` | GET | `historicalClosureCorrectionClient.ts` | Lectura y export de cierre historico | Lectura privilegiada de produccion; evitar para minimizar cuota | Admin SDK, Auth Firebase autorizada | No | Si, no probar en smoke |
| `/api/admin/historical-closure` con `preview`, `prepare`, `apply`, `rollback-*` | POST | `historicalClosureCorrectionClient.ts` | Correccion y rollback historicos | Critico: preview/preparacion y escrituras; prohibido | Admin SDK, Auth Firebase autorizada | No | Si, no probar |
| Firebase Identity Toolkit | POST interno | `api/_firebaseAuth.js` | Verifica token Firebase para APIs | Autenticacion server-side, no es ruta UI directa | `FIREBASE_WEB_API_KEY` o Firebase web key | No aplica | Si |
| Proveedores externos no serverless | GET/CDN | OCR y HTML | Tesseract CDN, Tailwind CDN, Google Fonts | Lectura de red; no persisten patrimonio | Ninguna | Si | Si |

### Limites de seguridad de la tabla

No se invoco ninguna ruta `POST`, endpoint administrativo, Fintoc, publicacion MIDAS ni ruta de FX en modo GET. En particular, las funciones listadas como escritura o riesgo sensible quedan fuera de toda prueba automatizada inicial.

## 5. Verificacion de Vercel Dev

Comando comprobado, ejecutado desde `apps/aurum` para coincidir con el Root Directory:

```text
npx vercel dev --listen 3001
```

Resultado:

* Inicio correcto en `http://localhost:3001/`.
* Vercel ejecuto `vite --port $PORT` para la interfaz y anuncio `Ready` localmente.
* La pagina raiz devolvio HTTP 200 con cabecera `server: Vercel`.
* La comprobacion segura `HEAD /api/fx/live` devolvio HTTP 405, `Allow: GET`, `Content-Type: application/json` y cabeceras Vercel. Al no ser GET, el handler rechazo el metodo antes de consultar BCCh u otro proveedor. Esto confirma que `/api/*` se reconoce como funcion, no como archivo JavaScript.
* No se desplego nada. Vercel Dev se detuvo despues de la comprobacion; Vite en `http://localhost:3000/` quedo activo.

Vercel Dev usa el enlace repo de Aurum y el `.env.local` descargado de Development. Sus funciones pueden llamar servicios y datos de produccion si se las invoca: iniciar el servidor es seguro, pero no convierte el entorno en aislado.

## 6. Vite frente a Vercel Dev

| Aspecto | `npm run dev:aurum` | `npx vercel dev` |
| --- | --- | --- |
| Directorio recomendado | Raiz del monorepo | `apps/aurum` |
| UI React/Vite | Si, rapido | Si, Vercel inicia Vite tras su proxy |
| Puerto comprobado | 3000 | 3001 en esta prueba; se puede elegir con `--listen` |
| Firebase Auth y Firestore directo | Si; usa las variables `VITE_*` locales | Si; usa el mismo cliente y variables locales |
| Rutas `/api/*` | No; Vite puede servir el fuente JS en vez de ejecutar la funcion | Si; Vercel enruta y ejecuta funciones locales |
| Variables server-side | No aplican a Vite puro | Disponibles para funciones a traves del entorno Development local |
| Similitud con produccion | Alta para UI, Auth y Firestore cliente | Mayor para UI + funciones Vercel, pero sigue apuntando a servicios reales |
| Velocidad | Mejor para trabajo visual | Menor por proxy y funciones |
| Riesgo | Lecturas cliente tras login; evitar acciones de UI mutadoras | Incluye los mismos riesgos y ademas APIs con credenciales server-side |
| Uso recomendado | Desarrollo visual y validaciones rapidas | Pruebas de API no mutadoras y E2E que necesiten `/api/*` |

Recomendacion operativa:

* Desarrollo visual y smoke de login: Vite en 3000.
* E2E de navegacion autenticada que no toque APIs: Vite, con sesion de pruebas controlada.
* E2E de FX/API GET no mutadora: Vercel Dev, con lista explicita de rutas permitidas.
* Depuracion de comportamiento productivo de funciones: Vercel Dev, solo con autorizacion puntual y sin acciones financieras.
* Validaciones rapidas de Codex: Vite por defecto; Vercel Dev solo cuando la evidencia requiera una ruta `/api/*`.

## 7. Plan de automatizacion propuesto, no implementado

### Base tecnica

* Aurum ya tiene Vitest y pruebas jsdom. Playwright no esta declarado por Aurum: hoy aparece por el workspace MIDAS (`@playwright/test@1.60.0`). La siguiente fase debe decidir si se declara como dependencia de desarrollo de Aurum o de la raiz, sin depender accidentalmente de MIDAS.
* Instalar o validar Chromium de Playwright solo en la fase posterior. La configuracion debe guardar screenshots, videos y traces como artefactos locales/CI, nunca como datos Firestore.
* Usar dos proyectos de prueba: `smoke-vite` para 3000 y `api-safe-vercel` para Vercel Dev en puerto dedicado.

### Autenticacion segura

* Preferir una cuenta Google de pruebas con acceso estrictamente de lectura al entorno que se vaya a probar; no reutilizar una sesion personal sin consentimiento.
* El primer login Google debe ser manual y supervisado. Guardar `storageState` solo si se aprueba expresamente, fuera de Git y fuera de artefactos publicos.
* No automatizar contrasena, MFA ni aprobaciones de Google. Si hay popup, redirect o MFA, la prueba debe pausar y requerir intervencion humana o marcarse como omitida.
* GitHub Actions no debe ejecutar login Google interactivo. Los smoke no autenticados pueden correr alli; los autenticados requieren un mecanismo de cuenta de pruebas aprobado y secretos gestionados por CI.

### Barreras contra escrituras

* Mantener una allowlist inicial: solo carga de UI, navegacion y, si se aprueba, GET `/api/fx/live` y GET `/api/fx/closure` en Vercel Dev.
* Bloquear en Playwright todo `POST`, `PUT`, `PATCH` y `DELETE` a `/api/*`; fallar tambien ante rutas de publicacion, cierre, Fintoc, historicos y sincronizacion.
* No pulsar controles de guardar, cerrar, publicar, sincronizar, eliminar, backup, undo ni configuracion.
* Ejecutar primero con captura de consola, trace, video y screenshot al fallar; no reintentar una accion que pueda mutar.

### Primer conjunto seguro de pruebas

1. Carga del login de Aurum sin `auth/invalid-api-key`.
2. Restauracion de una sesion de pruebas aprobada, si existe `storageState` autorizado.
3. Carga del dashboard y presencia de datos principales, solo lectura.
4. Ausencia de errores criticos de consola y de carga indefinida.
5. Navegacion entre Dashboard, Patrimonio, Analisis y Settings sin guardar cambios.
6. En Vercel Dev, comprobacion de endpoints GET permitidos exclusivamente despues de aprobarlos; inicialmente basta el chequeo de metodo 405 para validar el routing sin ejecutar negocio.

Quedan expresamente excluidos: creacion o edicion de patrimonio, cierres, publicacion MIDAS/Data Room, sincronizacion, borrados, cambios de configuracion, aperturas temporales y operaciones financieras.

## 8. Cambios de Git y pasos pendientes

Vercel CLI anadio inicialmente estas dos lineas a `.gitignore`:

```diff
+.vercel
+.env*
```

La revision previa al commit mantuvo `.vercel`, porque evita versionar el mapa local del proyecto. Se retiro `.env*`: era redundante con las reglas existentes `.env` y `.env.*` y podia ocultar futuras plantillas convencionales. Se agregaron las excepciones `!.env.example` y `!.env.template` para que dichas plantillas puedan versionarse; los archivos locales con secretos, incluido `apps/aurum/.env.local`, permanecen ignorados.

Archivos que no se modificaron ni eliminaron:

```text
.firebaserc
AURUM_AUDITORIA_CALCULOS_FINANCIEROS.md
AURUM_DIAGNOSTICO_GARANTIA.md
```

Estado Git al cierre de esta auditoria:

```text
 M .gitignore
?? .firebaserc
?? AURUM_AUDITORIA_CALCULOS_FINANCIEROS.md
?? AURUM_DIAGNOSTICO_GARANTIA.md
?? apps/aurum/LOCAL_ENVIRONMENT_AUDIT.md
```

No hay archivos staged, no se hizo commit y no se realizo deploy.
