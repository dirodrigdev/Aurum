# Motor 7 — Guided Regime Monte Carlo

- Objetivo: motor guiado por regímenes con guardrails, sin bootstrap y menos rígido que Motor 2.
- Arquitectura: regímenes normal/stress/recovery con overlays moderados, transiciones simples y topes de duración; mecánica patrimonial estándar.
- Problema que intentaba resolver: balancear crisis plausibles con persistencia acotada y correlaciones dinámicas.
- Fortalezas: estable por seed; guardrails evitan crisis interminables; explícito en supuestos.
- Debilidades: resultados quedaron en bloque prudente (probRuin 40.20%); cobertura 80% y 20% over-P90 en walk-forward; no mejora el centro.
- Tests clave: comparación 5 motores, seed, walk-forward, score.
- Resultados clave: probRuin 40.20%, terminalP50 4.34B CLP; summary WF: within 80%, above P90 20%, error P50 ~-34%.
- Conclusión metodológica: confirma el bloque prudente, no resuelve la brecha con Motor 1.
- Estado: **Descartado/Referencial**.***
