# Motor 1 - Bootstrap Hibrido

## Arquitectura

Motor 1 usa tres capas clave:

- preprocess log-aditivo de medias forward-looking
- weighted bootstrap
- block sampling historico

El preprocess recentra las series historicas hacia supuestos base mas prudentes, preservando volatilidad y secuencia temporal. Luego el bootstrap arma trayectorias por bloques, con mayor peso para la historia mas reciente.

## Que problema resuelve

Motor 1 existe para mantener realismo historico:

- secuencias de crisis reales
- clustering de malos periodos
- correlaciones implicitas observadas

Busca evitar el mundo demasiado limpio de un motor completamente parametrico.

## Fortalezas

- captura crisis historicas reales
- preserva secuencia temporal y arrastre entre meses
- mantiene shocks y episodios persistentes sin inventarlos

## Debilidades

- depende del pasado observado
- es sensible al weighting del bootstrap
- las medias efectivas pueden quedar mas benignas que la capa economica base

## Resultados clave

Escenario base actual:

- `probRuin ~ 4.98%`
- `successRate ~ 95.02%`
- `terminalP50 ~ 25,929.4MM`
- `months_cut_pct ~ 52.08%`

## Conclusion

Motor 1 es usable, pero su lectura es optimista condicionada.

No esta roto, pero tampoco debe tratarse como arbitro unico. La principal razon es que el weighted bootstrap termina empujando el resultado hacia un regimen historico reciente relativamente favorable.
