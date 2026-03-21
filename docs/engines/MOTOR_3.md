# Motor 3 — Regímenes Simples

- Objetivo: introducir dinámica de estados (normal/stress/recovery) sin bootstrap.
- Arquitectura: transiciones fijas, overlays por régimen (retornos/vols/correlaciones) sobre la mecánica patrimonial estándar.
- Problema que intentaba resolver: persistencia de crisis sin sesgo reciente.
- Fortalezas: incorpora noción de crisis y rebote; sigue siendo auditable.
- Debilidades: calibración terminó cerca del bloque prudente; cobertura buena pero mediana pesimista; no arbitró entre motores 1 y 2.
- Tests clave: corrida base, seed, walk-forward, score comparativo.
- Resultados clave: probRuin ~39.4%, terminalP50 ~4.52B CLP; error P50 ~-34%.
- Conclusión metodológica: confirma el bloque prudente, no aporta centro.
- Estado: **Exploratorio/descartado** para producto.***
