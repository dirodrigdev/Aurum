# PATCH PACK J — Build fix TS2698 + mantiene TX order (Trips/Projects)

## Qué arregla
- Corrige el error de TypeScript `TS2698: Spread types may only be created from object types` en `src/services/db.ts`.
- Mantiene el fix de transacciones Firestore (reads antes de writes) para gastos de **Trips/Projects**.

## Qué cambia
- Solo 1 archivo:
  - `src/services/db.ts`

## Cómo aplicar
- Copia `src/services/db.ts` sobre tu repo, reemplazando el existente.
