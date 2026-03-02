# PATCH PACK K2 — ProjectDetail (Projects)

Objetivo: reducir lecturas y evitar listeners a toda la colección en Projects.

Cambios:
- `ProjectDetail.tsx`: reemplaza el `onSnapshot(query(...project_expenses...))` sin límite por:
  - `subscribeToProjectExpensesFirstPage(projectId, 50)` (realtime, barato)
  - `getProjectExpensesPage(projectId, 50, cursor)` con botón **Cargar más**
- Al guardar/editar/borrar gastos usa servicios transaccionales:
  - `addProjectExpense` / `updateProjectExpense` / `deleteProjectExpense`
  - elimina el anti-patrón **delete + add** al editar.
- Totales: usa agregados del Project (`gasto_total_eur`, `gasto_total_local`) con fallback a cálculo si faltan.

Notas:
- No toca schema ni reglas.
- Índices Firestore: este patrón usa `where(proyecto_id) + orderBy(fecha desc)` (si Firestore pide índice, se crea 1 vez).
