# MIDAS Confidence V2

## Problema

MIDAS podía mostrar un número principal con apariencia oficial aunque alguna fuente crítica viniera de fallback, localStorage, resultado provisional o una corrida sin comprobante auditable. Esta rama agrega una capa de confianza alrededor del motor M8 para responder si el resultado es canónico, usable con salvedades o no decisional.

## Result Digest

`simulationResultDigest` es el comprobante estable del resultado renderizado. Se calcula fuera del motor y hashea con SHA-256 solo el resumen decisional:

- `success40`
- `ruin40`
- `houseSalePct`
- `maxDrawdownP50`
- `resultSeed`
- `resultNSim`
- `resultInputHash`

No incluye timestamps, warnings, auth, cloud diagnostics, textos visuales ni datos de UI. Si falta una métrica crítica, el digest queda `null` y el resultado no puede ser decisional.

## Result Confidence

`resultConfidence` es la fuente única para `OK`, `Revisar` y `No usar`. Consume fuentes críticas, diagnóstico de corrida y digest final. La UI no debe recalcular ese estado por su cuenta.

Estados:

- `canonical / OK`: resultado canónico para decisión.
- `review / Revisar`: resultado final usable, pero con salvedades.
- `not_decisional / No usar`: resultado incompleto, provisional, sin digest o con fuente crítica faltante/error.

## Fuentes Críticas

- Aurum snapshot.
- Configuración M8.
- Instrument Universe.
- FX aplicado.
- Ajustes de capital.
- Resultado de corrida.
- Sandbox/assumptions.

## Reglas OK/Revisar/No Usar

- Fallback nunca da OK pleno.
- LocalStorage nunca es fuente oficial.
- Sandbox nunca da OK canónico.
- Resultado sin `resultDigest` es `No usar`.
- Resultado que no coincide con `effectiveEngineInputHash` es `No usar`.
- Corrida no completada es `No usar`.
- `Instrument Universe = bundled` puede calcular, pero el máximo estado es `Revisar`.
- Ajuste local de capital puede calcular, pero el máximo estado es `Revisar`.
- Solo fuentes críticas canónicas + digest final válido pueden dar `OK`.

## Implementado

- Helper `simulationResultDigest.ts`.
- Tests fixture-only para digest, sin llamar al motor M8.
- Helper `resultConfidence.ts`.
- Tests de reglas OK/Revisar/No usar.
- Helper `assumptionMode.ts`.
- JSON copiable con `simulationResultDiagnostics`, `resultConfidence` y `assumptionModeDiagnostics`.
- Badge/hero/card de estado conectados a `resultConfidence`.

## Cómo Probar Manualmente

1. Abrir MIDAS en Chrome escritorio.
2. Esperar a que la simulación llegue a resultado visible.
3. Usar “Copiar input M8 aplicado”.
4. Verificar:
   - `effectiveEngineInputHash`.
   - `simulationRunDiagnostics.lastRunInputHash`.
   - `simulationRunDiagnostics.lastRenderedResultHash`.
   - `simulationResultDiagnostics.resultDigest`.
   - `simulationResultDiagnostics.isFinalForCurrentInput`.
   - `resultConfidence.status`.
   - `resultConfidence.label`.
   - `assumptionModeDiagnostics`.

## Comandos

Desde `apps/midas`:

```bash
npx tsx src/domain/model/simulationResultDigest.test.ts
npx tsx src/domain/model/resultConfidence.test.ts
npx tsx src/domain/model/assumptionMode.test.ts
npx tsx src/domain/model/m8InputFingerprint.test.ts
npx tsx src/domain/model/simulationRunGate.test.ts
npm run test:motor
npm run build
```

## Qué No Se Tocó

- `engineM8.ts`.
- Fórmulas económicas.
- Monte Carlo económico.
- Cholesky, fat tails, mean reversion, crisis clustering y generación de shocks.
- Defaults económicos.
- Auth.
- Firestore rules/config.
- Aurum.
- GastApp.
- Instrument Universe económico.
- FX económico.
- Rediseño visual grande.

## Pendientes y límites conocidos

- `Instrument Universe = bundled` sigue siendo fallback canónico de app, no cloud; por diseño queda en `Revisar`, no `OK`.
- `structuralAssumptionsSource` queda `not_implemented`; no se inventó persistencia cloud para assumptions.
- `sandboxActive` queda `false` por defecto; esta rama no implementa UX completa de sandbox.
- Escenarios guardados como overlays no quedan implementados.
- `previousResultDigest` y `previousResultInputHash` existen en el contrato, pero todavía se reportan como `null`.
- La app mantiene `buildSimulationActionStatus(...)` para compatibilidad interna, pero el estado visual superior ya consume `resultConfidence`.
