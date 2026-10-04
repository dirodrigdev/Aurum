# Cierre de hardening de integridad — 2026-10-04

## Propósito

Este documento registra el cierre formal del hardening de Aurum relacionado con sincronización patrimonial, revisiones GastApp, historial de cierres y Monthly Close.

**Código certificado antes de estos commits documentales:** `7bf310e7a8670eaf5964e347c28220d1b012c27c`.

Las modificaciones posteriores que sólo añadan o actualicen documentación no cambian esa certificación funcional.

Antes de modificar wealth sync, Monthly Close, revisiones GastApp, previousVersions, FX histórico o contratos GastApp → Aurum, leer este documento.

No reabrir este hardening sin evidencia nueva y concreta.

## Hallazgos cerrados

- **AUD-03** — Wealth sync: el general sync ya no puede sobrescribir una revisión GastApp recién aceptada; lectura/merge/escritura están protegidas transaccionalmente.
- **AUD-04** — previousVersions: el predecessor inmediato tiene slot reservado y no puede perderse por ordenación/truncado; límite histórico conservado en 36.
- **H07 / protección heredada de AUD-02** — Una publicación Spark stale no puede pisar un Full/pointer más nuevo; los guards de base invalidan el plan viejo.
- **Monthly Close** — El readback de confirmación cloud usa lectura transaccional y evita falsos fallos por lectura stale. La comparación financiera completa sigue intacta.

## Invariantes que no deben relajarse

1. General wealth sync no puede sobrescribir una revisión GastApp aceptada con estado local obsoleto.
2. El predecessor inmediato de un cierre debe conservarse siempre en `previousVersions`.
3. El histórico mantiene su límite sin sacrificar el predecessor directo.
4. Un cierre mensual sólo se considera confirmado cuando la nube contiene el cierre exacto bajo el contrato vigente.
5. La confirmación no puede volver a depender de una lectura stale del listener/cache.
6. No relajar la comparación de `id`, `monthKey`, `closedAt`, FX, metadata FX, `fxMissing`, snapshot GastApp, records o summary sin nueva decisión de producto explícita.
7. No recalcular wealth/FX histórico usando estado actual.
8. No confundir período contable día 11 con mes calendario.
9. “OK, leído” sólo reconoce; no autoriza ni ejecuta mutaciones.
10. Una revisión GastApp incompleta/no certificada no sustituye el cierre certificado activo.
11. Las correcciones de GastApp se originan en GastApp; Aurum no debe introducir controles para borrar/ignorar esas correcciones.

## Validación final

Auditoría final de integración realizada sobre los `main` certificados:

- Regresiones focalizadas Aurum: **126 PASS**.
- Typecheck/build Aurum: **PASS**.
- Lint Aurum: **PASS**.
- E2E autenticado Aurum: **28 PASS / 0 FAIL**.
- E2E MIDAS consumidor: **4 PASS / 0 FAIL**.
- ProjectIds de prueba: `aurum-e2e-local` y `midas-e2e-local`.
- Sin tráfico financiero de producción.
- Teardown de Emulator/Vite/Playwright confirmado.

La auditoría final no detectó regresiones entre los fixes cerrados.

## PR y commits principales del cierre

- PR #6 — AUD-03.
- PR #7 — AUD-04.
- PR #8 — Monthly Close cloud confirmation.

El comportamiento de revisiones GastApp ya estaba integrado en `main` antes de este cierre y fue verificado en la auditoría final.

## Estado Git/GitHub certificado al cierre

- Rama remota permanente: **`main` solamente**.
- PR abiertos: **0**.
- Ramas antiguas de fix/UX eliminadas.
- No quedaron ramas remotas paralelas de trabajo.
- Checkouts protegidos quedaron intactos.

### Regla permanente

Estado esperado entre tareas:

- `main` como única rama remota permanente.
- 0 PR abiertos.
- Una tarea → una rama temporal → PR → merge → borrar rama local/remota → verificar `main` → siguiente tarea.
- No usar worktrees para implementaciones paralelas.
- No iniciar una segunda implementación Aurum antes de cerrar completamente la anterior.

## Deuda técnica explícitamente excluida

- Suite legacy `wealth-flow.integration.test.ts`: **9 fallos + 1 skip** que reproducen exactamente el baseline preexistente.
- Error baseline asociado: “No se pudo limpiar en la nube. Mantuve los datos locales intactos.”
- Esta deuda no forma parte de los hallazgos de integridad financiera cerrados en esta auditoría.

## Criterio de reapertura

Reabrir este hardening únicamente si aparece evidencia concreta: fallo reproducible, regresión de test, inconsistencia de producción o cambio funcional deliberado que afecte alguno de los invariantes anteriores.

No repetir una auditoría profunda por rutina.
