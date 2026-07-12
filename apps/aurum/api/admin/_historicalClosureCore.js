import { createHash, randomUUID } from 'node:crypto';

export const HISTORICAL_ADMIN_EMAIL = 'diegorp.1978@gmail.com';
export const HISTORICAL_BACKUP_SCHEMA_VERSION = 1;
const BACKUP_CHUNK_SIZE = 450_000;
const VALID_CURRENCIES = ['CLP', 'USD', 'EUR', 'UF'];
const MONTH_NAMES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

const normalizeText = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase();

const isPlainObject = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

export const encodeFirestoreValue = (value) => {
  if (value === undefined) return { __type: 'undefined' };
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return { __type: 'number', value: 'NaN' };
    if (value === Infinity) return { __type: 'number', value: 'Infinity' };
    if (value === -Infinity) return { __type: 'number', value: '-Infinity' };
    if (Object.is(value, -0)) return { __type: 'number', value: '-0' };
    return value;
  }
  if (typeof value === 'bigint') return { __type: 'bigint', value: value.toString() };
  if (value instanceof Date) return { __type: 'date', iso: value.toISOString() };
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { __type: 'bytes', base64: Buffer.from(value).toString('base64') };
  }
  if (Array.isArray(value)) return value.map(encodeFirestoreValue);
  if (typeof value?.seconds === 'number' && typeof value?.nanoseconds === 'number') {
    return { __type: 'timestamp', seconds: value.seconds, nanoseconds: value.nanoseconds };
  }
  if (typeof value?._seconds === 'number' && typeof value?._nanoseconds === 'number') {
    return { __type: 'timestamp', seconds: value._seconds, nanoseconds: value._nanoseconds };
  }
  if (typeof value?.path === 'string' && value?.firestore) {
    return { __type: 'document-reference', path: value.path };
  }
  if (typeof value?.latitude === 'number' && typeof value?.longitude === 'number') {
    return { __type: 'geo-point', latitude: value.latitude, longitude: value.longitude };
  }
  const entries = Object.entries(value || {}).sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(entries.map(([key, item]) => [key, encodeFirestoreValue(item)]));
};

export const decodeFirestoreValue = (value, factories = {}) => {
  if (Array.isArray(value)) return value.map((item) => decodeFirestoreValue(item, factories));
  if (!isPlainObject(value)) return value;
  if (value.__type === 'undefined') return undefined;
  if (value.__type === 'date') return new Date(value.iso);
  if (value.__type === 'bigint') return BigInt(value.value);
  if (value.__type === 'bytes') {
    const bytes = Buffer.from(value.base64, 'base64');
    return factories.bytes ? factories.bytes(bytes) : bytes;
  }
  if (value.__type === 'number') {
    if (value.value === 'NaN') return Number.NaN;
    if (value.value === 'Infinity') return Infinity;
    if (value.value === '-Infinity') return -Infinity;
    if (value.value === '-0') return -0;
  }
  if (value.__type === 'timestamp') {
    return factories.timestamp
      ? factories.timestamp(value.seconds, value.nanoseconds)
      : { seconds: value.seconds, nanoseconds: value.nanoseconds };
  }
  if (value.__type === 'document-reference') {
    return factories.documentReference ? factories.documentReference(value.path) : { path: value.path };
  }
  if (value.__type === 'geo-point') {
    return factories.geoPoint
      ? factories.geoPoint(value.latitude, value.longitude)
      : { latitude: value.latitude, longitude: value.longitude };
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, decodeFirestoreValue(item, factories)]),
  );
};

export const stableSerialize = (value) => JSON.stringify(encodeFirestoreValue(value));
export const fingerprintValue = (value) => createHash('sha256').update(stableSerialize(value)).digest('hex');

export const assertAuthorizedIdentity = (identity, requestedUid) => {
  const uid = String(identity?.uid || '').trim();
  const email = String(identity?.email || '').trim().toLowerCase();
  if (!uid) throw Object.assign(new Error('Usuario Firebase no autenticado.'), { statusCode: 401, code: 'unauthenticated' });
  if (email !== HISTORICAL_ADMIN_EMAIL || identity?.emailVerified === false) {
    throw Object.assign(new Error('Cuenta no autorizada para correcciones históricas.'), { statusCode: 403, code: 'forbidden' });
  }
  if (requestedUid && String(requestedUid) !== uid) {
    throw Object.assign(new Error('El UID solicitado no corresponde a la sesión autenticada.'), { statusCode: 403, code: 'uid_mismatch' });
  }
  return { uid, email };
};

export const economicDateForMonth = (monthKey) => {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthKey || ''));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${match[1]}-${match[2]}-${String(day).padStart(2, '0')}`;
};

export const historicalConfirmationText = (monthKey, action = 'apply') => {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthKey || ''));
  if (!match) return '';
  const label = `${MONTH_NAMES[Number(match[2]) - 1]} de ${match[1]}`;
  return action === 'rollback'
    ? `Confirmo que deseo restaurar el cierre histórico de ${label} desde checkpoint.`
    : `Confirmo que deseo corregir las tasas y recalcular el cierre histórico de ${label}.`;
};

const validFx = (fx) => Boolean(
  fx &&
  Number.isFinite(Number(fx.usdClp)) && Number(fx.usdClp) > 0 &&
  Number.isFinite(Number(fx.eurClp)) && Number(fx.eurClp) > 0 &&
  Number.isFinite(Number(fx.ufClp)) && Number(fx.ufClp) > 0
);

export const normalizeFxRates = (fx) => {
  if (!validFx(fx)) throw Object.assign(new Error('USD/CLP, EUR/CLP y UF/CLP deben ser positivos y finitos.'), { statusCode: 400, code: 'invalid_fx' });
  return { usdClp: Number(fx.usdClp), eurClp: Number(fx.eurClp), ufClp: Number(fx.ufClp) };
};

const isRiskCapital = (record) => {
  const label = normalizeText(record?.label);
  return record?.block === 'investment' && (label === 'capital de riesgo clp' || label === 'capital de riesgo usd');
};
const isMortgagePrincipal = (record) => {
  const label = normalizeText(record?.label);
  return label.includes('saldo deuda hipotecaria') || label.includes('deuda hipotecaria') || label.includes('saldo hipoteca');
};
const isMortgageMeta = (record) => {
  const label = normalizeText(record?.label);
  return !isMortgagePrincipal(record) && (
    label.includes('dividendo hipotec') || label.includes('amortizacion hipotec') ||
    label.includes('interes hipotec') || label.includes('seguro hipotec') || label.includes('seguros hipotec')
  );
};
const BANK_AGGREGATES = new Set(['saldo bancos clp', 'saldo bancos usd', 'bancos clp historico', 'bancos usd historico']);
const DEBT_AGGREGATES = new Set(['deuda tarjetas clp', 'deuda tarjetas usd', 'tarjetas clp historico', 'tarjetas usd historico']);
const PROVIDER_BANKS = new Set([
  'banco de chile clp', 'banco de chile usd', 'scotiabank clp', 'scotiabank usd',
  'santander clp', 'santander usd',
]);
const MANUAL_CARDS = new Set([
  'visa banco de chile', 'visa scotia', 'mastercard scotia', 'mastercard falabella',
  'mastercard santander', 'american express santander',
]);
const isManualAdjustment = (record) => {
  const marker = `${normalizeText(record?.source)} ${normalizeText(record?.label)} ${normalizeText(record?.note)}`;
  return marker.includes('manual_closure_detail_adjustment') || marker.includes('edicion cierre') || marker.includes('ajuste bancos');
};
const isNonMortgageDebt = (record) => {
  if (isMortgagePrincipal(record) || isMortgageMeta(record)) return false;
  const label = normalizeText(record?.label);
  return record?.block === 'debt' || (record?.block === 'bank' && (DEBT_AGGREGATES.has(label) || MANUAL_CARDS.has(label)));
};
const isSynthetic = (record) => {
  const label = normalizeText(record?.label);
  if (label === 'checkpoint inicio mes') return true;
  return record?.block === 'bank' && BANK_AGGREGATES.has(label) && normalizeText(record?.note).includes('calculado desde detalle de cuentas');
};
const normalizedAmount = (record) => {
  const value = Number(record?.amount);
  if (!Number.isFinite(value)) return Number.NaN;
  if ((record.currency === 'USD' || record.currency === 'EUR') && Number.isInteger(value) && Math.abs(value) >= 100000) {
    if (record.block === 'bank' || record.block === 'debt') return value / 100;
  }
  return value;
};
const recordKey = (record) => [record.block, normalizeText(record.source), normalizeText(record.label), record.currency].join('::');
const recordTimestamp = (record) => String(record.updatedAt || record.refreshedAt || record.createdAt || record.snapshotDate || '');

const dedupeRecords = (records) => {
  const byKey = new Map();
  records.forEach((record) => {
    const key = recordKey(record);
    const existing = byKey.get(key);
    if (!existing || recordTimestamp(record) >= recordTimestamp(existing)) byKey.set(key, record);
  });
  return [...byKey.values()];
};

export const selectHistoricalCanonicalRecords = (records, includeRiskCapital = true) => {
  const latest = dedupeRecords(records).filter((record) => !isSynthetic(record));
  const riskFiltered = includeRiskCapital ? latest : latest.filter((record) => !isRiskCapital(record));
  const bankCandidates = riskFiltered.filter((record) => record.block === 'bank' && !isNonMortgageDebt(record));
  const debtCandidates = riskFiltered.filter((record) => isNonMortgageDebt(record));
  const providerByCurrency = new Set(bankCandidates.filter((record) => PROVIDER_BANKS.has(normalizeText(record.label))).map((record) => record.currency));
  const detailedBankByCurrency = new Set(bankCandidates.filter((record) => !BANK_AGGREGATES.has(normalizeText(record.label)) && !PROVIDER_BANKS.has(normalizeText(record.label))).map((record) => record.currency));
  const detailedDebtByCurrency = new Set(debtCandidates.filter((record) => !DEBT_AGGREGATES.has(normalizeText(record.label))).map((record) => record.currency));
  const selected = [];
  const aggregateDebtCounted = new Set();

  riskFiltered.forEach((record) => {
    if (!VALID_CURRENCIES.includes(record.currency) || !Number.isFinite(normalizedAmount(record))) return;
    if (isMortgageMeta(record)) return;
    const label = normalizeText(record.label);
    if (record.block === 'investment' || record.block === 'real_estate' || isMortgagePrincipal(record)) {
      selected.push(record);
      return;
    }
    if (record.block === 'bank' && !isNonMortgageDebt(record)) {
      if (providerByCurrency.has(record.currency) && !PROVIDER_BANKS.has(label) && !isManualAdjustment(record)) return;
      if (!providerByCurrency.has(record.currency) && detailedBankByCurrency.has(record.currency) && BANK_AGGREGATES.has(label)) return;
      selected.push(record);
      return;
    }
    if (!isNonMortgageDebt(record)) return;
    if (detailedDebtByCurrency.has(record.currency) && DEBT_AGGREGATES.has(label)) return;
    if (!detailedDebtByCurrency.has(record.currency) && DEBT_AGGREGATES.has(label)) {
      if (aggregateDebtCounted.has(record.currency)) return;
      aggregateDebtCounted.add(record.currency);
    }
    selected.push(record);
  });
  return selected;
};

const emptyCurrencyMap = () => ({ CLP: 0, USD: 0, EUR: 0, UF: 0 });
const emptyBlockMap = () => ({ bank: emptyCurrencyMap(), investment: emptyCurrencyMap(), real_estate: emptyCurrencyMap(), debt: emptyCurrencyMap() });
const toClp = (amount, currency, fx) => currency === 'CLP'
  ? amount
  : amount * (currency === 'USD' ? fx.usdClp : currency === 'EUR' ? fx.eurClp : fx.ufClp);

export const calculateHistoricalClosureSummary = (records, fxInput) => {
  const fx = normalizeFxRates(fxInput);
  if (!Array.isArray(records) || !records.length) throw Object.assign(new Error('El cierre no contiene records detallados.'), { statusCode: 409, code: 'summary_only' });
  const withRisk = selectHistoricalCanonicalRecords(records, true);
  const withoutRisk = selectHistoricalCanonicalRecords(records, false);
  const summarize = (selected) => {
    const assetsByCurrency = emptyCurrencyMap();
    const debtsByCurrency = emptyCurrencyMap();
    const byBlock = emptyBlockMap();
    let investmentClp = 0;
    let bankClp = 0;
    let realEstateAssetsClp = 0;
    let mortgageDebtClp = 0;
    let nonMortgageDebtClp = 0;
    selected.forEach((record) => {
      const amount = Math.abs(normalizedAmount(record));
      const debt = isMortgagePrincipal(record) || isNonMortgageDebt(record);
      byBlock[record.block][record.currency] += amount;
      if (debt) debtsByCurrency[record.currency] += amount;
      else assetsByCurrency[record.currency] += amount;
      const clp = toClp(amount, record.currency, fx);
      if (record.block === 'investment') investmentClp += clp;
      else if (record.block === 'real_estate') realEstateAssetsClp += clp;
      else if (isMortgagePrincipal(record)) mortgageDebtClp += clp;
      else if (isNonMortgageDebt(record)) nonMortgageDebtClp += clp;
      else if (record.block === 'bank') bankClp += clp;
    });
    const netByCurrency = Object.fromEntries(VALID_CURRENCIES.map((currency) => [currency, assetsByCurrency[currency] - debtsByCurrency[currency]]));
    const netClp = investmentClp + bankClp + realEstateAssetsClp - mortgageDebtClp - nonMortgageDebtClp;
    return { assetsByCurrency, debtsByCurrency, byBlock, netByCurrency, investmentClp, bankClp, realEstateAssetsClp, mortgageDebtClp, nonMortgageDebtClp, realEstateNetClp: realEstateAssetsClp - mortgageDebtClp, netClp };
  };
  const withRiskSummary = summarize(withRisk);
  const withoutRiskSummary = summarize(withoutRisk);
  const riskCapitalClp = withRiskSummary.investmentClp - withoutRiskSummary.investmentClp;
  return {
    netByCurrency: withRiskSummary.netByCurrency,
    assetsByCurrency: withRiskSummary.assetsByCurrency,
    debtsByCurrency: withRiskSummary.debtsByCurrency,
    netConsolidatedClp: withRiskSummary.netClp,
    byBlock: withRiskSummary.byBlock,
    analysisByCurrency: {
      clpWithoutRisk: withoutRiskSummary.netByCurrency.CLP + withoutRiskSummary.netByCurrency.EUR * fx.eurClp + withoutRiskSummary.netByCurrency.UF * fx.ufClp,
      usdWithoutRisk: withoutRiskSummary.netByCurrency.USD,
      clpWithRisk: withRiskSummary.netByCurrency.CLP + withRiskSummary.netByCurrency.EUR * fx.eurClp + withRiskSummary.netByCurrency.UF * fx.ufClp,
      usdWithRisk: withRiskSummary.netByCurrency.USD,
      source: 'records',
    },
    investmentClp: withoutRiskSummary.investmentClp,
    riskCapitalClp,
    investmentClpWithRisk: withRiskSummary.investmentClp,
    netClp: withoutRiskSummary.netClp,
    netClpWithRisk: withRiskSummary.netClp,
    bankClp: withoutRiskSummary.bankClp,
    nonMortgageDebtClp: withoutRiskSummary.nonMortgageDebtClp,
    realEstateNetClp: withoutRiskSummary.realEstateNetClp,
    realEstateAssetsClp: withoutRiskSummary.realEstateAssetsClp,
    mortgageDebtClp: withoutRiskSummary.mortgageDebtClp,
  };
};

const delta = (before, after) => ({
  before,
  after,
  difference: after - before,
  differencePct: before === 0 ? null : (after - before) / Math.abs(before),
});

export const locateClosure = (rootData, monthKey) => {
  const closures = Array.isArray(rootData?.closures) ? rootData.closures : [];
  const matches = closures.map((closure, index) => ({ closure, index })).filter(({ closure }) => closure?.monthKey === monthKey);
  if (matches.length !== 1) {
    throw Object.assign(new Error(matches.length ? `Hay ${matches.length} cierres para ${monthKey}.` : `No existe cierre ${monthKey}.`), { statusCode: 409, code: matches.length ? 'duplicate_closure' : 'closure_not_found' });
  }
  return matches[0];
};

export const buildHistoricalPreview = (rawClosure, proposedFxRates) => {
  const proposedFx = normalizeFxRates(proposedFxRates);
  const currentFx = normalizeFxRates(rawClosure?.fxRates);
  const records = rawClosure?.records;
  const before = calculateHistoricalClosureSummary(records, currentFx);
  const after = calculateHistoricalClosureSummary(records, proposedFx);
  const storedWithoutRisk = Number(rawClosure?.summary?.netClp);
  const storedWithRisk = Number(rawClosure?.summary?.netClpWithRisk);
  const tolerance = 0.05;
  const reconciliation = {
    beforeWithoutRisk: Number.isFinite(storedWithoutRisk) && Math.abs(before.netClp - storedWithoutRisk) <= tolerance,
    beforeWithRisk: Number.isFinite(storedWithRisk) && Math.abs(before.netClpWithRisk - storedWithRisk) <= tolerance,
    after: Number.isFinite(after.netClp) && Number.isFinite(after.netClpWithRisk),
  };
  return {
    monthKey: rawClosure.monthKey,
    economicDate: economicDateForMonth(rawClosure.monthKey),
    recordCount: records.length,
    currentFxRates: currentFx,
    proposedFxRates: proposedFx,
    exposureNetByCurrency: after.netByCurrency,
    withoutRisk: delta(before.netClp, after.netClp),
    withRisk: delta(before.netClpWithRisk, after.netClpWithRisk),
    presentation: {
      CLP: delta(before.netClp, after.netClp),
      USD: delta(before.netClp / currentFx.usdClp, after.netClp / proposedFx.usdClp),
      EUR: delta(before.netClp / currentFx.eurClp, after.netClp / proposedFx.eurClp),
      UF: delta(before.netClp / currentFx.ufClp, after.netClp / proposedFx.ufClp),
    },
    summaries: { before, after },
    reconciliation,
    fingerprint: fingerprintValue(rawClosure),
    consumers: {
      derivedAutomatically: ['Cierres / Evolución', 'Conversion horizons', 'Retornos', 'Portfolio Analytics', 'Dashboard', 'Wealth Lab', 'Exportaciones financieras'],
      notModified: ['Patrimonio vivo', 'Mes abierto', 'Snapshot FX operativo', 'Otros cierres', 'MIDAS', 'Data Room de GastApp'],
    },
  };
};

export const splitBackupPayload = (payload) => {
  const encoded = Buffer.from(JSON.stringify(encodeFirestoreValue(payload)), 'utf8').toString('base64');
  const chunks = [];
  for (let index = 0; index < encoded.length; index += BACKUP_CHUNK_SIZE) {
    chunks.push(encoded.slice(index, index + BACKUP_CHUNK_SIZE));
  }
  return chunks;
};

export const joinBackupPayload = (chunks, factories) => {
  const text = Buffer.from(chunks.join(''), 'base64').toString('utf8');
  return decodeFirestoreValue(JSON.parse(text), factories);
};

export const createBackupPackage = ({ rootData, rawClosure, identity, monthKey, reason, rootUpdateTime, now = new Date(), operationId = randomUUID() }) => {
  const createdAt = now.toISOString();
  const backupId = `historical_${monthKey}_${operationId}`;
  const checkpointId = `checkpoint_${monthKey}_${operationId}`;
  const payload = {
    schemaVersion: HISTORICAL_BACKUP_SCHEMA_VERSION,
    exportedAt: createdAt,
    manifest: { backupId, checkpointId, operationId, monthKey },
    rootDocumentPath: `aurum_wealth/${identity.uid}`,
    rootDocument: rootData,
    closure: rawClosure,
  };
  const chunks = splitBackupPayload(payload);
  const rootDocumentFingerprint = fingerprintValue(rootData);
  const closureFingerprint = fingerprintValue(rawClosure);
  return {
    backupId,
    checkpointId,
    operationId,
    chunks,
    manifest: {
      schemaVersion: HISTORICAL_BACKUP_SCHEMA_VERSION,
      type: 'historical-closure-backup',
      backupId,
      checkpointId,
      operationId,
      uid: identity.uid,
      email: identity.email,
      monthKey,
      createdAt,
      rootDocumentPath: `aurum_wealth/${identity.uid}`,
      rootDocumentUpdateTime: rootUpdateTime || null,
      rootDocumentFingerprint,
      closureFingerprint,
      encoding: 'base64-json',
      chunkCount: chunks.length,
      reason,
      status: 'prepared',
    },
    checkpoint: {
      schemaVersion: HISTORICAL_BACKUP_SCHEMA_VERSION,
      type: 'historical-closure-checkpoint',
      checkpointId,
      backupId,
      operationId,
      uid: identity.uid,
      email: identity.email,
      monthKey,
      createdAt,
      closureFingerprint,
      rootDocumentFingerprint,
      backupChunkCount: chunks.length,
      status: 'prepared',
    },
    exportPayload: encodeFirestoreValue(payload),
  };
};

const mergeDerivedSummary = (original, calculated) => ({ ...(original || {}), ...calculated });

export const applyCorrectionToRoot = ({ rootData, monthKey, expectedFingerprint, proposedFxRates, suggestedFxRates, reason, identity, backupId, checkpointId, now = new Date(), operationId = randomUUID() }) => {
  const { closure: rawClosure, index } = locateClosure(rootData, monthKey);
  const currentFingerprint = fingerprintValue(rawClosure);
  if (currentFingerprint !== expectedFingerprint) {
    throw Object.assign(new Error('El cierre cambió desde la preview. Recarga antes de continuar.'), { statusCode: 409, code: 'concurrent_modification' });
  }
  if (!String(reason || '').trim()) throw Object.assign(new Error('El motivo es obligatorio.'), { statusCode: 400, code: 'reason_required' });
  const preview = buildHistoricalPreview(rawClosure, proposedFxRates);
  if (!preview.reconciliation.beforeWithoutRisk || !preview.reconciliation.beforeWithRisk || !preview.reconciliation.after) {
    throw Object.assign(new Error('El cierre no reconcilia y no puede corregirse automáticamente.'), { statusCode: 409, code: 'reconciliation_failed' });
  }
  const proposedFx = preview.proposedFxRates;
  const previousAudit = Array.isArray(rawClosure.historicalFxCorrectionAudit) ? rawClosure.historicalFxCorrectionAudit : [];
  const auditEntry = {
    operationId,
    editedAt: now.toISOString(),
    editedBy: identity.email,
    uid: identity.uid,
    editReason: String(reason).trim(),
    economicMonthKey: monthKey,
    economicDate: economicDateForMonth(monthKey),
    previousFxRates: preview.currentFxRates,
    newFxRates: proposedFx,
    suggestedFxRates: suggestedFxRates && validFx(suggestedFxRates) ? normalizeFxRates(suggestedFxRates) : proposedFx,
    previousNetClp: preview.withoutRisk.before,
    newNetClp: preview.withoutRisk.after,
    previousNetClpWithRisk: preview.withRisk.before,
    newNetClpWithRisk: preview.withRisk.after,
    checkpointId,
    backupId,
    originalDocumentFingerprint: currentFingerprint,
    reconciliationStatus: 'exact',
    source: 'historical_closure_correction_service',
    manualOverride: true,
  };
  const nextClosure = {
    ...rawClosure,
    fxRates: proposedFx,
    fxMetadata: {
      ...(rawClosure.fxMetadata || {}),
      economicMonthKey: monthKey,
      economicDate: economicDateForMonth(monthKey),
      usedFxRates: proposedFx,
      suggestedFxRates: auditEntry.suggestedFxRates,
      rateOrigin: { usd: 'manual', eur: 'manual', uf: 'manual' },
      manualOverrideReason: auditEntry.editReason,
      checkedAt: auditEntry.editedAt,
      source: { usd: 'historical_correction', eur: 'historical_correction', uf: 'historical_correction' },
    },
    summary: mergeDerivedSummary(rawClosure.summary, preview.summaries.after),
    historicalFxCorrectionAudit: [...previousAudit, auditEntry],
  };
  const closures = [...rootData.closures];
  closures[index] = nextClosure;
  return {
    nextRootData: { ...rootData, closures },
    previousClosure: rawClosure,
    nextClosure,
    preview,
    auditEntry,
    finalFingerprint: fingerprintValue(nextClosure),
  };
};

export const restoreClosureInRoot = ({ rootData, monthKey, expectedFingerprint, checkpoint, identity, reason, now = new Date(), operationId = randomUUID() }) => {
  const { closure: currentClosure, index } = locateClosure(rootData, monthKey);
  const currentFingerprint = fingerprintValue(currentClosure);
  if (currentFingerprint !== expectedFingerprint) {
    throw Object.assign(new Error('El cierre cambió desde la preview de rollback.'), { statusCode: 409, code: 'concurrent_modification' });
  }
  if (!checkpoint?.rawClosure || checkpoint.monthKey !== monthKey) {
    throw Object.assign(new Error('Checkpoint histórico inválido.'), { statusCode: 409, code: 'invalid_checkpoint' });
  }
  if (fingerprintValue(checkpoint.rawClosure) !== checkpoint.closureFingerprint) {
    throw Object.assign(new Error('El checkpoint no supera la verificación de integridad.'), { statusCode: 409, code: 'checkpoint_integrity_failed' });
  }
  const restoredClosure = checkpoint.rawClosure;
  const closures = [...rootData.closures];
  closures[index] = restoredClosure;
  const auditEntry = {
    operationId,
    editedAt: now.toISOString(),
    editedBy: identity.email,
    uid: identity.uid,
    monthKey,
    reason,
    source: 'historical_closure_rollback_service',
    previousFingerprint: currentFingerprint,
    restoredFingerprint: fingerprintValue(restoredClosure),
    checkpointId: checkpoint.checkpointId,
  };
  return { nextRootData: { ...rootData, closures }, currentClosure, restoredClosure, auditEntry };
};
