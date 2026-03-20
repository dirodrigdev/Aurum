# Motor 3 - Regime Engine

## Arquitectura

Motor 3 usa tres estados discretos:

- normal
- stress
- recovery

Cada estado aplica overlays simples sobre la capa economica base:

- retornos
- volatilidades
- correlaciones

Las transiciones son explicitas y simples. No usa HMM ni arquitectura pesada.

## Proposito

Motor 3 existe para capturar algo que Motor 2 no tiene:

- persistencia de crisis
- recuperaciones parciales
- alternancia economica simple sin depender del bootstrap historico

## Fortalezas

- incorpora dinamica economica mas realista que una normal fija
- sigue siendo simple y auditable
- comparte la misma logica patrimonial del resto

## Debilidades

- sensible a la calibracion de transiciones y overlays
- no es completamente independiente de decisiones exploratorias
- no arbitra con claridad si queda demasiado cerca de Motor 2

## Resultados clave

Escenario base actual:

- `probRuin ~ 39.40%`
- `successRate ~ 60.60%`
- `terminalP50 ~ 4,522.5MM`
- `months_cut_pct ~ 80.08%`

## Conclusion

Motor 3 confirma el bloque prudente, pero no arbitra.

Su lectura no contradice a Motor 2. En la practica, hoy queda muy cerca del motor parametrico y no abre un punto medio claro frente a Motor 1.
