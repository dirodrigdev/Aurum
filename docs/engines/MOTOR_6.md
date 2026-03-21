# Motor 6 — Central Explícito

- Objetivo: proveer un centro defendible entre el optimismo de Motor 1 y el bloque prudente (2/4).
- Arquitectura: paramétrico normal con supuestos RV intermedios (RVg 7.25%, RVcl 7.85%), resto de supuestos base comunes; mecánica patrimonial estándar.
- Problema que resuelve: dar un número central sin weighting histórico ni rigidez extrema.
- Fortalezas: mejora centralidad (probRuin 32.62%); cobertura 100%; estabilidad alta.
- Debilidades: sigue prudente vs expectativa (no llega a ~20%); error P50 ~-31% en walk-forward.
- Tests clave: comparación base, seed, walk-forward, score.
- Resultados clave: probRuin 32.62%, terminalP50 5.26B CLP; score total 85.4 (máximo actual).
- Conclusión metodológica: mejor candidato central actual; prudente pero más equilibrado.
- Estado: **Elegido** para producto como número central.***
