import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { MonthlyReport } from '../types';
import { emitDataEvent } from '../state/dataEvents';

const MONTHLY_REPORTS_COLLECTION = 'monthly_reports';

// Tu ancla real (ya la tienes en periodClosing.ts)
const ANCHOR_PERIOD_NUMBER = 16;
const ANCHOR_START_YMD = '2024-08-12'; // P16 empieza el 12-ago (cierre día 11)
const CLOSING_DAY = 11;

// Mapea headers del CSV a nombres “oficiales” en la app
const CAT = {
  Alquiler: 'ALQUILER',
  Amazon: 'AMAZON',
  Extra: 'EXTRA',
  Gym: 'GYM',
  Iker: 'IKER',
  Peluqueria: 'PELUQUERIA',
  Ropa: 'ROPA',
  Supermercado: 'SUPERMERCADO',
  Servicios: 'SERVICIOS',
  Seguro_Salud: 'SEGURO DE SALUD',
  Plataformas: 'PLATAFORMAS',
  Ocio: 'OCIO',
  Comida_Fuera: 'COMIDA FUERA',
  Transporte: 'TRANSPORTE',
} as const;

type LegacyRow = {
  Periodo: number;
  Alquiler: number;
  Amazon: number;
  Extra: number;
  Gym: number;
  Iker: number;
  Peluqueria: number;
  Ropa: number;
  Supermercado: number;
  Servicios: number;
  Seguro_Salud: number;
  Plataformas: number;
  Ocio: number;
  Comida_Fuera: number;
  Transporte: number;
  Total: number;
};

export const LEGACY_P1_P30: LegacyRow[] = [
  { Periodo: 1, Alquiler: 2750, Amazon: 178, Extra: 49, Gym: 75, Iker: 95, Peluqueria: 0, Ropa: 8, Supermercado: 608, Servicios: 175, Seguro_Salud: 100, Plataformas: 30, Ocio: 61, Comida_Fuera: 302, Transporte: 106, Total: 4536 },
  { Periodo: 2, Alquiler: 2750, Amazon: 0, Extra: 1, Gym: 49, Iker: 360, Peluqueria: 24, Ropa: 146, Supermercado: 458, Servicios: 145, Seguro_Salud: 100, Plataformas: 30, Ocio: 164, Comida_Fuera: 430, Transporte: 66, Total: 4724 },
  { Periodo: 3, Alquiler: 2150, Amazon: 90, Extra: 100, Gym: 49, Iker: 18, Peluqueria: 36, Ropa: 222, Supermercado: 458, Servicios: 81, Seguro_Salud: 100, Plataformas: 30, Ocio: 390, Comida_Fuera: 253, Transporte: 154, Total: 4130 },
  { Periodo: 4, Alquiler: 2150, Amazon: 87, Extra: 56, Gym: 111, Iker: 49, Peluqueria: 12, Ropa: 464, Supermercado: 610, Servicios: 40, Seguro_Salud: 100, Plataformas: 30, Ocio: 0, Comida_Fuera: 304, Transporte: 32, Total: 4044 },
  { Periodo: 5, Alquiler: 2150, Amazon: 176, Extra: 128, Gym: 208, Iker: 160, Peluqueria: 12, Ropa: 52, Supermercado: 498, Servicios: 8, Seguro_Salud: 100, Plataformas: 30, Ocio: 55, Comida_Fuera: 289, Transporte: 12, Total: 3878 },
  { Periodo: 6, Alquiler: 2150, Amazon: 52, Extra: 148, Gym: 49, Iker: 42, Peluqueria: 24, Ropa: 95, Supermercado: 431, Servicios: 11, Seguro_Salud: 100, Plataformas: 30, Ocio: 95, Comida_Fuera: 253, Transporte: 24, Total: 3504 },
  { Periodo: 7, Alquiler: 2150, Amazon: 374, Extra: 203, Gym: 159, Iker: 44, Peluqueria: 12, Ropa: 259, Supermercado: 375, Servicios: 8, Seguro_Salud: 100, Plataformas: 30, Ocio: 0, Comida_Fuera: 98, Transporte: 52, Total: 3864 },
  { Periodo: 8, Alquiler: 2150, Amazon: 49, Extra: 49, Gym: 0, Iker: 64, Peluqueria: 12, Ropa: 279, Supermercado: 487, Servicios: 53, Seguro_Salud: 100, Plataformas: 30, Ocio: 286, Comida_Fuera: 282, Transporte: 81, Total: 3922 },
  { Periodo: 9, Alquiler: 2150, Amazon: 149, Extra: 159, Gym: 0, Iker: 226, Peluqueria: 12, Ropa: 117, Supermercado: 319, Servicios: 335, Seguro_Salud: 100, Plataformas: 30, Ocio: 52, Comida_Fuera: 40, Transporte: 26, Total: 3714 },
  { Periodo: 10, Alquiler: 2150, Amazon: 86, Extra: 153, Gym: 159, Iker: 36, Peluqueria: 0, Ropa: 219, Supermercado: 539, Servicios: 136, Seguro_Salud: 100, Plataformas: 30, Ocio: 0, Comida_Fuera: 255, Transporte: 18, Total: 3881 },
  { Periodo: 11, Alquiler: 2150, Amazon: 117, Extra: 96, Gym: 0, Iker: 47, Peluqueria: 14, Ropa: 100, Supermercado: 496, Servicios: 182, Seguro_Salud: 100, Plataformas: 30, Ocio: 0, Comida_Fuera: 169, Transporte: 89, Total: 3590 },
  { Periodo: 12, Alquiler: 2150, Amazon: 32, Extra: 79, Gym: 159, Iker: 117, Peluqueria: 0, Ropa: 0, Supermercado: 493, Servicios: 82, Seguro_Salud: 123, Plataformas: 30, Ocio: 0, Comida_Fuera: 281, Transporte: 27, Total: 3572 },
  { Periodo: 13, Alquiler: 2150, Amazon: 129, Extra: 81, Gym: 0, Iker: 69, Peluqueria: 0, Ropa: 148, Supermercado: 347, Servicios: 248, Seguro_Salud: 123, Plataformas: 30, Ocio: 15, Comida_Fuera: 29, Transporte: 0, Total: 3370 },
  { Periodo: 14, Alquiler: 2150, Amazon: 69, Extra: 11, Gym: 0, Iker: 21, Peluqueria: 0, Ropa: 0, Supermercado: 355, Servicios: 149, Seguro_Salud: 123, Plataformas: 30, Ocio: 125, Comida_Fuera: 418, Transporte: 21, Total: 3471 },
  { Periodo: 15, Alquiler: 2885, Amazon: 105, Extra: 134, Gym: 159, Iker: 58, Peluqueria: 0, Ropa: 360, Supermercado: 737, Servicios: 90, Seguro_Salud: 123, Plataformas: 30, Ocio: 152, Comida_Fuera: 386, Transporte: 37, Total: 5255 },
  { Periodo: 16, Alquiler: 2800, Amazon: 102, Extra: 353, Gym: 0, Iker: 97, Peluqueria: 0, Ropa: 255, Supermercado: 740, Servicios: 46, Seguro_Salud: 123, Plataformas: 35, Ocio: 29, Comida_Fuera: 318, Transporte: 23, Total: 4922 },
  { Periodo: 17, Alquiler: 2800, Amazon: 28, Extra: 356, Gym: 0, Iker: 391, Peluqueria: 14, Ropa: 110, Supermercado: 207, Servicios: 43, Seguro_Salud: 123, Plataformas: 35, Ocio: 27, Comida_Fuera: 112, Transporte: 57, Total: 4302 },
  { Periodo: 18, Alquiler: 2800, Amazon: 54, Extra: 260, Gym: 0, Iker: 18, Peluqueria: 0, Ropa: 60, Supermercado: 958, Servicios: 107, Seguro_Salud: 123, Plataformas: 35, Ocio: 95, Comida_Fuera: 478, Transporte: 187, Total: 5173 },
  { Periodo: 19, Alquiler: 2800, Amazon: 390, Extra: 376, Gym: 0, Iker: 134, Peluqueria: 0, Ropa: 222, Supermercado: 649, Servicios: 89, Seguro_Salud: 123, Plataformas: 35, Ocio: 9, Comida_Fuera: 280, Transporte: 12, Total: 5120 },
  { Periodo: 20, Alquiler: 2800, Amazon: 299, Extra: 463, Gym: 159, Iker: 35, Peluqueria: 23, Ropa: 294, Supermercado: 882, Servicios: 79, Seguro_Salud: 123, Plataformas: 35, Ocio: 0, Comida_Fuera: 263, Transporte: 6, Total: 5460 },
  { Periodo: 21, Alquiler: 2800, Amazon: 71, Extra: 177, Gym: 0, Iker: 25, Peluqueria: 0, Ropa: 183, Supermercado: 338, Servicios: 109, Seguro_Salud: 123, Plataformas: 35, Ocio: 0, Comida_Fuera: 76, Transporte: 6, Total: 3943 },
  { Periodo: 22, Alquiler: 2800, Amazon: 153, Extra: 254, Gym: 0, Iker: 18, Peluqueria: 177, Ropa: 258, Supermercado: 534, Servicios: 99, Seguro_Salud: 123, Plataformas: 35, Ocio: 0, Comida_Fuera: 44, Transporte: 12, Total: 4507 },
  { Periodo: 23, Alquiler: 2800, Amazon: 80, Extra: 83, Gym: 0, Iker: 68, Peluqueria: 29, Ropa: 509, Supermercado: 321, Servicios: 133, Seguro_Salud: 123, Plataformas: 35, Ocio: 368, Comida_Fuera: 74, Transporte: 40, Total: 4664 },
  { Periodo: 24, Alquiler: 2800, Amazon: 24, Extra: 26, Gym: 0, Iker: 114, Peluqueria: 0, Ropa: 0, Supermercado: 315, Servicios: 121, Seguro_Salud: 121, Plataformas: 35, Ocio: 0, Comida_Fuera: 114, Transporte: 12, Total: 3682 },
  { Periodo: 25, Alquiler: 2800, Amazon: 34, Extra: 664, Gym: 159, Iker: 46, Peluqueria: 0, Ropa: 0, Supermercado: 658, Servicios: 76, Seguro_Salud: 121, Plataformas: 35, Ocio: 102, Comida_Fuera: 264, Transporte: 6, Total: 4965 },
  { Periodo: 26, Alquiler: 2800, Amazon: 111, Extra: 326, Gym: 97, Iker: 93, Peluqueria: 20, Ropa: 586, Supermercado: 500, Servicios: 89, Seguro_Salud: 121, Plataformas: 35, Ocio: 60, Comida_Fuera: 262, Transporte: 69, Total: 5169 },
  { Periodo: 27, Alquiler: 2840, Amazon: 34, Extra: 723, Gym: 56, Iker: 20, Peluqueria: 170, Ropa: 314, Supermercado: 408, Servicios: 125, Seguro_Salud: 121, Plataformas: 35, Ocio: 25, Comida_Fuera: 252, Transporte: 0, Total: 5123 },
  { Periodo: 28, Alquiler: 2860, Amazon: 203, Extra: 365, Gym: 56, Iker: 106, Peluqueria: 30, Ropa: 100, Supermercado: 418, Servicios: 127, Seguro_Salud: 121, Plataformas: 35, Ocio: 0, Comida_Fuera: 402, Transporte: 7, Total: 4830 },
  { Periodo: 29, Alquiler: 2860, Amazon: 22, Extra: 666, Gym: 56, Iker: 44, Peluqueria: 20, Ropa: 62, Supermercado: 566, Servicios: 83, Seguro_Salud: 121, Plataformas: 35, Ocio: 0, Comida_Fuera: 296, Transporte: 137, Total: 4968 },
  { Periodo: 30, Alquiler: 2860, Amazon: 68, Extra: 472, Gym: 140, Iker: 104, Peluqueria: 0, Ropa: 151, Supermercado: 476, Servicios: 114, Seguro_Salud: 121, Plataformas: 35, Ocio: 32, Comida_Fuera: 552, Transporte: 71, Total: 5197 },
];

const parseYMDNoon = (ymdStr: string) => {
  const [y, m, d] = ymdStr.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
};

const ymd = (dt: Date) => {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const addMonthsKeepDayNoon = (base: Date, months: number) =>
  new Date(base.getFullYear(), base.getMonth() + months, base.getDate(), 12, 0, 0, 0);

const periodRangeFromNumber = (periodNumber: number) => {
  const anchorStart = parseYMDNoon(ANCHOR_START_YMD); // P16 start
  const offset = periodNumber - ANCHOR_PERIOD_NUMBER;

  const startNoon = addMonthsKeepDayNoon(anchorStart, offset); // siempre día 12
  const endNoon = new Date(startNoon.getFullYear(), startNoon.getMonth() + 1, CLOSING_DAY, 12, 0, 0, 0);

  return { startNoon, endNoon };
};

export const buildLegacyMonthlyReportsP1P30 = (): MonthlyReport[] => {
  return LEGACY_P1_P30.map((r) => {
    const { startNoon, endNoon } = periodRangeFromNumber(r.Periodo);

    const detalles = [
      { categoryName: CAT.Alquiler, presupuesto: 0, gastoReal: r.Alquiler, diferencia: 0 },
      { categoryName: CAT.Amazon, presupuesto: 0, gastoReal: r.Amazon, diferencia: 0 },
      { categoryName: CAT.Extra, presupuesto: 0, gastoReal: r.Extra, diferencia: 0 },
      { categoryName: CAT.Gym, presupuesto: 0, gastoReal: r.Gym, diferencia: 0 },
      { categoryName: CAT.Iker, presupuesto: 0, gastoReal: r.Iker, diferencia: 0 },
      { categoryName: CAT.Peluqueria, presupuesto: 0, gastoReal: r.Peluqueria, diferencia: 0 },
      { categoryName: CAT.Ropa, presupuesto: 0, gastoReal: r.Ropa, diferencia: 0 },
      { categoryName: CAT.Supermercado, presupuesto: 0, gastoReal: r.Supermercado, diferencia: 0 },
      { categoryName: CAT.Servicios, presupuesto: 0, gastoReal: r.Servicios, diferencia: 0 },
      { categoryName: CAT.Seguro_Salud, presupuesto: 0, gastoReal: r.Seguro_Salud, diferencia: 0 },
      { categoryName: CAT.Plataformas, presupuesto: 0, gastoReal: r.Plataformas, diferencia: 0 },
      { categoryName: CAT.Ocio, presupuesto: 0, gastoReal: r.Ocio, diferencia: 0 },
      { categoryName: CAT.Comida_Fuera, presupuesto: 0, gastoReal: r.Comida_Fuera, diferencia: 0 },
      { categoryName: CAT.Transporte, presupuesto: 0, gastoReal: r.Transporte, diferencia: 0 },
    ];

    const docId = `legacy-p${r.Periodo}`; // no pisa tus cierres reales

    return {
      id: docId,
      numeroPeriodo: r.Periodo,
      estado: 'cerrado',
      fechaInicio: startNoon.toISOString(),
      fechaFin: endNoon.toISOString(),
      fechaCierre: endNoon.toISOString(),
      detalles,
      totalGlobalPresupuesto: 0, // tu UI hace fallback
      totalGlobalGasto: r.Total,
      totalGlobalDiferencia: 0,
    };
  });
};

// ✅ Seed a Firestore (una vez). No pisa nada: ids legacy-pX
export const seedLegacyReportsP1P30ToFirestore = async (): Promise<{ saved: number; skipped: number }> => {
  const reports = buildLegacyMonthlyReportsP1P30();
  let saved = 0;
  let skipped = 0;

  for (const r of reports) {
    const ref = doc(db, MONTHLY_REPORTS_COLLECTION, r.id);
    const snap = await getDoc(ref);

    if (snap.exists()) {
      skipped += 1;
      continue;
    }

    await setDoc(ref, {
      ...r,
      source: 'legacy_csv_seed',
      migratedAt: new Date().toISOString(),
      fechaInicioYMD: ymd(new Date(r.fechaInicio!)),
      fechaFinYMD: ymd(new Date(r.fechaFin)),
    });
    saved += 1;
  }

  if (saved > 0) emitDataEvent('monthly_reports_changed');

  return { saved, skipped };
};
