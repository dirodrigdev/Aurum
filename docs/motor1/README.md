# Motor 1 — Bootstrap híbrido patrimonial

## 1. Objetivo

Motor 1 es el motor base de simulación patrimonial de largo plazo de Midas.
Está orientado a responder cuatro preguntas centrales sobre un horizonte de 40 años:

- probabilidad de ruina
- patrimonio terminal
- estabilidad del gasto
- sensibilidad del plan a shocks de mercado, inflación y FX

No es un motor de trading ni de market timing. Es un motor de supervivencia patrimonial de largo plazo con foco en secuencia de retornos, sostenibilidad del gasto y fragilidad del portafolio bajo estrés.

## 2. Arquitectura actual

### Block bootstrap histórico

La base del motor es un bootstrap por bloques mensuales sobre historia observada. Esto preserva:

- clustering de volatilidad
- secuencias de crisis
- correlaciones implícitas en los datos
- regímenes históricos difíciles de capturar con un modelo puramente paramétrico

El parámetro oficial actual es `blockLength = 12`.

### Preprocess log-aditivo de medias forward-looking

Motor 1 no usa el histórico puro como forecast de medias futuras. Antes del bootstrap aplica un preprocess log-aditivo:

`r_nuevo = exp(ln(1 + r_hist) - mu_hist_m + mu_fwd_m) - 1`

Esto permite:

- mantener la volatilidad prácticamente intacta
- mantener la secuencia temporal de crisis
- recentrar las medias hacia expectativas forward-looking

### Weighted bootstrap

El bootstrap pondera más los bloques recientes que los antiguos, pero sin borrar episodios históricos relevantes.

La intención es:

- reducir el sesgo de un régimen 2000–2019 que ya no necesariamente representa bien el futuro
- mantener peso material para episodios como 2008

El half-life oficial actual es `12 años`.

### Escenarios base / pesimista / optimista

Sobre la configuración base existen variantes auditables:

- `base`
- `pessimistic`
- `optimistic`

Estas variantes aplican overrides absolutos sobre retornos, volatilidades, inflación y `tcrealLT`. Sirven como sensibilidad estructural, no como “predicción oficial” del futuro.

### Regla dinámica de gasto

El gasto sigue una regla por fases y un multiplicador dinámico de ajuste (`spendingRule`):

- si el drawdown real se mantiene bajo ciertos umbrales durante varios meses, el gasto se recorta gradualmente
- si el drawdown mejora, el multiplicador converge de vuelta hacia 1

Esto busca modelar sostenibilidad del retiro bajo estrés, no una obligación real de recorte hoy.

### Fee

El motor aplica `feeAnnual` mensualizada sobre el portafolio después de retornos.

### Umbral de ruina

La ruina se define operativamente cuando la riqueza disponible cae por debajo de `ruinThresholdMonths * gasto efectivo mensual`.

No es quiebra contable estricta; es un criterio de inviabilidad práctica del plan de gasto.

## 3. Inputs principales

### Sleeves del portafolio

El portafolio se modela con cuatro sleeves:

- `rvGlobal`
- `rfGlobal`
- `rvChile`
- `rfChile`

### Tipos de retornos usados

- `rvGlobal`: renta variable global
- `rfGlobal`: renta fija global
- `rvChile`: blend histórico SURA / AFP
- `rfChile`: tratado como retorno real UF, convertido a nominal dentro del motor al combinarlo con IPC

### Inflación

Se modelan:

- `ipcChile`
- `hipcEur`

### FX

Se modelan:

- `CLP/USD`
- `EUR/USD`
- reversión parcial de `tcrealLT`

### Gasto por fases

El gasto está definido por `spendingPhases`, con duración, monto real y moneda:

- fase 1 en EUR
- fases siguientes en CLP

## 4. Decisiones de diseño importantes

### Por qué no se usa el histórico puro como forecast

Porque el histórico completo mezcla regímenes que no deben trasladarse mecánicamente a expectativas futuras. En particular:

- años de QE y compresión extrema de tasas
- ciclos muy favorables para algunos activos
- ventanas locales excepcionalmente fuertes

### Por qué se recentran medias

Porque queremos preservar la forma de la historia sin asumir que la media observada histórica es el mejor estimador forward-looking.

### Por qué se pondera más la historia reciente sin borrar 2008

Porque un motor totalmente uniforme sobrepondera relaciones antiguas, pero un weighting demasiado agresivo vuelve irrelevantes episodios de cola. La calibración actual intenta un punto medio.

### Por qué `rfChile` se trata como retorno real UF

La serie histórica usada para `rfChile` viene de `r_RFcl_UF`. Por semántica y origen, se interpreta como retorno real / UF. El preprocess usa un target real y luego el motor lo convierte a nominal al combinarlo con IPC, alineando histórico, target y uso posterior.

### Por qué el motor base quedó algo prudente / pesimista

Las validaciones walk-forward mostraron:

- buena cobertura histórica dentro de `[P10, P90]`
- una mediana (`P50`) que tiende a quedar por debajo de la realización histórica

Por eso el Motor 1 hoy se interpreta como una herramienta algo conservadora, no eufórica.

## 5. Cómo interpretar los outputs

### `probRuin`

Probabilidad simulada de entrar en la zona operativa de ruina bajo la regla actual.

### `successRate`

Equivale a `1 - probRuin`.

### `terminalP50`

Mediana del patrimonio terminal simulado. No debe leerse como predicción exacta del patrimonio final; es un valor central dependiente de la arquitectura bootstrap y de los supuestos del motor.

### `months_cut_pct`

Porcentaje de meses simulados en que el multiplicador de gasto quedó por debajo de 1. Es una señal de tensión del plan de gasto modelado.

### Lectura correcta del P50

El `P50` no es “lo que va a pasar”. Es una referencia central dentro de una distribución metodológica que hoy mantiene sensibilidad estructural al diseño del bootstrap.

## 6. Limitaciones conocidas

- sensibilidad moderada al `block length`
- dependencia material del diseño bootstrap
- el motor no es la “verdad”; es una herramienta robusta pero imperfecta
- el weighting sigue siendo una decisión metodológica importante
- todavía falta un Motor 2 paramétrico para contraste metodológico

## 7. Estado actual

- Motor 1 es usable como motor base
- no debe tratarse como árbitro absoluto único
- su cobertura histórica es buena, pero su mediana tiende a ser prudente
- próximo paso metodológico recomendado: Motor 2 paramétrico
