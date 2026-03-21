# Motor 4 — Robust (Incertidumbre de Parámetros)

- Objetivo: capturar incertidumbre de supuestos (medias/vols/correlaciones) sin cambiar la lógica patrimonial.
- Arquitectura: paramétrico normal, pero cada simulación sortea parámetros dentro de rangos plausibles; parámetros fijos por trayectoria.
- Problema que resuelve: rompe la falsa precisión de Motor 2 y muestra rango prudente sin bootstrap.
- Fortalezas: expone incertidumbre de modelo; estable por seed; prudente sin depender de historia.
- Debilidades: resultados sensibles a los rangos elegidos; sigue en bloque prudente.
- Tests clave: comparación 4 motores; seed; dispersión de parámetros.
- Resultados clave: probRuin 38.78%, terminalP50 4.84B CLP; rango RVg usado 5–8%, vol RVg 12.3–18.4%.
- Conclusión metodológica: prudente y honesto sobre parámetros; útil como vista conservadora.
- Estado: **Elegido** para producto como vista prudente.***
