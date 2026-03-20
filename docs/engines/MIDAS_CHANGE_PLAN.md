# Plan de Cambio Midas (sin implementar)

Principio: reutilizar la UI actual, cambiar solo lógica/datos y copy donde sea imprescindible.

## A. Pantalla Simulación
- Número principal: mostrar Motor 6 (central). Hoy usa M1; cambiar fuente de dato, no el layout.
- Prob. de ruina: exponer la de Motor 6. Mantener copy y ubicación.
- Banda/rango: mostrar rango M1 ↔ M4 con etiqueta clara “rango plausible (favorable–prudente)”.
- Fan chart: usar Motor 6. Mantener estilo actual.
- Escenarios (tabs/pills Optimista/Base/Pesimista): al cambiar, recalcular los 3 motores con ese set de supuestos; destacar tab activo; no agregar nuevas cards.
- Cards secundarias: mantener; solo actualizar fuentes (central=6, rango=1/4).

## B. Pantalla Sensibilidades
- Motor usado hoy: sigue el motor actual (prob. M2/central). Nuevo: usar Motor 6 como baseline.
- Visual: sin cambios; sliders/inputs iguales.
- Botón Ejecutar: mismo significado (“recalcular con estos supuestos”); ahora ejecuta Motor 6 para resultados.

## C. Pantalla Stress
- Visual: sin cambios.
- Convivencia con escenarios: stress ≠ escenarios; aplicar shocks sobre el escenario seleccionado, recalculando los 3 motores si es viable, o al menos Motor 6 si solo uno es práctico.
- Copy: aclarar que stress tests son shocks adicionales, no escenarios de probabilidad.

## D. Pantalla Optimizador
- Motor objetivo: usar Motor 6 para la función objetivo (probRuin o patrimonio P50).
- Visual: sin cambios; mismos pasos/inputs.
- Si muestra métricas comparativas, opcionalmente añadir rango M1/M4 como referencia (sin rediseñar).

## E. Modo Custom / Simulación manual
- Regla: si el usuario modifica manualmente capital, años, retorno, etc., y esos valores difieren del escenario activo, el estado pasa a “Custom”.
- Cómo se muestra: mantener UI actual; marcar chip/escenario como “Custom” (desactivar resaltado de Optimista/Base/Pesimista).
- Reglas de vuelta: tocar un escenario restablece sus valores y sale de Custom.
- Ejecución: siempre recalcular los 3 motores con el set de supuestos vigente (escenario o custom).

## Qué queda igual
- Layout general, hero card, barra, fan chart, tabs existentes, botones Ejecutar.
- Gastos, fee, regla dinámica, definición de ruina.

## Qué cambia (lógica/copy)
- Fuente de métricas: central = Motor 6; rango = M1/M4.
- Escenarios recalculan los 3 motores.
- Estado Custom cuando hay overrides manuales.
- Copy breve en Simulación para aclarar “rango plausible” y “motor central”.
