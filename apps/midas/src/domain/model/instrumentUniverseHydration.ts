export type InstrumentUniverseReadStatus = 'loading' | 'loaded' | 'missing' | 'timeout' | 'error';

export function isInstrumentUniverseReadStatusTerminal(status: InstrumentUniverseReadStatus): boolean {
  return status !== 'loading';
}

export function shouldStartInstrumentUniverseHydration(input: {
  hydrationKey: string;
  force?: boolean;
  inFlightKey: string | null;
  lastSettledKey: string | null;
  readStatus: InstrumentUniverseReadStatus;
}): boolean {
  if (input.force) return true;
  if (input.inFlightKey === input.hydrationKey) return false;
  if (
    input.lastSettledKey === input.hydrationKey
    && isInstrumentUniverseReadStatusTerminal(input.readStatus)
  ) {
    return false;
  }
  return true;
}
