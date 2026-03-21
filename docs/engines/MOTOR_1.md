# Motor 1 — Bootstrap Ponderado

- Objetivo: conservar secuencias históricas (crisis incluidas) y ofrecer una lectura favorable con ponderación a lo reciente.
- Arquitectura: preprocess log-aditivo + block bootstrap ponderado (half-life 12y) + gastos/regla dinámica/ruina = mecánica patrimonial estándar.
- Problema que resuelve: incorpora eventos reales (2008) y mantiene continuidad temporal.
- Fortalezas: cobertura histórica 100% en walk-forward; captura colas históricas; número principal bajo (probRuin base 4.98%).
- Debilidades: depende fuerte del weighting; medias/correlaciones efectivas quedan más altas que los targets; sensibilidad moderada a block length; menos estable metodológicamente.
- Tests clave: preprocess before/after; weighted vs uniform; block length; seed; walk-forward; reconciliación vs Motor 2.
- Resultados clave: probRuin 4.98%, terminalP50 25.9B CLP; weighting vs uniforme abre brecha grande.
- Conclusión metodológica: optimista estructural por sesgo a régimen reciente; válido como “favorable”.
- Estado: **Elegido** para producto como vista favorable.***
