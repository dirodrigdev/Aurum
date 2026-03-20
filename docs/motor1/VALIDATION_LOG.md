# Validation Log — Motor 1

## 1. Problema inicial

El motor original presentaba tres problemas metodológicos principales:

- usaba demasiado el pasado como forecast directo de medias futuras
- era sensible a la arquitectura bootstrap y a las correlaciones implícitas del dataset
- mezclaba decisiones históricas y forward-looking sin una separación suficientemente explícita

La preocupación principal no era que el motor estuviera “roto”, sino que pudiera estar calibrado de manera engañosa para un horizonte patrimonial de 40 años.

## 2. Cambios introducidos

### Preprocess log-aditivo

Se incorporó un preprocess log-aditivo para recentrar medias hacia targets forward-looking sin destruir la volatilidad ni la secuencia temporal de crisis.

### Weighted bootstrap

Se incorporó un weighted bootstrap para favorecer bloques recientes, pero posteriormente se recalibró porque la primera versión era demasiado agresiva.

### Corrección de `rfChile` real vs nominal

La auditoría detectó inconsistencia conceptual en `rfChile`:

- la serie histórica correspondía a `r_RFcl_UF`
- el target aplicado en preprocess era nominal
- el uso posterior en bootstrap trataba esa serie como si ya fuera nominal

Se corrigió para que:

- la serie histórica se trate como retorno real / UF
- el target del preprocess sea real (`1.02%`)
- la conversión a nominal ocurra dentro del motor al combinar con IPC

### Ajuste de `mrHalfLifeYears`

`mrHalfLifeYears` quedó en `6.3`, calibrado con ajuste empírico AR(1).

### Recalibración de escenarios

Se recalibraron escenarios `base`, `pessimistic` y `optimistic` con valores absolutos auditables.

## 3. Tests realizados

### 3.1 Preprocess before/after

Resultados observados:

- `rvGlobal`: `6.12% -> 6.50%`, vol `15.48% -> 15.48%`
- `rfGlobal`: `2.59% -> 3.05%`, vol `3.74% -> 3.74%`
- `rvChile`: `6.68% -> 7.50%`, vol `10.93% -> 10.94%`
- `rfChile`: `4.81% real -> 1.02% real`, vol `2.37% -> 2.36%`
- `ipcChile`: `3.77% -> 3.80%`, vol `1.43% -> 1.43%`
- `clpUsdDrift`: `1.51% -> 2.00%`, vol `9.42% -> 9.42%`

Conclusión:

- el preprocess quedó sano numéricamente
- mueve medias
- preserva volatilidad casi exactamente

### 3.2 Weighted bootstrap weights

Primer intento (half-life 8 años):

- `2000–2009`: `16.25%`
- `2010–2019`: `39.82%`
- `2020–2026`: `43.93%`
- peso agregado 2008: `2.20%`

Conclusión intermedia:

- weighting demasiado agresivo
- régimen reciente dominaba demasiado

Versión recalibrada (half-life 12 años):

- `2000–2009`: `22.29%`
- `2010–2019`: `41.12%`
- `2020–2026`: `36.59%`
- peso agregado 2008: `2.79%`

Conclusión:

- el weighting sigue favoreciendo lo reciente
- pero deja de volver 2008 marginal

### 3.3 Attribution A/B/C/D

Resultados relevantes tras la corrección de `rfChile`:

| Variante | probRuin | terminalP50 |
|---|---:|---:|
| baseline viejo | 8.38% | 6,926.1MM |
| preprocess only | 16.22% | 8,011.9MM |
| weighted only | 2.02% | 20,070.0MM |
| preprocess + weighted | 4.98% | 25,844.9MM |

Conclusión:

- el weighting fue la palanca dominante del cambio
- el preprocess por sí solo no explica el salto principal del modelo

### 3.4 Sensibilidad half-life

Resultados resumidos:

| Half-life | probRuin | terminalP50 |
|---|---:|---:|
| 8 años | 2.80% | 43,605.3MM |
| 10 años | 3.92% | 31,832.7MM |
| 12 años | 4.98% | 25,844.9MM |
| 15 años | 6.88% | 21,723.8MM |

Conclusión:

- la sensibilidad al half-life es material
- el motor no es inmune al weighting
- `12 años` quedó como punto medio prudente

### 3.5 Sensibilidad block length

Resultados resumidos:

| Block length | probRuin | terminalP50 |
|---|---:|---:|
| 6 | 3.52% | 24,440.6MM |
| 12 | 4.98% | 25,844.9MM |
| 18 | 5.94% | 25,963.6MM |
| 24 | 6.40% | 25,076.4MM |

Conclusión:

- sensibilidad moderada
- `probRuin` se mueve de forma visible
- `terminalP50` es más estable que la ruina

### 3.6 Sensibilidad por seed

Resultados resumidos:

| Seed | probRuin | terminalP50 |
|---|---:|---:|
| 11 | 5.24% | 25,106.6MM |
| 21 | 5.18% | 25,543.7MM |
| 42 | 4.98% | 25,844.9MM |
| 84 | 4.60% | 25,898.5MM |
| 168 | 4.94% | 25,121.9MM |

Conclusión:

- baja sensibilidad por seed
- el ruido Monte Carlo puro no parece ser la principal fuente de inestabilidad

### 3.7 Walk-forward validation

Resultados agregados:

- `100%` de los cortes quedó dentro de `[P10, P90]`
- `0%` quedó por debajo de `P10`
- `0%` quedó por encima de `P90`
- error signed medio del `P50`: `-21.37%`
- error absoluto medio del `P50`: `22.00%`
- amplitud relativa media de banda: `91.30%`

Conclusión:

- cobertura histórica buena
- mediana sistemáticamente conservadora / pesimista
- no aparece sesgo eufórico

### 3.8 Supervivencia intermedia

Resumen observado en los cortes walk-forward:

- primeros dos cortes: trayectoria cómoda
- últimos tres cortes: trayectoria tensa
- `0` meses con wealth `< 12 meses de gasto`
- `0` meses con wealth `< 6 meses de gasto`
- no hubo near-ruin factual en las ventanas observadas
- sí aparecieron meses con `spending multiplier < 1` en las ventanas más recientes

Conclusión:

- el modelo no quedó ciego a tensión intermedia
- pero las ventanas reales observadas no mostraron fragilidad extrema

## 4. Conclusión de validación

La síntesis honesta al cierre de esta etapa es:

- Motor 1 no está roto
- no es eufórico
- tiene buena cobertura histórica
- es usable como motor base
- sigue siendo sensible a decisiones de arquitectura bootstrap

La principal variable metodológica que sigue mandando no es el seed, sino el diseño del bootstrap:

- weighting
- half-life
- block length

Por eso Motor 1 puede usarse hoy como motor oficial base, pero no como árbitro absoluto único del sistema.
