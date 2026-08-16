import {
  loadGastappCanonicalV2ContractsCached,
  type GastappCanonicalV2Contracts,
} from './gastappCanonicalV2';

export type GastappAuditCheckStatus = 'pass' | 'warning' | 'not_proven';

export type GastappCanonicalV2Concordance = {
  status: 'ok' | 'warning';
  canonicalDataHash: string;
  generatedAt: string | null;
  global: {
    identities: GastappAuditCheckStatus;
    rowCount: GastappAuditCheckStatus;
    total: GastappAuditCheckStatus;
    families: GastappAuditCheckStatus;
  };
  exactDateRange: {
    status: GastappAuditCheckStatus;
    detail: string;
  };
  rowControls: {
    status: GastappAuditCheckStatus;
    detail: string;
  };
  businessComparison: {
    periods12Eur: number | null;
    calendarMonths12Eur: number | null;
    differenceEur: number | null;
    status: 'informative' | 'unavailable';
    detail: string;
  };
};

export type GastappCanonicalV2AuditResult =
  | {
    status: 'ok' | 'warning';
    error: null;
    contracts: GastappCanonicalV2Contracts;
    concordance: GastappCanonicalV2Concordance;
  }
  | {
    status: 'unavailable';
    error: string;
    contracts: null;
    concordance: null;
  };

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const sameEur = (left: number | null, right: number | null) =>
  left !== null && right !== null && Math.abs(left - right) < 0.005;

const addNumberMap = (target: Record<string, number>, source: Record<string, number>) => {
  Object.entries(source).forEach(([key, value]) => {
    target[key] = round2((target[key] || 0) + value);
  });
  return target;
};

const sameNumberMap = (left: Record<string, number>, right: Record<string, number>) => {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every((key) => sameEur(round2(left[key] || 0), round2(right[key] || 0)));
};

export const buildGastappCanonicalV2Concordance = (
  contracts: GastappCanonicalV2Contracts,
): GastappCanonicalV2Concordance => {
  const { metadata, periods, months } = contracts;
  const periodFamilies = periods.periods.reduce<Record<string, number>>(
    (result, period) => addNumberMap(result, period.byFamily),
    {},
  );
  const monthFamilies = months.months.reduce<Record<string, number>>(
    (result, month) => addNumberMap(result, month.byFamily),
    {},
  );
  const periodRowCount = periods.periods.reduce((sum, period) => sum + period.rowCount, 0);
  const monthRowCount = months.months.reduce((sum, month) => sum + month.rowCount, 0);
  const periodTotal = round2(periods.periods.reduce((sum, period) => sum + period.totalEur, 0));
  const monthTotal = round2(months.months.reduce((sum, month) => sum + month.totalEur, 0));
  const global = {
    identities: periods.canonicalDataHash === months.canonicalDataHash && periods.canonicalDataHash === metadata.canonicalDataHash
      ? 'pass' as const
      : 'warning' as const,
    rowCount: periods.rowCount === months.rowCount && periods.rowCount === metadata.counts.canonicalRows && periodRowCount === monthRowCount
      ? 'pass' as const
      : 'warning' as const,
    total: sameEur(periods.totalEur, months.totalEur) && sameEur(periods.totalEur, metadata.totalsEur.exact) && sameEur(periodTotal, monthTotal)
      ? 'pass' as const
      : 'warning' as const,
    families: sameNumberMap(periodFamilies, monthFamilies)
      ? 'pass' as const
      : 'warning' as const,
  };

  const eligibleMonths = months.months.filter((month) => month.status === 'complete' && month.eligibleForAurumReturns);
  const periods12Eur = periods.periods.length >= 12
    ? round2(periods.periods.slice(-12).reduce((sum, period) => sum + period.totalEur, 0))
    : null;
  const calendarMonths12Eur = eligibleMonths.length >= 12
    ? round2(eligibleMonths.slice(-12).reduce((sum, month) => sum + month.totalEur, 0))
    : null;

  return {
    status: Object.values(global).every((value) => value === 'pass') ? 'warning' : 'warning',
    canonicalDataHash: metadata.canonicalDataHash,
    generatedAt: metadata.generatedAt || months.generatedAt || periods.generatedAt,
    global,
    exactDateRange: {
      status: 'not_proven',
      detail: 'Los contratos publicados contienen agregados, no identidades de fila ni el payload transaccional necesario para reagrupar un rango exacto. No se realiza una lectura amplia para suplirlo.',
    },
    rowControls: {
      status: 'not_proven',
      detail: 'El hash canónico y los conteos globales concuerdan; la ausencia de duplicados o pérdida por fila requiere controles de identidad en el contrato final o una descarga Data Room solicitada.',
    },
    businessComparison: {
      periods12Eur,
      calendarMonths12Eur,
      differenceEur: periods12Eur !== null && calendarMonths12Eur !== null
        ? round2(calendarMonths12Eur - periods12Eur)
        : null,
      status: periods12Eur !== null && calendarMonths12Eur !== null ? 'informative' : 'unavailable',
      detail: periods12Eur !== null && calendarMonths12Eur !== null
        ? 'Comparación informativa: 12 períodos reales y 12 meses calendario son ventanas nativas distintas; una diferencia no es un error de integridad.'
        : 'No hay 12 unidades elegibles en ambos ejes para esta comparación informativa.',
    },
  };
};

export const loadGastappCanonicalV2Audit = async (): Promise<GastappCanonicalV2AuditResult> => {
  try {
    const contracts = await loadGastappCanonicalV2ContractsCached();
    const concordance = buildGastappCanonicalV2Concordance(contracts);
    return { status: concordance.status, error: null, contracts, concordance };
  } catch (error: any) {
    return {
      status: 'unavailable',
      error: String(error?.message || error || 'No se pudo cargar la auditoría Canónico V2.'),
      contracts: null,
      concordance: null,
    };
  }
};
