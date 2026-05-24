import {
  loadInstrumentUniverseSnapshot,
  summarizeInstrumentUniverse,
  type InstrumentUniverseInstrument,
  type InstrumentUniverseSnapshot,
} from './instrumentUniverse';
import type { PortfolioWeights } from './model/types';
import type { InstrumentImplementationUniverse } from './instrumentImplementationTypes';

export type PlanVitalCuenta2LoaderDiagnostic = {
  planvitalMandatoryDetected: boolean;
  planvitalCuenta2SyntheticCreated: boolean;
  matchedSourceInstrumentId: string | null;
  matchedSourceInstrumentName: string | null;
  reasonIfNotCreated: string | null;
};

export type InstrumentImplementationUniverseLoad = {
  universe: InstrumentImplementationUniverse | null;
  summary: ReturnType<typeof summarizeInstrumentUniverse>;
  warnings: string[];
  diagnostics: {
    planvitalCuenta2: PlanVitalCuenta2LoaderDiagnostic;
  };
};

const normalizeText = (value: string | null | undefined) =>
  (value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

const includesNormalized = (value: string | null | undefined, needle: string) =>
  normalizeText(value).includes(normalizeText(needle));

function isPlanVitalFundABaseCandidate(item: InstrumentUniverseInstrument): boolean {
  const name = normalizeText(item.name);
  return (
    name.includes('planvital')
    && name.includes('fondo a')
    && !name.includes('cuenta 2')
    && !name.includes('cuenta2')
    && !name.includes('apv')
  );
}

function planVitalSourcePriority(item: InstrumentUniverseInstrument): number {
  const role = normalizeText(item.role);
  const wrapper = normalizeText(item.taxWrapper);
  const constraint = normalizeText(item.replacementConstraint);
  let score = 0;
  if (item.currentMixUsed) score += 8;
  if (item.currency) score += 6;
  if (item.isCaptive === true) score += 4;
  if (item.decisionEligible === false) score += 3;
  if (role.includes('mandatory') || role.includes('oblig')) score += 3;
  if (wrapper.includes('mandatory') || wrapper.includes('oblig')) score += 2;
  if (constraint.includes('afp') || constraint.includes('oblig')) score += 2;
  return score;
}

function isExistingPlanVitalCuenta2(item: InstrumentUniverseInstrument): boolean {
  const name = normalizeText(item.name);
  const wrapper = normalizeText(item.taxWrapper);
  const role = normalizeText(item.role);
  return (
    name.includes('planvital')
    && name.includes('fondo a')
    && (
      name.includes('cuenta 2')
      || name.includes('cuenta2')
      || name.includes('apv')
      || wrapper.includes('cuenta_2')
      || wrapper.includes('cuenta2')
      || wrapper.includes('apv')
      || role.includes('voluntary')
      || role.includes('cuenta 2')
    )
  );
}

export function buildImplementationUniverseInstruments(
  instruments: InstrumentUniverseInstrument[],
): {
  instruments: InstrumentUniverseInstrument[];
  warnings: string[];
  diagnostics: PlanVitalCuenta2LoaderDiagnostic;
} {
  if (instruments.some(isExistingPlanVitalCuenta2)) {
    return {
      instruments,
      warnings: [],
      diagnostics: {
        planvitalMandatoryDetected: true,
        planvitalCuenta2SyntheticCreated: false,
        matchedSourceInstrumentId: null,
        matchedSourceInstrumentName: null,
        reasonIfNotCreated: 'Ya existe una posición PlanVital Fondo A Cuenta 2/APV en el universo.',
      },
    };
  }

  const planVitalCandidates = instruments.filter(isPlanVitalFundABaseCandidate);
  const matchedSource = [...planVitalCandidates].sort((a, b) => planVitalSourcePriority(b) - planVitalSourcePriority(a))[0] ?? null;
  if (!matchedSource) {
    return {
      instruments,
      warnings: [],
      diagnostics: {
        planvitalMandatoryDetected: false,
        planvitalCuenta2SyntheticCreated: false,
        matchedSourceInstrumentId: null,
        matchedSourceInstrumentName: null,
        reasonIfNotCreated: 'No se detectó un instrumento PlanVital Fondo A en el universo base.',
      },
    };
  }

  if (!matchedSource.currentMixUsed || !matchedSource.currency) {
    return {
      instruments,
      warnings: [],
      diagnostics: {
        planvitalMandatoryDetected: true,
        planvitalCuenta2SyntheticCreated: false,
        matchedSourceInstrumentId: matchedSource.instrumentId,
        matchedSourceInstrumentName: matchedSource.name ?? null,
        reasonIfNotCreated: !matchedSource.currentMixUsed
          ? 'El instrumento PlanVital Fondo A detectado no tiene exposición RV/RF usable.'
          : 'El instrumento PlanVital Fondo A detectado no tiene moneda informada.',
      },
    };
  }

  const syntheticCuenta2: InstrumentUniverseInstrument = {
    ...matchedSource,
    instrumentId: 'planvital_fondo_a_cuenta2',
    name: 'PlanVital Fondo A Cuenta 2',
    vehicleType: 'Cuenta 2',
    taxWrapper: 'cuenta_2',
    isCaptive: false,
    isSellable: false,
    amountClp: 0,
    amountNative: 0,
    amountNativeCurrency: matchedSource.amountNativeCurrency ?? matchedSource.currency,
    fxToClpUsed: matchedSource.fxToClpUsed ?? (matchedSource.currency === 'CLP' ? 1 : null),
    weightPortfolio: 0,
    role: 'voluntary',
    replacementConstraint: 'requires_account_opening',
    sameCurrencyCandidates: [],
    sameManagerCandidates: [],
    sameTaxWrapperCandidates: [],
    decisionEligible: true,
    warnings: [
      ...matchedSource.warnings.filter((warning) => !includesNormalized(warning, 'cautiv') && !includesNormalized(warning, 'oblig')),
      'Destino voluntario sintético para implementación: saldo 0, no afecta mix actual hasta recibir aportes.',
    ],
    usable: false,
  };

  return {
    instruments: [...instruments, syntheticCuenta2],
    warnings: ['Se agregó PlanVital Fondo A Cuenta 2 como destino voluntario con saldo 0 para implementación.'],
    diagnostics: {
      planvitalMandatoryDetected: true,
      planvitalCuenta2SyntheticCreated: true,
      matchedSourceInstrumentId: matchedSource.instrumentId,
      matchedSourceInstrumentName: matchedSource.name ?? null,
      reasonIfNotCreated: null,
    },
  };
}

function normalizeSnapshot(snapshot: InstrumentUniverseSnapshot): InstrumentImplementationUniverse {
  const enriched = buildImplementationUniverseInstruments(snapshot.instruments);
  return {
    snapshot,
    instruments: enriched.instruments,
  };
}

export function loadInstrumentImplementationUniverse(
  targetWeights?: PortfolioWeights | null,
): InstrumentImplementationUniverseLoad {
  const snapshot = loadInstrumentUniverseSnapshot();
  if (!snapshot) {
    return {
      universe: null,
      summary: null,
      warnings: ['No hay instrument_universe cargado en Ajustes.'],
      diagnostics: {
        planvitalCuenta2: {
          planvitalMandatoryDetected: false,
          planvitalCuenta2SyntheticCreated: false,
          matchedSourceInstrumentId: null,
          matchedSourceInstrumentName: null,
          reasonIfNotCreated: 'No hay instrument_universe cargado en Ajustes.',
        },
      },
    };
  }
  const universe = normalizeSnapshot(snapshot);
  const summary = summarizeInstrumentUniverse(snapshot, targetWeights);
  const enriched = buildImplementationUniverseInstruments(snapshot.instruments);
  return {
    universe,
    summary,
    warnings: [...(summary?.warnings ?? []), ...enriched.warnings],
    diagnostics: {
      planvitalCuenta2: enriched.diagnostics,
    },
  };
}
