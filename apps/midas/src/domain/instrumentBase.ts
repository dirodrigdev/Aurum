import type { PortfolioWeights } from './model/types';

export type InstrumentExposure = {
  rv: number;
  rf: number;
  global: number;
  local: number;
};

export type InstrumentBaseItem = {
  id: string;
  name: string;
  manager: string;
  currency: string;
  currentAmountCLP: number;
  exposure: InstrumentExposure;
};

export type InstrumentBaseSnapshot = {
  version: 1;
  savedAt: string;
  rawJson: string;
  instruments: InstrumentBaseItem[];
};

export type InstrumentBaseSummary = {
  instrumentCount: number;
  managerCount: number;
  totalAmountCLP: number;
  weightedExposure: InstrumentExposure | null;
  coverageVsOptimizableBaseRatio: number | null;
  differenceVsOptimizableBaseClp: number | null;
};

export type CoverageQuality = 'high' | 'partial' | 'insufficient' | 'unknown';

export type InstrumentImplicitMix = {
  rv: number;
  rf: number;
  global: number;
  local: number;
  sleeves: {
    rvGlobal: number;
    rvChile: number;
    rfGlobal: number;
    rfChile: number;
  };
};

export type OptimizableBaseReference = {
  amountClp: number | null;
  asOf: string | null;
  sourceLabel: string;
  status: 'available' | 'pending';
};

export type InstrumentSleeveKey = keyof PortfolioWeights;

export type InstrumentProposalQuality = 'high' | 'partial' | 'low';

export type InstrumentMove = {
  fromId: string;
  fromName: string;
  fromManager: string;
  toId: string;
  toName: string;
  toManager: string;
  currency: string;
  amountClp: number;
  fromSleeve: InstrumentSleeveKey;
  toSleeve: InstrumentSleeveKey;
  reason: string;
};

export type InstrumentProposal = {
  moves: InstrumentMove[];
  quality: InstrumentProposalQuality;
  coverageRatio: number;
  withinManagerShare: number;
  currentMix: PortfolioWeights;
  targetMix: PortfolioWeights;
  proposedMix: PortfolioWeights;
  baseTotalClp: number;
  notes: string[];
};

export type InstrumentBaseValidation = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  snapshot: InstrumentBaseSnapshot | null;
  summary: InstrumentBaseSummary | null;
};

const STORAGE_KEY = 'midas.instrument-base.v1';
const VERSION = 1 as const;
const PAIR_TOLERANCE = 0.02;

const asFiniteNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const toId = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const normalizePair = (
  leftRaw: unknown,
  rightRaw: unknown,
  leftLabel: string,
  rightLabel: string,
): { left: number; right: number; errors: string[] } => {
  const leftNum = asFiniteNumber(leftRaw);
  const rightNum = asFiniteNumber(rightRaw);
  if (leftNum === null || rightNum === null) {
    return {
      left: 0,
      right: 0,
      errors: [`Exposición inválida en ${leftLabel}/${rightLabel}.`],
    };
  }

  const usePercentScale = Math.abs(leftNum) > 1 || Math.abs(rightNum) > 1;
  const left = usePercentScale ? leftNum / 100 : leftNum;
  const right = usePercentScale ? rightNum / 100 : rightNum;

  const errors: string[] = [];
  if (left < 0 || left > 1 || right < 0 || right > 1) {
    errors.push(`Exposición fuera de rango en ${leftLabel}/${rightLabel}.`);
  }
  if (Math.abs(left + right - 1) > PAIR_TOLERANCE) {
    errors.push(`${leftLabel} + ${rightLabel} debe sumar 100%.`);
  }

  return { left, right, errors };
};

const buildSummary = (
  snapshot: InstrumentBaseSnapshot,
  optimizableBaseClp?: number | null,
): InstrumentBaseSummary => {
  const totalAmountCLP = snapshot.instruments.reduce((sum, item) => sum + item.currentAmountCLP, 0);
  const managerCount = new Set(snapshot.instruments.map((item) => item.manager)).size;

  const weightedExposure =
    totalAmountCLP > 0
      ? snapshot.instruments.reduce<InstrumentExposure>(
          (acc, item) => {
            const weight = item.currentAmountCLP / totalAmountCLP;
            acc.rv += item.exposure.rv * weight;
            acc.rf += item.exposure.rf * weight;
            acc.global += item.exposure.global * weight;
            acc.local += item.exposure.local * weight;
            return acc;
          },
          { rv: 0, rf: 0, global: 0, local: 0 },
        )
      : null;

  const coverageVsOptimizableBaseRatio =
    optimizableBaseClp && Number.isFinite(optimizableBaseClp) && optimizableBaseClp > 0
      ? totalAmountCLP / optimizableBaseClp
      : null;

  return {
    instrumentCount: snapshot.instruments.length,
    managerCount,
    totalAmountCLP,
    weightedExposure,
    coverageVsOptimizableBaseRatio,
    differenceVsOptimizableBaseClp:
      coverageVsOptimizableBaseRatio === null || !optimizableBaseClp || !Number.isFinite(optimizableBaseClp)
        ? null
        : totalAmountCLP - optimizableBaseClp,
  };
};

const parseRootArray = (parsed: unknown): unknown[] | null => {
  if (Array.isArray(parsed)) return parsed;
  if (
    parsed &&
    typeof parsed === 'object' &&
    (Array.isArray((parsed as { instruments?: unknown[] }).instruments) ||
      Array.isArray((parsed as { instrumentos?: unknown[] }).instrumentos))
  ) {
    if (Array.isArray((parsed as { instruments?: unknown[] }).instruments)) {
      return (parsed as { instruments: unknown[] }).instruments;
    }
    return (parsed as { instrumentos: unknown[] }).instrumentos;
  }
  return null;
};

const resolveName = (source: Record<string, unknown>) =>
  String(source.name || source.instrumento || source.instrument || '').trim();

const resolveManager = (source: Record<string, unknown>) =>
  String(source.manager || source.provider || source.administradora || '').trim();

const resolveCurrency = (source: Record<string, unknown>) => {
  const raw = String(source.currency || source.moneda || source.ccy || '').trim().toUpperCase();
  if (!raw) return 'CLP';
  if (raw.startsWith('CLP')) return 'CLP';
  if (raw.startsWith('USD')) return 'USD';
  if (raw.startsWith('EUR')) return 'EUR';
  return raw.slice(0, 6);
};

const resolveCurrentAmountClp = (source: Record<string, unknown>) =>
  asFiniteNumber(source.currentAmountCLP ?? source.monto_clp_eq ?? source.montoCLP ?? null);

const resolveExposurePairValues = (
  source: Record<string, unknown>,
): {
  rvRaw: unknown;
  rfRaw: unknown;
  globalRaw: unknown;
  localRaw: unknown;
} => {
  const exposure = source.exposure;
  if (exposure && typeof exposure === 'object') {
    const typed = exposure as Record<string, unknown>;
    return {
      rvRaw: typed.rv,
      rfRaw: typed.rf,
      globalRaw: typed.global,
      localRaw: typed.local,
    };
  }

  return {
    rvRaw: source.porcentaje_rv ?? source.rv,
    rfRaw: source.porcentaje_rf ?? source.rf,
    globalRaw: source.porcentaje_global ?? source.global,
    localRaw: source.porcentaje_local ?? source.local,
  };
};

export const validateInstrumentBaseJson = (
  rawJson: string,
  optimizableBaseClp?: number | null,
): InstrumentBaseValidation => {
  const trimmed = String(rawJson || '').trim();
  if (!trimmed) {
    return {
      ok: false,
      errors: ['Pega un JSON antes de validar.'],
      warnings: [],
      snapshot: null,
      summary: null,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return {
      ok: false,
      errors: ['El JSON no es válido.'],
      warnings: [],
      snapshot: null,
      summary: null,
    };
  }

  const rows = parseRootArray(parsed);
  if (!rows) {
    return {
      ok: false,
      errors: ['El JSON debe ser un arreglo o un objeto con la propiedad "instruments" o "instrumentos".'],
      warnings: [],
      snapshot: null,
      summary: null,
    };
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  const instruments: InstrumentBaseItem[] = [];

  rows.forEach((row, index) => {
    if (!row || typeof row !== 'object') {
      errors.push(`Fila ${index + 1}: formato inválido.`);
      return;
    }

    const source = row as Record<string, unknown>;
    const name = resolveName(source);
    const manager = resolveManager(source);
    const currency = resolveCurrency(source);
    const currentAmountCLP = resolveCurrentAmountClp(source);
    const { rvRaw, rfRaw, globalRaw, localRaw } = resolveExposurePairValues(source);

    if (!name) errors.push(`Fila ${index + 1}: falta "name" o "instrumento".`);
    if (!manager) errors.push(`Fila ${index + 1}: falta "manager", "provider" o "administradora".`);
    if (currentAmountCLP === null || currentAmountCLP < 0) {
      errors.push(`Fila ${index + 1}: "currentAmountCLP" o "monto_clp_eq" debe ser un número >= 0.`);
    }

    const rvRf = normalizePair(
      rvRaw,
      rfRaw,
      'rv',
      'rf',
    );
    const globalLocal = normalizePair(
      globalRaw,
      localRaw,
      'global',
      'local',
    );
    rvRf.errors.forEach((message) => errors.push(`Fila ${index + 1}: ${message}`));
    globalLocal.errors.forEach((message) => errors.push(`Fila ${index + 1}: ${message}`));

    if (!name || !manager || currentAmountCLP === null || currentAmountCLP < 0) return;
    if (rvRf.errors.length || globalLocal.errors.length) return;

    instruments.push({
      id: toId(`${manager}-${name}`) || `instrument-${index + 1}`,
      name,
      manager,
      currency,
      currentAmountCLP,
      exposure: {
        rv: rvRf.left,
        rf: rvRf.right,
        global: globalLocal.left,
        local: globalLocal.right,
      },
    });
  });

  if (!instruments.length && !errors.length) {
    errors.push('No encontré instrumentos válidos en el JSON.');
  }

  const snapshot =
    errors.length === 0
      ? {
          version: VERSION,
          savedAt: new Date().toISOString(),
          rawJson: trimmed,
          instruments,
        }
      : null;

  const summary = snapshot ? buildSummary(snapshot, optimizableBaseClp) : null;

  if (summary && summary.coverageVsOptimizableBaseRatio !== null && summary.coverageVsOptimizableBaseRatio < 0.95) {
    warnings.push('La cobertura es parcial respecto a la base optimizable oficial.');
  }
  if (summary && summary.coverageVsOptimizableBaseRatio !== null && summary.coverageVsOptimizableBaseRatio > 1.05) {
    warnings.push('La base instrumental cargada supera la base optimizable oficial.');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    snapshot,
    summary,
  };
};

export const loadInstrumentBaseSnapshot = (): InstrumentBaseSnapshot | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as InstrumentBaseSnapshot | null;
    if (!parsed || parsed.version !== VERSION || !Array.isArray(parsed.instruments)) return null;
    const instruments = parsed.instruments.map((item) => ({
      ...item,
      currency: item.currency ? String(item.currency) : 'CLP',
    }));
    return { ...parsed, instruments };
  } catch {
    return null;
  }
};

export const saveInstrumentBaseSnapshot = (snapshot: InstrumentBaseSnapshot) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
};

export const clearInstrumentBaseSnapshot = () => {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
};

export const summarizeInstrumentBase = (
  snapshot: InstrumentBaseSnapshot | null,
  optimizableBaseClp?: number | null,
): InstrumentBaseSummary | null => {
  if (!snapshot) return null;
  return buildSummary(snapshot, optimizableBaseClp);
};

export const classifyCoverageQuality = (coverageRatio: number | null): CoverageQuality => {
  if (coverageRatio === null || !Number.isFinite(coverageRatio)) return 'unknown';
  if (coverageRatio >= 0.9 && coverageRatio <= 1.1) return 'high';
  if (coverageRatio >= 0.6 && coverageRatio < 0.9) return 'partial';
  if (coverageRatio > 1.1) return 'partial';
  return 'insufficient';
};

export const inferImplicitMixFromInstrumentBase = (
  snapshot: InstrumentBaseSnapshot | null,
): InstrumentImplicitMix | null => {
  if (!snapshot) return null;
  const summary = buildSummary(snapshot);
  if (!summary.weightedExposure) return null;

  const rv = clamp01(summary.weightedExposure.rv);
  const rf = clamp01(summary.weightedExposure.rf);
  const global = clamp01(summary.weightedExposure.global);
  const local = clamp01(summary.weightedExposure.local);

  const rawSleeves = {
    rvGlobal: rv * global,
    rvChile: rv * local,
    rfGlobal: rf * global,
    rfChile: rf * local,
  };

  const sleeveSum = rawSleeves.rvGlobal + rawSleeves.rvChile + rawSleeves.rfGlobal + rawSleeves.rfChile;
  if (sleeveSum <= 0) return null;

  return {
    rv,
    rf,
    global,
    local,
    sleeves: {
      rvGlobal: rawSleeves.rvGlobal / sleeveSum,
      rvChile: rawSleeves.rvChile / sleeveSum,
      rfGlobal: rawSleeves.rfGlobal / sleeveSum,
      rfChile: rawSleeves.rfChile / sleeveSum,
    },
  };
};

const SLEEVE_KEYS: InstrumentSleeveKey[] = ['rvGlobal', 'rvChile', 'rfGlobal', 'rfChile'];

const normalizeWeights = (weights: PortfolioWeights): PortfolioWeights => {
  const rvGlobal = clamp01(weights.rvGlobal);
  const rfGlobal = clamp01(weights.rfGlobal);
  const rvChile = clamp01(weights.rvChile);
  const rfChile = clamp01(weights.rfChile);
  const sum = rvGlobal + rfGlobal + rvChile + rfChile;
  if (sum <= 0) return { rvGlobal: 0, rfGlobal: 0, rvChile: 0, rfChile: 1 };
  return {
    rvGlobal: rvGlobal / sum,
    rfGlobal: rfGlobal / sum,
    rvChile: rvChile / sum,
    rfChile: rfChile / sum,
  };
};

const deriveSleeveWeights = (exposure: InstrumentExposure): PortfolioWeights => {
  const rv = clamp01(exposure.rv);
  const rf = clamp01(exposure.rf);
  const global = clamp01(exposure.global);
  const local = clamp01(exposure.local);
  return normalizeWeights({
    rvGlobal: rv * global,
    rvChile: rv * local,
    rfGlobal: rf * global,
    rfChile: rf * local,
  });
};

const dominantSleeve = (weights: PortfolioWeights): { sleeve: InstrumentSleeveKey; dominance: number } => {
  let maxKey: InstrumentSleeveKey = 'rfChile';
  let maxValue = -Infinity;
  SLEEVE_KEYS.forEach((key) => {
    const value = weights[key];
    if (value > maxValue) {
      maxValue = value;
      maxKey = key;
    }
  });
  return { sleeve: maxKey, dominance: maxValue };
};

const computeMixFromInstruments = (items: InstrumentBaseItem[]): PortfolioWeights => {
  const total = items.reduce((sum, item) => sum + item.currentAmountCLP, 0);
  if (!Number.isFinite(total) || total <= 0) {
    return { rvGlobal: 0, rfGlobal: 0, rvChile: 0, rfChile: 1 };
  }
  const accum = { rvGlobal: 0, rfGlobal: 0, rvChile: 0, rfChile: 0 };
  items.forEach((item) => {
    const weight = item.currentAmountCLP / total;
    const sleeves = deriveSleeveWeights(item.exposure);
    accum.rvGlobal += sleeves.rvGlobal * weight;
    accum.rfGlobal += sleeves.rfGlobal * weight;
    accum.rvChile += sleeves.rvChile * weight;
    accum.rfChile += sleeves.rfChile * weight;
  });
  return normalizeWeights(accum);
};

type InstrumentWorking = InstrumentBaseItem & {
  sleeveWeights: PortfolioWeights;
  dominant: InstrumentSleeveKey;
  dominance: number;
};

type InstrumentDelta = InstrumentWorking & {
  targetAmount: number;
  delta: number;
};

const buildInstrumentDeltas = (
  items: InstrumentWorking[],
  targetSleeveAmounts: Record<InstrumentSleeveKey, number>,
): { deltas: InstrumentDelta[]; totalsBySleeve: Record<InstrumentSleeveKey, number> } => {
  const totalsBySleeve = SLEEVE_KEYS.reduce<Record<InstrumentSleeveKey, number>>((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {} as Record<InstrumentSleeveKey, number>);

  items.forEach((item) => {
    totalsBySleeve[item.dominant] += item.currentAmountCLP;
  });

  const deltas = items.map((item) => {
    const sleeveTotal = totalsBySleeve[item.dominant];
    const targetAmount =
      sleeveTotal > 0 ? (item.currentAmountCLP / sleeveTotal) * targetSleeveAmounts[item.dominant] : 0;
    const delta = targetAmount - item.currentAmountCLP;
    return { ...item, targetAmount, delta };
  });

  return { deltas, totalsBySleeve };
};

const applyMovesToInstruments = (
  items: InstrumentWorking[],
  moves: InstrumentMove[],
): InstrumentWorking[] => {
  const next = items.map((item) => ({ ...item }));
  const index = new Map(next.map((item) => [item.id, item]));
  moves.forEach((move) => {
    const from = index.get(move.fromId);
    if (from) {
      from.currentAmountCLP = Math.max(0, from.currentAmountCLP - move.amountClp);
    }
    const to = index.get(move.toId);
    if (to) {
      to.currentAmountCLP += move.amountClp;
    } else {
      const synthetic: InstrumentWorking = {
        id: move.toId,
        name: move.toName,
        manager: move.toManager,
        currency: move.currency,
        currentAmountCLP: move.amountClp,
        exposure: sleeveToExposure(move.toSleeve),
        sleeveWeights: sleeveToWeights(move.toSleeve),
        dominant: move.toSleeve,
        dominance: 1,
      };
      index.set(move.toId, synthetic);
      next.push(synthetic);
    }
  });
  return next;
};

const sleeveToWeights = (sleeve: InstrumentSleeveKey): PortfolioWeights => {
  switch (sleeve) {
    case 'rvGlobal':
      return { rvGlobal: 1, rvChile: 0, rfGlobal: 0, rfChile: 0 };
    case 'rvChile':
      return { rvGlobal: 0, rvChile: 1, rfGlobal: 0, rfChile: 0 };
    case 'rfGlobal':
      return { rvGlobal: 0, rvChile: 0, rfGlobal: 1, rfChile: 0 };
    case 'rfChile':
    default:
      return { rvGlobal: 0, rvChile: 0, rfGlobal: 0, rfChile: 1 };
  }
};

const sleeveLabel = (sleeve: InstrumentSleeveKey) => {
  switch (sleeve) {
    case 'rvGlobal':
      return 'RV Global';
    case 'rvChile':
      return 'RV Chile';
    case 'rfGlobal':
      return 'RF Global';
    case 'rfChile':
    default:
      return 'RF Chile';
  }
};

const sleeveToExposure = (sleeve: InstrumentSleeveKey): InstrumentExposure => {
  switch (sleeve) {
    case 'rvGlobal':
      return { rv: 1, rf: 0, global: 1, local: 0 };
    case 'rvChile':
      return { rv: 1, rf: 0, global: 0, local: 1 };
    case 'rfGlobal':
      return { rv: 0, rf: 1, global: 1, local: 0 };
    case 'rfChile':
    default:
      return { rv: 0, rf: 1, global: 0, local: 1 };
  }
};

export const buildRealisticInstrumentProposal = (
  instruments: InstrumentBaseItem[] | null,
  targetWeights: PortfolioWeights,
  options?: {
    optimizableBaseClp?: number | null;
    minMoveClp?: number;
    dominanceThreshold?: number;
  },
): InstrumentProposal | null => {
  if (!instruments || instruments.length === 0) return null;
  const baseTotalClp = instruments.reduce((sum, item) => sum + item.currentAmountCLP, 0);
  if (!Number.isFinite(baseTotalClp) || baseTotalClp <= 0) return null;

  const normalizedTarget = normalizeWeights(targetWeights);
  const minMoveClp = options?.minMoveClp ?? Math.max(1_000_000, baseTotalClp * 0.003);
  const dominanceThreshold = options?.dominanceThreshold ?? 0.5;
  const working: InstrumentWorking[] = instruments.map((item) => {
    const sleeveWeights = deriveSleeveWeights(item.exposure);
    const { sleeve, dominance } = dominantSleeve(sleeveWeights);
    return { ...item, sleeveWeights, dominant: sleeve, dominance };
  });

  const targetSleeveAmounts = SLEEVE_KEYS.reduce<Record<InstrumentSleeveKey, number>>((acc, key) => {
    acc[key] = normalizedTarget[key] * baseTotalClp;
    return acc;
  }, {} as Record<InstrumentSleeveKey, number>);

  const currencyGroups = new Map<string, InstrumentWorking[]>();
  working.forEach((item) => {
    const key = item.currency || 'CLP';
    const existing = currencyGroups.get(key) ?? [];
    existing.push(item);
    currencyGroups.set(key, existing);
  });

  const moves: InstrumentMove[] = [];
  let movedWithinManager = 0;
  let movedTotal = 0;
  let totalDemand = 0;
  const notes: string[] = [];

  currencyGroups.forEach((currencyItems, currency) => {
    const currencyTotal = currencyItems.reduce((sum, item) => sum + item.currentAmountCLP, 0);
    if (currencyTotal <= 0) return;

    const managers = new Map<string, InstrumentWorking[]>();
    currencyItems.forEach((item) => {
      const list = managers.get(item.manager) ?? [];
      list.push(item);
      managers.set(item.manager, list);
    });

    const residualSources: InstrumentDelta[] = [];
    const residualTargets: InstrumentDelta[] = [];

    managers.forEach((managerItems, manager) => {
      const managerTotal = managerItems.reduce((sum, item) => sum + item.currentAmountCLP, 0);
      const managerTargetSleeves = SLEEVE_KEYS.reduce<Record<InstrumentSleeveKey, number>>((acc, key) => {
        acc[key] = (targetSleeveAmounts[key] * managerTotal) / currencyTotal;
        return acc;
      }, {} as Record<InstrumentSleeveKey, number>);

      const { deltas, totalsBySleeve } = buildInstrumentDeltas(managerItems, managerTargetSleeves);
      const sources = deltas
        .filter((item) => item.delta < -minMoveClp)
        .sort((a, b) => a.delta - b.delta);
      const targets = deltas
        .filter((item) => item.delta > minMoveClp)
        .sort((a, b) => b.delta - a.delta);

      const syntheticTargets: InstrumentDelta[] = [];
      SLEEVE_KEYS.forEach((sleeve) => {
        if (totalsBySleeve[sleeve] > 0) return;
        const required = managerTargetSleeves[sleeve];
        if (!(required > minMoveClp)) return;
        const id = toId(`${manager}-${currency}-${sleeve}-nuevo`) || `synthetic-${manager}-${sleeve}`;
        syntheticTargets.push({
          id,
          name: `Nuevo instrumento ${sleeveLabel(sleeve)}`,
          manager,
          currency,
          currentAmountCLP: 0,
          exposure: sleeveToExposure(sleeve),
          sleeveWeights: sleeveToWeights(sleeve),
          dominant: sleeve,
          dominance: 1,
          targetAmount: required,
          delta: required,
        });
      });

      totalDemand += targets.reduce((sum, item) => sum + item.delta, 0);
      totalDemand += syntheticTargets.reduce((sum, item) => sum + item.delta, 0);

      let sourceIndex = 0;
      [...targets, ...syntheticTargets].forEach((target) => {
        let remaining = target.delta;
        while (remaining > minMoveClp && sourceIndex < sources.length) {
          const source = sources[sourceIndex];
          const available = Math.min(-source.delta, remaining);
          const amount = Math.max(0, Math.min(available, source.currentAmountCLP));
          if (amount <= minMoveClp) break;
          moves.push({
            fromId: source.id,
            fromName: source.name,
            fromManager: source.manager,
            toId: target.id,
            toName: target.name,
            toManager: target.manager,
            currency,
            amountClp: amount,
            fromSleeve: source.dominant,
            toSleeve: target.dominant,
            reason: 'Dentro de la misma administradora',
          });
          movedWithinManager += amount;
          movedTotal += amount;
          remaining -= amount;
          source.delta += amount;
          if (Math.abs(source.delta) <= minMoveClp) {
            sourceIndex += 1;
          }
        }

        if (remaining > minMoveClp) {
          residualTargets.push({ ...target, delta: remaining });
        }
      });

      sources.forEach((source) => {
        if (source.delta < -minMoveClp) {
          residualSources.push(source);
        }
      });

      if (!targets.length && sources.length) {
        notes.push(`En ${manager} no hay instrumentos destino claros para reasignar dentro del mismo administrador.`);
      }
      if (!sources.length && targets.length) {
        notes.push(`En ${manager} no hay instrumentos origen suficientes dentro del mismo administrador.`);
      }
    });

    if (residualSources.length && residualTargets.length) {
      let sourceIndex = 0;
      residualTargets.forEach((target) => {
        let remaining = target.delta;
        while (remaining > minMoveClp && sourceIndex < residualSources.length) {
          const source = residualSources[sourceIndex];
          const available = Math.min(-source.delta, remaining);
          const amount = Math.max(0, Math.min(available, source.currentAmountCLP));
          if (amount <= minMoveClp) break;
          moves.push({
            fromId: source.id,
            fromName: source.name,
            fromManager: source.manager,
            toId: target.id,
            toName: target.name,
            toManager: target.manager,
            currency,
            amountClp: amount,
            fromSleeve: source.dominant,
            toSleeve: target.dominant,
            reason: 'Entre administradoras (insuficiente dentro de la misma)',
          });
          movedTotal += amount;
          remaining -= amount;
          source.delta += amount;
          if (Math.abs(source.delta) <= minMoveClp) {
            sourceIndex += 1;
          }
        }
      });
    }
  });

  const appliedMoves = moves.filter((move) => move.amountClp > minMoveClp);
  const proposedInstruments = applyMovesToInstruments(working, appliedMoves);
  const proposedMix = computeMixFromInstruments(proposedInstruments);
  const currentMix = computeMixFromInstruments(working);
  const coverageRatio = totalDemand > 0 ? movedTotal / totalDemand : 1;
  const withinManagerShare = movedTotal > 0 ? movedWithinManager / movedTotal : 1;
  const quality: InstrumentProposalQuality =
    coverageRatio >= 0.85 && withinManagerShare >= 0.6
      ? 'high'
      : coverageRatio >= 0.6
        ? 'partial'
        : 'low';

  if (options?.optimizableBaseClp && Math.abs(baseTotalClp - options.optimizableBaseClp) / options.optimizableBaseClp > 0.1) {
    notes.push('La base instrumental difiere bastante de la base optimizable oficial.');
  }
  const weakDominance = working.filter((item) => item.dominance < dominanceThreshold).length;
  if (weakDominance) {
    notes.push('Hay instrumentos balanceados; la propuesta es aproximada por sleeves dominantes.');
  }

  return {
    moves: appliedMoves,
    quality,
    coverageRatio: Number.isFinite(coverageRatio) ? coverageRatio : 0,
    withinManagerShare: Number.isFinite(withinManagerShare) ? withinManagerShare : 0,
    currentMix,
    targetMix: normalizedTarget,
    proposedMix,
    baseTotalClp,
    notes,
  };
};
