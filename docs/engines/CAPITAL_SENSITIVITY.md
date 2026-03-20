# Capital Sensitivity

## Escenarios

- Base: `1,401.0MM`
- Intermedio: `1,900.0MM`
- Alto: `2,500.0MM`

## Tabla resumida

| Capital | Motor 1 | Motor 2 | Motor 3 | Motor 4 |
|---|---:|---:|---:|---:|
| 1,401.0MM | 4.98% | 40.58% | 39.40% | 38.78% |
| 1,900.0MM | 0.30% | 10.18% | 10.10% | 10.08% |
| 2,500.0MM | 0.04% | 1.50% | 0.80% | 1.44% |

Valores en tabla: `probRuin`.

## Lectura principal

El capital cambia radicalmente el resultado en los cuatro motores.

- con `1.4B`, el sistema esta en zona fragil
- con `1.9B`, entra en una zona intermedia mucho mas defendible
- con `2.5B`, incluso los motores prudentes caen a una zona bastante baja de ruina

## Convergencia entre motores

La distancia entre motores sigue existiendo, pero se achica mucho al subir capital.

- a `1.4B`, la brecha metodologica domina
- a `1.9B`, los motores prudentes convergen en torno a `~10%`
- a `2.5B`, los motores prudentes convergen en torno a `~1%`

## Zonas practicas

### Fragil

`~1.4B`

- Motor 1: bajo riesgo
- Motores 2-4: riesgo alto

Conclusión: nivel todavia discutible.

### Intermedia

`~1.9B`

- Motor 1: riesgo casi nulo
- Motores 2-4: alrededor de `10%`

Conclusión: empieza a verse defendible.

### Robusta

`~2.5B`

- Motor 1: practicamente sin ruina
- Motores 2-4: entre `0.8%` y `1.5%`

Conclusión: zona materialmente mas comoda incluso bajo lecturas prudentes.
