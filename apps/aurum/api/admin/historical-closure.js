import { getAdminDb } from '../_firestoreAdmin.js';
import { requireHistoricalAdmin } from './_historicalAuth.js';
import {
  applyHistoricalCorrection,
  exportHistoricalBackup,
  prepareHistoricalCorrection,
  previewHistoricalCorrection,
  previewHistoricalRollback,
  readHistoricalClosure,
  rollbackHistoricalCorrection,
} from './_historicalClosureService.js';

const setHeaders = (res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
};

const parseBody = (req) => {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body);
  } catch {
    return {};
  }
};

const validMonthKey = (value) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ''));

export default async function handler(req, res) {
  setHeaders(res);
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Método no permitido.' });
  }
  req.body = parseBody(req);
  const identity = await requireHistoricalAdmin(req, res);
  if (!identity) return;
  try {
    const db = getAdminDb();
    const action = String(req.method === 'GET' ? req.query?.action || 'read' : req.body?.action || '');
    const monthKey = String(req.method === 'GET' ? req.query?.monthKey || '' : req.body?.monthKey || '');
    if (action !== 'export' && !validMonthKey(monthKey)) {
      return res.status(400).json({ ok: false, code: 'invalid_month', error: 'monthKey debe tener formato YYYY-MM.' });
    }

    let result;
    if (req.method === 'GET' && action === 'read') {
      result = await readHistoricalClosure({ db, identity, monthKey });
    } else if (req.method === 'GET' && action === 'export') {
      const backupId = String(req.query?.backupId || '');
      if (!backupId) return res.status(400).json({ ok: false, code: 'backup_required', error: 'backupId es obligatorio.' });
      result = await exportHistoricalBackup({ db, identity, backupId });
    } else if (req.method === 'POST' && action === 'preview') {
      result = await previewHistoricalCorrection({
        db,
        identity,
        monthKey,
        expectedFingerprint: String(req.body.expectedFingerprint || ''),
        proposedFxRates: req.body.proposedFxRates,
      });
    } else if (req.method === 'POST' && action === 'prepare') {
      result = await prepareHistoricalCorrection({
        db,
        identity,
        monthKey,
        expectedFingerprint: String(req.body.expectedFingerprint || ''),
        reason: req.body.reason,
      });
    } else if (req.method === 'POST' && action === 'apply') {
      result = await applyHistoricalCorrection({ db, identity, input: req.body });
    } else if (req.method === 'POST' && action === 'rollback-preview') {
      result = await previewHistoricalRollback({
        db,
        identity,
        monthKey,
        checkpointId: String(req.body.checkpointId || ''),
      });
    } else if (req.method === 'POST' && action === 'rollback') {
      result = await rollbackHistoricalCorrection({ db, identity, input: req.body });
    } else {
      return res.status(400).json({ ok: false, code: 'invalid_action', error: 'Acción administrativa no reconocida.' });
    }
    return res.status(200).json({ ok: true, result });
  } catch (error) {
    const status = Number(error?.statusCode || 500);
    return res.status(status).json({
      ok: false,
      code: error?.code || 'historical_service_error',
      error: String(error?.message || 'Error en el servicio de corrección histórica.'),
    });
  }
}
