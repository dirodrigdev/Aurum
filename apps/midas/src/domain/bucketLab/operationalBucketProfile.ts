import type { InstrumentUniverseInstrument, InstrumentUniverseSnapshot } from '../instrumentUniverse';

export type BucketLayerId =
  | 'hard_cash'
  | 'near_cash'
  | 'pure_fixed_income'
  | 'conservative_balanced'
  | 'moderate_balanced'
  | 'aggressive_balanced'
  | 'equity_like'
  | 'restricted'
  | 'unknown';

export type BucketLayerSummary = {
  layer: BucketLayerId;
  amountClp: number;
  pctPortfolio: number;
  runwayMonths: number;
  embeddedEquityClp: number;
  embeddedFixedIncomeClp: number;
  comment: string;
};

export type BucketInstrumentRow = {
  instrumentId: string;
  name: string;
  manager: string;
  vehicleType: string;
  role: string;
  currency: string;
  amountClp: number;
  layer: BucketLayerId;
  isSellable: boolean | null;
  isCaptive: boolean | null;
  rvMix: number | null;
  rfMix: number | null;
  cashMix: number | null;
  otherMix: number | null;
  embeddedEquityClp: number;
  embeddedFixedIncomeClp: number;
  warnings: string[];
};

export type OperationalBucketProfile = {
  source: 'instrument_universe' | 'missing';
  coveragePctByClp: number;
  hardCashClp: number;
  nearCashClp: number;
  pureFixedIncomeClp: number;
  cleanDefensiveClp: number;
  mixedFundClp: number;
  embeddedEquityClp: number;
  embeddedFixedIncomeClp: number;
  equityLikeClp: number;
  unknownClp: number;
  restrictedClp: number;
  hardCashRunwayMonths: number;
  nearCashRunwayMonths: number;
  pureFixedIncomeRunwayMonths: number;
  cleanDefensiveRunwayMonths: number;
  mixedFundRunwayMonths: number;
  stressAdjustedRunwayMonths: number;
  embeddedEquitySoldClp: number;
  embeddedEquitySoldPct: number;
  monthlySpendClp: number;
  layerSummaries: BucketLayerSummary[];
  instruments: BucketInstrumentRow[];
  warnings: string[];
};

export type BuildOperationalBucketProfileInput = {
  snapshot: InstrumentUniverseSnapshot | null;
  monthlySpendClp: number;
  includeCaptive: boolean;
  includeRiskCapital: boolean;
};

type Mix = { rv: number; rf: number; cash: number; other: number };

const LAYERS: BucketLayerId[] = [
  'hard_cash',
  'near_cash',
  'pure_fixed_income',
  'conservative_balanced',
  'moderate_balanced',
  'aggressive_balanced',
  'equity_like',
  'restricted',
  'unknown',
];

const LABELS: Record<BucketLayerId, string> = {
  hard_cash: 'Cash duro',
  near_cash: 'Near-cash',
  pure_fixed_income: 'RF pura',
  conservative_balanced: 'Balanceado conservador',
  moderate_balanced: 'Balanceado moderado',
  aggressive_balanced: 'Balanceado agresivo',
  equity_like: 'Renta variable',
  restricted: 'Restringido',
  unknown: 'Desconocido',
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const isFinitePositive = (value: number) => Number.isFinite(value) && value > 0;

const normalizeMix = (mix: InstrumentUniverseInstrument['currentMixUsed']): Mix | null => {
  if (!mix) return null;
  const rv = clamp01(Number(mix.rv ?? 0));
  const rf = clamp01(Number(mix.rf ?? 0));
  const cash = clamp01(Number(mix.cash ?? 0));
  const other = clamp01(Number(mix.other ?? 0));
  const sum = rv + rf + cash + other;
  if (!isFinitePositive(sum)) return null;
  return {
    rv: rv / sum,
    rf: rf / sum,
    cash: cash / sum,
    other: other / sum,
  };
};

const looksLike = (text: string | null, patterns: RegExp[]) => {
  if (!text) return false;
  return patterns.some((pattern) => pattern.test(text));
};

const inferLayer = (
  instrument: InstrumentUniverseInstrument,
  mix: Mix | null,
  includeCaptive: boolean,
  includeRiskCapital: boolean,
): { layer: BucketLayerId; comment: string } => {
  const name = (instrument.name || '').toLowerCase();
  const vehicleType = (instrument.vehicleType || '').toLowerCase();
  const role = (instrument.role || '').toLowerCase();
  const structuralDriver = (instrument.structuralMixDriver || '').toLowerCase();
  const combined = `${name} ${vehicleType} ${role} ${structuralDriver}`;
  const isCaptive = Boolean(instrument.isCaptive);
  const isRisk = /risk|riesgo|capital de riesgo|crp/.test(combined);
  if ((isCaptive && !includeCaptive) || (isRisk && !includeRiskCapital)) {
    return { layer: 'restricted', comment: 'Excluido por regla operativa' };
  }
  if (isCaptive) {
    return { layer: 'restricted', comment: 'Instrumento cautivo/restringido' };
  }
  if (looksLike(combined, [/cash/, /caja/, /banco/, /cuenta corriente/, /liquidez usd/, /wise/, /global66/])) {
    return { layer: 'hard_cash', comment: 'Liquidez operativa inmediata' };
  }
  if (looksLike(combined, [/money market/, /short duration/, /ultra short/, /depósito a plazo corto/])) {
    return { layer: 'near_cash', comment: 'Liquidez casi inmediata' };
  }
  if (!mix) {
    return { layer: 'unknown', comment: 'Sin mix usable' };
  }
  if (mix.rv <= 0.03 && mix.rf + mix.cash >= 0.9) {
    return { layer: 'pure_fixed_income', comment: 'Defensa limpia (RF/cash)' };
  }
  if (mix.rv > 0.03 && mix.rv <= 0.2) {
    return { layer: 'conservative_balanced', comment: 'Balanceado con RV baja embebida' };
  }
  if (mix.rv > 0.2 && mix.rv <= 0.45) {
    return { layer: 'moderate_balanced', comment: 'Balanceado con RV media embebida' };
  }
  if (mix.rv > 0.45 && mix.rv <= 0.7) {
    return { layer: 'aggressive_balanced', comment: 'Balanceado con RV alta embebida' };
  }
  if (mix.rv > 0.7) {
    return { layer: 'equity_like', comment: 'Exposición dominante a RV' };
  }
  return { layer: 'unknown', comment: 'Clasificación incierta' };
};

const runway = (amountClp: number, monthlySpendClp: number) =>
  monthlySpendClp > 0 ? amountClp / monthlySpendClp : 0;

export function buildOperationalBucketProfile(
  input: BuildOperationalBucketProfileInput,
): OperationalBucketProfile {
  const monthlySpendClp = Math.max(1, Number(input.monthlySpendClp || 0));
  const snapshot = input.snapshot;
  if (!snapshot || !Array.isArray(snapshot.instruments) || snapshot.instruments.length === 0) {
    return {
      source: 'missing',
      coveragePctByClp: 0,
      hardCashClp: 0,
      nearCashClp: 0,
      pureFixedIncomeClp: 0,
      cleanDefensiveClp: 0,
      mixedFundClp: 0,
      embeddedEquityClp: 0,
      embeddedFixedIncomeClp: 0,
      equityLikeClp: 0,
      unknownClp: 0,
      restrictedClp: 0,
      hardCashRunwayMonths: 0,
      nearCashRunwayMonths: 0,
      pureFixedIncomeRunwayMonths: 0,
      cleanDefensiveRunwayMonths: 0,
      mixedFundRunwayMonths: 0,
      stressAdjustedRunwayMonths: 0,
      embeddedEquitySoldClp: 0,
      embeddedEquitySoldPct: 0,
      monthlySpendClp,
      layerSummaries: [],
      instruments: [],
      warnings: ['No hay Instrument Universe activo para construir el perfil.'],
    };
  }

  const instruments: BucketInstrumentRow[] = [];
  const totalsByLayer: Record<BucketLayerId, number> = {
    hard_cash: 0,
    near_cash: 0,
    pure_fixed_income: 0,
    conservative_balanced: 0,
    moderate_balanced: 0,
    aggressive_balanced: 0,
    equity_like: 0,
    restricted: 0,
    unknown: 0,
  };
  let embeddedEquityClp = 0;
  let embeddedFixedIncomeClp = 0;
  const warnings: string[] = [];
  const valid = snapshot.instruments.filter((item) => Number.isFinite(item.amountClp) && Number(item.amountClp) > 0);
  const totalAmount = valid.reduce((sum, item) => sum + Number(item.amountClp || 0), 0);

  for (const instrument of valid) {
    const amountClp = Math.max(0, Number(instrument.amountClp || 0));
    const mix = normalizeMix(instrument.currentMixUsed);
    const layerInfo = inferLayer(instrument, mix, input.includeCaptive, input.includeRiskCapital);
    const eqEmbedded = amountClp * (mix?.rv ?? 0);
    const fiEmbedded = amountClp * ((mix?.rf ?? 0) + (mix?.cash ?? 0));
    if (layerInfo.layer === 'conservative_balanced' || layerInfo.layer === 'moderate_balanced' || layerInfo.layer === 'aggressive_balanced') {
      embeddedEquityClp += eqEmbedded;
      embeddedFixedIncomeClp += fiEmbedded;
    }
    if (!mix) warnings.push(`${instrument.instrumentId}: mix no disponible (unknown).`);
    totalsByLayer[layerInfo.layer] += amountClp;
    instruments.push({
      instrumentId: instrument.instrumentId,
      name: instrument.name || 'unknown',
      manager: (instrument.name || '').split(' ')[0] || 'unknown',
      vehicleType: instrument.vehicleType || 'unknown',
      role: instrument.role || 'unknown',
      currency: instrument.currency || 'unknown',
      amountClp,
      layer: layerInfo.layer,
      isSellable: instrument.isSellable,
      isCaptive: instrument.isCaptive,
      rvMix: mix?.rv ?? null,
      rfMix: mix?.rf ?? null,
      cashMix: mix?.cash ?? null,
      otherMix: mix?.other ?? null,
      embeddedEquityClp: eqEmbedded,
      embeddedFixedIncomeClp: fiEmbedded,
      warnings: [...instrument.warnings],
    });
  }

  const hardCashClp = totalsByLayer.hard_cash;
  const nearCashClp = totalsByLayer.near_cash;
  const pureFixedIncomeClp = totalsByLayer.pure_fixed_income;
  const cleanDefensiveClp = hardCashClp + nearCashClp + pureFixedIncomeClp;
  const mixedFundClp =
    totalsByLayer.conservative_balanced + totalsByLayer.moderate_balanced + totalsByLayer.aggressive_balanced;
  const equityLikeClp = totalsByLayer.equity_like;
  const unknownClp = totalsByLayer.unknown;
  const restrictedClp = totalsByLayer.restricted;
  const stressAdjustedRunwayMonths = runway(cleanDefensiveClp + embeddedFixedIncomeClp, monthlySpendClp);
  const embeddedEquitySoldPct = mixedFundClp > 0 ? embeddedEquityClp / mixedFundClp : 0;

  const layerSummaries: BucketLayerSummary[] = LAYERS.map((layer) => {
    const amountClp = totalsByLayer[layer];
    const pctPortfolio = totalAmount > 0 ? amountClp / totalAmount : 0;
    const layerEqEmbedded = instruments
      .filter((item) => item.layer === layer)
      .reduce((sum, item) => sum + item.embeddedEquityClp, 0);
    const layerFiEmbedded = instruments
      .filter((item) => item.layer === layer)
      .reduce((sum, item) => sum + item.embeddedFixedIncomeClp, 0);
    return {
      layer,
      amountClp,
      pctPortfolio,
      runwayMonths: runway(amountClp, monthlySpendClp),
      embeddedEquityClp: layerEqEmbedded,
      embeddedFixedIncomeClp: layerFiEmbedded,
      comment: LABELS[layer],
    };
  });

  const classifiedAmount =
    totalAmount - totalsByLayer.unknown - totalsByLayer.restricted;
  return {
    source: 'instrument_universe',
    coveragePctByClp: totalAmount > 0 ? Math.max(0, classifiedAmount) / totalAmount : 0,
    hardCashClp,
    nearCashClp,
    pureFixedIncomeClp,
    cleanDefensiveClp,
    mixedFundClp,
    embeddedEquityClp,
    embeddedFixedIncomeClp,
    equityLikeClp,
    unknownClp,
    restrictedClp,
    hardCashRunwayMonths: runway(hardCashClp, monthlySpendClp),
    nearCashRunwayMonths: runway(nearCashClp, monthlySpendClp),
    pureFixedIncomeRunwayMonths: runway(pureFixedIncomeClp, monthlySpendClp),
    cleanDefensiveRunwayMonths: runway(cleanDefensiveClp, monthlySpendClp),
    mixedFundRunwayMonths: runway(mixedFundClp, monthlySpendClp),
    stressAdjustedRunwayMonths,
    embeddedEquitySoldClp: embeddedEquityClp,
    embeddedEquitySoldPct,
    monthlySpendClp,
    layerSummaries,
    instruments,
    warnings: Array.from(new Set(warnings)),
  };
}
