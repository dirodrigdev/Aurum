# Auditoría del cierre de Aurum

Fecha: 2026-10-02. Clasificación: **Historical**. Para una revisión independiente, usar GPT-6 Luna con razonamiento **máximo (`max`)**. No se envió ningún mensaje a otra tarea.

## Hallazgos confirmados y correcciones

1. **El preview de reemplazo no mostraba lo que se guardaba.** La prueba reproducía bancos por 37.862.879 CLP en pantalla y 50.000.000 CLP en el cierre guardado. `Patrimonio.tsx` ahora calcula el preview del reemplazo a partir de los registros canónicos que el siguiente cierre persistirá.
2. **Un reemplazo fallido podía cambiar el respaldo de deshacer.** La prueba rechazó el guardado patrimonial y confirmó que el respaldo anterior se reemplazaba. `wealthStorage.ts` ahora conserva el checkpoint previo y solo revierte el creado por ese intento; respeta un checkpoint concurrente.
3. **El total de deuda podía inflarse al guardar.** Una reproducción aislada mostró 5.000.000 CLP en el preview y 6.000.000 CLP en Firestore. `Patrimonio.tsx` bloquea el cierre si el almacenamiento de varias deudas difiere del preview y no inventa cómo repartir un total entre partidas.
4. **Hubo fallos reales e intermitentes de persistencia.** En dos recorridos el modal informó que el cierre no se guardó y Firestore conservó la versión semilla. La ruta de sync puede rechazar una instantánea local obsoleta mientras deja un envío posterior en cola; `syncWealthNow` ahora drena esos envíos también cuando el primer intento devuelve error. El vínculo exacto entre cada fallo y esa carrera no quedó registrado en la ejecución fallida, así que la causa concreta se considera probable; la suite posterior pasó completa.
5. **El control flotante tapaba el diálogo de cierre.** `WealthDeltaToast.tsx` queda detrás del modal de confirmación y del resumen.
6. **El botón de confirmación recortaba su texto en móvil.** `CloseConfirmModal.tsx` permite que el botón crezca según el texto; la prueba verifica que la etiqueta no quede recortada.

## Comprobación cara al cliente

La prueba autenticada `customer close matches preview, survives reload and advances` ejecuta el flujo en escritorio (1280×800), tablet (768×1024) y móvil (390×844). Compara los importes y FX del preview con Firestore, cierra el mes, muestra el resumen, avanza al siguiente mes, recarga la página y confirma que el cierre conserva su identidad y sus valores. También verifica consola, tráfico externo y overflow horizontal. La deuda con caché vieja se bloquea sin cambiar los datos en nube.

Se inspeccionaron capturas E2E de preview, confirmación y resultado en los tres tamaños, más los botones inferiores del resumen móvil. El botón móvil ya no se recorta; el modal de cierre desplaza su contenido en móvil; el aviso flotante queda detrás del resumen.

## Validaciones ejecutadas

- `npm run test:aurum`: 530 aprobados, 10 omitidos y 1 archivo de integración omitido.
- `npm -w apps/aurum run test -- tests/closure-undo.test.ts`: 46 aprobados.
- `npm -w apps/aurum run lint:tests`: aprobado.
- `npm run build:aurum`: aprobado. Mostró advertencias existentes de chunks/importaciones y Browserslist.
- `npm run test:e2e:aurum:authenticated`: **17/17 aprobados** en la ejecución final.
- `npm run build --workspace apps/midas`: aprobado.
- `npm run test:e2e:midas:authenticated`: **4/4 aprobados**, incluyó verificación de reconciliación.

Los E2E usaron únicamente Firebase Emulator, el proyecto ficticio `aurum-e2e-local` con el usuario `aurum-e2e-user`, y para MIDAS `midas-e2e-local` / `midas-e2e-user`. Ambos arneses informaron apagado de Auth, Firestore, Hub y Logging; Vite se cerró con Playwright. No hubo tráfico a producción ni se cambiaron Rules.

## Instrucciones si Luna hace una revisión independiente

Revisar el diff y este informe, centrándose en que el preview y el cierre usen la misma fuente canónica, que el rollback no sobrescriba un checkpoint concurrente y que el sync espere la escritura pendiente antes de afirmar éxito. Repetir solo las comprobaciones que el diff o una duda concreta justifiquen; no reabrir GastApp ni modificar el arnés. No incluir `docs/AURUM_INTERACTION_AUDIT_FOR_ASTRA_2026-09-28.md`, que es ajeno a este trabajo.
