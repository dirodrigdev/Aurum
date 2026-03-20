# Validation Summary

## 1. Preprocess validation

### Que se midio

- medias antes y despues del preprocess
- volatilidades antes y despues

### Resultado clave

El preprocess movio las medias hacia los targets forward-looking sin alterar materialmente la volatilidad.

### Conclusion

Preprocess sano.

## 2. Attribution A/B/C/D

### Que se midio

Comparacion entre:

- baseline viejo
- preprocess only
- weighted only
- preprocess + weighted

### Resultado clave

El weighted bootstrap explicaba la mayor parte del cambio frente al motor original.

### Conclusion

La palanca dominante no era el preprocess, sino el weighting.

## 3. Half-life sensitivity

### Que se midio

Sensibilidad a half-life:

- 8
- 10
- 12
- 15 anos

### Resultado clave

El resultado era sensible al half-life, aunque de forma coherente: al reducir sesgo reciente subia `probRuin` y caia `terminalP50`.

### Conclusion

Sensibilidad material, pero no explosiva.

## 4. Weighted vs uniform

### Que se midio

Comparacion entre bootstrap uniforme y weighted, con preprocess activo.

### Resultado clave

Pasar a weighted movia mucho `probRuin` y `terminalP50`.

### Conclusion

El weighting no es un detalle tecnico menor; cambia el caracter del motor.

## 5. Block length sensitivity

### Que se midio

Block lengths:

- 6
- 12
- 18
- 24

### Resultado clave

`probRuin` cambiaba de forma visible, mientras `terminalP50` se mantenia relativamente mas estable.

### Conclusion

Sensibilidad moderada al block length.

## 6. Seed stability

### Que se midio

Variacion por seed.

### Resultado clave

- Motor 1: baja sensibilidad por seed
- Motores 2, 3 y 4: tambien baja sensibilidad por seed

### Conclusion

El ruido Monte Carlo no es el problema principal. La divergencia viene mas de arquitectura que de seed.

## 7. Walk-forward

### Que se midio

Cobertura historica en 5 cortes walk-forward.

### Resultado clave

Motor 1 logro cobertura fuerte dentro de `[P10, P90]`, con `P50` algo pesimista.

Motor 2 tambien cubrio, pero con mediana mas baja y bandas mas rigidas.

### Conclusion

La calibracion historica no favorece una lectura euforica. La mediana tiende a ser prudente o pesimista.

## 8. Survival metrics

### Que se midio

- min wealth observado
- max drawdown
- meses con recorte
- meses por debajo de 12 y 6 meses de gasto

### Resultado clave

Las ventanas historicas no mostraron ruina observada, pero si tramos tensos con recorte de gasto.

### Conclusion

La supervivencia historica fue razonable, aunque no siempre comoda.

## 9. Comparacion de motores

### Que se midio

Comparacion base entre motores:

- Motor 1
- Motor 2
- Motor 3
- Motor 4

### Resultado clave

- Motor 1: `probRuin ~ 4.98%`
- Motor 2: `probRuin ~ 40.58%`
- Motor 3: `probRuin ~ 39.40%`
- Motor 4: `probRuin ~ 38.78%`

### Conclusion

Existe una fractura metodologica real entre Motor 1 y el bloque prudente 2-4.

## 10. Robust Monte Carlo

### Que se midio

Sensibilidad al introducir incertidumbre en parametros.

### Resultado clave

Motor 4 no volvio el resultado mas benigno. Quedo cerca del bloque prudente.

### Conclusion

La incertidumbre de parametros confirma que la lectura prudente es robusta.

## Conclusión general

Los tests muestran tres cosas:

- Motor 1 no esta roto, pero es sensible al bootstrap y al weighting
- Motores 2, 3 y 4 convergen en una lectura mucho mas prudente
- el sistema necesita una decision metodologica explicita, no una preferencia implicita por un solo motor
