# MIDAS Scenario Lab

## Propósito

Laboratorio de Escenarios es una superficie exploratoria y no decisional.

- No escribe Modelo Base.
- No toca Aurum ni GastApp.
- No modifica datos reales.
- No reemplaza Simulación.
- La IA genera candidatos.
- MIDAS valida el JSON.
- Solo M8 oficial puede evaluar candidatos finales.

## Flujo

1. Entrada estricta
   MIDAS exporta un `midas_optimization_pack.json` sellado, versionado y validable.
2. Conversación guiada/flexible
   La IA recibe el pack, usa solo variables permitidas y después de cada objetivo o restricción debe preguntar:
   `¿Quieres seguir agregando objetivos/restricciones o terminaste?`
3. Salida estricta
   La IA devuelve un `midas_candidate_set.json` validable.
4. Evaluación final
   MIDAS, y solo MIDAS, evalúa candidatos con M8 oficial cuando esa etapa esté habilitada.

## Reglas de IA

- No calcular métricas finales como verdad.
- No afirmar recomendaciones decisionales.
- Sí puede proponer hipótesis cualitativas.
- Debe respetar variables permitidas y prohibidas.
- Debe devolver solo `midas_candidate_set` cuando el usuario diga `terminé`.

## Variables permitidas

- `spendingPhases`
- `phaseDurations`
- `bucketMonths`
- `portfolioMix`
- `cutRules`
- `houseSaleTrigger`
- `returnScenario`
- `horizonYears`
- `nSim`
- `seed`

## Variables prohibidas

- `realAurumSnapshot`
- `historicalGastAppExpenses`
- `observedFx`
- `observedMortgageBalance`
- `observedPortfolioValue`
- `userIdentity`
- `authUser`
- `email`
- `uid`

## Candidate Set

Salida esperada:

```json
{
  "type": "midas_candidate_set",
  "version": "1.0",
  "packFingerprint": "fnv1a-...",
  "selectedGoals": ["improve_quality_of_life"],
  "customGoals": [],
  "constraints": {},
  "candidates": [
    {
      "candidateId": "qol_001",
      "label": "Suavizar recortes",
      "changes": {
        "cutRules": {
          "cut1": 0.92,
          "cut2": 0.84
        }
      },
      "hypothesis": "Podría reducir profundidad de recortes.",
      "riskNotes": []
    }
  ]
}
```

## Estado del slice

- Export de Optimization Pack: implementado.
- Validación de Candidate Set: implementada.
- UI Laboratorio: implementada.
- Ejecución M8 desde Laboratorio: pendiente.
