# Engines Overview

## Proposito

El sistema de simulacion patrimonial de Midas busca estimar:

- probabilidad de ruina
- patrimonio terminal
- presion sobre el gasto
- sensibilidad a supuestos de mercado

El horizonte operativo base es de 40 anos, con gasto por fases, fee, FX y regla dinamica de gasto.

## Por que no se usa un solo modelo

La validacion historica mostro que el resultado depende materialmente de la arquitectura estadistica.

- Un motor demasiado pegado a la historia reciente puede verse demasiado benigno.
- Un motor parametrico fijo puede verse demasiado severo o rigido.
- Un motor con regimenes puede capturar persistencia, pero depende de su calibracion.
- Un motor robusto con incertidumbre de parametros rompe la falsa precision, pero depende de los rangos elegidos.

Por eso el enfoque adoptado fue comparar varios motores sobre una misma logica patrimonial.

## Motores disponibles

### Motor 1

Bootstrap historico ponderado.

- usa preprocess log-aditivo
- usa weighted bootstrap
- preserva secuencias historicas y crisis reales

Lectura general: optimista condicionado por la historia reciente.

### Motor 2

Parametrico normal multivariado mensual.

- usa medias, volatilidades y correlaciones explicitas
- no depende del bootstrap historico

Lectura general: baseline prudente y estable.

### Motor 3

Motor de regimenes simples.

- tres estados: normal, stress y recovery
- transiciones explicitas y persistencia acotada

Lectura general: bloque prudente, pero no arbitra con fuerza frente a Motor 2.

### Motor 4

Robust Monte Carlo con incertidumbre de parametros.

- en cada trayectoria se sortean medias, volatilidades y correlaciones
- los parametros quedan fijos dentro de esa trayectoria

Lectura general: representacion mas honesta de la incertidumbre del modelo, cercana al bloque prudente.

## Problema original

El problema original no era solo calcular trayectorias, sino decidir cuanto confiar en el resultado cuando:

- el bootstrap pesa demasiado el pasado reciente
- la capa economica forward-looking es incierta
- las correlaciones y volatilidades cambian con el tiempo

## Enfoque adoptado

El enfoque actual no asume un unico motor correcto.

- se construyeron motores metodologicamente distintos
- se corrieron validaciones historicas comparables
- se midio sensibilidad a seeds, block length, weighting y capital

La idea es tomar decisiones con validacion cruzada, no con una sola cifra.
