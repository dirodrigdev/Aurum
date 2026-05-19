import {
  loadInstrumentUniverseSnapshot,
  summarizeInstrumentUniverse,
  type InstrumentUniverseInstrument,
  type InstrumentUniverseSnapshot,
} from './instrumentUniverse';
import type { PortfolioWeights } from './model/types';
import type { InstrumentImplementationUniverse } from './instrumentImplementationTypes';

export type InstrumentImplementationUniverseLoad = {
  universe: InstrumentImplementationUniverse | null;
  summary: ReturnType<typeof summarizeInstrumentUniverse>;
  warnings: string[];
};

const includesNormalized = (value: string | null | undefined, needle: string) =>
  (value ?? '').toLowerCase().includes(needle);

function isPlanVitalMandatoryFundA(item: InstrumentUniverseInstrument): boolean {
  const name = (item.name ?? '').toLowerCase();
  const role = (item.role ?? '').toLowerCase();
  const wrapper = (item.taxWrapper ?? '').toLowerCase();
  const constraint = (item.replacementConstraint ?? '').toLowerCase();
  return (
    name.includes('planvital')
    && name.includes('fondo a')
    && !name.includes('cuenta 2')
    && !name.includes('cuenta2')
    && !name.includes('apv')
    && (
      item.isCaptive === true
      || item.decisionEligible === false
      || role.includes('mandatory')
      || role.includes('oblig')
      || wrapper.includes('mandatory')
      || wrapper.includes('oblig')
      || constraint.includes('afp')
      || constraint.includes('oblig')
    )
  );
}

function isExistingPlanVitalCuenta2(item: InstrumentUniverseInstrument): boolean {
  const name = (item.name ?? '').toLowerCase();
  const wrapper = (item.taxWrapper ?? '').toLowerCase();
  const role = (item.role ?? '').toLowerCase();
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
): { instruments: InstrumentUniverseInstrument[]; warnings: string[] } {
  if (instruments.some(isExistingPlanVitalCuenta2)) {
    return { instruments, warnings: [] };
  }

  const planVitalMandatory = instruments.find(isPlanVitalMandatoryFundA);
  if (!planVitalMandatory || !planVitalMandatory.currentMixUsed || !planVitalMandatory.currency) {
    return { instruments, warnings: [] };
  }

  const syntheticCuenta2: InstrumentUniverseInstrument = {
    ...planVitalMandatory,
    instrumentId: 'planvital_fondo_a_cuenta2',
    name: 'PlanVital Fondo A Cuenta 2',
    vehicleType: 'Cuenta 2',
    taxWrapper: 'cuenta_2',
    isCaptive: false,
    isSellable: false,
    amountClp: 0,
    amountNative: 0,
    amountNativeCurrency: planVitalMandatory.amountNativeCurrency ?? planVitalMandatory.currency,
    fxToClpUsed: planVitalMandatory.fxToClpUsed ?? (planVitalMandatory.currency === 'CLP' ? 1 : null),
    weightPortfolio: 0,
    role: 'voluntary',
    replacementConstraint: 'requires_account_opening',
    sameCurrencyCandidates: [],
    sameManagerCandidates: [],
    sameTaxWrapperCandidates: [],
    decisionEligible: true,
    warnings: [
      ...planVitalMandatory.warnings.filter((warning) => !includesNormalized(warning, 'cautiv') && !includesNormalized(warning, 'oblig')),
      'Destino voluntario sintético para implementación: saldo 0, no afecta mix actual hasta recibir aportes.',
    ],
    usable: false,
  };

  return {
    instruments: [...instruments, syntheticCuenta2],
    warnings: ['Se agregó PlanVital Fondo A Cuenta 2 como destino voluntario con saldo 0 para implementación.'],
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
    };
  }
  const universe = normalizeSnapshot(snapshot);
  const summary = summarizeInstrumentUniverse(snapshot, targetWeights);
  const enriched = buildImplementationUniverseInstruments(snapshot.instruments);
  return {
    universe,
    summary,
    warnings: [...(summary?.warnings ?? []), ...enriched.warnings],
  };
}
