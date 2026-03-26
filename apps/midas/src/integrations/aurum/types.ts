// integrations/aurum/types.ts
// Contrato entre Midas y Aurum — solo lectura, solo snapshots publicados.
// Aurum escribe snapshots publicados; Midas solo consume esos snapshots.

/**
 * Snapshot legacy de composición patrimonial.
 * Se mantiene por compatibilidad del contrato histórico.
 * Path histórico: users/{uid}/aurum/published/wealthSnapshot
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
 * Snapshot público y explícito de inversiones optimizables.
 * Midas lo usa solo como referencia oficial para la base instrumental.
 * Firestore path: aurum_published/optimizableInvestments
 */
export interface AurumOptimizableInvestmentsSnapshotV1 {
  version: 1;
  publishedAt: string;
  snapshotMonth: string;
  snapshotLabel: string;
  currency: 'CLP';
  totalNetWorthCLP: number;
  totalNetWorthWithRiskCLP?: number;
  optimizableInvestmentsCLP: number;
  optimizableInvestmentsWithRiskCLP?: number;
  source: {
    app: 'aurum';
    basis: 'latest_confirmed_closure';
  };
}

export interface AurumRealEstateSnapshot {
  propertyValueCLP?: number;
  realEstateEquityCLP?: number;
  mortgageDebtOutstandingCLP?: number;
  monthlyMortgagePaymentCLP?: number;
  mortgageEndDate?: string;
  mortgageRate?: number;
  amortizationSystem?: 'french' | 'constant' | string;
  mortgageScheduleCLP?: Array<{ month: number; debtCLP: number }>;
}

export interface AurumOptimizableInvestmentsSnapshotV2 {
  version: 2;
  publishedAt: string;
  snapshotMonth: string;
  snapshotLabel: string;
  currency: 'CLP';
  totalNetWorthCLP: number;
  totalNetWorthWithRiskCLP?: number;
  optimizableInvestmentsCLP: number;
  optimizableInvestmentsWithRiskCLP?: number;
  nonOptimizable?: {
    banksCLP?: number;
    nonMortgageDebtCLP?: number;
    realEstate?: AurumRealEstateSnapshot;
  };
  source: {
    app: 'aurum';
    basis: 'latest_confirmed_closure';
  };
}

export type AurumOptimizableInvestmentsSnapshot =
  | AurumOptimizableInvestmentsSnapshotV1
  | AurumOptimizableInvestmentsSnapshotV2;

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
