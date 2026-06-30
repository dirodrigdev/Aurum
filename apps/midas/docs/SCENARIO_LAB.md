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
   `¿Quieres seguir agregando objetivos/restricciones o terminaste? Responde seguir o terminé.`
3. Salida estricta
   La IA devuelve un `midas_candidate_set.json` validable.
4. Evaluación final
   MIDAS, y solo MIDAS, evalúa candidatos con M8 oficial cuando esa etapa esté habilitada.

## Reglas de IA

- No calcular métricas finales como verdad.
- No afirmar recomendaciones decisionales.
- Sí puede proponer hipótesis cualitativas.
- Sí puede hacer pre-screening heurístico y descartar candidatos débiles.
- Debe respetar variables permitidas y prohibidas.
- Debe ofrecer depuración antes del JSON final.
- Debe devolver solo `midas_candidate_set` cuando el usuario diga `generar JSON`.

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

La salida puede incluir proxy scoring y preprocesamiento heurístico, siempre marcado como no oficial.

Salida esperada:

```json
{
  "type": "midas_candidate_set",
  "version": "1.0",
  "packFingerprint": "fnv1a-...",
  "selectedGoals": ["improve_quality_of_life"],
  "customGoals": [],
  "constraints": {},
  "generationSummary": {
    "approach": "ai_proxy_prescreening",
    "internalCandidatesConsidered": 40,
    "candidateCountBeforeUserReview": 15,
    "candidateCountAfterUserReview": 10,
    "screeningCriteria": ["liquidez", "redundancia", "tradeoffs tempranos"],
    "userReviewedBeforeJson": true,
    "notes": ["Proxy heurístico, no resultado M8."]
  },
  "discardedIdeas": [],
  "candidates": [
    {
      "candidateId": "qol_001",
      "label": "Suavizar recortes",
      "candidateFamily": "qol_liquidity",
      "heuristicPriority": "high",
      "preM8Score": 82,
      "preM8ScoreExplanation": "Proxy heurístico, no resultado oficial.",
      "expectedDirectionalEffects": {
        "qualityOfLife": "likely_improve",
        "success40": "uncertain_or_slightly_down",
        "houseSalePct": "likely_up",
        "terminalWealth": "likely_down"
      },
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

## IA externa como preprocesador

- La IA puede hacer cálculos preliminares.
- Puede usar heurísticas y proxy scores.
- Puede descartar escenarios.
- Puede agrupar por familias.
- Puede pedir depuración al usuario antes del JSON final.
- No puede certificar resultados.
- M8 calcula oficialmente.

La IA puede calcular para pensar; MIDAS calcula para decidir.

## Estado del slice

- Export de Optimization Pack: implementado.
- Validación de Candidate Set: implementada.
- UI Laboratorio: implementada.
- Ejecución M8 desde Laboratorio: pendiente.
