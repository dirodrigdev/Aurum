// integrations/aurum/types.ts
// Contrato entre Midas y Aurum — solo lectura, solo snapshots publicados
// Aurum escribe aquí. Midas solo lee.
// Firestore path: users/{uid}/aurum/published/wealthSnapshot

/**
 * Snapshot patrimonial publicado por Aurum.
 * Midas NO debe leer colecciones internas de Aurum.
 * Midas solo consume este documento explícitamente publicado.
 */
export interface AurumWealthSnapshot {
  version:       string;       // "1.0"
  publishedAt:   string;       // ISO date
  snapshotDate:  string;       // ISO date del cierre

  // Capital total en CLP nominal
  totalCapitalCLP: number;

  // Composición por sleeve (% del total)
  // Aurum calcula esto desde sus posiciones reales
  allocation: {
    rvGlobal:  number;  // % 0-1
    rfGlobal:  number;
    rvChile:   number;
    rfChile:   number;
    cash:      number;
    other:     number;
  };

  // FX de referencia usado en el cierre
  fxReference: {
    clpUsd: number;
    usdEur: number;
    clpEur: number;
  };

  // Metadata
  source: 'aurum-manual' | 'aurum-auto';
  notes?: string;
}

/**
 * Resumen de proyección publicado por Midas para Aurum.
 * Aurum puede mostrar esto en su dashboard como contexto.
 * Firestore path: users/{uid}/midas/published/latestProjection
 */
export interface MidasProjectionSummary {
  version:       string;
  publishedAt:   string;
  simulatedAt:   string;
  horizonYears:  number;

  probRuin:      number;  // 0-1
  terminalP50:   number;  // CLP real
  terminalP10:   number;
  terminalP90:   number;

  scenarioLabel: string;
  nSimulations:  number;

  // Flag para que Aurum sepa si los datos base son recientes
  capitalSnapshotDate?: string;
}
