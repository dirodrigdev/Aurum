# Pack C — Huérfanos (ProjectExpenses sin Project) + Borrado en cascada

## Qué cambia

### 1) Mantenimiento (Settings)
- **Auditar Huérfanos** ahora usa una función de servicio que mira **projects vs project_expenses** en servidor y devuelve:
  - total
  - top de `proyecto_id` faltantes
  - muestra de gastos (hasta 5)
- **Nuevo botón:** **Limpiar Huérfanos (marcar borrado)**
  - Marca `estado: 'borrado'` (no hard-delete)
  - Agrega metadata: `orphan_reason`, `orphan_project_id`, `orphaned_at`, `updated_at`
  - Confirma con prompt (hay que escribir **BORRAR**)

### 2) Robustez al borrar proyectos
- `deleteProject(id)` ahora hace **cascade hard-delete** de `project_expenses` con `proyecto_id == id` **antes** de borrar el proyecto.
  - Objetivo: que **no vuelvan a generarse huérfanos** por borrado de proyecto.
  - Nota: esto sí es hard-delete (el proyecto ya no existirá).

## Archivos tocados
- `src/services/db.ts`
- `src/pages/Settings.tsx`

## Rollback (rápido)
- Si quieres volver atrás: reemplaza estos 2 archivos por los anteriores al patch.

