# CODEX PROMPT — Midas V1.2
# Leer antes de tocar cualquier archivo

## Arquitectura
```
apps/midas/src/
  App.tsx                    ← UI principal — routing y estado global
  main.tsx                   ← entry point
  domain/
    model/
      types.ts               ← tipos del dominio — NO modificar sin análisis
      defaults.ts            ← parámetros calibrados — NO inventar valores
    simulation/
      engine.ts              ← motor Monte Carlo — NO modificar
      historicalData.ts      ← 314 meses de datos reales — NO modificar
    optimizer/
      gridSearch.ts          ← optimizador grid search
  integrations/
    aurum/
      types.ts               ← contrato Midas ↔ Aurum (solo lectura)
      adapters.ts            ← conversión snapshot → params
```

## Monorepo (estructura futura)
```
repo/
  apps/
    aurum/    ← app existente
    midas/    ← este directorio
  packages/
    firebase/ ← solo infraestructura: initializeApp, auth, db
    contracts/ ← tipos compartidos: AurumWealthSnapshot, MidasProjectionSummary
  package.json (npm workspaces)
```

## Reglas estrictas
1. NO modificar domain/simulation/engine.ts sin instrucción explícita
2. NO modificar domain/model/defaults.ts sin datos de respaldo
3. NO inventar retornos, volatilidades ni correlaciones
4. Parámetros PLACEHOLDER (fx.tcrealLT) deben mostrar advertencia visual
5. Suma de weights debe validarse en tiempo real
6. La app es mobile-first — breakpoint principal: 390px

## Design system
- bg: #0E1116 / surface: #151922 / elevated: #1B2130
- border: #262C3D
- text: #E8ECF3 / secondary: #A3ACBB / muted: #6F788A
- primary: #5B8CFF — SOLO para el KPI principal
- positive: #3FBF7F / warning: #D4A65A / negative: #D45A5A
- metal: #8A94A6 / #B6C0D4 — bordes, iconos, decorativo
- Un pantalla = una pregunta principal
- Un card = una idea

## Tareas pendientes para Codex

### TAREA-1 (alta prioridad): Mobile layout
El App.tsx actual está diseñado para desktop.
Agregar responsive breakpoints para mobile (390px):
- En mobile: sidebar colapsa a bottom sheet o modal
- Tabs se convierten en bottom navigation
- Cards pasan de grid a stack vertical
- HeroKPI mantiene tamaño prominente

### TAREA-2: Web Worker para simulación
Mover runSimulation() a un Web Worker para no bloquear UI.
Crear: src/domain/simulation/simulation.worker.ts
El worker recibe ModelParameters, devuelve SimulationResults + progreso.

### TAREA-3: Persistencia Firestore
Cuando Firebase esté configurado en packages/firebase:
- Guardar escenarios en: users/{uid}/midas/scenarios/{id}
- Guardar resultados en: users/{uid}/midas/runs/{id}
- Publicar resumen en: users/{uid}/midas/published/latestProjection
Crear: src/services/scenarioService.ts y runService.ts

### TAREA-4: Leer snapshot de Aurum
Cuando Aurum publique snapshots patrimoniales:
- Leer desde: users/{uid}/aurum/published/wealthSnapshot
- Usar: src/integrations/aurum/adapters.ts → snapshotToParams()
- Mostrar en UI: banner "Datos desde Aurum — {fecha}"
NUNCA leer colecciones internas de Aurum.

## Datos históricos — actualización futura
Cuando lleguen datos nuevos, SOLO modificar:
src/domain/simulation/historicalData.ts
Agregar filas al array HISTORICAL_DATA. El motor los usa automáticamente.
