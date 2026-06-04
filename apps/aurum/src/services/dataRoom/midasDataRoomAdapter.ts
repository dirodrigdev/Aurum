import { doc, getDoc } from 'firebase/firestore';
import { db, ensureAuthPersistence, getCurrentUid } from '../firebase';
import type { MidasAdapterResult, MidasExportRow } from './dataRoomTypes';

const pathForSimulation = (uid: string) => `users/${uid}/midas_config/simulationActiveV1`;
const pathForUniverse = (uid: string) => `users/${uid}/midas_config/instrumentUniverseV1`;
const PATH_OPTIMIZABLE = 'aurum_published/optimizableInvestments';

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const timestampToIso = (value: unknown): string | null => {
  if (typeof value === 'string') return value;
  const maybe = value as { toDate?: () => Date } | null;
  if (maybe && typeof maybe.toDate === 'function') {
    const date = maybe.toDate();
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  return null;
};

const inferCurrency = (path: string): string => {
  const lower = path.toLowerCase();
  if (lower.includes('clp')) return 'CLP';
  if (lower.includes('usd')) return 'USD';
  if (lower.includes('eur')) return 'EUR';
  if (lower.includes('uf')) return 'UF';
  return '';
};

const flattenObject = (value: unknown, prefix = ''): Array<{ path: string; value: unknown }> => {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flattenObject(item, `${prefix}[${index}]`));
  }
  const record = asRecord(value);
  if (record) {
    return Object.entries(record).flatMap(([key, child]) => flattenObject(child, prefix ? `${prefix}.${key}` : key));
  }
  return [{ path: prefix || 'value', value }];
};

const pushFlattenedRows = (rows: MidasExportRow[], input: {
  sourceDoc: string;
  scenarioName: string;
  updatedAt: string;
  payload: unknown;
  notes?: string;
}) => {
  flattenObject(input.payload).forEach((entry) => {
    rows.push({
      source_doc: input.sourceDoc,
      scenario_name: input.scenarioName,
      parameter: entry.path,
      value: typeof entry.value === 'string' || typeof entry.value === 'number' || typeof entry.value === 'boolean'
        ? entry.value
        : entry.value === null || entry.value === undefined
          ? null
          : JSON.stringify(entry.value),
      currency: inferCurrency(entry.path),
      updated_at: input.updatedAt,
      notes: input.notes || '',
    });
  });
};

export const loadMidasDataRoomData = async (): Promise<MidasAdapterResult> => {
  const warnings: string[] = [];
  const rows: MidasExportRow[] = [];
  const rawMinimal: Record<string, unknown> = {};
  try {
    await ensureAuthPersistence();
    const uid = getCurrentUid();
    const loaded: string[] = [];

    if (uid) {
      const simulationRef = doc(db, 'users', uid, 'midas_config', 'simulationActiveV1');
      const simulationSnap = await getDoc(simulationRef);
      if (simulationSnap.exists()) {
        const data = simulationSnap.data() as Record<string, unknown>;
        const active = asRecord(data.active);
        const paramsJson = typeof active?.paramsJson === 'string' ? active.paramsJson : null;
        const parsedParams = (() => {
          if (!paramsJson) return null;
          try {
            return JSON.parse(paramsJson);
          } catch {
            warnings.push('midas_simulation_params_json_invalid');
            return null;
          }
        })();
        const updatedAt = timestampToIso(data.updatedAt) || String(active?.savedAt || '');
        pushFlattenedRows(rows, {
          sourceDoc: pathForSimulation(uid),
          scenarioName: String(active?.source || 'simulationActiveV1'),
          updatedAt,
          payload: {
            active_meta: {
              hash: active?.hash ?? null,
              savedAt: active?.savedAt ?? null,
              source: active?.source ?? null,
              nSim: active?.nSim ?? null,
              seed: active?.seed ?? null,
              bucketMonths: active?.bucketMonths ?? null,
              capitalInitialClp: active?.capitalInitialClp ?? null,
            },
            params: parsedParams,
          },
          notes: 'simulationActiveV1',
        });
        rawMinimal.simulationActiveV1 = {
          path: pathForSimulation(uid),
          updatedAt,
          active: active ? {
            hash: active.hash ?? null,
            savedAt: active.savedAt ?? null,
            source: active.source ?? null,
          } : null,
        };
        loaded.push(pathForSimulation(uid));
      } else {
        warnings.push('midas_simulationActiveV1_not_found');
      }

      const universeRef = doc(db, 'users', uid, 'midas_config', 'instrumentUniverseV1');
      const universeSnap = await getDoc(universeRef);
      if (universeSnap.exists()) {
        const data = universeSnap.data() as Record<string, unknown>;
        const active = asRecord(data.active);
        const updatedAt = timestampToIso(data.updatedAt) || String(active?.savedAt || '');
        pushFlattenedRows(rows, {
          sourceDoc: pathForUniverse(uid),
          scenarioName: String(active?.source || 'instrumentUniverseV1'),
          updatedAt,
          payload: {
            active_meta: {
              hash: active?.hash ?? null,
              savedAt: active?.savedAt ?? null,
              source: active?.source ?? null,
              fileName: active?.fileName ?? null,
              instrumentCount: active?.instrumentCount ?? null,
              usableInstrumentCount: active?.usableInstrumentCount ?? null,
              totalWeightPortfolio: active?.totalWeightPortfolio ?? null,
              totalAmountClp: active?.totalAmountClp ?? null,
              hasUsableAmounts: active?.hasUsableAmounts ?? null,
              hasUsableWeights: active?.hasUsableWeights ?? null,
              amountSource: active?.amountSource ?? null,
              warnings: active?.warnings ?? [],
            },
          },
          notes: 'instrumentUniverseV1_metadata_only',
        });
        rawMinimal.instrumentUniverseV1 = {
          path: pathForUniverse(uid),
          updatedAt,
          active: active ? {
            hash: active.hash ?? null,
            savedAt: active.savedAt ?? null,
            source: active.source ?? null,
            instrumentCount: active.instrumentCount ?? null,
          } : null,
        };
        loaded.push(pathForUniverse(uid));
      } else {
        warnings.push('midas_instrumentUniverseV1_not_found');
      }
    } else {
      warnings.push('midas_uid_missing');
    }

    const optimizableRef = doc(db, 'aurum_published', 'optimizableInvestments');
    const optimizableSnap = await getDoc(optimizableRef);
    if (optimizableSnap.exists()) {
      const data = optimizableSnap.data() as Record<string, unknown>;
      const updatedAt = String(data.publishedAt || '');
      pushFlattenedRows(rows, {
        sourceDoc: PATH_OPTIMIZABLE,
        scenarioName: String(data.snapshotLabel || data.snapshotMonth || 'optimizableInvestments'),
        updatedAt,
        payload: data,
        notes: 'aurum_published.optimizableInvestments',
      });
      rawMinimal.optimizableInvestments = {
        path: PATH_OPTIMIZABLE,
        publishedAt: data.publishedAt ?? null,
        snapshotMonth: data.snapshotMonth ?? null,
        version: data.version ?? null,
      };
      loaded.push(PATH_OPTIMIZABLE);
    } else {
      warnings.push('aurum_published_optimizableInvestments_not_found');
    }

    return {
      status: loaded.length > 0 ? 'ok' : uid ? 'not_found' : 'missing_auth',
      included: loaded.length > 0,
      rows,
      warnings,
      errorMessage: null,
      projectId: String(db.app.options.projectId || ''),
      sourceDocsLoaded: loaded,
      rawMinimal,
    };
  } catch (error: any) {
    const code = String(error?.code || '');
    return {
      status: code === 'permission-denied' ? 'permission_denied' : 'error',
      included: rows.length > 0,
      rows,
      warnings,
      errorMessage: String(error?.message || error || 'midas_export_error'),
      projectId: String(db.app.options.projectId || ''),
      sourceDocsLoaded: [],
      rawMinimal,
    };
  }
};
