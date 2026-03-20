# Motor 2 - Parametrico Normal

## Arquitectura

Motor 2 usa una normal multivariada mensual sobre los cuatro sleeves:

- rvGlobal
- rfGlobal
- rvChile
- rfChile

Usa:

- medias explicitas
- volatilidades explicitas
- matriz de correlacion explicita

No depende del bootstrap historico.

## Proposito

Motor 2 existe como baseline limpio y controlado.

Su rol principal es responder: que pasa si usamos directamente la capa economica base, sin ayuda del weighting historico ni de secuencias reales favorables.

## Fortalezas

- alta estabilidad por seed
- arquitectura transparente
- facil de auditar
- mismo flujo patrimonial que los otros motores

## Debilidades

- no modela regimenes
- no captura persistencia de crisis
- puede verse demasiado rigido frente al mundo real

## Resultados clave

Escenario base actual:

- `probRuin ~ 40.58%`
- `successRate ~ 59.42%`
- `terminalP50 ~ 4,415.5MM`
- `months_cut_pct ~ 80.32%`

## Conclusion

Motor 2 entrega una lectura prudente estructural.

Es mas severo que Motor 1, pero tambien mas estable y menos dependiente de decisiones implicitas del bootstrap. Sirve como ancla metodologica frente a resultados excesivamente benignos.
