import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = existsSync(resolve(process.cwd(), 'apps/aurum/src'))
  ? resolve(process.cwd(), 'apps/aurum/src')
  : resolve(process.cwd(), 'src');

const sourceFiles = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = join(directory, entry.name);
  if (entry.isDirectory()) return sourceFiles(path);
  return /\.(ts|tsx|js|jsx)$/.test(entry.name) ? [path] : [];
});

describe('GastApp runtime legacy boundary', () => {
  it('keeps the user-facing GastApp downloads on the canonical artifact reader', () => {
    const analysis = readFileSync(join(sourceRoot, 'pages/AnalysisAurum.tsx'), 'utf8');
    const settings = readFileSync(join(sourceRoot, 'pages/SettingsAurum.tsx'), 'utf8');
    const entrypoints = `${analysis}\n${settings}`;

    expect(entrypoints).toContain('downloadGastappDataRoomV2Artifact');
    expect(entrypoints).not.toContain('exportDataRoomZip');
    expect(entrypoints).not.toContain('gastappMonthlyAdapter');
    expect(entrypoints).not.toContain('gastappDataRoomV2Adapter');
    expect(entrypoints).not.toContain('gastappLedgerPreviewAdapter');
  });

  it('does not import the legacy consolidated exporter from the application runtime', () => {
    const legacyExporter = resolve(sourceRoot, 'services/dataRoom/exportDataRoomZip.ts');
    expect(() => statSync(legacyExporter)).toThrow();

    const runtimeReferences = sourceFiles(sourceRoot)
      .filter((path) => path !== legacyExporter)
      .filter((path) => /dataRoom[\\/]exportDataRoomZip/.test(readFileSync(path, 'utf8')));

    expect(runtimeReferences).toEqual([]);
  });
});
