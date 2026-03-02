import { collection, doc, getDoc, getDocs, orderBy, query, setDoc, where } from 'firebase/firestore';
import { db } from './firebase';
import { emitDataEvent } from '../state/dataEvents';
import { PERIOD_ANCHOR_START_NOON, endNoonFromStartNoon, nextStartNoonAfterEndNoon, periodNumberFromStartNoon, toYMD } from '../utils/period';

const MONTHLY_REPORTS_COLLECTION = 'monthly_reports';
const MONTHLY_EXPENSES_COLLECTION = 'monthly_expenses';
const CATEGORIES_COLLECTION = 'categories';
const META_COLLECTION = 'meta';
const CLOSING_CONFIG_DOC_ID = 'closing_config';


const MADRID_TZ = 'Europe/Madrid';

const getNowPartsInTZ = (timeZone: string) => {
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
  const parts = dtf.formatToParts(new Date());
  const get = (type: string) => parts.find(p => p.type === type)?.value || '00';
  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));
  const second = Number(get('second'));
  const ymdStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return {
    ymd: ymdStr,
    seconds: hour * 3600 + minute * 60 + second,
  };
};

const ymdToKey = (s: string) => Number(s.replaceAll('-', ''));





const loadExpensesInDateRange = async (startYMD: string, endYMD: string) => {
  const q = query(
    collection(db, MONTHLY_EXPENSES_COLLECTION),
    where('fecha', '>=', startYMD),
    where('fecha', '<=', endYMD + '\uf8ff'),
    orderBy('fecha', 'asc')
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() as any }));
};

export const rebuildReportForPeriod = async (args: { numeroPeriodo: number; startNoon: Date; endNoon: Date; }) => {
  // Rebuild explícito (mantenimiento): permite sobre-escritura controlada.
  return buildAndSaveReport({ ...args, force: true });
};

let ensureInFlight: Promise<any> | null = null;

export const buildAndSaveReport = async (args: { numeroPeriodo: number; startNoon: Date; endNoon: Date; force?: boolean; }) => {
  const { startNoon, endNoon } = args;
  const numeroPeriodo = periodNumberFromStartNoon(startNoon);

  const startYMD = toYMD(startNoon);
  const endYMD = toYMD(endNoon);

  // ID estable por rango (evita duplicados si un bug generó numeroPeriodo incorrecto)
  const reportId = `R_${startYMD}__${endYMD}`;
  const periodKey = `${startYMD}__${endYMD}`;

  // Idempotencia: si ya existe un cierre para ese rango, NO lo re-escribimos.
  // (salvo rebuild explícito)
  const reportRef = doc(db, MONTHLY_REPORTS_COLLECTION, reportId);
  if (!args.force) {
    const existing = await getDoc(reportRef);
    if (existing.exists()) return reportId;
  }

  const [expenses, categoriesSnap] = await Promise.all([
    loadExpensesInDateRange(startYMD, endYMD),
    getDocs(collection(db, CATEGORIES_COLLECTION))
  ]);

  const categories = categoriesSnap.docs.map(d => ({ id: d.id, ...d.data() as any }));
  const spendByCat: Record<string, number> = {};
  expenses.forEach(e => {
    const name = e.categoria || 'SIN CATEGORÍA';
    spendByCat[name] = (spendByCat[name] || 0) + (e.monto || 0);
  });

  const detalles = categories.map(c => ({
    categoryId: c.id,
    categoryName: c.nombre,
    presupuesto: c.presupuestoMensual || 0,
    gastoReal: spendByCat[c.nombre] || 0,
    diferencia: (c.presupuestoMensual || 0) - (spendByCat[c.nombre] || 0)
  }));

  const endOfDay = new Date(endNoon.getFullYear(), endNoon.getMonth(), endNoon.getDate(), 23, 59, 59, 999);
  await setDoc(reportRef, {
    numeroPeriodo,
    estado: 'cerrado',
    fechaInicio: new Date(startNoon).toISOString(),
    // Nota: guardamos fin/cierre al final del día (23:59:59) para coherencia con la regla de cierre.
    fechaFin: endOfDay.toISOString(),
    fechaCierre: endOfDay.toISOString(),
    fechaInicioYMD: startYMD,
    fechaFinYMD: endYMD,
    periodKey,
    totalGlobalGasto: detalles.reduce((acc, d) => acc + d.gastoReal, 0),
    totalGlobalPresupuesto: detalles.reduce((acc, d) => acc + d.presupuesto, 0),
    detalles,
    // FIX: Snapshot de presupuestos para que el rebuild sea inmutable
    snapshot_categories_config: categories.map(c => ({ id: c.id, nombre: c.nombre, ppto: c.presupuestoMensual })),
    updatedAt: new Date().toISOString()
  }, { merge: false });
  emitDataEvent('monthly_reports_changed');

  return reportId;
};

export const ensureAutoCloseMissingPeriods = async () => {
  // Single-flight: Home, Settings y CloseSync pueden llamar esto en paralelo.
  // Evita trabajo duplicado y cualquier sensación de "se ejecutó dos veces".
  if (ensureInFlight) return ensureInFlight;

  ensureInFlight = (async () => {
  const snap = await getDoc(doc(db, META_COLLECTION, CLOSING_CONFIG_DOC_ID));
  const closingDay = snap.exists() ? snap.data().diaFijo : 11;
  
  const reportsSnap = await getDocs(collection(db, MONTHLY_REPORTS_COLLECTION));
  const existingKeys = new Set<string>();
  reportsSnap.docs.forEach((d) => {
    const data: any = d.data();
    const s = String(data?.fechaInicioYMD || '').trim() || (typeof data?.fechaInicio === 'string' ? toYMD(new Date(data.fechaInicio)) : '');
    const e = String(data?.fechaFinYMD || '').trim() || (typeof data?.fechaFin === 'string' ? toYMD(new Date(data.fechaFin)) : '');
    if (s && e) existingKeys.add(`${s}__${e}`);
  });

  // Regla: el cierre ocurre por hora de Madrid a las 23:59:59 del día de cierre.
  // Como la PWA no corre en background, esto se ejecuta al abrir la app (o estando abierta).
  const madridNow = getNowPartsInTZ(MADRID_TZ);
  const nowKey = ymdToKey(madridNow.ymd);
  const endOfDaySeconds = 23 * 3600 + 59 * 60 + 59;

  const results = { reports: [] as string[], closedIds: [] as string[], diaCierre: closingDay };

  // Cálculo de periodos desde el ancla, secuencial, evitando solaparse (start = end + 1 día)
  let tempStart = new Date(PERIOD_ANCHOR_START_NOON);
  tempStart.setHours(12, 0, 0, 0);

  // Hard stop para evitar loops infinitos si hay datos corruptos
  for (let guard = 0; guard < 240; guard++) {
    const tempEndNoon = endNoonFromStartNoon(tempStart, closingDay);
    const endYMD = toYMD(tempEndNoon);
    const endKey = ymdToKey(endYMD);

    const endedInMadrid =
      endKey < nowKey || (endKey === nowKey && madridNow.seconds >= endOfDaySeconds);

    if (!endedInMadrid) break;

    const periodKey = `${toYMD(tempStart)}__${toYMD(tempEndNoon)}`;

    if (!existingKeys.has(periodKey)) {
      const id = await buildAndSaveReport({
        numeroPeriodo: periodNumberFromStartNoon(tempStart),
        startNoon: new Date(tempStart),
        endNoon: new Date(tempEndNoon),
      });
      results.closedIds.push(id);
      existingKeys.add(periodKey);
    }

    tempStart = nextStartNoonAfterEndNoon(tempEndNoon);
  }

  return results;
  })().finally(() => {
    ensureInFlight = null;
  });

  return ensureInFlight;
};