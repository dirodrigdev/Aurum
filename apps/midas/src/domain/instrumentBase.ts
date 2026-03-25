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
  coverageRatio: number | null;
  differenceClp: number | null;
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
  baseCapitalClp?: number | null,
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

  const coverageRatio =
    baseCapitalClp && Number.isFinite(baseCapitalClp) && baseCapitalClp > 0
      ? totalAmountCLP / baseCapitalClp
      : null;

  return {
    instrumentCount: snapshot.instruments.length,
    managerCount,
    totalAmountCLP,
    weightedExposure,
    coverageRatio,
    differenceClp:
      coverageRatio === null || !baseCapitalClp || !Number.isFinite(baseCapitalClp)
        ? null
        : totalAmountCLP - baseCapitalClp,
  };
};

const parseRootArray = (parsed: unknown): unknown[] | null => {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { instruments?: unknown[] }).instruments)) {
    return (parsed as { instruments: unknown[] }).instruments;
  }
  return null;
};

export const validateInstrumentBaseJson = (
  rawJson: string,
  baseCapitalClp?: number | null,
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
      errors: ['El JSON debe ser un arreglo o un objeto con la propiedad "instruments".'],
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
    const name = String(source.name || '').trim();
    const manager = String(source.manager || source.provider || '').trim();
    const currentAmountCLP = asFiniteNumber(source.currentAmountCLP);
    const exposure = source.exposure;

    if (!name) errors.push(`Fila ${index + 1}: falta "name".`);
    if (!manager) errors.push(`Fila ${index + 1}: falta "manager" o "provider".`);
    if (currentAmountCLP === null || currentAmountCLP < 0) {
      errors.push(`Fila ${index + 1}: "currentAmountCLP" debe ser un número >= 0.`);
    }
    if (!exposure || typeof exposure !== 'object') {
      errors.push(`Fila ${index + 1}: falta "exposure".`);
      return;
    }

    const rvRf = normalizePair(
      (exposure as Record<string, unknown>).rv,
      (exposure as Record<string, unknown>).rf,
      'rv',
      'rf',
    );
    const globalLocal = normalizePair(
      (exposure as Record<string, unknown>).global,
      (exposure as Record<string, unknown>).local,
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

  const summary = snapshot ? buildSummary(snapshot, baseCapitalClp) : null;

  if (summary && summary.coverageRatio !== null && summary.coverageRatio < 0.95) {
    warnings.push('La cobertura es parcial respecto a la cartera base real actual.');
  }
  if (summary && summary.coverageRatio !== null && summary.coverageRatio > 1.05) {
    warnings.push('El total cargado supera la cartera base real actual.');
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
    return parsed;
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
  baseCapitalClp?: number | null,
): InstrumentBaseSummary | null => {
  if (!snapshot) return null;
  return buildSummary(snapshot, baseCapitalClp);
};
