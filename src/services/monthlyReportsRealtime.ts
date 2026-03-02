
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  limit,
} from 'firebase/firestore';
import { db } from './firebase';
import { setFirestoreOk, setFirestoreStatusFromError } from './firestoreStatus';
import { MonthlyReport } from '../types';

// Realtime listener para monthly_reports (cross-device). Mantiene el mismo filtro que getMonthlyReports.
export const subscribeToMonthlyReports = (
  callback: (reports: MonthlyReport[]) => void,
  maxResults: number = 24,
) => {
  const q = query(
    collection(db, 'monthly_reports'),
    orderBy('numeroPeriodo', 'desc'),
    limit(maxResults),
  );

  return onSnapshot(
    q,
    (snap) => {
      setFirestoreOk();
      const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as MonthlyReport));

      const cleaned = items
        .map((r: any) => {
          if (typeof r.fechaCierre === 'string') r.fechaCierre = r.fechaCierre.trim();
          if (typeof r.fechaInicio === 'string') r.fechaInicio = r.fechaInicio.trim();
          if (typeof r.fechaFin === 'string') r.fechaFin = r.fechaFin.trim();
          return r as MonthlyReport;
        })
        .filter((r: any) => {
          const estado = String(r?.estado || '').toLowerCase();
          if (estado.startsWith('archived')) return false;
          if (r?.estado === 'cerrado_manual_stub') return false;
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

      callback(cleaned);
    },
    (err) => {
      setFirestoreStatusFromError(err);
      callback([]);
    },
  );
};
