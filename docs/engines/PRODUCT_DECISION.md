# Product Decision — Motores

## Motores en producción
- Motor 1 = Favorable (bootstrap ponderado)
- Motor 6 = Central (paramétrico explícito intermedio)
- Motor 4 = Prudente (paramétrico con incertidumbre de parámetros)
- Escenarios visibles: Optimista / Base / Pesimista → se aplican simultáneamente a los 3 motores.

## Motores fuera de producción
- Motor 2 (paramétrico fijo): baseline severo, no centro.
- Motor 3 (regímenes simples): no arbitra, cercano a bloque prudente.
- Motor 5 (igual a M2): sin aporte.
- Motor 7 (guided regime): confirma bloque prudente, no mejora centro.

## Rationale
- Un solo modelo es insuficiente: M1 optimista por weighting; bloque 2/4/7 severo; M6 intermedio pero prudente.
- Trío productivo cubre banda honesta: favorable (M1), central (M6), prudente (M4).
- Escenarios ≠ motores: cada escenario recalcula los 3 motores con supuestos Optimista/Base/Pesimista.

## Uso en la app
- Número principal: Motor 6 (central).
- Rango plausible: M1 ↔ M4.
- Fan chart: Motor 6.
- Escenarios: cambian supuestos y recalculan los 3 motores.***
