import type { ModelParameters } from '../../domain/model/types';
import { resolveCapital } from '../../domain/simulation/capitalResolver';
import { toM8Input } from '../../domain/simulation/m8Adapter';
/** Carry explicit scenario FX edits; otherwise inherit the new official source. */
export function rebaseSnapshotFx(previous: ModelParameters, scenario: ModelParameters, official: ModelParameters) {
    const fx = { ...scenario.fx };
    for (const key of ['clpUsdInitial', 'usdEurFixed'] as const) {
        if (scenario.fx[key] === previous.fx[key])
            fx[key] = official.fx[key];
    }
    return fx;
}
/** Compare actual engine inputs; its display label is not an economic input. */
export function sourceRebaseEngineIdentity(params: ModelParameters): string | null {
    try {
        const { capital_source_label: _label, ...input } = toM8Input(params, resolveCapital({ params }));
        return JSON.stringify(input, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
            ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);
    }
    catch {
        return null;
    }
}
