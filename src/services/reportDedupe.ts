// src/services/reportDedupe.ts
// Dedupe / winner-pick utilities for monthly_reports.

import { collection, doc, getDocs, writeBatch, deleteField } from 'firebase/firestore';
import { db } from './firebase';
import { getExpensesInRangeOnce } from './db';
import { emitDataEvent } from '../state/dataEvents';
import { periodNumberFromStartYMD } from '../utils/period';

const MONTHLY_REPORTS_COLLECTION = 'monthly_reports';
const MADRID_TZ = 'Europe/Madrid';

type AnyReport = Record<string, any> & { id?: string };

export type DedupeResult<T extends AnyReport = AnyReport> = {
  deduped: T[];
  groups: Map<string, T[]>; // periodKey => all candidates (normalized)
  winners: Map<string, T>;
};

const extractYMDFromISO = (iso: string | undefined | null): string => {
  if (!iso) return '';
  const m = String(iso).match(/\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : '';
};

const getNowPartsInTZ = (d: Date, timeZone: string) => {
  const dtf = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '00';
  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));
  const second = Number(get('second'));
  const ymd = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { ymd, seconds: hour * 3600 + minute * 60 + second };
};

const ymdToKey = (s: string) => Number(String(s || '').replaceAll('-', ''));

// Period numbering: single source of truth (src/utils/period.ts)
export const computePeriodNumberFromStartYMD = (startYMD: string) => {
  const n = periodNumberFromStartYMD(startYMD);
  return Number.isFinite(n) ? n : 0;
};

export const getReportPeriodKey = (r: AnyReport) => {
  const startYMD = String(r?.fechaInicioYMD || extractYMDFromISO(r?.fechaInicio) || '').trim();
  const endYMD = String(r?.fechaFinYMD || extractYMDFromISO(r?.fechaFin) || '').trim();
  if (!startYMD || !endYMD) return null;
  const periodKey = `${startYMD}__${endYMD}`;
  return { startYMD, endYMD, periodKey };
};

const isArchived = (r: AnyReport) => {
  const estado = String(r?.estado || '').toLowerCase();
  return estado.startsWith('archived');
};

const isClosedLike = (r: AnyReport) => {
  const estado = String(r?.estado || '').toLowerCase();
  // Backward compatible: old docs had no estado.
  if (!estado) return true;
  return estado.startsWith('cerrado');
};

const isEndedInMadrid = (endYMD: string, now: Date) => {
  const madrid = getNowPartsInTZ(now, MADRID_TZ);
  const endKey = ymdToKey(endYMD);
  const nowKey = ymdToKey(madrid.ymd);
  // End-of-day threshold in Madrid
  const eod = 23 * 3600 + 59 * 60 + 59;
  return endKey < nowKey || (endKey === nowKey && madrid.seconds >= eod);
};

const scoreReport = (r: AnyReport) => {
  // Prefer stable IDs and richer content.
  const id = String(r?.id || '');
  const gasto = Math.abs(Number(r?.totalGlobalGasto || 0));
  const presu = Math.abs(Number(r?.totalGlobalPresupuesto || 0));
  const tx = Number(r?.transactionsCount || 0);

  let score = 0;
  if (id.startsWith('R_')) score += 1000000;
  if (gasto > 0.000001) score += 100000;
  if (tx > 0) score += 50000;
  if (presu > 0.000001) score += 10000;
  if (id.startsWith('legacy-')) score += 2000;

  const t =
    r?.updatedAt
      ? new Date(r.updatedAt).getTime()
      : r?.fechaCierre
        ? new Date(r.fechaCierre).getTime()
        : r?.fechaFin
          ? new Date(r.fechaFin).getTime()
          : 0;
  score += Math.floor((t || 0) / 10000000);
  return score;
};

const timeTie = (r: AnyReport) => {
  const t =
    r?.updatedAt
      ? new Date(r.updatedAt).getTime()
      : r?.fechaCierre
        ? new Date(r.fechaCierre).getTime()
        : r?.fechaFin
          ? new Date(r.fechaFin).getTime()
          : 0;
  return t || 0;
};

export const dedupeMonthlyReportsByPeriodKey = <T extends AnyReport>(
  items: T[],
  opts?: { now?: Date; includeFuture?: boolean },
): DedupeResult<T> => {
  const now = opts?.now || new Date();
  const includeFuture = !!opts?.includeFuture;

  const groups = new Map<string, T[]>();

  (items || []).forEach((raw) => {
    if (!raw) return;
    if (isArchived(raw)) return;
    if (!isClosedLike(raw)) return;

    const info = getReportPeriodKey(raw);
    if (!info) return;

    // Ignore future / not-yet-ended periods unless explicitly included.
    if (!includeFuture && !isEndedInMadrid(info.endYMD, now)) return;

    const normalized: T = {
      ...(raw as any),
      numeroPeriodo: computePeriodNumberFromStartYMD(info.startYMD),
      fechaInicioYMD: info.startYMD,
      fechaFinYMD: info.endYMD,
      periodKey: info.periodKey,
    };

    if (!groups.has(info.periodKey)) groups.set(info.periodKey, []);
    groups.get(info.periodKey)!.push(normalized);
  });

  const winners = new Map<string, T>();
  const deduped: T[] = [];

  for (const [key, arr] of groups.entries()) {
    const best = [...arr].sort((a, b) => {
      const sa = scoreReport(a);
      const sb = scoreReport(b);
      if (sb !== sa) return sb - sa;
      const ta = timeTie(a);
      const tb = timeTie(b);
      if (tb !== ta) return tb - ta;
      const ida = String(a?.id || '');
      const idb = String(b?.id || '');
      return idb.localeCompare(ida, 'en');
    })[0];
    winners.set(key, best);
    deduped.push(best);
  }

  return { deduped, groups, winners };
};

export const pickLastClosedReport = <T extends AnyReport>(items: T[], opts?: { now?: Date }) => {
  const { deduped } = dedupeMonthlyReportsByPeriodKey(items, { now: opts?.now });
  const sorted = [...deduped].sort((a, b) => (Number(b?.numeroPeriodo || 0) - Number(a?.numeroPeriodo || 0)));
  return sorted[0] || null;
};

export const archiveDuplicateMonthlyReports = async (args?: { dryRun?: boolean }) => {
  const dryRun = !!args?.dryRun;
  const now = new Date();
  const snap = await getDocs(collection(db, MONTHLY_REPORTS_COLLECTION));
  const items: AnyReport[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

  const updates: Array<{ id: string; patch: Record<string, any> }> = [];

  let dupCount = 0;
  let futureCount = 0;
  let unarchivedWinners = 0;
  let skippedArchived = 0;

  for (const r of items) {
    if (isArchived(r)) skippedArchived++;
  }

  // Cache: total real del periodo (desde Movimientos). Si esto está disponible, es la verdad.
  const truthCache = new Map<string, number | null>();
  const getTruthTotal = async (periodKey: string): Promise<number | null> => {
    if (truthCache.has(periodKey)) return truthCache.get(periodKey) ?? null;
    const [startYMD, endYMD] = String(periodKey || '').split('__');
    if (!startYMD || !endYMD) {
      truthCache.set(periodKey, null);
      return null;
    }
    try {
      const exps = await getExpensesInRangeOnce(startYMD, endYMD);
      const sum = (exps || [])
        .filter((e: any) => e?.estado !== 'borrado')
        .reduce((acc: number, e: any) => acc + Number(e?.monto || 0), 0);
      const truth = Math.abs(sum);
      truthCache.set(periodKey, truth);
      return truth;
    } catch {
      truthCache.set(periodKey, null);
      return null;
    }
  };

  const pickWinnerSmart = async (arr: AnyReport[], periodKey: string) => {
    const truth = await getTruthTotal(periodKey);
    const sorted = [...arr].sort((a, b) => {
      if (truth != null) {
        const ga = Math.abs(Number((a as any)?.totalGlobalGasto || 0));
        const gb = Math.abs(Number((b as any)?.totalGlobalGasto || 0));
        const da = Math.abs(ga - truth);
        const dbb = Math.abs(gb - truth);
        if (da !== dbb) return da - dbb; // menor distancia = más probable que sea el cierre correcto
      }

      const sa = scoreReport(a as any);
      const sb = scoreReport(b as any);
      if (sb !== sa) return sb - sa;

      // Si todo empata, prefiero el que no esté archivado.
      const aa = isArchived(a) ? 1 : 0;
      const ab = isArchived(b) ? 1 : 0;
      if (aa !== ab) return aa - ab;

      const ta = timeTie(a);
      const tb = timeTie(b);
      if (tb !== ta) return tb - ta;

      const ida = String(a?.id || '');
      const idb = String(b?.id || '');
      return idb.localeCompare(ida, 'en');
    });
    return { winner: sorted[0] || null, truth };
  };

  // Agrupar TODOS los cierres (incluyendo archivados) por periodKey.
  const allGroups = new Map<string, AnyReport[]>();
  for (const raw of items) {
    if (!raw?.id) continue;
    if (!isClosedLike(raw) && !isArchived(raw)) continue;
    const info = getReportPeriodKey(raw);
    if (!info) continue;
    const normalized: AnyReport = {
      ...(raw as any),
      numeroPeriodo: computePeriodNumberFromStartYMD(info.startYMD),
      fechaInicioYMD: info.startYMD,
      fechaFinYMD: info.endYMD,
      periodKey: info.periodKey,
    };
    if (!allGroups.has(info.periodKey)) allGroups.set(info.periodKey, []);
    allGroups.get(info.periodKey)!.push(normalized);
  }

  // 1) Archive future (not yet ended) closures.
  for (const [key, arr] of allGroups.entries()) {
    const sample = arr[0];
    const info = getReportPeriodKey(sample);
    if (!info) continue;
    if (isEndedInMadrid(info.endYMD, now)) continue;

    // Cualquier cierre "cerrado" para un periodo aún no terminado es bug: lo archivamos.
    for (const r of arr) {
      if (!r?.id) continue;
      if (!isClosedLike(r)) continue;
      if (String((r as any)?.estado || '') === 'archived_future') continue;
      futureCount++;
      updates.push({
        id: r.id,
        patch: {
          estado: 'archived_future',
          archivedAt: now.toISOString(),
          archivedReason: 'period_not_ended_yet',
          winnerId: '__future__',
          periodKey: key,
        },
      });
    }
  }

  // 2) Para periodos ya terminados: elegir el cierre correcto por "verdad" (Movimientos) y archivar el resto.
  for (const [key, arr] of allGroups.entries()) {
    if (arr.length === 0) continue;
    const sample = arr[0];
    const info = getReportPeriodKey(sample);
    if (!info) continue;
    if (!isEndedInMadrid(info.endYMD, now)) continue; // futuros ya tratados

    const hasAnomaly = arr.length > 1 || arr.some((r) => isArchived(r) || (r as any)?.archivedAt || (r as any)?.archivedReason);
    if (!hasAnomaly) continue;

    const { winner, truth } = await pickWinnerSmart(arr, key);
    if (!winner?.id) continue;

    // Asegurar que el winner quede "vivo" (no archivado) y con estado cerrado.
    const winnerEstado = String((winner as any)?.estado || '').toLowerCase();
    const winnerLooksArchived = winnerEstado.startsWith('archived') || isArchived(winner) || (winner as any)?.archivedAt || (winner as any)?.archivedReason;
    if (winnerLooksArchived || !winnerEstado.startsWith('cerrado')) {
      unarchivedWinners++;
      updates.push({
        id: winner.id,
        patch: {
          estado: 'cerrado',
          archivedAt: deleteField(),
          archivedReason: deleteField(),
          winnerId: deleteField(),
          periodKey: key,
        },
      });
    }

    const losers = arr.filter((x) => String(x?.id) !== String(winner.id));
    for (const loser of losers) {
      if (!loser?.id) continue;
      const loserEstado = String((loser as any)?.estado || '').toLowerCase();
      const alreadyArchivedWithSameWinner = loserEstado === 'archived_duplicate' && String((loser as any)?.winnerId || '') === String(winner.id);
      if (alreadyArchivedWithSameWinner) continue;

      dupCount++;
      updates.push({
        id: loser.id,
        patch: {
          estado: 'archived_duplicate',
          archivedAt: now.toISOString(),
          archivedReason:
            truth != null
              ? `duplicate_period_key_keep_closest_to_movimientos(${truth.toFixed(2)})`
              : 'duplicate_period_key',
          winnerId: winner.id,
          periodKey: key,
        },
      });
    }
  }

  // Apply changes.
  if (!dryRun && updates.length > 0) {
    // chunk batch to avoid Firestore 500-write limit
    const chunks: typeof updates[] = [];
    for (let i = 0; i < updates.length; i += 450) chunks.push(updates.slice(i, i + 450));

    for (const chunk of chunks) {
      const b = writeBatch(db);
      chunk.forEach((u) => {
        b.set(doc(db, MONTHLY_REPORTS_COLLECTION, u.id), u.patch, { merge: true });
      });
      await b.commit();
    }
    emitDataEvent('monthly_reports_changed');
  }

  return {
    totalReports: items.length,
    skippedArchived,
    archivedFuture: futureCount,
    archivedDuplicates: dupCount,
    unarchivedWinners,
    updatesPlanned: updates.length,
    dryRun,
  };
};


// Targeted resolver: archive duplicates ONLY for a given periodKey (startYMD__endYMD).
// Used by Reports (Sprint 2A) to fix a broken Pxx without going to Settings.
export const archiveMonthlyReportsForPeriodKey = async (periodKey: string, args?: { dryRun?: boolean }) => {
  const dryRun = !!args?.dryRun;
  const now = new Date();

  const key = String(periodKey || '').trim();
  const [startYMD, endYMD] = key.split('__');
  if (!startYMD || !endYMD) {
    throw new Error('Invalid periodKey. Expected: YYYY-MM-DD__YYYY-MM-DD');
  }

  const snap = await getDocs(collection(db, MONTHLY_REPORTS_COLLECTION));
  const items: AnyReport[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

  const candidates: AnyReport[] = [];
  for (const raw of items) {
    if (!raw?.id) continue;
    const info = getReportPeriodKey(raw);
    if (!info) continue;
    if (info.periodKey !== key) continue;
    if (!isClosedLike(raw) && !isArchived(raw)) continue;

    candidates.push({
      ...(raw as any),
      numeroPeriodo: computePeriodNumberFromStartYMD(info.startYMD),
      fechaInicioYMD: info.startYMD,
      fechaFinYMD: info.endYMD,
      periodKey: info.periodKey,
    });
  }

  const updates: Array<{ id: string; patch: Record<string, any> }> = [];

  let dupCount = 0;
  let futureCount = 0;
  let unarchivedWinners = 0;

  const ended = isEndedInMadrid(endYMD, now);

  // Cache truth from Movimientos.
  let truth: number | null = null;
  const getTruthTotal = async () => {
    if (truth != null) return truth;
    try {
      const exps = await getExpensesInRangeOnce(startYMD, endYMD);
      const sum = (exps || [])
        .filter((e: any) => e?.estado !== 'borrado')
        .reduce((acc: number, e: any) => acc + Number(e?.monto || 0), 0);
      truth = Math.abs(sum);
      return truth;
    } catch {
      truth = null;
      return null;
    }
  };

  const pickWinnerSmart = async (arr: AnyReport[]) => {
    const t = ended ? await getTruthTotal() : null;
    const sorted = [...arr].sort((a, b) => {
      if (t != null) {
        const ga = Math.abs(Number((a as any)?.totalGlobalGasto || 0));
        const gb = Math.abs(Number((b as any)?.totalGlobalGasto || 0));
        const da = Math.abs(ga - t);
        const dbb = Math.abs(gb - t);
        if (da != dbb) return da - dbb;
      }

      const sa = scoreReport(a as any);
      const sb = scoreReport(b as any);
      if (sb != sa) return sb - sa;

      const aa = isArchived(a) ? 1 : 0;
      const ab = isArchived(b) ? 1 : 0;
      if (aa != ab) return aa - ab;

      const ta = timeTie(a);
      const tb = timeTie(b);
      if (tb != ta) return tb - ta;

      const ida = String(a?.id || '');
      const idb = String(b?.id || '');
      return idb.localeCompare(ida, 'en');
    });
    return { winner: sorted[0] || null, truth: t };
  };

  if (candidates.length <= 1) {
    return {
      periodKey: key,
      totalCandidates: candidates.length,
      archivedDuplicates: 0,
      archivedFuture: 0,
      unarchivedWinners: 0,
      truthTotal: ended ? await getTruthTotal() : null,
      updatesPlanned: 0,
      dryRun,
    };
  }

  if (!ended) {
    // Period not ended: any "cerrado" report here is bug => archive as future.
    for (const r of candidates) {
      if (!r?.id) continue;
      if (!isClosedLike(r)) continue;
      if (String((r as any)?.estado || '') === 'archived_future') continue;
      futureCount++;
      updates.push({
        id: r.id,
        patch: {
          estado: 'archived_future',
          archivedAt: now.toISOString(),
          archivedReason: 'period_not_ended_yet',
          winnerId: '__future__',
          periodKey: key,
        },
      });
    }
  } else {
    const { winner, truth: t } = await pickWinnerSmart(candidates);
    if (winner?.id) {
      const winnerEstado = String((winner as any)?.estado || '').toLowerCase();
      const winnerLooksArchived = winnerEstado.startsWith('archived') || isArchived(winner) || (winner as any)?.archivedAt || (winner as any)?.archivedReason;
      if (winnerLooksArchived || !winnerEstado.startsWith('cerrado')) {
        unarchivedWinners++;
        updates.push({
          id: winner.id,
          patch: {
            estado: 'cerrado',
            archivedAt: deleteField(),
            archivedReason: deleteField(),
            winnerId: deleteField(),
            periodKey: key,
          },
        });
      }

      const losers = candidates.filter((x) => String(x?.id) != String(winner.id));
      for (const loser of losers) {
        if (!loser?.id) continue;
        const loserEstado = String((loser as any)?.estado || '').toLowerCase();
        const alreadyArchivedWithSameWinner = loserEstado == 'archived_duplicate' && String((loser as any)?.winnerId || '') == String(winner.id);
        if (alreadyArchivedWithSameWinner) continue;

        dupCount++;
        updates.push({
          id: loser.id,
          patch: {
            estado: 'archived_duplicate',
            archivedAt: now.toISOString(),
            archivedReason:
              t != null
                ? `duplicate_period_key_keep_closest_to_movimientos(${Number(t).toFixed(2)})`
                : 'duplicate_period_key',
            winnerId: winner.id,
            periodKey: key,
          },
        });
      }
    }
  }

  if (!dryRun && updates.length > 0) {
    const chunks: typeof updates[] = [];
    for (let i = 0; i < updates.length; i += 450) chunks.push(updates.slice(i, i + 450));

    for (const chunk of chunks) {
      const b = writeBatch(db);
      chunk.forEach((u) => {
        b.set(doc(db, MONTHLY_REPORTS_COLLECTION, u.id), u.patch, { merge: true });
      });
      await b.commit();
    }
    emitDataEvent('monthly_reports_changed');
  }

  return {
    periodKey: key,
    totalCandidates: candidates.length,
    archivedDuplicates: dupCount,
    archivedFuture: futureCount,
    unarchivedWinners,
    truthTotal: ended ? truth : null,
    updatesPlanned: updates.length,
    dryRun,
  };
};
