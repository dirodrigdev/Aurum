import {
  collection,
  addDoc,
  getDocs,
  getDocsFromServer,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where,
  onSnapshot,
  getDoc,
  setDoc,
  orderBy,
  limit,
  startAfter,
  runTransaction,
  writeBatch,
  increment,
} from 'firebase/firestore';
import { db } from './firebase';
import {
  setFirestoreOk,
  setFirestoreStatusFromError,
} from './firestoreStatus';
import {
  perfIncListener,
  perfDecListener,
} from './perf';
import {
  Project,
  ProjectExpense,
  MonthlyExpense,
  Category,
  MonthlyReport,
  ClosingConfig,
} from '../types';
import { emitDataEvent } from '../state/dataEvents';
import { periodInfoForISODate } from '../utils/period';

/* CONSTANTES */
const PROJECTS_COLLECTION = 'projects';
const PROJECT_EXPENSES_COLLECTION = 'project_expenses';
const MONTHLY_EXPENSES_COLLECTION = 'monthly_expenses';
const CATEGORIES_COLLECTION = 'categories';
const META_COLLECTION = 'meta';
const CLOSING_CONFIG_DOC_ID = 'closing_config';
const CUSTOM_CURRENCIES_DOC_ID = 'custom_currencies';
const MONTHLY_REPORTS_COLLECTION = 'monthly_reports';
const PERIOD_SUMMARIES_COLLECTION = 'period_summaries';

// Cache suave (memoria) para evitar lecturas extra en writes.
let closingConfigCache: ClosingConfig | null = null;

const nowISO = () => new Date().toISOString();

const normalizeCurrencyCode = (v: any, fallback: string = 'EUR') => {
  const s = String(v ?? '').trim();
  if (!s || s.toUpperCase() === 'XXX') return fallback;
  // Si parece código ISO (3 letras), lo normalizamos a mayúsculas.
  if (/^[a-zA-Z]{3}$/.test(s)) return s.toUpperCase();
  return s.toUpperCase(); // mantenemos custom en mayúsculas también (ej. BTC)
};


const safeNumber = (v: any): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const safeString = (v: any): string => (v === undefined || v === null ? '' : String(v));

// Firestore no permite ciertos caracteres en nombres de campo (cuando usamos maps).
// Para evitar invalid-argument al guardar summary.categories[<key>], sanitizamos.
const toSafeFirestoreMapKey = (v: any, fallback: string = 'SIN_CATEGORIA') => {
  const raw = safeString(v).trim();
  if (!raw) return fallback;
  // Reemplaza cualquier caracter que podría romper field paths.
  const cleaned = raw
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || fallback;
};

// --- Period helpers (single source of truth: src/utils/period.ts) ---
const computePeriodInfoForISODate = (isoDate: string, closingDay: number = 11) => {
  const p = periodInfoForISODate(isoDate, closingDay);
  return {
    periodNumber: p.periodNumber,
    periodId: p.periodId,
    startYMD: p.startYMD,
    endYMD: p.endYMD,
  };
};

const normalizeMonthlyExpenseForWrite = (
  input: Partial<MonthlyExpense> & Record<string, any>,
  opts: { isUpdate: boolean }
) => {
  const now = nowISO();
  const out: Record<string, any> = { ...input };

  // defaults
  if (!out.estado) out.estado = 'activo';
  out.monto = safeNumber(out.monto);
  out.moneda = normalizeCurrencyCode(out.moneda, 'EUR');
  if (opts.isUpdate) {
    out.updated_at = now;
    if (!out.created_at) out.created_at = now;
  } else {
    out.created_at = out.created_at || now;
    out.updated_at = out.updated_at || now;
  }

  // Normaliza strings comunes
  if (out.categoria !== undefined) out.categoria = safeString(out.categoria);
  if (out.descripcion !== undefined) out.descripcion = safeString(out.descripcion);
  if (out.categoryId !== undefined) out.categoryId = safeString(out.categoryId);
  if (out.creado_por_usuario_id !== undefined) out.creado_por_usuario_id = safeString(out.creado_por_usuario_id);

  return out;
};

const applyDeltaToSummaryData = (
  summary: Record<string, any>,
  opts: {
    amountDelta: number;
    countDelta: number;
    categoryKey: string;
    categoryName?: string;
  }
) => {
  const categories = (summary.categories || {}) as Record<string, any>;
  const key = opts.categoryKey || 'SIN_CATEGORIA';
  const entry = categories[key] || {
    key,
    name: opts.categoryName || key,
    spent: 0,
    count: 0,
  };

  entry.spent = safeNumber(entry.spent) + opts.amountDelta;
  entry.count = safeNumber(entry.count) + opts.countDelta;
  if (opts.categoryName && !entry.name) entry.name = opts.categoryName;

  // Limpieza básica: si queda en cero, lo dejamos igual (no borramos para no “bailar” UI)
  categories[key] = entry;

  summary.categories = categories;
  summary.total = safeNumber(summary.total) + opts.amountDelta;
  summary.totalCount = safeNumber(summary.totalCount) + opts.countDelta;
  summary.updated_at = nowISO();
};


/**
 * Normaliza ProjectExpense antes de escribir.
 * - Unifica creado_por_usuario_id (acepta legacy creado_por)
 * - Setea defaults de estado
 * - Setea created_at/updated_at
 * - Normaliza campos numéricos a number
 */
const normalizeProjectExpenseForWrite = (
  input: Partial<ProjectExpense> & Record<string, any>,
  opts: { isUpdate: boolean }
): Record<string, any> => {
  const now = nowISO();
  const out: Record<string, any> = { ...input };

  // Normaliza moneda_original (y evita placeholders)
  out.moneda_original = normalizeCurrencyCode(out.moneda_original, 'EUR');

  // created_by legacy alias
  if (!out.creado_por_usuario_id && out.creado_por) {
    out.creado_por_usuario_id = out.creado_por;
  }
  // mantén legacy solo si ya existe, pero preferimos no escribirlo
  if (out.creado_por) delete out.creado_por;

  if (!out.estado) out.estado = 'activo';

  if (opts.isUpdate) {
    out.updated_at = now;
    if (!out.created_at) out.created_at = now; // safety
  } else {
    out.created_at = out.created_at || now;
    out.updated_at = out.updated_at || now;
  }

  const toNum = (v: any) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  // Solo normalizamos si el campo viene definido (no inventamos datos para legacy)
  const numFields = [
    'monto_original',
    'tipo_cambio_usado',
    'monto_en_moneda_proyecto',
    'monto_en_moneda_principal',
  ];
  for (const f of numFields) {
    if (out[f] !== undefined) out[f] = toNum(out[f]);
  }


// Inferencias mínimas para writes legacy:
// - Si falta tipo_cambio_usado y tenemos ambos montos, lo calculamos.
// - Si falta uno de los montos normalizados y tenemos el otro + tc, lo completamos.
// - Si falta monto_original, lo inferimos según moneda_original.
const mEur = out.monto_en_moneda_principal !== undefined ? toNum(out.monto_en_moneda_principal) : undefined;
const mProj = out.monto_en_moneda_proyecto !== undefined ? toNum(out.monto_en_moneda_proyecto) : undefined;

if (out.tipo_cambio_usado === undefined && mEur !== undefined && mEur > 0 && mProj !== undefined) {
  out.tipo_cambio_usado = toNum(mProj / mEur);
}

const tc = out.tipo_cambio_usado !== undefined ? toNum(out.tipo_cambio_usado) : undefined;

if (out.monto_en_moneda_principal === undefined && mProj !== undefined && tc && tc > 0) {
  out.monto_en_moneda_principal = toNum(mProj / tc);
}
if (out.monto_en_moneda_proyecto === undefined && mEur !== undefined && tc && tc > 0) {
  out.monto_en_moneda_proyecto = toNum(mEur * tc);
}

if (out.monto_original === undefined) {
  if (out.moneda_original === 'EUR' && out.monto_en_moneda_principal !== undefined) {
    out.monto_original = toNum(out.monto_en_moneda_principal);
  } else if (out.monto_en_moneda_proyecto !== undefined) {
    out.monto_original = toNum(out.monto_en_moneda_proyecto);
  }
}

  return out;
};

/* --- PROYECTOS --- */

export const subscribeToProjects = (callback: (projects: Project[]) => void) => {
  const colRef = collection(db, PROJECTS_COLLECTION);
  perfIncListener('projects');
  const unsub = onSnapshot(
    colRef,
    (snapshot) => {
      setFirestoreOk();
      callback(snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Project)));
    },
    (err) => setFirestoreStatusFromError(err)
  );
  return () => {
    try {
      unsub();
    } finally {
      perfDecListener('projects');
    }
  };
};

// ✅ Para evitar suscribirse a TODO y filtrar en front (mejor rendimiento + menos ruido)
export const subscribeToProjectsByTipo = (
  tipo: string,
  callback: (projects: Project[]) => void
) => {
  const q = query(collection(db, PROJECTS_COLLECTION), where('tipo', '==', tipo));
  perfIncListener('projects_by_tipo');
  const unsub = onSnapshot(
    q,
    (snapshot) => {
      setFirestoreOk();
      callback(snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Project)));
    },
    (err) => setFirestoreStatusFromError(err)
  );
  return () => {
    try {
      unsub();
    } finally {
      perfDecListener('projects_by_tipo');
    }
  };
};

export const getProjects = async (): Promise<Project[]> => {
  try {
    const colRef = collection(db, PROJECTS_COLLECTION);
    const snapshot = await getDocs(colRef);
    setFirestoreOk();
    return snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Project[];
  } catch (err: any) {
    setFirestoreStatusFromError(err);
    throw err;
  }
};
export const getProjectsCached = getProjects;

export const getProjectById = async (id: string): Promise<Project | null> => {
  try {
    const snap = await getDoc(doc(db, PROJECTS_COLLECTION, id));
    setFirestoreOk();
    return snap.exists() ? ({ id: snap.id, ...snap.data() } as Project) : null;
  } catch (err: any) {
    setFirestoreStatusFromError(err);
    throw err;
  }
};

// FIX: devuelve string (ID) en lugar de DocumentReference
// Nota: permitimos props extra para compatibilidad con campos legacy del front.
export const createProject = async (
  project: Omit<Project, 'id' | 'created_at'> & Record<string, any>
): Promise<string> => {
  const payload = { ...project, created_at: nowISO() };
  if (payload.gasto_total_eur === undefined) payload.gasto_total_eur = 0;
  if (payload.gastos_count === undefined) payload.gastos_count = 0;
  payload.moneda_principal = normalizeCurrencyCode(payload.moneda_principal, 'EUR');
  payload.moneda_proyecto = normalizeCurrencyCode(payload.moneda_proyecto, payload.moneda_principal);

  try {
    const docRef = await addDoc(collection(db, PROJECTS_COLLECTION), payload);
    setFirestoreOk();
    return docRef.id;
  } catch (err: any) {
    setFirestoreStatusFromError(err);
    throw err;
  }
};

export const updateProject = async (id: string, data: Partial<Project> & Record<string, any>) => {
  try {
    const payload: any = { ...data };
    if ('moneda_principal' in payload) payload.moneda_principal = normalizeCurrencyCode(payload.moneda_principal, 'EUR');
    if ('moneda_proyecto' in payload) payload.moneda_proyecto = normalizeCurrencyCode(payload.moneda_proyecto, payload.moneda_principal || 'EUR');

    const res = await updateDoc(doc(db, PROJECTS_COLLECTION, id), payload);
    setFirestoreOk();
    return res;
  } catch (err: any) {
    setFirestoreStatusFromError(err);
    throw err;
  }
};

export const deleteProject = async (id: string) => {
  try {
    // 🔥 Robustez: si se borra un proyecto, borramos sus project_expenses para evitar huérfanos.
    // Nota: se hace hard-delete de expenses vinculados (el proyecto ya no existirá).
    const qExp = query(
      collection(db, PROJECT_EXPENSES_COLLECTION),
      where('proyecto_id', '==', id)
    );
    const expSnap = await getDocsFromServer(qExp);

    // Batch delete en chunks (límite 500 ops por batch)
    let batch = writeBatch(db);
    let ops = 0;
    let batches = 0;

    for (const d of expSnap.docs) {
      batch.delete(d.ref);
      ops += 1;
      if (ops >= 450) {
        await batch.commit();
        batches += 1;
        batch = writeBatch(db);
        ops = 0;
      }
    }
    if (ops > 0) {
      await batch.commit();
      batches += 1;
    }

    const res = await deleteDoc(doc(db, PROJECTS_COLLECTION, id));
    setFirestoreOk();
    return res;
  } catch (err: any) {
    setFirestoreStatusFromError(err);
    throw err;
  }
};

/* --- GASTOS DE PROYECTO --- */

export const getProjectExpenses = async (projectId: string): Promise<ProjectExpense[]> => {
  try {
    const q = query(
      collection(db, PROJECT_EXPENSES_COLLECTION),
      where('proyecto_id', '==', projectId)
    );
    const snap = await getDocs(q);
    setFirestoreOk();
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as ProjectExpense));
  } catch (err: any) {
    setFirestoreStatusFromError(err);
    throw err;
  }
};

export const subscribeToProjectExpensesByProjectId = (
  projectId: string,
  callback: (expenses: ProjectExpense[]) => void
) => {
  const q = query(
    collection(db, PROJECT_EXPENSES_COLLECTION),
    where('proyecto_id', '==', projectId)
  );
  perfIncListener('project_expenses(all)');
  const unsub = onSnapshot(
    q,
    (snapshot) => {
      setFirestoreOk();
      callback(snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as ProjectExpense)));
    },
    (err) => setFirestoreStatusFromError(err)
  );
  return () => {
    perfDecListener('project_expenses(all)');
    unsub();
  };
};

// --- Proyecto (y Viaje) - Paginación/primer bloque realtime ---
export const subscribeToProjectExpensesFirstPage = (
  projectId: string,
  pageSize: number,
  callback: (res: { items: ProjectExpense[]; cursor: any | null }) => void
) => {
  const q = query(
    collection(db, PROJECT_EXPENSES_COLLECTION),
    where('proyecto_id', '==', projectId),
    orderBy('fecha', 'desc'),
    limit(pageSize)
  );

  perfIncListener('project_expenses(page1)');
  const unsub = onSnapshot(
    q,
    (snapshot) => {
      setFirestoreOk();
      const items = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as ProjectExpense));
      const cursor = snapshot.docs.length ? snapshot.docs[snapshot.docs.length - 1] : null;
      callback({ items, cursor });
    },
    (err) => setFirestoreStatusFromError(err)
  );

  return () => {
    perfDecListener('project_expenses(page1)');
    unsub();
  };
};

export const getProjectExpensesPage = async (
  projectId: string,
  pageSize: number,
  cursor?: any | null
): Promise<{ items: ProjectExpense[]; cursor: any | null }> => {
  try {
    const parts: any[] = [
      collection(db, PROJECT_EXPENSES_COLLECTION),
      where('proyecto_id', '==', projectId),
      orderBy('fecha', 'desc'),
    ];
    if (cursor) parts.push(startAfter(cursor));
    parts.push(limit(pageSize));

    const q = query.apply(null, parts as any);
    const snap = await getDocs(q as any);
    setFirestoreOk();
    const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as ProjectExpense));
    const nextCursor = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;
    return { items, cursor: nextCursor };
  } catch (err: any) {
    setFirestoreStatusFromError(err);
    throw err;
  }
};

export const addProjectExpense = async (expense: Omit<ProjectExpense, 'id'> & Record<string, any>) => {
  try {
    const payload = normalizeProjectExpenseForWrite(expense, { isUpdate: false });
    const projectId = String((payload as any).proyecto_id || '');
    const eur = safeNumber((payload as any).monto_en_moneda_principal);
    const local = safeNumber((payload as any).monto_en_moneda_proyecto);

    const expRef = doc(collection(db, PROJECT_EXPENSES_COLLECTION));
    await runTransaction(db, async (tx) => {
      // ⚠️ Firestore exige que TODOS los reads ocurran ANTES de cualquier write dentro de la transacción.
      let projRef: any | null = null;
      let projSnap: any | null = null;

      if (projectId) {
        projRef = doc(db, PROJECTS_COLLECTION, projectId);
        projSnap = await tx.get(projRef);
      }

      tx.set(expRef, payload);

      if (projRef && projSnap?.exists()) {
        tx.update(projRef, {
          gasto_total_eur: increment(eur),
          gasto_total_local: increment(local),
          gastos_count: increment(1),
          gastos_updated_at: nowISO(),
        });
      }
    });

    setFirestoreOk();
    emitDataEvent('project_expenses_changed');
    emitDataEvent('projects_changed');
    return expRef;
  } catch (err: any) {
    setFirestoreStatusFromError(err);
    throw err;
  }
};

export const updateProjectExpense = async (expense: ProjectExpense & Record<string, any>) => {
  if (!expense.id) return;
  const { id, ...rest } = expense;

  try {
    const payload = normalizeProjectExpenseForWrite(rest, { isUpdate: true });
    const expRef = doc(db, PROJECT_EXPENSES_COLLECTION, id);

    await runTransaction(db, async (tx) => {
      // 1) Reads (antes de cualquier write)
      const snap = await tx.get(expRef);
      const prev = snap.exists() ? (snap.data() as any) : null;

      const oldProjectId = prev ? String(prev.proyecto_id || '') : '';
      const oldEur = prev ? safeNumber(prev.monto_en_moneda_principal) : 0;
      const oldLocal = prev ? safeNumber(prev.monto_en_moneda_proyecto) : 0;

      const newProjectId = String((payload as any).proyecto_id ?? oldProjectId);
      const newEur = safeNumber((payload as any).monto_en_moneda_principal ?? oldEur);
      const newLocal = safeNumber((payload as any).monto_en_moneda_proyecto ?? oldLocal);

      const now = nowISO();

      const oldProjRef = oldProjectId ? doc(db, PROJECTS_COLLECTION, oldProjectId) : null;
      const newProjRef = newProjectId ? doc(db, PROJECTS_COLLECTION, newProjectId) : null;

      const oldProjSnap = oldProjRef ? await tx.get(oldProjRef) : null;
      const newProjSnap =
        newProjRef
          ? (oldProjRef && (newProjRef as any).path === (oldProjRef as any).path ? oldProjSnap : await tx.get(newProjRef))
          : null;

      // 2) Writes (después de todos los reads)
      if (snap.exists()) {
        tx.update(expRef, payload);
      } else {
        tx.set(expRef, payload, { merge: true });
      }

      // Mismo proyecto: solo ajusta delta.
      if (oldProjectId && oldProjectId === newProjectId) {
        const delta = newEur - oldEur;
        const deltaLocal = newLocal - oldLocal;

        if ((delta !== 0 || deltaLocal !== 0) && oldProjRef && oldProjSnap?.exists()) {
          const upd: any = { gastos_updated_at: now };
          if (delta !== 0) upd.gasto_total_eur = increment(delta);
          if (deltaLocal !== 0) upd.gasto_total_local = increment(deltaLocal);
          tx.update(oldProjRef, upd);
        }
        return;
      }

      // Cambio de proyecto: mueve el gasto (y el contador) entre proyectos.
      if (oldProjRef && oldProjSnap?.exists()) {
        tx.update(oldProjRef, {
          gasto_total_eur: increment(-oldEur),
          gasto_total_local: increment(-oldLocal),
          gastos_count: increment(-1),
          gastos_updated_at: now,
        });
      }

      if (newProjRef && newProjSnap?.exists()) {
        tx.update(newProjRef, {
          gasto_total_eur: increment(newEur),
          gasto_total_local: increment(newLocal),
          gastos_count: increment(1),
          gastos_updated_at: now,
        });
      }
    });

    setFirestoreOk();
    emitDataEvent('project_expenses_changed');
    emitDataEvent('projects_changed');
    return;
  } catch (err: any) {
    setFirestoreStatusFromError(err);
    throw err;
  }
};

export const deleteProjectExpense = async (expenseId: string) => {
  try {
    const expRef = doc(db, PROJECT_EXPENSES_COLLECTION, expenseId);

    await runTransaction(db, async (tx) => {
      // 1) Reads (antes de cualquier write)
      const snap = await tx.get(expRef);
      if (!snap.exists()) return;

      const prev = snap.data() as any;
      const projectId = String(prev.proyecto_id || '');
      const eur = safeNumber(prev.monto_en_moneda_principal);
      const local = safeNumber(prev.monto_en_moneda_proyecto);
      const now = nowISO();

      const projRef = projectId ? doc(db, PROJECTS_COLLECTION, projectId) : null;
      const projSnap = projRef ? await tx.get(projRef) : null;

      // 2) Writes (después de todos los reads)
      tx.delete(expRef);

      if (projRef && projSnap?.exists()) {
        tx.update(projRef, {
          gasto_total_eur: increment(-eur),
          gasto_total_local: increment(-local),
          gastos_count: increment(-1),
          gastos_updated_at: now,
        });
      }
    });

    setFirestoreOk();
    emitDataEvent('project_expenses_changed');
    emitDataEvent('projects_changed');
    return;
  } catch (err: any) {
    setFirestoreStatusFromError(err);
    throw err;
  }
};

export const getAllProjectExpenses = async (): Promise<ProjectExpense[]> => {
  try {
    const q = query(collection(db, PROJECT_EXPENSES_COLLECTION), orderBy('fecha', 'desc'));
    const snap = await getDocs(q);
    setFirestoreOk();
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as ProjectExpense));
  } catch (err: any) {
    setFirestoreStatusFromError(err);
    throw err;
  }
};
export const getAllProjectExpensesCached = getAllProjectExpenses;


export const rebuildProjectAggregates = async () => {
  try {
    // ⚠️ One-shot: recorre todos los ProjectExpenses y recalcula totales en cada Project.
    const [projects, expensesSnap] = await Promise.all([
      getProjects(),
      getDocs(collection(db, PROJECT_EXPENSES_COLLECTION)),
    ]);

    const totals: Record<string, { sum: number; sumLocal: number; count: number }> = {};
    for (const d of expensesSnap.docs) {
      const exp = d.data() as any;
      if (exp?.estado === 'borrado') continue;
      const pid = String(exp?.proyecto_id || '');
      if (!pid) continue;
      const eur = safeNumber(exp?.monto_en_moneda_principal);
      const local = safeNumber(exp?.monto_en_moneda_proyecto);
      totals[pid] = totals[pid] || { sum: 0, sumLocal: 0, count: 0 };
      totals[pid].sum += eur;
      totals[pid].sumLocal += local;
      totals[pid].count += 1;
    }

    const now = nowISO();
    for (const p of projects) {
      const pid = p.id;
      if (!pid) continue;
      const t = totals[pid] || { sum: 0, sumLocal: 0, count: 0 };
      await updateDoc(doc(db, PROJECTS_COLLECTION, pid), {
        gasto_total_eur: t.sum,
        gasto_total_local: t.sumLocal,
        gastos_count: t.count,
        gastos_updated_at: now,
      } as any);
    }

    setFirestoreOk();
    return;
  } catch (err: any) {
    setFirestoreStatusFromError(err);
    throw err;
  }
};

export const ensureProjectAggregatesIfMissing = async (projectId: string) => {
  try {
    const projRef = doc(db, PROJECTS_COLLECTION, projectId);
    const projSnap = await getDoc(projRef);
    if (!projSnap.exists()) return;

    const data = projSnap.data() as any;
    const hasEur = typeof data?.gasto_total_eur === 'number' && Number.isFinite(data.gasto_total_eur);
    const hasLocal = typeof data?.gasto_total_local === 'number' && Number.isFinite(data.gasto_total_local);
    const hasCount = typeof data?.gastos_count === 'number' && Number.isFinite(data.gastos_count);

    // Si ya está todo, nada que hacer.
    if (hasEur && hasLocal && hasCount) return;

    // One-shot: recalcula solo para ESTE proyecto.
    const q = query(collection(db, PROJECT_EXPENSES_COLLECTION), where('proyecto_id', '==', projectId));
    const expSnap = await getDocsFromServer(q);

    let sumEur = 0;
    let sumLocal = 0;
    let count = 0;
    for (const d of expSnap.docs) {
      const exp = d.data() as any;
      if (exp?.estado === 'borrado') continue;
      sumEur += safeNumber(exp?.monto_en_moneda_principal);
      sumLocal += safeNumber(exp?.monto_en_moneda_proyecto);
      count += 1;
    }

    await updateDoc(projRef, {
      gasto_total_eur: sumEur,
      gasto_total_local: sumLocal,
      gastos_count: count,
      gastos_updated_at: nowISO(),
    } as any);

    setFirestoreOk();
    return;
  } catch (err: any) {
    setFirestoreStatusFromError(err);
    throw err;
  }
};

/* --- GASTOS MENSUALES --- */

export const addMonthlyExpense = async (expense: Omit<MonthlyExpense, 'id'>) => {
  try {
    const closingDay = closingConfigCache?.diaFijo || 11;
    const normalized = normalizeMonthlyExpenseForWrite(expense as any, { isUpdate: false });
    const p = computePeriodInfoForISODate(safeString(normalized.fecha), closingDay);

    // Guardamos metadata de periodo para que todo sea determinista.
    normalized.period_id = p.periodId;
    normalized.period_numero = p.periodNumber;
    normalized.period_inicio_ymd = p.startYMD;
    normalized.period_fin_ymd = p.endYMD;

    const col = collection(db, MONTHLY_EXPENSES_COLLECTION);
    const expRef = doc(col);
    const sumRef = doc(db, PERIOD_SUMMARIES_COLLECTION, p.periodId);

    await runTransaction(db, async (tx) => {
      // ⚠️ Firestore exige que TODOS los reads ocurran ANTES de cualquier write dentro de la transacción.
      // 1) Lee summary
      const sumSnap = await tx.get(sumRef);
      const base: Record<string, any> = sumSnap.exists()
        ? ({ ...sumSnap.data() } as any)
        : {
            numeroPeriodo: p.periodNumber,
            fechaInicioYMD: p.startYMD,
            fechaFinYMD: p.endYMD,
            total: 0,
            totalCount: 0,
            categories: {},
            version: 2,
          };

      // Si ya existía pero quedó con otro rango (por config o legacy), lo ajustamos.
      base.numeroPeriodo = p.periodNumber;
      base.fechaInicioYMD = p.startYMD;
      base.fechaFinYMD = p.endYMD;
      base.version = Math.max(2, safeNumber(base.version));

      const rawCatKey = safeString(normalized.categoryId) || safeString(normalized.categoria);
      const catKey = toSafeFirestoreMapKey(rawCatKey, 'SIN_CATEGORIA');
      const catName = safeString(normalized.categoria) || catKey;

      applyDeltaToSummaryData(base, {
        amountDelta: safeNumber(normalized.monto),
        countDelta: 1,
        categoryKey: catKey,
        categoryName: catName,
      });

      // 2) Writes (después de reads)
      tx.set(expRef, normalized);
      tx.set(sumRef, base, { merge: false });
    });

    setFirestoreOk();
    emitDataEvent('monthly_expenses_changed');
    emitDataEvent('period_summaries_changed');
    return { id: expRef.id } as any;
  } catch (err: any) {
    setFirestoreStatusFromError(err);
    throw err;
  }
};

export const updateMonthlyExpense = async (expense: MonthlyExpense) => {
  if (!expense.id) return;
  const { id, ...rest } = expense;
  try {
    const closingDay = closingConfigCache?.diaFijo || 11;
    const expRef = doc(db, MONTHLY_EXPENSES_COLLECTION, id);

    await runTransaction(db, async (tx) => {
      const prevSnap = await tx.get(expRef);
      if (!prevSnap.exists()) return;

      const prev = prevSnap.data() as any;
      const normalized = normalizeMonthlyExpenseForWrite(rest as any, { isUpdate: true });

      // Periodos (soporta cambio de fecha)
      const prevPeriodId = safeString(prev.period_id) || computePeriodInfoForISODate(safeString(prev.fecha), closingDay).periodId;
      const nextPeriodInfo = computePeriodInfoForISODate(safeString(normalized.fecha ?? prev.fecha), closingDay);
      const nextPeriodId = nextPeriodInfo.periodId;

      normalized.period_id = nextPeriodId;
      normalized.period_numero = nextPeriodInfo.periodNumber;
      normalized.period_inicio_ymd = nextPeriodInfo.startYMD;
      normalized.period_fin_ymd = nextPeriodInfo.endYMD;

      // 2) summary deltas (⚠️ todos los reads antes de writes)
      const prevAmt = safeNumber(prev.monto);
      const nextAmt = safeNumber(normalized.monto ?? prev.monto);

      const prevState = safeString(prev.estado) || 'activo';
      const nextState = safeString(normalized.estado ?? prev.estado) || 'activo';

      const prevRawCatKey = safeString(prev.categoryId) || safeString(prev.categoria);
      const nextRawCatKey = safeString(normalized.categoryId ?? prev.categoryId) || safeString(normalized.categoria ?? prev.categoria);
      const prevCatKey = toSafeFirestoreMapKey(prevRawCatKey, 'SIN_CATEGORIA');
      const nextCatKey = toSafeFirestoreMapKey(nextRawCatKey, 'SIN_CATEGORIA');
      const prevCatName = safeString(prev.categoria) || prevCatKey;
      const nextCatName = safeString(normalized.categoria ?? prev.categoria) || nextCatKey;

      const prevCount = prevState === 'borrado' ? 0 : 1;
      const nextCount = nextState === 'borrado' ? 0 : 1;

      const prevEffectiveAmt = prevState === 'borrado' ? 0 : prevAmt;
      const nextEffectiveAmt = nextState === 'borrado' ? 0 : nextAmt;

      // refs + reads (antes de cualquier write)
      const prevPeriodInfo = computePeriodInfoForISODate(safeString(prev.fecha), closingDay);
      const prevPeriodNumberFromId = safeNumber(prevPeriodId.replace(/^P/i, ''));
      const prevPeriodNumber = prevPeriodNumberFromId || prevPeriodInfo.periodNumber;
      const sumPrevRef = doc(db, PERIOD_SUMMARIES_COLLECTION, prevPeriodId);
      const sumNextRef = doc(db, PERIOD_SUMMARIES_COLLECTION, nextPeriodId);

      const sumPrevSnap = await tx.get(sumPrevRef);
      const sumNextSnap = prevPeriodId === nextPeriodId ? sumPrevSnap : await tx.get(sumNextRef);

      const basePrev: Record<string, any> = sumPrevSnap.exists()
        ? ({ ...sumPrevSnap.data() } as any)
        : {
            numeroPeriodo: prevPeriodNumber,
            fechaInicioYMD: safeString(prev.period_inicio_ymd) || prevPeriodInfo.startYMD,
            fechaFinYMD: safeString(prev.period_fin_ymd) || prevPeriodInfo.endYMD,
            total: 0,
            totalCount: 0,
            categories: {},
            version: 2,
          };
      basePrev.numeroPeriodo = prevPeriodNumber;
      basePrev.fechaInicioYMD = safeString(prev.period_inicio_ymd) || prevPeriodInfo.startYMD;
      basePrev.fechaFinYMD = safeString(prev.period_fin_ymd) || prevPeriodInfo.endYMD;
      basePrev.version = Math.max(2, safeNumber(basePrev.version));

      const baseNext: Record<string, any> =
        prevPeriodId === nextPeriodId
          ? basePrev
          : sumNextSnap.exists()
            ? ({ ...sumNextSnap.data() } as any)
            : {
                numeroPeriodo: nextPeriodInfo.periodNumber,
                fechaInicioYMD: nextPeriodInfo.startYMD,
                fechaFinYMD: nextPeriodInfo.endYMD,
                total: 0,
                totalCount: 0,
                categories: {},
                version: 2,
              };
      if (prevPeriodId !== nextPeriodId) {
        baseNext.numeroPeriodo = nextPeriodInfo.periodNumber;
        baseNext.fechaInicioYMD = nextPeriodInfo.startYMD;
        baseNext.fechaFinYMD = nextPeriodInfo.endYMD;
        baseNext.version = Math.max(2, safeNumber(baseNext.version));
      }

      if (prevPeriodId === nextPeriodId) {
        // misma categoría: delta simple
        if (prevCatKey === nextCatKey) {
          applyDeltaToSummaryData(basePrev, {
            amountDelta: nextEffectiveAmt - prevEffectiveAmt,
            countDelta: nextCount - prevCount,
            categoryKey: nextCatKey,
            categoryName: nextCatName,
          });
        } else {
          // cambia de categoría: restar una, sumar otra
          if (prevCount > 0) {
            applyDeltaToSummaryData(basePrev, {
              amountDelta: -prevEffectiveAmt,
              countDelta: -prevCount,
              categoryKey: prevCatKey,
              categoryName: prevCatName,
            });
          }
          if (nextCount > 0) {
            applyDeltaToSummaryData(basePrev, {
              amountDelta: nextEffectiveAmt,
              countDelta: nextCount,
              categoryKey: nextCatKey,
              categoryName: nextCatName,
            });
          }
        }
      } else {
        // periodo anterior: quitar
        if (prevCount > 0) {
          applyDeltaToSummaryData(basePrev, {
            amountDelta: -prevEffectiveAmt,
            countDelta: -prevCount,
            categoryKey: prevCatKey,
            categoryName: prevCatName,
          });
        }
        // periodo nuevo: sumar
        if (nextCount > 0) {
          applyDeltaToSummaryData(baseNext, {
            amountDelta: nextEffectiveAmt,
            countDelta: nextCount,
            categoryKey: nextCatKey,
            categoryName: nextCatName,
          });
        }
      }

      // 3) writes (después de TODOS los reads)
      tx.update(expRef, normalized);
      tx.set(sumPrevRef, basePrev, { merge: false });
      if (prevPeriodId !== nextPeriodId) {
        tx.set(sumNextRef, baseNext, { merge: false });
      }
    });

    setFirestoreOk();
    emitDataEvent('monthly_expenses_changed');
    emitDataEvent('period_summaries_changed');
    return;
  } catch (err: any) {
    setFirestoreStatusFromError(err);
    throw err;
  }
};

export const deleteMonthlyExpense = async (id: string) => {
  try {
    const closingDay = closingConfigCache?.diaFijo || 11;
    const expRef = doc(db, MONTHLY_EXPENSES_COLLECTION, id);

    await runTransaction(db, async (tx) => {
      const snap = await tx.get(expRef);
      if (!snap.exists()) return;
      const prev = snap.data() as any;

      const prevState = safeString(prev.estado) || 'activo';
      if (prevState === 'borrado') {
        // Si ya estaba borrado (soft), igual lo eliminamos duro sin tocar summary.
        tx.delete(expRef);
        return;
      }

      const amt = safeNumber(prev.monto);
      const p = safeString(prev.period_id) || computePeriodInfoForISODate(safeString(prev.fecha), closingDay).periodId;
      const rawCatKey = safeString(prev.categoryId) || safeString(prev.categoria);
      const catKey = toSafeFirestoreMapKey(rawCatKey, 'SIN_CATEGORIA');
      const catName = safeString(prev.categoria) || catKey;

      const sumRef = doc(db, PERIOD_SUMMARIES_COLLECTION, p);
      const sumSnap = await tx.get(sumRef);
      const base: Record<string, any> = sumSnap.exists()
        ? ({ ...sumSnap.data() } as any)
        : {
            numeroPeriodo: safeNumber(p.replace(/^P/i, '')),
            fechaInicioYMD: safeString(prev.period_inicio_ymd) || '',
            fechaFinYMD: safeString(prev.period_fin_ymd) || '',
            total: 0,
            totalCount: 0,
            categories: {},
            version: 2,
          };
      base.version = Math.max(2, safeNumber(base.version));

      applyDeltaToSummaryData(base, {
        amountDelta: -amt,
        countDelta: -1,
        categoryKey: catKey,
        categoryName: catName,
      });

      tx.set(sumRef, base, { merge: false });
      tx.delete(expRef);
    });

    setFirestoreOk();
    emitDataEvent('monthly_expenses_changed');
    emitDataEvent('period_summaries_changed');
    return;
  } catch (err: any) {
    setFirestoreStatusFromError(err);
    throw err;
  }
};

// ✅ Suscripción “solo primera página” para Home (Bulldozer v2)
export const subscribeToExpensesFirstPageInRange = (
  startYMD: string,
  endYMD: string,
  pageSize: number,
  callback: (payload: { items: MonthlyExpense[]; cursor: any }) => void
) => {
  const q = query(
    collection(db, MONTHLY_EXPENSES_COLLECTION),
    where('fecha', '>=', startYMD),
    where('fecha', '<=', endYMD + ''),
    orderBy('fecha', 'desc'),
    limit(pageSize)
  );
  return onSnapshot(
    q,
    (snap) => {
      setFirestoreOk();
      callback({
        items: snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as MonthlyExpense)),
        cursor: snap.docs[snap.docs.length - 1],
      });
    },
    (err) => setFirestoreStatusFromError(err)
  );
};

export const subscribeToExpensesInRange = (
  startYMD: string,
  endYMD: string,
  callback: (expenses: MonthlyExpense[]) => void
) => {
  const q = query(
    collection(db, MONTHLY_EXPENSES_COLLECTION),
    where('fecha', '>=', startYMD),
    where('fecha', '<=', endYMD + ''),
    orderBy('fecha', 'desc')
  );
  return onSnapshot(
    q,
    (snap) => {
      setFirestoreOk();
      callback(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as MonthlyExpense)));
    },
    (err) => setFirestoreStatusFromError(err)
  );
};

export const getExpensesInRangeOnce = async (
  startYMD: string,
  endYMD: string
): Promise<MonthlyExpense[]> => {
  try {
    const q = query(
      collection(db, MONTHLY_EXPENSES_COLLECTION),
      where('fecha', '>=', startYMD),
      where('fecha', '<=', endYMD + ''),
      orderBy('fecha', 'desc')
    );
    const snap = await getDocsFromServer(q);
    setFirestoreOk();
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as MonthlyExpense));
  } catch (err: any) {
    setFirestoreStatusFromError(err);
    throw err;
  }
};

export const getExpensesPageInRange = async (
  startYMD: string,
  endYMD: string,
  pageSize: number,
  cursor?: any
) => {
  try {
    const base = [
      where('fecha', '>=', startYMD),
      where('fecha', '<=', endYMD + ''),
      orderBy('fecha', 'desc'),
      limit(pageSize),
    ];
    const q = cursor
      ? query(collection(db, MONTHLY_EXPENSES_COLLECTION), ...base, startAfter(cursor))
      : query(collection(db, MONTHLY_EXPENSES_COLLECTION), ...base);
    const snap = await getDocs(q);
    setFirestoreOk();
    return {
      items: snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as MonthlyExpense)),
      cursor: snap.docs[snap.docs.length - 1],
    };
  } catch (err: any) {
    setFirestoreStatusFromError(err);
    throw err;
  }
};

/* --- CATEGORÍAS --- */

export const getCategories = async (scope: 'home' | 'trip' = 'home'): Promise<Category[]> => {
  try {
    const snap = await getDocs(collection(db, CATEGORIES_COLLECTION));
    setFirestoreOk();
    const all = snap.docs.map((d) => {
        const data = d.data() as any;
        const nombre = String(data?.nombre ?? data?.label ?? '').trim();
        const label = String(data?.label ?? data?.nombre ?? nombre).trim();
        const key = String(data?.key ?? '').trim() || normalizeCategoryKey(label || nombre);
        return ({ id: d.id, ...data, nombre: nombre || label, label, key } as Category);
      });
      // Legacy: si falta scope, se asume 'home'
    return all.filter((c) => (scope === 'home' ? (c as any).scope !== 'trip' : (c as any).scope === 'trip'));
  } catch (err: any) {
    setFirestoreStatusFromError(err);
    throw err;
  }
};


const stripDiacriticsForKey = (s: string) => {
  try {
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  } catch {
    // por si algún entorno no soporta normalize; fallback sin cambios
    return s;
  }
};

const normalizeCategoryKey = (raw: any) => {
  const s = stripDiacriticsForKey(String(raw ?? '')).trim().toLowerCase();
  // letters/numbers + espacios -> guiones
  const cleaned = s
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned || 'otros';
};

export const saveCategory = async (category: Category) => {
  const { id, ...rest } = category;

  // Modelo: nombre sigue existiendo para compatibilidad, pero ahora guardamos también label (visible) y key (estable).
  const label = String((category as any).label ?? (rest as any).label ?? (rest as any).nombre ?? '').trim();
  const nombre = String((rest as any).nombre ?? label).trim() || label;
  const key = String((category as any).key ?? (rest as any).key ?? '').trim() || normalizeCategoryKey(label || nombre);

  const payload: any = {
    ...rest,
    scope: (rest as any).scope ?? 'home',
    nombre,
    label,
    key,
  };
  try {
    const res = id
      ? await updateDoc(doc(db, CATEGORIES_COLLECTION, id), payload)
      : await addDoc(collection(db, CATEGORIES_COLLECTION), payload);
    setFirestoreOk();
    return res;
  } catch (err: any) {
    setFirestoreStatusFromError(err);
    throw err;
  }
};

export const deleteCategory = async (id: string) => {
  try {
    const res = await deleteDoc(doc(db, CATEGORIES_COLLECTION, id));
    setFirestoreOk();
    return res;
  } catch (err: any) {
    setFirestoreStatusFromError(err);
    throw err;
  }
};

export const subscribeToCategories = (
  callback: (categories: Category[]) => void,
  scope: 'home' | 'trip' = 'home'
) => {
  return onSnapshot(
    query(collection(db, CATEGORIES_COLLECTION), orderBy('nombre', 'asc')),
    (snap) => {
      setFirestoreOk();
      const all = snap.docs.map((d) => {
      const data = d.data() as any;
      const nombre = String(data?.nombre ?? data?.label ?? '').trim();
      const label = String(data?.label ?? data?.nombre ?? nombre).trim();
      const key = String(data?.key ?? '').trim() || normalizeCategoryKey(label || nombre);
      return ({ id: d.id, ...data, nombre: nombre || label, label, key } as Category);
    });
      // Legacy: si falta scope, se asume 'home'
      const filtered = all.filter((c) =>
        scope === 'home' ? (c as any).scope !== 'trip' : (c as any).scope === 'trip'
      );
      callback(filtered);
    },
    (err) => setFirestoreStatusFromError(err)
  );
};


/* --- CONFIGURACIÓN Y REPORTES --- */

export const getClosingConfig = async (): Promise<ClosingConfig> => {
  try {
    const snap = await getDoc(doc(db, META_COLLECTION, CLOSING_CONFIG_DOC_ID));
    setFirestoreOk();
    const cfg = (snap.exists() ? snap.data() : { tipo: 'diaFijo', diaFijo: 11 }) as ClosingConfig;
    closingConfigCache = cfg;
    return cfg;
  } catch (err: any) {
    setFirestoreStatusFromError(err);
    throw err;
  }
};


export type CustomCurrency = {
  code: string;
  name: string;
  created_at?: string;
  updated_at?: string;
};

const sanitizeCustomCurrencyCode = (raw: any, maxLen: number = 10) => {
  const upper = String(raw ?? '').toUpperCase();
  const cleaned = upper.replace(/\s+/g, '').replace(/[^A-Z0-9]/g, '');
  return cleaned.slice(0, maxLen);
};

const sanitizeCustomCurrencyName = (raw: any, maxLen: number = 60) => {
  const s = String(raw ?? '').trim();
  // deja espacios simples, evita saltos de línea y corta largo
  const cleaned = s.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ');
  return cleaned.slice(0, maxLen);
};

export const getCustomCurrencies = async (): Promise<CustomCurrency[]> => {
  try {
    const ref = doc(db, META_COLLECTION, CUSTOM_CURRENCIES_DOC_ID);
    const snap = await getDoc(ref);
    setFirestoreOk();
    if (!snap.exists()) return [];

    const raw = (snap.data() as any)?.items || [];
    const items: CustomCurrency[] = (Array.isArray(raw) ? raw : [])
      .map((it: any) => {
        const code = sanitizeCustomCurrencyCode(it?.code);
        const name = sanitizeCustomCurrencyName(it?.name || code);
        return { code, name, created_at: it?.created_at, updated_at: it?.updated_at } as CustomCurrency;
      })
      .filter((it) => !!it.code);

    // unique + sort
    const map = new Map<string, CustomCurrency>();
    for (const it of items) map.set(it.code, it);
    return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
  } catch (err: any) {
    setFirestoreStatusFromError(err);
    throw err;
  }
};

export const upsertCustomCurrency = async (codeRaw: string, nameRaw: string) => {
  const code = sanitizeCustomCurrencyCode(codeRaw);
  const name = sanitizeCustomCurrencyName(nameRaw || code);
  if (!code) throw new Error('Código de moneda inválido');
  if (!name) throw new Error('Nombre de moneda inválido');

  const ref = doc(db, META_COLLECTION, CUSTOM_CURRENCIES_DOC_ID);
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const now = nowISO();
      const raw = snap.exists() ? ((snap.data() as any)?.items || []) : [];
      const items: CustomCurrency[] = (Array.isArray(raw) ? raw : [])
        .map((it: any) => ({
          code: sanitizeCustomCurrencyCode(it?.code),
          name: sanitizeCustomCurrencyName(it?.name || it?.code),
          created_at: it?.created_at,
          updated_at: it?.updated_at,
        }))
        .filter((it) => !!it.code);

      const idx = items.findIndex((x) => x.code === code);
      if (idx >= 0) {
        items[idx] = { ...items[idx], name, updated_at: now };
      } else {
        items.push({ code, name, created_at: now, updated_at: now });
      }

      // unique + sort
      const map = new Map<string, CustomCurrency>();
      for (const it of items) map.set(it.code, it);
      const out = Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));

      tx.set(ref, { items: out, updated_at: now, version: 1 }, { merge: true });
    });
    setFirestoreOk();
  } catch (err: any) {
    setFirestoreStatusFromError(err);
    throw err;
  }
};

export const deleteCustomCurrency = async (codeRaw: string) => {
  const code = sanitizeCustomCurrencyCode(codeRaw);
  if (!code) return;

  const ref = doc(db, META_COLLECTION, CUSTOM_CURRENCIES_DOC_ID);
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const now = nowISO();
      const raw = snap.exists() ? ((snap.data() as any)?.items || []) : [];
      const items: CustomCurrency[] = (Array.isArray(raw) ? raw : [])
        .map((it: any) => ({
          code: sanitizeCustomCurrencyCode(it?.code),
          name: sanitizeCustomCurrencyName(it?.name || it?.code),
          created_at: it?.created_at,
          updated_at: it?.updated_at,
        }))
        .filter((it) => !!it.code && it.code !== code);

      // unique + sort
      const map = new Map<string, CustomCurrency>();
      for (const it of items) map.set(it.code, it);
      const out = Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));

      tx.set(ref, { items: out, updated_at: now, version: 1 }, { merge: true });
    });
    setFirestoreOk();
  } catch (err: any) {
    setFirestoreStatusFromError(err);
    throw err;
  }
};



/* --- RESUMEN LIVE POR PERIODO --- */

export const subscribeToPeriodSummary = (
  periodId: string,
  callback: (summary: any | null) => void
) => {
  const ref = doc(db, PERIOD_SUMMARIES_COLLECTION, periodId);
  return onSnapshot(
    ref,
    (snap) => {
      setFirestoreOk();
      callback(snap.exists() ? ({ id: snap.id, ...snap.data() } as any) : null);
    },
    (err) => setFirestoreStatusFromError(err)
  );
};

export const ensurePeriodSummary = async (
  periodId: string,
  startYMD: string,
  endYMD: string
) => {
  try {
    const ref = doc(db, PERIOD_SUMMARIES_COLLECTION, periodId);
    const snap = await getDoc(ref);

    const existsAndMatches =
      snap.exists() &&
      safeString((snap.data() as any)?.fechaInicioYMD) === startYMD &&
      safeString((snap.data() as any)?.fechaFinYMD) === endYMD &&
      safeNumber((snap.data() as any)?.version) >= 2;

    if (existsAndMatches) {
      setFirestoreOk();
      return;
    }

    // Rebuild (solo si falta o está desfasado)
    const q = query(
      collection(db, MONTHLY_EXPENSES_COLLECTION),
      where('fecha', '>=', startYMD),
      where('fecha', '<=', endYMD + ''),
      orderBy('fecha', 'desc')
    );
    const expensesSnap = await getDocsFromServer(q);

    const out: Record<string, any> = {
      numeroPeriodo: safeNumber(periodId.replace(/^P/i, '')),
      fechaInicioYMD: startYMD,
      fechaFinYMD: endYMD,
      total: 0,
      totalCount: 0,
      categories: {},
      version: 2,
      rebuilt_at: nowISO(),
      updated_at: nowISO(),
    };

    for (const d of expensesSnap.docs) {
      const e = d.data() as any;
      if (e?.estado === 'borrado') continue;
      const amt = safeNumber(e?.monto);
      const catKey = safeString(e?.categoryId) || safeString(e?.categoria) || 'SIN_CATEGORIA';
      const catName = safeString(e?.categoria) || catKey;
      applyDeltaToSummaryData(out, {
        amountDelta: amt,
        countDelta: 1,
        categoryKey: catKey,
        categoryName: catName,
      });
    }

    // En rebuild ya sumamos updated_at en cada apply; lo dejamos consistente
    out.updated_at = nowISO();

    await setDoc(ref, out, { merge: false });
    setFirestoreOk();
  } catch (err: any) {
    setFirestoreStatusFromError(err);
    throw err;
  }
};

export const saveClosingConfig = async (config: any) => {
  try {
    const res = await setDoc(doc(db, META_COLLECTION, CLOSING_CONFIG_DOC_ID), config, { merge: true });
    setFirestoreOk();
    return res;
  } catch (err: any) {
    setFirestoreStatusFromError(err);
    throw err;
  }
};

export const getMonthlyReports = async (): Promise<MonthlyReport[]> => {
  try {
    const q = query(collection(db, MONTHLY_REPORTS_COLLECTION), orderBy('numeroPeriodo', 'desc'));
    const snap = await getDocs(q);
    setFirestoreOk();
    const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as MonthlyReport));

// Filtra stubs legacy (ej. "P31" cerrado_manual_stub) y sanea strings con whitespace accidental
const cleaned = items
  .map((r: any) => {
    if (typeof r.fechaCierre === 'string') r.fechaCierre = r.fechaCierre.trim();
    if (typeof r.fechaInicio === 'string') r.fechaInicio = r.fechaInicio.trim();
    if (typeof r.fechaFin === 'string') r.fechaFin = r.fechaFin.trim();
    return r as MonthlyReport;
  })
  .filter((r: any) => {
    // Excluir cierres archivados (duplicados, futuros, etc.)
    const estado = String(r?.estado || '').toLowerCase();
    if (estado.startsWith('archived')) return false;
    if (r?.estado === 'cerrado_manual_stub') return false;
    // Stub típico: id "P31" sin detalles reales
    if (r?.id === 'P31') {
      const det = r.detalles;
      const emptyDetails =
        !Array.isArray(det) ||
        det.length === 0 ||
        (det.length === 1 && (!det[0] || (!det[0].categoryName && !det[0].categoryId)));
      if (emptyDetails) return false;
    }
    return true;
  });

return cleaned;

  } catch (err: any) {
    setFirestoreStatusFromError(err);
    throw err;
  }
};

export const upsertMonthlyReport = async (id: string, data: any) => {
  try {
    const res = await setDoc(doc(db, MONTHLY_REPORTS_COLLECTION, id), data, { merge: true });
    setFirestoreOk();
    return res;
  } catch (err: any) {
    setFirestoreStatusFromError(err);
    throw err;
  }
};


/* --- MANTENIMIENTO: HUÉRFANOS (project_expenses sin project) --- */

export type ProjectExpenseOrphan = {
  id: string;
  proyecto_id: string;
  fecha?: any;
  descripcion?: string;
  categoria?: string;
  monto_en_moneda_principal?: number;
  moneda_original?: string;
  created_at?: string;
  updated_at?: string;
};

export type OrphanAuditResult = {
  total: number;
  byProjectId: Array<{ projectId: string; count: number }>;
  sample: ProjectExpenseOrphan[];
};

export const auditProjectExpenseOrphans = async (): Promise<OrphanAuditResult> => {
  try {
    const [projectsSnap, expSnap] = await Promise.all([
      getDocsFromServer(collection(db, PROJECTS_COLLECTION)),
      getDocsFromServer(collection(db, PROJECT_EXPENSES_COLLECTION)),
    ]);

    const projectIds = new Set(projectsSnap.docs.map((d) => d.id));

    const orphans: ProjectExpenseOrphan[] = [];
    const counts: Record<string, number> = {};

    for (const d of expSnap.docs) {
      const e = d.data() as any;
      if (e?.estado === 'borrado') continue;
      const pid = String(e?.proyecto_id || '').trim();
      if (!pid || !projectIds.has(pid)) {
        const key = pid || '[SIN_PROYECTO_ID]';
        counts[key] = (counts[key] || 0) + 1;
        orphans.push({
          id: d.id,
          proyecto_id: pid,
          fecha: e?.fecha,
          descripcion: e?.descripcion,
          categoria: e?.categoria,
          monto_en_moneda_principal: safeNumber(e?.monto_en_moneda_principal),
          moneda_original: safeString(e?.moneda_original),
          created_at: safeString(e?.created_at),
          updated_at: safeString(e?.updated_at),
        });
      }
    }

    const byProjectId = Object.entries(counts)
      .map(([projectId, count]) => ({ projectId, count }))
      .sort((a, b) => b.count - a.count);

    setFirestoreOk();
    return {
      total: orphans.length,
      byProjectId,
      sample: orphans.slice(0, 20),
    };
  } catch (err: any) {
    setFirestoreStatusFromError(err);
    throw err;
  }
};

export const softDeleteProjectExpenseOrphans = async (): Promise<{ toUpdate: number; updated: number; batches: number }> => {
  try {
    const audit = await auditProjectExpenseOrphans();
    const toUpdate = audit.total;
    if (!toUpdate) {
      setFirestoreOk();
      return { toUpdate: 0, updated: 0, batches: 0 };
    }

    const [projectsSnap, expSnap] = await Promise.all([
      getDocsFromServer(collection(db, PROJECTS_COLLECTION)),
      getDocsFromServer(collection(db, PROJECT_EXPENSES_COLLECTION)),
    ]);
    const projectIds = new Set(projectsSnap.docs.map((d) => d.id));

    const now = nowISO();

    let batch = writeBatch(db);
    let ops = 0;
    let batches = 0;
    let updated = 0;

    for (const d of expSnap.docs) {
      const e = d.data() as any;
      if (e?.estado === 'borrado') continue;
      const pid = String(e?.proyecto_id || '').trim();
      const isOrphan = !pid || !projectIds.has(pid);
      if (!isOrphan) continue;

      batch.update(d.ref, {
        estado: 'borrado',
        orphan_reason: pid ? 'missing_project' : 'missing_project_id',
        orphan_project_id: pid || null,
        orphaned_at: now,
        updated_at: now,
      });
      ops += 1;
      updated += 1;

      if (ops >= 450) {
        await batch.commit();
        batches += 1;
        batch = writeBatch(db);
        ops = 0;
      }
    }

    if (ops > 0) {
      await batch.commit();
      batches += 1;
    }

    setFirestoreOk();
    return { toUpdate, updated, batches };
  } catch (err: any) {
    setFirestoreStatusFromError(err);
    throw err;
  }
};


// --- REBUILD (ANTI "TOTALES FANTASMAS") ---
// Recalcula period_summaries completo desde monthly_expenses del rango.
// Diseñado para ser idempotente: ejecutarlo 1 o N veces deja el mismo estado final.
export const forceRebuildPeriodSummary = async (
  periodId: string,
  startYMD: string,
  endYMD: string
): Promise<{ periodId: string; total: number; totalCount: number }> => {
  // 1) Cargar categorías (para resolver nombre cuando existe categoria_id)
  const catsSnap = await getDocs(collection(db, CATEGORIES_COLLECTION));
  const categoriesById = new Map<string, string>();
  catsSnap.docs.forEach((d) => {
    const data: any = d.data();
    const name = String(data?.nombre ?? data?.name ?? '').trim();
    if (name) categoriesById.set(d.id, name);
  });

  // 2) Cargar movimientos del rango
  const all = await getExpensesInRangeOnce(startYMD, endYMD);
  const expenses = (all || []).filter((e: any) => e?.estado !== 'borrado');

  // 3) Re-armar data summary
  const data: any = {
    periodId,
    startYMD,
    endYMD,
    total: 0,
    totalCount: 0,
    categories: {},
    rebuiltAt: new Date().toISOString(),
    rebuiltSource: 'forceRebuildPeriodSummary',
  };

  for (const e of expenses) {
    const amount = Number(e?.monto ?? 0) || 0;
    const categoryId = String((e as any)?.categoria_id ?? '').trim();
    const categoryName =
      (categoryId && categoriesById.get(categoryId)) ||
      String((e as any)?.categoria ?? 'Sin categoría').trim() ||
      'Sin categoría';

    const rawKey = categoryId || categoryName;
    const catKey = toSafeFirestoreMapKey(rawKey);

    if (!data.categories[catKey]) {
      data.categories[catKey] = { name: categoryName, total: 0, count: 0 };
    }
    data.categories[catKey].total += amount;
    data.categories[catKey].count += 1;

    data.total += amount;
    data.totalCount += 1;
  }

  // Redondeos defensivos (evita drift por floats)
  data.total = Number(data.total.toFixed(2));
  Object.keys(data.categories).forEach((k) => {
    data.categories[k].total = Number(Number(data.categories[k].total).toFixed(2));
  });

  // 4) Persistir (merge para no romper otros campos si existen)
  await setDoc(doc(db, PERIOD_SUMMARIES_COLLECTION, periodId), data, { merge: true });

  // 5) Notificar UI (Home / Reports)
  emitDataEvent('period_summaries_changed');

  return { periodId, total: data.total, totalCount: data.totalCount };
};
