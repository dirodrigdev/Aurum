# Aurum → MIDAS: publicación e identidad económica

Base de comparación: `cc6bb8a28780fe47f0e3e95f3cf4504218e30503`.
Alcance: publicación del último cierre confirmado y aplicación de sus inputs efectivos en M8. No se recupera el paquete local de octubre.

## Cambios

- La API autentica con Firebase y vincula la publicación global a su propietario persistido. El arranque sin propietario requiere el administrador ya existente y correo verificado; no se introducen permisos en el navegador.
- Una transacción lee la publicación y el documento de patrimonio de la sesión. Valida el último cierre persistido, sus importes, bloques y FX. No ordena por fechas enviadas por el navegador. Rechaza solicitudes anteriores del mismo mes, retrocesos de mes, downgrades V2→V1, ambigüedades y cierres retirados. Un último cierre inválido no permite usar otro anterior.
- Una publicación idéntica no escribe. Los relojes técnicos proceden de la fuente persistida. Los nuevos hashes son trazabilidad opcional, no requisitos para leer objetos históricos.
- La firma de MIDAS representa capital financiero efectivo, propiedad, deuda hipotecaria, UF, riesgo y FX operativo. Las etiquetas, procedencia y gasto histórico no fuerzan recalcular. Cambios compensados entre bancos e inversiones tampoco cambian el input del motor.
- Aplicar una base conserva parámetros de escenario, overrides válidos, deltas manuales y eventos futuros sin descontarlos o sumarlos dos veces. Se comparan los inputs reales del motor antes de recalcular.

## Línea base y bloqueos de validación

Se ejecutaron las suites publicadas sin modificar su código y el candidato en el mismo entorno (Node 22, Java 21, dependencias físicas y emuladores locales). La línea base presentó 19 fallos unitarios y 9 E2E; los mismos 19 y 9 aparecieron inicialmente en el candidato. Un timeout móvil adicional no se reprodujo en la repetición aislada de escritorio/móvil.

| Grupo | Causa y corrección limitada |
|---|---|
| 8 unitarios FX | Esperaban el gate de procedencia eliminado expresamente en `e834a3b` (6 de octubre). Los tests verifican las tasas históricas guardadas; se conservan los rechazos de tasas numéricas inválidas. No se cambia la lógica FX. |
| 2 unitarios de atribución | Esperaban matching por producto anterior a `3f21900` (6 de octubre). Se comprueba la atribución agregada publicada y su calidad indicativa cuando falta confirmar movimientos. |
| 9 unitarios de interfaz/fixtures | Selectores y textos antiguos, fixture sin consumo oficial de GastApp y mock de portapapeles reemplazado por el setup de user-event. Se mantienen verificaciones de persistencia, errores y confirmaciones. |
| 2 E2E de textos | Botones y marca cambiaron. Se mantienen resultados económicos y verificaciones de flujo. |
| 1 E2E accesibilidad | El selector de moneda tenía 42 px; se ajusta a los 44 px que exige la comprobación existente. |
| 5 E2E contaminados | La página del sidecar seguía sincronizando al restaurar la fixture. Se cierra antes de restaurarla. El cierre de cliente aislado pasó tanto en main como en candidato. |
| E2E de revisión y reconocimiento | El contrato demo `e2e_fixture` queda excluido correctamente de revisiones automáticas. El test suministra solo para julio un contrato certificado sintético de revisión 2. Se detectó además una carrera: tras guardar el reconocimiento, una lectura de servidor podía reutilizar otra lectura iniciada antes de la transacción y reabrir el mismo aviso. La interfaz ahora deriva la bandeja del estado devuelto por la transacción y los cierres actuales; una revisión más nueva continúa visible. |

No se desactivan tests ni se suavizan aserciones. Se asignaron límites de 60 segundos solo a los seis escenarios E2E que completan el recorrido de cierre y propagación; la suite conserva el límite general de 30 segundos y sus comprobaciones financieras. La espera puntual por el resumen de cierre usa 10 segundos. La guardia de red permanece activa. Las fuentes locales existentes resuelven Google Fonts sin acceso externo.

Se ejecutó también `wealth-flow.integration.test.ts`, una suite histórica adicional fuera de la puerta oficial: 9 de sus 10 casos fallan antes de cada test al llamar `clearWealthDataForFreshStart`, porque el mock del propio archivo devuelve `getCurrentUid() === null`. Los nueve fallos se reprodujeron con el mismo comando en `cc6bb8a`, sin emulador; esa suite y la rutina de limpieza no se modifican ni son parte de los bloques Aurum→MIDAS. Se deja documentado como deuda de test preexistente, sin alterar el flujo patrimonial para acomodarla.

## Decisión funcional de rentabilidad

Con flujos externos completos y saldos comparables, no confirmar movimientos internos mantiene el porcentaje visible como **INDICATIVA**, con explicación de movimientos y atribuciones pendientes, sin presentarlo como reconstruido o certificado. Los flujos incompletos, saldos no comparables y errores que invalidan el cálculo conservan el porcentaje pendiente. Solo cambia la presentación y sus pruebas; `financialPerformance.ts` permanece intacto.

## Validación reproducible

Desde la raíz, ejecutar secuencialmente:

```sh
npm run test:aurum
npm run test:aurum:integration # exclusivamente dentro de Auth/Firestore Emulator locales
npm -w apps/midas run test:critical
npm run test:midas:publication:emulator
npm run build:aurum
npm -w apps/midas run build
npm run test:e2e:aurum:authenticated
npm run test:e2e:midas:authenticated
```

Los emuladores usan `aurum-e2e-local` y `midas-e2e-local`. La prueba de API importa la función real con Node ESM y usa transacciones Firestore reales: propietario, 401, 403, concurrencia, rechazo obsoleto y updateTime sin cambios en reintentos idénticos. El E2E de MIDAS comprueba llegada de la publicación, cambios compensados/procedencia sin recálculo, cambio de propiedad detectado y horizonte manual conservado.

Capturas temporales: rentabilidad indicativa, selector de moneda y aplicación de base en escritorio, tablet y móvil. Los artefactos, credenciales, sesiones y datos productivos quedan fuera de Git.

Resultados finales de los controles obligatorios: 646 unitarios aprobados (10 dependientes de cloud omitidos por el comando unitario), 10 pruebas de Rules en emulador, 31 E2E Aurum y 5 E2E MIDAS aprobados, suite crítica M8 aprobada, seis pruebas del endpoint Node ESM/transacciones aprobadas y ambos builds TypeScript/Vite aprobados. Tras el cambio final de reconocimiento, el E2E certificado de Aurum volvió a pasar aislado. Las tasas numéricas inválidas, errores de lectura, concurrencia, cierres no comparables y el cierre del aviso después de reconocerlo se siguen comprobando.

## Límites y publicación segura

No se modifican fórmulas M8, cálculo de rentabilidad, patrimonio histórico, registros financieros, tipos de cambio, reglas Firestore ni contratos de forma incompatible. No se incorporan retornos históricos a MIDAS.

La verificación productiva es no destructiva: comprobar SHA exacto y READY de ambos proyectos, HTML/assets y rechazo controlado de la API sin sesión; comparar la publicación existente con su fuente mediante lectura puntual. El flujo de escritura y preservación de escenarios se verifica con datos sintéticos en emuladores, no creando cambios financieros reales.

Si la publicación introduce un error crítico, restaurar ambos despliegues productivos anteriores; no revertir ni reconstruir datos de Firestore. Antes de ordenar el checkout original se conservan íntegros sus 42 archivos, hashes, parches y referencias en un único resguardo externo verificado; solo después puede hacerse fast-forward.
