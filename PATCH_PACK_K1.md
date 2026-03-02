# Pack K1 — Paginación en detalles (Viajes + Otros Proyectos)

## Objetivo
Bajar el costo de Firestore y evitar que el detalle de un proyecto/viaje escuche cientos/miles de docs en realtime.

## Cambios
- **TripDetail** y **OtherProjectDetail** ahora:
  - escuchan en tiempo real **solo los últimos 50 gastos** (primera página), y
  - permiten traer páginas anteriores con un botón **“Cargar más”**.
- Los **totales** se muestran desde los agregados del documento del proyecto (`gasto_total_eur`, `gasto_total_local`, `gastos_count`).
  - Si el proyecto es legacy y no tiene esos campos, se dispara un **recalculo one-shot** (`ensureProjectAggregatesIfMissing`).

## Archivos tocados
- `src/pages/TripDetail.tsx`
- `src/pages/OtherProjectDetail.tsx`

## Posible requerimiento de índice
Las queries usan `where('proyecto_id','==',id)` + `orderBy('fecha','desc')`.
Si Firestore te pide índice, lo creas así:
1) Abre la consola Firebase → **Firestore Database** → **Indexes**.
2) **Add index** (Composite index):
   - Collection: `project_expenses`
   - Fields:
     - `proyecto_id` → **Ascending**
     - `fecha` → **Descending**
   - Query scope: Collection
3) Guardas y esperas a que quede **Enabled**.

