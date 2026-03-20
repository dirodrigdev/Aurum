# Motor 4 - Robust Monte Carlo

## Arquitectura

Motor 4 mantiene la mecanica patrimonial del motor parametrico, pero agrega incertidumbre de parametros.

Para cada trayectoria:

1. samplea un set de parametros
2. fija esos parametros para toda la trayectoria
3. corre la simulacion completa

Se randomizan:

- medias anuales
- volatilidades
- correlaciones clave
- inflacion Chile
- drift CLP/USD

## Proposito

Motor 4 existe para capturar algo que Motor 2 subestima:

- no sabemos las medias verdaderas
- no sabemos la volatilidad verdadera
- no sabemos la correlacion verdadera

O sea, representa incertidumbre del modelo, no solo incertidumbre de mercado.

## Fortalezas

- rompe la falsa precision de parametros fijos
- es metodologicamente mas honesto
- sigue siendo simple y auditable

## Debilidades

- depende de los rangos elegidos
- si los rangos son demasiado estrechos o demasiado amplios, el resultado cambia
- no resuelve por si solo el problema de elegir una sola lectura oficial

## Resultados clave

Escenario base actual:

- `probRuin ~ 38.78%`
- `successRate ~ 61.22%`
- `terminalP50 ~ 4,844.9MM`
- `months_cut_pct ~ 79.73%`

Sanity check de parametros observados:

- retorno RV global medio usado: `6.51%`
- rango RV global usado: `5.00% - 8.00%`
- volatilidad RV global media usada: `15.31%`
- correlacion RVg-RFg media usada: `0.201`

## Conclusion

Motor 4 confirma robustamente el bloque prudente.

No se acerca a Motor 1. Al contrario, muestra que al introducir incertidumbre realista de parametros, la lectura sigue quedando cerca de Motores 2 y 3.
