# Final Interpretation

## A. Resumen de resultados

Lectura base actual:

- Motor 1: `~5%`
- Motor 2: `~40.6%`
- Motor 3: `~39.4%`
- Motor 4: `~38.8%`

## B. Conclusión metodologica

No hay un unico modelo correcto.

Lo que si hay es una senal clara:

- Motor 1 queda aislado en el extremo optimista
- Motores 2, 3 y 4 convergen en un bloque prudente

Eso hace dificil seguir tratando a Motor 1 como unica lectura oficial.

## C. Insight clave

El nivel de capital domina sobre la eleccion del modelo.

La eleccion del motor importa mucho en `1.4B`, pero bastante menos en `1.9B` y mucho menos en `2.5B`.

## D. Banda honesta de riesgo

### Banda metodologica actual

- optimista: `~5%`
- prudente: `~38% - 41%`

Esta es la banda honesta hoy, antes de decidir como se mostrara en producto.

## E. Estado actual

Queda pendiente decidir:

- que motor usar en la app
- si se mostrara un motor unico
- o si se mostrara una banda metodologica

La parte buena es que la documentacion y la validacion ya permiten tomar esa decision con trazabilidad.

## Lectura final

Hoy no hay evidencia para decir que Motor 1 sea el unico arbitro correcto.

Tampoco hay evidencia para decir que cualquier motor prudente sea exagerado por defecto, porque:

- Motor 2 converge con Motor 3
- Motor 4 agrega incertidumbre de parametros y sigue cerca de ese bloque

La interpretacion mas defendible hoy es:

- Motor 1 = extremo optimista
- Motores 2-4 = bloque prudente convergente
- capital = variable dominante para bajar el riesgo de verdad
