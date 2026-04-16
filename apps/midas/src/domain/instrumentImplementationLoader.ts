import {
  loadInstrumentUniverseSnapshot,
  summarizeInstrumentUniverse,
  type InstrumentUniverseSnapshot,
} from './instrumentUniverse';
import type { PortfolioWeights } from './model/types';
import type { InstrumentImplementationUniverse } from './instrumentImplementationTypes';

export type InstrumentImplementationUniverseLoad = {
  universe: InstrumentImplementationUniverse | null;
  summary: ReturnType<typeof summarizeInstrumentUniverse>;
  warnings: string[];
};

function normalizeSnapshot(snapshot: InstrumentUniverseSnapshot): InstrumentImplementationUniverse {
  return {
    snapshot,
    instruments: snapshot.instruments,
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
  return {
    universe,
    summary,
    warnings: summary?.warnings ?? [],
  };
}

