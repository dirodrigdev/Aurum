# MIDAS Fiduciary Validation Record

## Estado actual

MIDAS Simulacion es la unica superficie considerada decisional dentro de `apps/midas`.

- Motor M8 tecnicamente validado contra fixtures fiduciarios.
- Corrida productiva real `91,6%` validada contra golden canonical run.
- Fuente oficial diferenciada de notas tecnicas.
- Mix / Instrument Universe valido por 60 dias.
- Avisos decisionales visualmente trazables.
- Controles visibles de Simulacion auditados.
- Pastillas express del hero activas y testeadas.
- Controles express colapsados por defecto.
- Calidad de vida simulada jerarquizada con semaforos explicitos.
- Hero muestra edad objetivo dinamica, no horizonte abstracto.
- Tabs auxiliares siguen siendo exploratorias salvo validacion especifica.

## Commits de referencia

- `191fd46` `test(midas): add fiduciary golden canonical run`
- `d19b9e5` `test(midas): add production golden canonical run`
- `f67eccc` `fix(midas): warn on expired effective source`
- `cc6022c` `fix(midas): extend mix freshness window to sixty days`
- `04865b1` `fix(midas): clarify warning visual traceability`
- `e6083c3` `fix(midas): audit simulation surface controls`
- `2814db9` `fix(midas): restore simulation hero controls and hierarchy`
- `87bcf4e` `fix(midas): refine quality indicators and hero express controls`
- `e14eaad` `fix(midas): tighten hero density and dynamic target age`

## Que quedo validado

1. Determinismo del motor
   Misma seed mas mismo input implican mismo resultado.
2. Golden controlado
   Existe fixture fiduciario no productivo para proteger invariantes.
3. Golden productivo real
   Fixture sanitizado exportado desde produccion, con:
   - `fingerprint`: `fnv1a-959dded4`
   - `effectiveEngineInputHash`: `fnv1a-959dded4`
   - `resultDigest`: `be5994b1164d990a0790f22a269d9e23e63475b5047e32d8c5685e002990d607`
   - reproduccion de `success40 = 91,6%`
4. Source policy
   Distingue fuente oficial/canonica de local/cache/legacy/fallback; fuentes prohibidas efectivas bloquean comparabilidad; notas tecnicas no usadas no contaminan el estado principal.
5. Mix / Instrument Universe
   Fuente estructural valida por 60 dias; muestra edad y fecha en Simulacion; si supera 60 dias debe sugerir revisar o actualizar.
6. Warning visual traceability
   `Canonico + aviso` solo aparece por avisos decisionales reales; los avisos asociados quedan visibles y destacados; las notas tecnicas quedan en detalle tecnico.
7. Simulation surface controls
   Los controles visibles fueron auditados, diferenciando controles express, grupos staged y diagnostico/solo lectura; no quedan controles ambiguos visibles como decisionales.
8. Hero
   La pregunta usa edad objetivo dinamica; edad objetivo = edad actual + horizonte activo; `OK Resultado canonico` no aparece duplicado; `Neutro` y `1000 sim` no compiten como pills principales; capital queda informativo.
9. Hero express controls
   Las pastillas activas son `Retorno` y `Anos`; al tocarlas abren modal; `Cancelar` no altera input; `Aplicar` dispara el flujo existente de recalculo; `Escenario` y `Monte Carlo` quedan accesibles en controles express o niveles secundarios, no como pills hero principales.
10. QoL / evaluacion
   Las metricas QoL se reproducen desde el output del motor; la clasificacion `Fragil` y score `52/100` se reproducen; las metricas de consumo son simuladas y no gasto real observado; los KPI principales tienen semaforo explicito.

## Resultado productivo certificado

| Metrica | Valor certificado |
| --- | --- |
| Exito 40 anos | 91,6% |
| Ruina 40 anos | 8,4% |
| Ruinas | 84/1000 |
| Venta casa | 24,6% |
| Venta mediana casa | ano 24,7 |
| Terminal wealth P25 | 1.030.503.112 CLP aprox. |
| Terminal wealth P50 | 3.374.316.533 CLP aprox. |
| Terminal wealth ratio | 2,18x |
| CSR-85/4 | 73,7% |
| Quality survival rate | 15,4% |
| QASR strict | 90,4% |
| Clasificacion MIDAS | Fragil |
| Score | 52/100 |

## Rangos QoL vigentes

Usar copy visible con acentos: `Atención`, `Crítico`, `Informativo`.

| KPI | Verde | Amarillo / Atención | Rojo / Crítico | Productivo actual |
| --- | --- | --- | --- | --- |
| CSR-85/4 | >= 80% | 65%-80% | < 65% | 73,7% Atención |
| Quality survival rate | >= 50% | 25%-50% | < 25% | 15,4% Crítico |
| Consumo efectivo promedio | >= 97% | 93%-97% | < 93% | 96,0% Atención |
| Tiempo en recorte severo | <= 1 ano | 1-3 anos | > 3 anos | 2,9 anos Atención |
| Terminal wealth ratio | contextual | contextual | contextual | 2,18x Atención por posible subuso |

## Que NO queda validado

- No valida que los supuestos de retorno sean correctos.
- No valida que el futuro se comporte como la simulacion.
- No convierte el `91,6%` en garantia.
- No sustituye revision financiera humana.
- No certifica tabs auxiliares como decisionales.
- No certifica nuevas corridas productivas futuras si cambia el input o fingerprint.
- No certifica cambios futuros que no pasen los golden tests.
- No certifica edicion rapida de gasto desde hero, porque quedo fuera deliberadamente.
- No certifica Optimizacion Asistida / Laboratorio de Escenarios, todavia no construido.

## Condiciones para usar Simulacion como decisional

La hoja Simulacion solo debe considerarse decisional si:

- `canonicalInputReady = true`
- `sourcePolicy.isComparable = true`
- `resultConfidence.canUseForDecision = true`
- no hay `forbiddenSourcesUsed`
- existe fingerprint
- existe replay trace
- el golden productivo sigue pasando
- Mix / Instrument Universe esta dentro de la ventana de 60 dias o revisado explicitamente
- no hay cambios staged pendientes sin aplicar
- los controles usados estan clasificados como canonicos o claramente exploratorios
- el resultado visible corresponde al fingerprint vigente

## Controles de Simulacion

- `Modelo Base`: control decisional canonico.
- `Retorno` y `Anos`: pastillas express del hero, editables por modal y recalculo.
- `Escenario` y `Monte Carlo`: accesibles como controles express, no pills principales del hero.
- `Parametros de simulacion`: exploratorio/express segun UI actual.
- `Barra de decision`: exploratoria/express.
- `Prorroga +5`: exploratoria/express.
- `Controles express`: colapsados por defecto.
- `Copiar input M8`, trazas y detalle tecnico: diagnostico/solo lectura.
- `Ledger capital manual`: staged; requiere guardar y recalcular.
- `Capital` en hero: informativo, no falsa entrada editable.
- `Gasto` desde hero: pendiente/no certificado como edicion rapida.

Nada debe parecer decisional si no esta conectado, testeado, trazado y protegido por fingerprint, `sourcePolicy` y `resultConfidence`.

## Comandos de validacion

```bash
npm -w apps/midas run test:critical
npm -w apps/midas run build
```

Tests relevantes:

- `goldenCanonicalRun.test.ts`
- `productionGoldenRun.test.ts`
- `sourceFreshnessPolicy.test.ts`
- `m8InputFingerprint.test.ts`
- `m8ReplayTrace.test.ts`
- `motorInvariants.test.ts`
- `SimulationPage.test.ts`
- `qualityOfLifeKpiThresholds.test.ts`

## Como interpretar "motor validado"

"Motor validado" significa que, para los inputs cubiertos por fixtures fiduciarios y golden runs, el motor es reproducible y los cambios futuros quedan protegidos por tests. No significa que las hipotesis financieras sean correctas ni que los resultados sean garantias.

## Proximas decisiones recomendadas

1. Mantener MIDAS congelado para features nuevas salvo correcciones.
2. Validar produccion visual despues de cada cambio relevante.
3. Mantener tabs auxiliares como exploratorias salvo auditoria equivalente.
4. Evaluar warning de chunk grande Vite como deuda tecnica no funcional.
5. Crear nuevo golden productivo si cambia el fingerprint real de produccion.
6. Evaluar edicion rapida de gasto en hero solo si puede conectarse con la misma seguridad fiduciaria.
7. Disenar Laboratorio de Escenarios como entrada/salida estricta y conversacion guiada flexible.
