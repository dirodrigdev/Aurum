import type { FinancialDataRoomManifest } from './dataRoomTypes';

export const buildFinancialDataRoomManifest = (input: FinancialDataRoomManifest): FinancialDataRoomManifest => ({
  ...input,
  warnings: Array.from(new Set(input.warnings.filter(Boolean))),
  missing_sources: Array.from(new Set(input.missing_sources.filter(Boolean))),
});
