# Preparación del cierre de septiembre de Aurum — 2026-10-03

## Conclusión y alcance

El flujo de código revisado supera las comprobaciones funcionales y visuales descritas abajo. No quedan defectos demostrados de esta revisión pendientes de corrección. Esto no certifica los datos reales de septiembre ni permite afirmar una probabilidad del 100%.

Clasificación **Historical** para los cierres y sus gastos aceptados: cada mes conserva registros, identidad y tasas propios. Una revisión de GastApp actualiza únicamente su snapshot de gasto tras una aceptación explícita, conserva la versión anterior y recalcula los consumidores. El mes abierto usa una foto **Snapshot** provisional, identificada como P y excluida de los agregados oficiales.

Se conservaron las correcciones anteriores, incluido `111c192`, antecesor comprobado de la base actual `ad8bc68`. No se modificaron datos reales, reglas de Firebase, adaptadores externos ni contratos publicados Aurum→MIDAS. No se ejecutó E2E contra producción.

## Defectos reproducidos y corrección mínima

| Hallazgo confirmado con datos sintéticos | Corrección y evidencia |
| --- | --- |
| El constructor real del mes abierto perdía el gasto parcial cuando GastApp aún no estaba certificado. | Marcador provisional explícito; Análisis y Wealth Lab conservan el parcial, sin convertirlo en gasto oficial. Caso de 2.500 EUR, probado mediante el constructor real. |
| Análisis podía reutilizar el gasto antiguo aunque se hubiera aceptado una revisión y el patrimonio y las tasas fueran iguales. | La clave de caché incluye el snapshot GastApp aceptado. Una pestaña ya abierta recibe el cambio de 2.000 a 2.715 EUR. |
| El preflight podía mostrar GO ante una revisión GastApp que el cierre definitivo bloqueaba. | La revisión pendiente produce NO_GO y explica cómo comparar y aceptar su impacto. El caso sin revisión conserva GO. |
| La etiqueta y ciertas comprobaciones del preflight podían usar el mes sugerido en vez del mes económico seleccionado. | El mes seleccionado determina el diagnóstico y el informe. Septiembre se comprueba con fecha económica 30-09, aunque el navegador esté en octubre. |
| Una sincronización podía revertir la revisión aceptada con contador y reloj empatados; también duplicaba una versión ya archivada. | La relación explícita con el predecesor archivado decide qué versión conservar. No se vuelve a archivar una copia ya existente; cuatro regresiones cubren ambas preferencias de sincronización. No se limpian archivos históricos existentes. |
| Abrir Análisis ejecutaba una reparación automática de UF histórica. La prueba detectó tasas y auditorías históricas modificadas en el emulador. | Se retiró esa ejecución al abrir la pantalla. La función de reparación explícita se conserva. La prueba compara los 38 cierres completos antes y después de navegar a Análisis. |
| Avisos podía describir el gasto actual como si estuviera confirmado en cierres sin snapshot, y el estado se cortaba en móvil. | Textos distinguen gasto aceptado, falta de snapshot y parcial. El aviso admite varias líneas y explica que no se reconstruye historia automáticamente. |

También se reforzó la aceptación de una revisión: tras refrescar GastApp vuelve a comprobar el cierre base y exige la misma versión que el cliente comparó. Pruebas dirigidas rechazan una nueva versión certificada publicada durante el refresco, un cierre base cambiado, una lectura fallida y una versión sin certificar. El reintento revisado acepta solo la versión correcta.

## Comprobaciones realizadas

Entorno: Firebase Emulator, proyecto ficticio `aurum-e2e-local`, usuario sintético `aurum-e2e-user`, reloj del navegador controlado y tasas deterministas. Todos los cierres de julio, agosto y septiembre utilizados aquí son sintéticos; no son cierres de producción.

| Control | Resultado |
| --- | --- |
| `npm run build:aurum` | Aprobado: TypeScript y build de producción. |
| `npm run test:e2e:aurum:authenticated` | **24/24 aprobados**, ejecución secuencial con un worker; controles de consola y red conservados. |
| Pruebas unitarias relevantes | **148 aprobadas** en ocho archivos, ejecutadas de forma dirigida durante las correcciones. |
| `npm -w apps/aurum run lint:tests` | Aprobado. |
| ESLint de todos los archivos fuente modificados | Aprobado sin warnings. |
| `git diff --check` | Aprobado. |

Desglose unitario: `returns-analysis.test.ts` (35), `analysis-session-cache.test.ts` (5), `monthly-close-preflight.test.ts` (17), `accept-reviewed-gastapp-revision.test.ts` (4), `gastos-monthly.test.ts` (9), `wealth-lab.test.ts` (16), `wealth-storage-closures-merge.test.ts` (14), `closure-undo.test.ts` (48).

La suite autenticada demuestra:

- Cierre sintético de septiembre con navegador en octubre: preview y cierre guardado coinciden; snapshot GastApp de septiembre de 2.805 EUR, equivalente a 2.950.860 CLP con EUR/CLP 1.052; tasas del 30-09; agosto conservado; septiembre único tras recargar; arrastre nativo a octubre sin amortización anticipada.
- Resumen, avance, «Recordarme después», reapertura y comienzo explícito del mes. Cancelar no actualiza tasas ni amortiza. Aceptar aplica una sola amortización: 3.000 UF → 2.990 UF. Doble clic, recarga y vuelta a entrar conservan una única operación.
- Fallo ficticio al guardar TC/UF: no aplica hipoteca; restauración y reintento seguros. Esta comprobación usa la frontera de persistencia real del flujo local, sin simular una consulta productiva de tasas.
- Bancos, USD manuales, inversiones, deuda no hipotecaria y propiedad conservan sus importes nativos salvo la amortización explícita prevista. Comparación posterior con Firestore Emulator y cierre anterior completo.
- Revisión GastApp: gasto mensual, acumulado y Wealth Lab cambian exactamente 715 × 1.052 CLP; Dashboard 12/36 meses y presentación consumen la misma versión, incluido tras recargar. Los registros, resumen patrimonial y tasas del cierre permanecen iguales.
- Cierres antiguos sin snapshot aceptado muestran gasto no disponible, quedan fuera de agregados oficiales y no toman el dato actual de GastApp. Abrir Análisis no dispara una reparación de UF.

La revisión cubre tanto comportamiento Historical como Snapshot provisional. MIDAS no se añadió: no cambió su contrato compartido ni el snapshot publicado; el smoke autenticado de Aurum conserva su comprobación existente de publicación.

Tras el build y la suite completos no cambió código de aplicación. Se completaron únicamente las capturas del caso de septiembre y su precondición de hidratación; el reintento dirigido de ese caso pasó. No se repitieron suites completas ya aprobadas para ajustes del test.

## Revisión visual y teardown

Vistas afectadas: preflight de septiembre y su snapshot GastApp; comparación/aceptación de revisión; Análisis con gasto revisado; aviso de cierre sin snapshot aceptado. Capturas temporales inspeccionadas en escritorio **1280×800**, tablet **768×1024** y móvil **390×844**. La suite conserva también las vistas de confirmación, resumen e inicio de mes.

Capturas: `september-preflight-*`, `september-gastapp-snapshot-*`, `gastapp-revision-accept-*`, `gastapp-revised-analysis-*`, `legacy-expense-warning-*`. Permanecen fuera de Git. Se corrigió el aviso móvil truncado. Los textos nuevos y el importe GastApp se leen sin overflow de la página. Las tablas mantienen su desplazamiento horizontal existente.

El aviso temporal de variación patrimonial no intercepta clics (`pointer-events-none`) y desaparece a los tres segundos. Para inspeccionar el importe se capturó el panel una vez desaparecido el aviso y centrado fuera de la navegación fija; no se alteró su diseño.

Se conservaron los primeros errores observados. La comparación inicial del histórico tropezó además con la ordenación y el enriquecimiento de los resúmenes durante la hidratación del fixture. Las pruebas ahora esperan explícitamente la igualdad entre la base normalizada local y Firestore antes de la acción, y comparan íntegramente los cierres por mes; no omiten campos financieros ni añaden esperas arbitrarias.

Teardown confirmado en los logs y con comprobaciones posteriores: sin procesos del entorno Firebase Emulator, Vite o Playwright de esta validación y sin listeners en 3000, 9099, 8080, 9150, 4400 ni 4500. Las dos pestañas se cierran antes de restaurar el fixture.

## Archivos del cambio

- UI: `apps/aurum/src/pages/Patrimonio.tsx`, `apps/aurum/src/pages/AnalysisAurum.tsx`, `apps/aurum/src/components/analysis/ReturnsTab.tsx`.
- Servicios: `acceptReviewedGastappRevision.ts`, `analysisSessionCache.ts`, `monthlyClosePreflight.ts`, `returnsAnalysis.ts`, `wealthLab.ts`, `wealthStorage.ts`, dentro de `apps/aurum/src/services`.
- Regresiones: `accept-reviewed-gastapp-revision.test.ts`, `analysis-session-cache.test.ts`, `gastos-monthly.test.ts`, `monthly-close-preflight.test.ts`, `returns-analysis.test.ts`, `wealth-lab.test.ts`, `wealth-storage-closures-merge.test.ts`, dentro de `apps/aurum/tests`.
- Recorrido autenticado: `apps/aurum/e2e-auth/zz-closure-audit.authenticated.spec.ts`.
- Este informe. Los documentos pendientes de otras tareas no forman parte del commit.

## Límite sobre producción y uso al cerrar

La lectura autorizada del contrato mensual real de GastApp en `duofin-c1894` fue denegada: `Permission 'mcp.googleapis.com/tools.call' denied on resource '//firestore.googleapis.com/mcp/projects/duofin-c1894' (or it may not exist).` No se buscó otra vía de acceso.

Por eso no se ha certificado el snapshot real de septiembre, sus importes, la frescura de todos los registros reales ni posibles efectos pasados de la reparación histórica retirada. No se puede concluir que los seis cierres reales anteriores estén correctos. No existe propuesta de modificación de datos reales en esta revisión.

Antes del cierre real: seleccionar **septiembre de 2026**, comprobar que el preflight muestra ese mismo mes, revisar el total GastApp certificado y las tasas del **30-09**, resolver cualquier NO_GO y confirmar solo los importes correctos. Tras cerrar, revisar el resumen de septiembre; el arrastre a octubre y su inicio explícito son pasos distintos. Estos controles del propio cierre no sustituyen la limitación de lectura productiva.

La publicación se verifica después del push contra el commit exacto y el alias de producción; su resultado se comunica en la respuesta final.
