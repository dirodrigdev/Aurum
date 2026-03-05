# Plantilla mínima para reconstruir historia (Aurum)

Usa este formato para pedirle a Gemini los datos de **enero, febrero y marzo**.

## 1) Resumen mensual (obligatorio)

Completa una fila por mes:

```csv
month_key,closed_at,usd_clp,eur_clp,uf_clp,sura_fin_clp,sura_prev_clp,btg_clp,planvital_clp,global66_usd,wise_usd,valor_prop_uf,saldo_deuda_uf,dividendo_uf,interes_uf,seguros_uf,amortizacion_uf,bancos_clp,bancos_usd,tarjetas_clp,tarjetas_usd
2026-01,2026-01-31T23:59:59-03:00,,,,,,,,,,,,,,,,,,,
2026-02,2026-02-28T23:59:59-03:00,,,,,,,,,,,,,,,,,,,
2026-03,2026-03-31T23:59:59-03:00,,,,,,,,,,,,,,,,,,,
```

## 2) Regla de signos

- En la planilla, los montos van **positivos** (incluyendo deudas).
- Aurum aplica signo interno por bloque:
  - `investment`, `real_estate`, `bank`: activos
  - `debt`: resta

## 3) Campos clave

- `month_key`: `YYYY-MM`
- `closed_at`: fecha-hora de cierre del mes (ISO, idealmente con zona `-03:00` para Chile).
- `usd_clp`, `eur_clp`, `uf_clp`: tipos de cambio/UF del cierre de ese mes.
- Inversiones:
  - `sura_fin_clp`
  - `sura_prev_clp`
  - `btg_clp`
  - `planvital_clp`
  - `global66_usd`
  - `wise_usd`
- Bienes raíces:
  - `valor_prop_uf`
  - `saldo_deuda_uf`
  - `dividendo_uf`
  - `interes_uf`
  - `seguros_uf`
  - `amortizacion_uf`
- Bancos/tarjetas (agregados mensuales):
  - `bancos_clp`, `bancos_usd`
  - `tarjetas_clp`, `tarjetas_usd`

## 4) Opcional: detalle fino por ítem

Si quieres precisión por banco o por tarjeta, agrega además una tabla detallada:

```csv
month_key,block,source,label,currency,amount,snapshot_date,note
2026-03,bank,Banco de Chile,Banco de Chile CLP,CLP,0,2026-03-31,
2026-03,debt,Manual tarjetas,Visa Banco de Chile,CLP,0,2026-03-31,
```

Esto permite reconstrucción fina sin perder el resumen mensual.
