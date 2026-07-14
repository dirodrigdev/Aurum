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

## Pruebas E2E no autenticadas

La primera fase E2E usa `@playwright/test` declarado en la raiz del monorepo y una configuracion aislada en `apps/aurum/playwright.config.ts`; no depende de la instalacion de MIDAS. Los comandos desde la raiz son `npm run test:e2e:aurum`, `npm run test:e2e:aurum:headed` y `npm run test:e2e:aurum:report`.

La configuracion inicia Vite automaticamente en `http://127.0.0.1:3000` o reutiliza el servidor existente. Usa Chromium, un worker, cero reintentos locales, capturas, video y trace solo si falla. Los artefactos quedan bajo `.playwright/aurum/`, fuera del watcher de Vite, y estan ignorados por Git, incluido un futuro directorio de estados autenticados.

El smoke no autenticado solo comprueba el login: respuesta de pagina, montaje React, marca Aurum, texto y boton de Google, ausencia de `auth/invalid-api-key`, de pantalla blanca, `pageerror`, `console.error` y solicitudes fallidas. No pulsa el boton de login ni accede a datos.

Registra metodo, origen y pathname de las solicitudes, sin capturar cabeceras, tokens ni cookies. Falla e interrumpe antes de red si una solicitud local bajo `/api/*` apunta a rutas claramente mutadoras (`publish`, `closure`, `sync`, `delete`, `rollback`, `apply`, `prepare`, `backup`, `undo`, Fintoc, admin e historicos) o si una ruta `/api/*` usa un metodo distinto de GET. No bloquea globalmente POST para no confundir trafico Firebase/Google con una escritura de negocio, ni clasifica los modulos fuente de Vite como rutas de negocio. Filtra solo dos advertencias conocidas y con patrones exactos: el aviso completo de Tailwind CDN y el refresco inicial `APP_BUILD` con `none -> <build>`.

Limitaciones: no automatiza Google, MFA, `storageState`, sesion autenticada, dashboard, Vercel Dev ni APIs. La siguiente fase recomendada es una cuenta Google de pruebas aprobada, una sesion manual supervisada y pruebas de solo lectura con barreras de red conservadas.

Validacion: Chromium de Playwright quedo instalado; `npm run build:aurum` y el smoke headless pasaron con Vite iniciado automaticamente por `webServer`. La variante headed tambien paso en este entorno. Se verificaron temporalmente tres fallos esperados y se retiraron las simulaciones: marca Aurum ausente, `pageerror` inyectado y un `POST` simulado hacia `/api/midas/publish-snapshot`, detectado por la barrera antes de llegar a red. El runner de Node puede avisar que `NO_COLOR` se ignora cuando `FORCE_COLOR` esta definido; es una condicion del entorno de terminal, no un warning de Aurum.

## Auditoría de preparación para pruebas autenticadas

### Veredicto

No es seguro ejecutar hoy un smoke autenticado contra producción, aunque no se pulse ningún control. La autenticación restaura correctamente la sesión, pero `AuthGate` llama siempre a `hydrateWealthFromCloudShared({ force: true })` y después instala un listener de Firestore. La hidratación puede escribir el patrimonio y el listener puede programar otra sincronización cuando el estado local y remoto no coinciden. Además, la hidratación publica automáticamente el snapshot Aurum hacia MIDAS aun cuando no haya diferencias que persistir.

### Mapa de escrituras Firebase y servicios

| Hallazgo | Destino | Activador | ¿Automático? | Riesgo E2E |
| --- | --- | --- | --- | --- |
| `syncWealthToCloudNow` / `setDoc` | `aurum_wealth/{uid}` | Cualquier mutación local confirmada, hidratación si el documento no existe o si la reconciliación detecta diferencia, listener si recibe diferencia | Sí, en esas condiciones de arranque | Crítico: fusiona estado local del perfil con producción y publica MIDAS después |
| `hydrateWealthFromCloud` | `aurum_wealth/{uid}` | Bootstrap de `AuthGate`, Patrimonio o Settings; foco/visibilidad en pantallas que rehidratan | Sí: si falta documento o `cloudNeedsUpdate` | Crítico: un perfil de navegador con datos residuales basta para disparar `scheduleWealthCloudSync` |
| `subscribeWealthCloud` / `onSnapshot` | `aurum_wealth/{uid}` | Después de hidratación autenticada | Sí: si el documento falta y hay datos locales, o si la fusión difiere del remoto | Crítico: listener de lectura puede terminar programando una escritura |
| `publishAurumOptimizableInvestmentsSnapshot` / `POST /api/midas/publish-snapshot` | `aurum_published/optimizableInvestments` vía Admin SDK | Cada hidratación que llega a documento existente y cada sincronización | Sí: la hidratación lo invoca sin condición de diferencia | Crítico: modifica el snapshot que consume MIDAS |
| `setDoc` de checkpoints | `aurum_wealth/{uid}/monthly_close_checkpoints/{key}` | Crear/cerrar mes y operaciones de checkpoint | No, requiere acción de cierre/undo | Alto; excluir por completo |
| `deleteDoc` de checkpoints y `setDoc` de auditoría de undo | Subcolecciones de checkpoints y `monthly_close_undo_audits` | Undo o rollback explícito | No | Alto; excluir |
| `setDoc` de backup y restauración | `aurum_wealth/{uid}/backups/{id}` y documento raíz | Crear/restaurar backup explícitamente | No | Alto; excluir |
| `deleteDoc` raíz | `aurum_wealth/{uid}` | Reset/fresh start explícito | No | Crítico; excluir |
| Reparaciones de cierres históricos | Documento raíz de `aurum_wealth/{uid}` mediante guardado y sync | Botones administrativos, salvo reparación UF conocida en Análisis | Sí al montar `/analysis`: `repairKnownHistoricalUfClpClosures()` escribe si halla candidatos | Crítico; no navegar a Análisis en ningún smoke autenticado actual |
| Backfill GastApp mensual | `aurum_monthly_from_periods_v1/{monthKey}` del proyecto GastApp | Acción administrativa explícita | No | Alto; excluir |
| Fintoc refresh/discover/webhook | `fintoc_refresh_intents/{id}` y proveedor Fintoc | Inicio de refresh o webhook | No desde el arranque | Crítico; excluir |
| Corrección histórica Admin | `aurum_wealth/{uid}`, backups, checkpoints y auditorías históricas | POST `prepare`, `apply` o `rollback` con confirmación | No | Crítico; excluir |

No se encontraron en código activo de Aurum `addDoc`, `updateDoc`, `writeBatch`, `arrayUnion`, `arrayRemove`, `increment`, uploads de Firebase Storage ni Functions callable. Las escrituras REST identificadas son las APIs propias anteriores; las llamadas `POST` de Firebase Auth no son por sí mismas una escritura de negocio.

### Llamadas automáticas y flujo posterior al login

1. `ensureAuthPersistence()` configura `browserLocalPersistence`; Firebase restaura la identidad mediante `onAuthStateChanged`.
2. Al aceptar un usuario Google no anónimo, `AuthGate` monta las rutas y ejecuta dos familias de efectos: consulta de FX en vivo y bootstrap de patrimonio.
3. La consulta FX hace `GET /api/fx/live` al montar y nuevamente en foco/visibilidad. Solo escribe snapshots de indicadores en `localStorage`; no persiste FX en Firestore salvo que se pulse `Reflejar cambios`.
4. El bootstrap hace `getDoc(aurum_wealth/{uid})`, fusiona estado local/remoto, actualiza almacenamiento local si corresponde y puede llamar `syncWealthToCloudNow`. Si el documento no existe, sincroniza inmediatamente.
5. Aun si no hay `cloudNeedsUpdate`, el bootstrap llama a `POST /api/midas/publish-snapshot`, cuyo servidor escribe el snapshot publicado de MIDAS.
6. Luego se crea `onSnapshot(aurum_wealth/{uid})`. Si la fusión producida por el listener difiere del remoto, programa `setDoc` con un temporizador corto.
7. La ruta inicial es Dashboard. Dashboard ejecuta `warmGastappMonthlyContable()`, que hace `getDocs` de `aurum_monthly_from_periods_v1`: es lectura. No monta Fintoc, Data Room v2, FX histórico ni APIs administrativas.
8. Navegar a Settings agrega hidrataciones por foco/visibilidad y lecturas de Data Room solo al abrir su sección Sync. Navegar a Patrimonio agrega otra hidratación. Navegar a Análisis es inseguro hoy porque ejecuta la reparación UF automática indicada arriba; sus cargas de GastApp son de lectura.

Por lo tanto, el primer punto que puede cambiar producción sin clic es el `useEffect` de bootstrap autenticado: si el documento de patrimonio no existe, primero hace `setDoc`; si existe, la hidratación publica MIDAS y, según estado local/remoto, puede programar después el `setDoc` de reconciliación. No es una inferencia de UI: ambas llamadas están en el flujo de código posterior a `onAuthStateChanged`.

### Límites de Playwright y estrategia

Bloquear globalmente `POST` no sirve: Firebase Auth y Firestore usan transporte no equivalente a una operación de negocio y se romperían lecturas válidas. Bloquear solo `/api/*` tampoco basta, porque `setDoc` y `onSnapshot` se comunican directamente con Firestore. No pulsar botones ni identificar controles visualmente no evita los efectos anteriores. Un interceptor puede abortar rutas propias conocidas, pero no prueba de manera fiable que el SDK Firestore no intentará una escritura sin también cortar sus lecturas.

| Opción | Esfuerzo | Seguridad | Fidelidad | Recomendación |
| --- | --- | --- | --- | --- |
| A. Cuenta Google read-only en producción | Medio | Media: detiene escrituras, pero genera `permission-denied` y no representa el flujo real | Media | No como primer smoke; útil solo tras modo read-only explícito |
| B. Firebase staging con cuenta de pruebas | Medio/alto | Alta para producción | Alta si replica reglas, datos sanitizados y APIs | Recomendado para E2E autenticado real |
| C. Firebase Emulator | Medio | Muy alta | Media: no cubre reglas/servicios productivos completos | Recomendado para pruebas de mutación y regresión |
| D. Sesión personal contra producción | Bajo | Inaceptable con el código actual | Máxima | No usar |
| E. Modo E2E read-only instrumentado | Medio | Alta si desactiva reconciliación, sync y publicación antes de crear clientes | Alta para UI de lectura | Necesario si se quiere probar producción visualmente |
| F. Staging + Emulator + modo read-only | Alto inicial, bajo mantenimiento posterior | Máxima | Alta | Estrategia recomendada |

La combinación recomendada es: Emulator para mutaciones, staging con cuenta de pruebas para el smoke autenticado normal y, solo si se necesita UI contra producción, un modo read-only de aplicación que prohíba antes de red `syncWealthToCloudNow`, `scheduleWealthCloudSync`, publicación MIDAS, reparaciones automáticas y acciones Fintoc. Este modo debe acompañarse de una identidad de producción con permisos estrictamente de lectura; no basta el flag del navegador.

### Persistencia y storageState propuesto

La aplicación usa explícitamente `browserLocalPersistence`, no persistencia de sesión ni memoria. La captura futura debe ser manual y supervisada en Chromium headed: el usuario inicia Google sin entregar contraseña a Codex, se confirma que se está en el entorno seguro aprobado y recién entonces se guarda el contexto con `context.storageState({ path: '.playwright/aurum/auth/aurum-test.json', indexedDB: true })`. Ese archivo debe crearse con permisos locales restrictivos, permanecer bajo el directorio ya ignorado por Git, validarse con `git check-ignore` y `git status`, y regenerarse al expirar o invalidarse eliminándolo localmente. No deben adjuntarse screenshots, traces ni reportes con saldos; los artefactos solo se retienen ante fallo y siguen ignorados.

### Condiciones previas y primer smoke autenticado propuesto

Antes de crear cualquier `storageState` se deben cumplir estas condiciones: elegir staging/emulator o implementar y revisar el modo read-only; disponer de cuenta Google de pruebas aprobada; verificar que el perfil de navegador no contiene datos locales que puedan fusionarse; y añadir una barrera explícita que rechace toda llamada de sincronización/publicación esperada. La acción manual necesaria hoy es aprobar esa arquitectura y proporcionar una cuenta de pruebas solo para el entorno aislado; no se debe capturar una sesión personal de producción.

El primer smoke futuro debe restaurar sesión, comprobar que desaparece el login, que Dashboard termina de cargar y que no hay errores críticos ni rutas mutadoras. Selectores seguros: `Dashboard`, `Patrimonio`, `Análisis`, `Configuración`, `Resumen`, `Evolución patrimonial` y `Cerrar sesión`; no usar importes, saldos, email, UID, periodos ni nombres de instrumentos. Debe quedarse en Dashboard, no pulsar controles, registrar solo método/origen/pathname, y desactivar screenshots/traces por defecto o guardarlos exclusivamente bajo la ruta local ignorada si falla.
