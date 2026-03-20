# Open Questions — Motor 1 / Próximos pasos

## 1. Motor 2 paramétrico

- construir un segundo motor no bootstrap
- contrastar cobertura, sesgo y sensibilidad contra Motor 1
- usarlo como chequeo metodológico, no como reemplazo automático

## 2. Ensemble / consenso de motores

- evaluar si conviene usar mediana entre motores
- evaluar si conviene reportar rango entre motores
- decidir si el output oficial será puntual o metodológicamente distribuido

## 3. Stress tests futuros

- década débil prolongada
- inflación alta persistente
- FX adverso
- correlación tipo 2022
- combinación de drawdown + inflación + CLP débil

## 4. Revisión futura del weighting

- decidir si el weighting actual debe mantenerse como setup oficial
- o si debe quedar como sensibilidad estructural y no como única configuración base
- revisar periódicamente si el half-life actual sigue siendo razonable

## 5. Interpretación de outputs

- definir cómo se mostrará oficialmente el resultado al usuario
- decidir el peso interpretativo de `P50`
- decidir si se mostrará banda metodológica explícita
- decidir si el output oficial será:
  - valor central
  - banda metodológica
  - rango entre motores

## 6. Gobierno de calibración

- definir cada cuánto se recalibran forward targets
- definir qué cambios requieren bitácora formal en `VALIDATION_LOG.md`
- evitar que cambios de parámetros se mezclen con cambios de arquitectura sin trazabilidad
