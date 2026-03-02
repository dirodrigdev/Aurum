# PATCH PACK K – HOTFIX BUILD (Typescript)

Arregla errores de compilación introducidos al aplicar K1 + K2:

1) **OtherProjectDetail.tsx**
   - Elimina referencias a `project.concepto` (no existe en el tipo `Project`).
   - En "Otros Proyectos" usa **concepto libre** (tomado del input actual) y lo guarda en `categoria` + `descripcion` para compatibilidad.
   - En edición toma el valor desde `descripcion || categoria` para no perder datos históricos.

2) **ProjectDetail.tsx**
   - Fix del date input: `setFecha` recibe string (YYYY-MM-DD), no `Date`.
   - Fix de Button variants: usa `primary` en lugar de `default`.

## Cómo aplicar
Copia y reemplaza los archivos en tu repo respetando la misma ruta:
- `src/pages/OtherProjectDetail.tsx`
- `src/pages/ProjectDetail.tsx`
