# Motor 2 — Paramétrico Normal

- Objetivo: baseline limpio y estacionario con supuestos forward fijos.
- Arquitectura: distribución normal multivariada mensual con medias/vols/correlaciones explícitas; misma mecánica de gasto/fee/ruina.
- Problema que resuelve: transparencia y reproducibilidad sin depender de historia reciente.
- Fortalezas: muy estable por seed; implementación simple y auditable.
- Debilidades: no captura regímenes; mediana históricamente pesimista; no refleja incertidumbre de parámetros; cobertura buena pero sesgo alto.
- Tests clave: atribución A/B/C/D; weighted vs uniforme (como contraste); seed; walk-forward; reconciliación con Motor 1.
- Resultados clave: probRuin 40.58%, terminalP50 4.42B CLP; error P50 medio ≈ -34% en walk-forward.
- Conclusión metodológica: severo/estacionario; útil como baseline de referencia pero no como centro.
- Estado: **Descartado** para producto (referencia interna).***
