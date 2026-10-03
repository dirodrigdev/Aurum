# Preflight de septiembre: respuestas obsoletas y comparación entre meses

## Alcance y evidencia

Revisión del informe de preflight `2026-09` aportado por el usuario el 3 de octubre. Clasificación **Historical**: cada cierre conserva sus registros, tasas y snapshot mensual. Este cambio sólo corrige la lectura y el diagnóstico previo; no reconstruye historia ni modifica Firestore real.

El informe aportado identifica un contrato GastApp parcial y bloqueos de antigüedad/arrastre en inversiones y capital de riesgo. El usuario actualizará esos valores. Los demás controles contables, de identidad del mes, FX, deuda y propiedad aparecen `ok` en ese informe; eso describe esa simulación, no acredita un cierre guardado.

## Defectos demostrados antes de corregir

1. **Respuesta GastApp obsoleta:** una lectura iniciada antes del refresh podía terminar después y reemplazar el contrato recién leído. Dos pruebas fallaron antes de la corrección: un resultado antiguo `pending` reemplazaba el nuevo `complete`; un error antiguo convertía la lectura nueva en indisponible. Ahora una generación invalida las respuestas y errores anteriores, sin borrar la promesa de una lectura posterior.
2. **Frescura de otro mes:** el preflight calculaba la frescura con todos los registros mientras el cierre utilizaba sólo el mes candidato. La prueba previa falló con septiembre `16.497.820 CLP` y octubre `31.539.950 CLP`, reproduciendo la diferencia `15.042.130 CLP` del informe. Ahora ambas comparaciones usan los registros del mes candidato.

La reproducción es sintética. No demuestra que una respuesta fuera de orden haya causado el bloqueo real de GastApp, ni acredita qué registro real originó la diferencia de Tenencia.

## Archivos del arreglo

- `apps/aurum/src/services/gastosMonthly.ts`: descartar lecturas obsoletas.
- `apps/aurum/src/services/monthlyClosePreflight.ts`: limitar frescura e identidad de sus registros al mes candidato.
- `apps/aurum/tests/gastos-monthly.test.ts`: carreras antiguo parcial/error frente a nuevo completo y antiguo completo frente a nuevo parcial. Este último conserva el NO-GO legítimo.
- `apps/aurum/tests/monthly-close-preflight.test.ts`: septiembre/octubre con importes distintos, sin mutar entradas.
- `apps/aurum/e2e-auth/zz-closure-audit.authenticated.spec.ts`: recorrido del preflight de septiembre con octubre distinto, Firestore después de simular, consola/red y capturas en tres anchos. Reutiliza el fixture del recorrido de cierre ya existente.

No cambia el esquema compartido GastApp→Aurum, la publicación Aurum→MIDAS, las reglas, el arnés ni el productor de GastApp. No requiere repetir MIDAS ni GastApp para este arreglo del consumidor.

## Verificación

- Unitarias dirigidas: **34/34** (18 preflight, 12 gastos mensuales, 4 aceptación de revisión).
- Prueba autenticada dirigida de frescura: **1/1**, `aurum-e2e-local`, usuario sintético `aurum-e2e-user`, reloj fijo y referencias deterministas. Importes de septiembre/octubre conservados; la simulación no guarda un cierre de septiembre.
- Build de Aurum y lint: aprobados.
- Revisión visual del preflight: escritorio `1280×800`, tablet `768×1024`, móvil `390×844`; checks y advertencias legibles, sin desbordamiento de página. Capturas temporales `september-freshness-{desktop,tablet,mobile}.png`, sin datos reales y fuera del commit.
- Se creó un checkout aislado sobre `7afb633` para excluir cambios concurrentes de otro trabajo.
- Primer fallo del E2E aislado: las fuentes enlazadas fuera del checkout recibieron un rechazo del servidor Vite (`outside of Vite serving allow list`, HTTP 403). Se detuvo la ejecución y se copiaron únicamente las fuentes al entorno aislado, sin relajar consola, red ni permisos del servidor. Quedaron 5 pruebas aprobadas y 20 pendientes/fallidas/interrumpidas para reintento.
- Primer intento de ese reintento: `/bin/sh: playwright: command not found`, código 127, por ejecutar el arnés fuera del PATH de npm. Se corrigió sólo la configuración temporal para invocar el ejecutable local con Node.
- Reintento final: **20/20 aprobadas en 1,4 minutos**. Con las 5 aprobadas del primer intento, los 25 casos de la suite quedaron cubiertos; no se repitieron esas 5 pruebas. Se conserva la distinción entre el fallo inicial del entorno y el resultado del reintento, sin presentarlos como una única ejecución limpia.
- Build del checkout aislado (`7afb633` más los cinco archivos del arreglo): aprobado. Se comprobó que esos cinco archivos coinciden byte a byte con los que se incluirán en el commit; los cambios concurrentes de Análisis quedan excluidos.
- Teardown confirmado: cierre del arnés y ausencia de listeners en `3000`, `9099`, `8080`, `9150`, `4400`, `4500`; sin procesos Firebase Emulator, Vite E2E ni Playwright autenticado residuales. Capturas del checkout aislado revisadas y conservadas temporalmente en `.playwright/aurum-visual-audit/september-preflight-2026-10-03/`.

## Límite sobre septiembre real y comprobación manual

La lectura de producción facilitada desde el chat GastApp fue denegada (`Permission 'mcp.googleapis.com/tools.call' denied`). No se buscó otra vía. El informe del usuario muestra que Aurum leyó un avance parcial; no permite declarar que la publicación real actual esté cerrada y certificada.

Después del despliegue: recargar Aurum, seleccionar septiembre y ejecutar un nuevo preflight. La comparación de frescura debe usar septiembre. Si GastApp sigue pendiente con esta lectura nueva, comprobar en GastApp el **cierre calendario oficial de septiembre completo y certificado**, su cobertura del 1 al 30 y su publicación vigente para Aurum. Tener gastos cargados o un avance publicado no satisface ese requisito. No forzar GO, cambiar hashes ni fabricar la certificación.

La disponibilidad del contrato real sigue sin verificar hasta recibir evidencia de esa publicación o un preflight actualizado. Las pruebas sintéticas no prueban la conciliación real ni garantizan un cierre perfecto.
