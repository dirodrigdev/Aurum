import { labelMatchKey } from '../utils/wealthLabels';
import {
  BANK_BALANCE_CLP_LABEL,
  DEBT_CARD_CLP_LABEL,
  REAL_ESTATE_PROPERTY_VALUE_LABEL,
  RISK_CAPITAL_LABEL_CLP,
  TENENCIA_CXC_PREFIX_LABEL,
  buildCanonicalClosureSummary,
  computeWealthHomeSectionAmounts,
  currentMonthKey,
  dedupeLatestByAsset,
  detectAggregateCompetitionConflicts,
  defaultFxRates,
  filterRecordsByRiskCapitalPreference,
  isAggregateNonMortgageDebtRecord,
  isMortgagePrincipalDebtLabel,
  isNonMortgageDebtRecord,
  isRiskCapitalInvestmentLabel,
  isStartMonthCheckpointRecord,
  isSyntheticAggregateRecord,
  latestRecordsForMonth,
  loadInvestmentInstruments,
  makeAssetKey,
  resolveRiskCapitalRecordsForTotals,
  selectCanonicalWealthExposureRecords,
  type AggregateCompetitionConflict,
  type WealthCurrency,
  type WealthFxRates,
  type WealthInvestmentInstrument,
  type WealthMonthlyClosure,
  type WealthRecord,
  validateFxRange,
} from './wealthStorage';
import { buildWealthFreshnessModel, type WealthFreshnessBucket } from './wealthFreshness';
import { shouldBlockMonthlyCloseForDebtMismatch } from './monthlyCloseDebtGuard';
import type { ClosureFxPreflightContext } from './closureFxRates';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MATERIALITY_CLP = 1_000_000;
const DIFF_TOLERANCE_CLP = 5_000;

export type MonthlyClosePreflightDecision =
  | 'GO_PARA_CERRAR'
  | 'NO_GO_SOURCE_OF_TRUTH_UNCLEAR'
  | 'NO_GO_DATA_QUALITY';

export type MonthlyClosePreflightStatus = 'ok' | 'warn' | 'fail';

export interface MonthlyClosePreflightAssetRow {
  assetId: string;
  label: string;
  block: string;
  assetType: string;
  currency: string;
  amountPatrimonioUI: number | null;
  amountFreshness: number | null;
  amountCloseTarget: number | null;
  amountClpPatrimonioUI: number | null;
  amountClpFreshness: number | null;
  amountClpCloseTarget: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  refreshedAt: string | null;
  confirmedAt: string | null;
  snapshotDate: string | null;
  freshnessDays: number | null;
  freshnessBucket: WealthFreshnessBucket | null;
  includedInPatrimonioUI: boolean;
  includedInFreshness: boolean;
  includedInClose: boolean;
  sourcePatrimonioUI: string | null;
  sourceFreshness: string | null;
  sourceClose: string | null;
  diffPatrimonioVsClose: number | null;
  diffFreshnessVsClose: number | null;
  timestampMismatch: boolean;
  sourceMismatch: boolean;
  duplicateRisk: boolean;
  missingInClose: boolean;
  missingInUI: boolean;
  severity: 'low' | 'medium' | 'high';
  notes: string[];
}

export interface MonthlyClosePreflightBlockRow {
  block: string;
  valuePatrimonioUI: number | null;
  valueFreshness: number | null;
  valueCloseTarget: number | null;
  diffUiVsClose: number | null;
  diffFreshnessVsClose: number | null;
  status: MonthlyClosePreflightStatus;
  notes: string;
}

export interface MonthlyClosePreflightCheck {
  key: string;
  label: string;
  status: MonthlyClosePreflightStatus;
  message: string;
}

export interface MonthlyClosePreflightDiagnostic {
  candidateMonthKey: string;
  previousMonthKey: string | null;
  uiMonthKey: string;
  hasExistingClosure: boolean;
  wouldOverwrite: boolean;
  decision: MonthlyClosePreflightDecision;
  uiRecordsEquivalent: WealthRecord[];
  closeTargetRecords: WealthRecord[];
  closeSummary: ReturnType<typeof buildCanonicalClosureSummary>;
  fxForClose: WealthFxRates;
  fxContext?: ClosureFxPreflightContext;
  freshness: ReturnType<typeof buildWealthFreshnessModel>;
  warnings: string[];
  checks: MonthlyClosePreflightCheck[];
  assetRows: MonthlyClosePreflightAssetRow[];
  blockRows: MonthlyClosePreflightBlockRow[];
  checkpointUndoExpectation: string;
  fillMissingWarning: {
    wouldRun: boolean;
    sourceMonth: string | null;
    sourceKind: 'records' | 'summary' | 'none';
    labels: string[];
    count: number;
  };
  debtAlignmentWarning: {
    wouldAlign: boolean;
    liveDebtClp: number;
    closeDebtClp: number;
  };
  aggregateCompetitionConflicts: AggregateCompetitionConflict[];
}

interface MonthlyClosePreflightInput {
  records: WealthRecord[];
  closures: WealthMonthlyClosure[];
  fxForClose: WealthFxRates;
  fxContext?: ClosureFxPreflightContext;
  includeRiskCapitalInTotals: boolean;
  uiMonthKey: string;
  targetMonthKey?: string;
  calendarMonthKey?: string;
  investmentInstruments?: WealthInvestmentInstrument[];
}

type SourceAggregate = {
  label: string;
  block: string;
  assetType: string;
  currency: string;
  amount: number | null;
  amountClp: number;
  createdAt: string | null;
  updatedAt: string | null;
  refreshedAt: string | null;
  confirmedAt: string | null;
  snapshotDate: string | null;
  sources: string[];
  duplicateRisk: boolean;
  notes: string[];
};

const asFinite = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const isTenenciaKey = (label: string) => {
  const base = labelMatchKey(TENENCIA_CXC_PREFIX_LABEL);
  const value = labelMatchKey(label);
  return value === base || value.startsWith(`${base} `);
};

const isAssetMaterial = (valueClp: number | null) => Math.abs(Number(valueClp || 0)) >= MATERIALITY_CLP;

const monthAfterKey = (monthKey: string) => {
  const [yearRaw, monthRaw] = monthKey.split('-').map(Number);
  if (!Number.isFinite(yearRaw) || !Number.isFinite(monthRaw) || monthRaw < 1 || monthRaw > 12) return monthKey;
  const month = monthRaw === 12 ? 1 : monthRaw + 1;
  const year = monthRaw === 12 ? yearRaw + 1 : yearRaw;
  return `${year}-${String(month).padStart(2, '0')}`;
};

const deriveOperationalMonthKeyFromClosures = (closures: WealthMonthlyClosure[], fallbackMonthKey: string) => {
  if (!closures.length) return fallbackMonthKey;
  const ordered = [...closures].sort((a, b) => b.monthKey.localeCompare(a.monthKey));
  let candidate = monthAfterKey(ordered[0].monthKey);
  const closedMonths = new Set(ordered.map((closure) => closure.monthKey));
  let guard = 0;
  while (closedMonths.has(candidate) && guard < 24) {
    candidate = monthAfterKey(candidate);
    guard += 1;
  }
  return candidate;
};

const buildCanonicalCloseTargetRecords = (sourceRecords: WealthRecord[], targetMonthKey: string) =>
  latestRecordsForMonth(sourceRecords, targetMonthKey).filter((record) => !isStartMonthCheckpointRecord(record));

const recordDateMsForFreshness = (record: WealthRecord) => {
  for (const value of [record.refreshedAt, record.confirmedAt, record.updatedAt]) {
    const parsed = new Date(String(value || '')).getTime();
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const note = String(record.note || '').toLowerCase();
  const carried = note.includes('arrastrado') || note.includes('mes anterior');
  if (carried) {
    const match = String(record.note || '').match(/cierre\s+(\d{4}-\d{2})/i);
    if (match?.[1]) {
      const [year, month] = match[1].split('-').map(Number);
      if (Number.isFinite(year) && Number.isFinite(month) && month >= 1 && month <= 12) {
        const lastDay = new Date(year, month, 0).getDate();
        return new Date(`${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}T12:00:00`).getTime();
      }
    }
  }
  for (const value of [record.createdAt, record.snapshotDate ? `${record.snapshotDate}T12:00:00` : '']) {
    const parsed = new Date(String(value || '')).getTime();
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return NaN;
};

const freshnessDaysFromRecord = (record: WealthRecord, nowMs: number) => {
  const dateMs = recordDateMsForFreshness(record);
  const ageMs = nowMs - dateMs;
  return Number.isFinite(ageMs) && ageMs >= 0 ? Math.floor(ageMs / MS_PER_DAY) : null;
};

const diagnosticAssetKey = (record: Pick<WealthRecord, 'block' | 'label' | 'currency'>) => {
  if (isTenenciaKey(record.label)) return `investment::${labelMatchKey(TENENCIA_CXC_PREFIX_LABEL)}::merged`;
  return makeAssetKey(record);
};

const toClp = (record: Pick<WealthRecord, 'amount' | 'currency'>, fx: WealthFxRates) => {
  const amount = Math.abs(Number(record.amount || 0));
  if (record.currency === 'CLP') return amount;
  if (record.currency === 'USD') return amount * fx.usdClp;
  if (record.currency === 'EUR') return amount * fx.eurClp;
  return amount * fx.ufClp;
};

const pickTimestamp = (values: Array<string | null | undefined>) => {
  const sorted = values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .sort((a, b) => String(b).localeCompare(String(a)));
  return sorted[0] || null;
};

const inferAssetType = (record: Pick<WealthRecord, 'block' | 'label'>) => {
  if (record.block === 'real_estate' && labelMatchKey(record.label) === labelMatchKey(REAL_ESTATE_PROPERTY_VALUE_LABEL)) {
    return 'property';
  }
  if (isMortgagePrincipalDebtLabel(record.label)) return 'mortgage_debt';
  if (isNonMortgageDebtRecord({ block: record.block as any, label: record.label, source: '' })) return 'card_debt';
  if (isRiskCapitalInvestmentLabel(record.label)) return 'risk_capital';
  if (isTenenciaKey(record.label)) return 'tenencia';
  return record.block;
};

const aggregateRecordsByDiagnosticKey = (
  records: WealthRecord[],
  fx: WealthFxRates,
  nowMs: number,
): Map<string, SourceAggregate> => {
  const rawCounts = new Map<string, number>();
  records.forEach((record) => {
    const key = diagnosticAssetKey(record);
    rawCounts.set(key, (rawCounts.get(key) || 0) + 1);
  });

  const map = new Map<string, SourceAggregate>();
  records.forEach((record) => {
    const key = diagnosticAssetKey(record);
    const existing = map.get(key);
    const nextAmountClp = toClp(record, fx);
    const notes = [...(existing?.notes || [])];
    if (isTenenciaKey(record.label)) notes.push('Tenencia/CxC consolidada');
    const current: SourceAggregate = {
      label: isTenenciaKey(record.label) ? TENENCIA_CXC_PREFIX_LABEL : record.label,
      block: record.block,
      assetType: inferAssetType(record),
      currency:
        existing && existing.currency !== record.currency ? 'MULTI' : existing?.currency || record.currency,
      amount:
        existing
          ? existing.currency === record.currency && existing.amount !== null
            ? existing.amount + Number(record.amount || 0)
            : null
          : Number(record.amount || 0),
      amountClp: (existing?.amountClp || 0) + nextAmountClp,
      createdAt: pickTimestamp([existing?.createdAt, record.createdAt]),
      updatedAt: pickTimestamp([existing?.updatedAt, record.updatedAt]),
      refreshedAt: pickTimestamp([existing?.refreshedAt, record.refreshedAt]),
      confirmedAt: pickTimestamp([existing?.confirmedAt, record.confirmedAt]),
      snapshotDate: pickTimestamp([existing?.snapshotDate, record.snapshotDate]),
      sources: Array.from(new Set([...(existing?.sources || []), record.source].filter(Boolean))),
      duplicateRisk: (rawCounts.get(key) || 0) > 1,
      notes: Array.from(new Set(notes)),
    };
    map.set(key, current);
  });

  map.forEach((item, key) => {
    if (item.assetType === 'tenencia') {
      const raw = records.filter((record) => diagnosticAssetKey(record) === key);
      const newest = raw.reduce<WealthRecord | null>((latest, current) => {
        if (!latest) return current;
        return freshnessDaysFromRecord(current, nowMs) ?? Number.POSITIVE_INFINITY <
          (freshnessDaysFromRecord(latest, nowMs) ?? Number.POSITIVE_INFINITY)
          ? current
          : latest;
      }, null);
      if (newest) {
        item.updatedAt = pickTimestamp([newest.updatedAt, item.updatedAt]);
        item.refreshedAt = pickTimestamp([newest.refreshedAt, item.refreshedAt]);
        item.confirmedAt = pickTimestamp([newest.confirmedAt, item.confirmedAt]);
      }
    }
  });

  return map;
};

const buildPatrimonioUiEquivalentRecords = (
  records: WealthRecord[],
  closures: WealthMonthlyClosure[],
  monthKey: string,
  includeRiskCapitalInTotals: boolean,
) => {
  const activeClosure = closures.find((closure) => closure.monthKey === monthKey) || null;
  const monthRecords = latestRecordsForMonth(records, monthKey);
  const resolved = resolveRiskCapitalRecordsForTotals(monthRecords, includeRiskCapitalInTotals);
  if (activeClosure) return resolved.recordsForTotals;
  return resolved.recordsForTotals.filter(
    (record) => !(isNonMortgageDebtRecord(record) && isAggregateNonMortgageDebtRecord(record)),
  );
};

const buildPreviousCarryPreview = (
  previous: WealthMonthlyClosure | null,
  targetMonthKey: string,
  investmentInstruments: WealthInvestmentInstrument[],
) => {
  if (!previous) {
    return { wouldRun: false, sourceMonth: null, sourceKind: 'none' as const, labels: [] as string[], count: 0 };
  }

  const previousRecords = previous.records?.length
    ? dedupeLatestByAsset(previous.records)
    : (() => {
        const built: WealthRecord[] = [];
        const summary = previous.summary || null;
        const pushSynthetic = (block: WealthRecord['block'], label: string, amount: number) => {
          if (!Number.isFinite(amount) || Math.abs(amount) <= 0) return;
          built.push({
            id: `${block}-${labelMatchKey(label)}`,
            block,
            source: 'cierre_resumen',
            label,
            amount,
            currency: 'CLP',
            snapshotDate: `${targetMonthKey}-01`,
            createdAt: '',
            note: `Mes anterior (summary): cierre ${previous.monthKey}`,
          });
        };
        pushSynthetic('investment', TENENCIA_CXC_PREFIX_LABEL, Number(summary?.investmentClp || 0));
        pushSynthetic('investment', RISK_CAPITAL_LABEL_CLP, Number(summary?.riskCapitalClp || 0));
        pushSynthetic('bank', BANK_BALANCE_CLP_LABEL, Number(summary?.bankClp || 0));
        pushSynthetic('debt', DEBT_CARD_CLP_LABEL, Number(summary?.nonMortgageDebtClp || 0));
        pushSynthetic('real_estate', REAL_ESTATE_PROPERTY_VALUE_LABEL, Number(summary?.realEstateNetClp || 0));
        return built;
      })();

  const currentKeys = new Set<string>();
  const excludedInvestmentKeys = new Set(
    investmentInstruments
      .filter((instrument) => (instrument.excludedMonths || []).includes(targetMonthKey))
      .map((instrument) => `${labelMatchKey(instrument.label)}::${instrument.currency}`),
  );

  const labels: string[] = [];
  previousRecords.forEach((record) => {
    if (record.block === 'investment') {
      const excludedKey = `${labelMatchKey(record.label)}::${record.currency}`;
      if (excludedInvestmentKeys.has(excludedKey)) return;
    }
    currentKeys.add(makeAssetKey(record));
  });

  return {
    sourceMonth: previous.monthKey,
    sourceKind: previous.records?.length ? ('records' as const) : ('summary' as const),
    labels,
    count: 0,
    wouldRun: false,
    currentKeys,
  };
};

const buildCheck = (
  key: string,
  label: string,
  status: MonthlyClosePreflightStatus,
  message: string,
): MonthlyClosePreflightCheck => ({ key, label, status, message });

const statusFromDiff = (diff: number | null, notes: string) => {
  if (diff === null) return { status: 'warn' as const, notes };
  if (Math.abs(diff) <= DIFF_TOLERANCE_CLP) return { status: 'ok' as const, notes };
  return { status: 'fail' as const, notes };
};

const formatAggregateCompetitionConflict = (conflict: AggregateCompetitionConflict) =>
  `${conflict.family}/${conflict.currency}: agregado ${conflict.aggregateClp.toLocaleString('es-CL')} vs detalle ${conflict.detailClp.toLocaleString('es-CL')}`;

const formatPreflightDecision = (decision: MonthlyClosePreflightDecision) => {
  if (decision === 'GO_PARA_CERRAR') return 'GO PARA CERRAR';
  if (decision === 'NO_GO_DATA_QUALITY') return 'NO-GO: calidad de datos';
  return 'NO-GO: fuentes no reconciliadas';
};

export const buildMonthlyClosePreflightReport = (diagnostic: MonthlyClosePreflightDiagnostic) => {
  const blockedConflicts = diagnostic.aggregateCompetitionConflicts.filter((conflict) => conflict.status === 'blocked');
  const ignoredLegacyConflicts = diagnostic.aggregateCompetitionConflicts.filter(
    (conflict) => conflict.status === 'ignored_legacy',
  );

  return [
    `Preflight cierre mensual (${diagnostic.candidateMonthKey})`,
    `Decision: ${formatPreflightDecision(diagnostic.decision)}`,
    `UI visible: ${diagnostic.uiMonthKey}`,
    diagnostic.previousMonthKey ? `Cierre previo: ${diagnostic.previousMonthKey}` : 'Cierre previo: none',
    `Overwrite: ${diagnostic.wouldOverwrite ? 'sí' : 'no'}`,
    '',
    'Checks:',
    ...diagnostic.checks.map((check) => `- [${check.status}] ${check.label}: ${check.message}`),
    '',
    blockedConflicts.length
      ? `Conflictos agregados bloqueantes: ${blockedConflicts.map(formatAggregateCompetitionConflict).join(' · ')}`
      : 'Conflictos agregados bloqueantes: none',
    ignoredLegacyConflicts.length
      ? `Agregados legacy ignorados: ${ignoredLegacyConflicts.map(formatAggregateCompetitionConflict).join(' · ')}`
      : 'Agregados legacy ignorados: none',
    '',
    'Resumen por bloque:',
    ...diagnostic.blockRows.map(
      (row) =>
        `- ${row.block}: UI ${row.valuePatrimonioUI === null ? '—' : row.valuePatrimonioUI.toLocaleString('es-CL')} | cierre ${row.valueCloseTarget === null ? '—' : row.valueCloseTarget.toLocaleString('es-CL')} | estado ${row.status}`,
    ),
    '',
    diagnostic.warnings.length ? 'Warnings:' : 'Warnings: none',
    ...diagnostic.warnings.map((warning) => `- ${warning}`),
  ].join('\n');
};

export const buildMonthlyClosePreflightDiagnostic = (
  input: MonthlyClosePreflightInput,
): MonthlyClosePreflightDiagnostic => {
  const calendarMonth = input.calendarMonthKey || currentMonthKey();
  const candidateMonthKey = deriveOperationalMonthKeyFromClosures(input.closures, calendarMonth);
  const targetMonthKey = input.targetMonthKey || candidateMonthKey;
  const previousClosure =
    [...input.closures]
      .filter((closure) => closure.monthKey < targetMonthKey)
      .sort((a, b) => b.monthKey.localeCompare(a.monthKey))[0] || null;
  const existingClosure = input.closures.find((closure) => closure.monthKey === targetMonthKey) || null;
  const fxForClose = {
    usdClp: Number(input.fxForClose?.usdClp || 0),
    eurClp: Number(input.fxForClose?.eurClp || 0),
    ufClp: Number(input.fxForClose?.ufClp || 0),
  };
  const safeFx = {
    usdClp: fxForClose.usdClp > 0 ? fxForClose.usdClp : defaultFxRates.usdClp,
    eurClp: fxForClose.eurClp > 0 ? fxForClose.eurClp : defaultFxRates.eurClp,
    ufClp: fxForClose.ufClp > 0 ? fxForClose.ufClp : defaultFxRates.ufClp,
  };
  const nowMs = Date.now();
  const instruments = input.investmentInstruments || loadInvestmentInstruments();

  const uiRecordsEquivalent = buildPatrimonioUiEquivalentRecords(
    input.records,
    input.closures,
    input.uiMonthKey,
    input.includeRiskCapitalInTotals,
  ).filter((record) => !isStartMonthCheckpointRecord(record));
  const uiMonthRecords = buildCanonicalCloseTargetRecords(input.records, input.uiMonthKey);
  const uiSummary = buildCanonicalClosureSummary(uiMonthRecords, safeFx);
  const closeTargetRecords = buildCanonicalCloseTargetRecords(input.records, targetMonthKey);
  const closeTargetForTotals = resolveRiskCapitalRecordsForTotals(
    closeTargetRecords,
    input.includeRiskCapitalInTotals,
  ).recordsForTotals;
  const uiSectionAmounts = computeWealthHomeSectionAmounts(uiRecordsEquivalent, safeFx);
  const closeSectionAmounts = computeWealthHomeSectionAmounts(closeTargetForTotals, safeFx);
  const closeSummary = buildCanonicalClosureSummary(closeTargetRecords, safeFx);
  const freshness = buildWealthFreshnessModel(input.records, safeFx, {
    includeRiskCapitalInTotals: input.includeRiskCapitalInTotals,
    now: nowMs,
  });

  const uiDiagnosticRecords = selectCanonicalWealthExposureRecords(
    uiRecordsEquivalent,
    input.includeRiskCapitalInTotals,
  ).map((entry) => entry.record);
  const closeDiagnosticRecords = selectCanonicalWealthExposureRecords(
    closeTargetForTotals,
    input.includeRiskCapitalInTotals,
  ).map((entry) => entry.record);
  const freshnessRecordById = new Map(
    selectCanonicalWealthExposureRecords(input.records, input.includeRiskCapitalInTotals).map((entry) => [entry.record.id, entry.record]),
  );

  const uiMap = aggregateRecordsByDiagnosticKey(uiDiagnosticRecords, safeFx, nowMs);
  const closeMap = aggregateRecordsByDiagnosticKey(closeDiagnosticRecords, safeFx, nowMs);

  const freshnessMap = new Map<
    string,
    {
      label: string;
      block: string;
      assetType: string;
      currency: string;
      amountClp: number;
      amount: number | null;
      daysOld: number | null;
      bucket: WealthFreshnessBucket;
      source: string;
      notes: string[];
    }
  >();

  freshness.components.forEach((component) => {
    const key =
      isTenenciaKey(component.label)
        ? `investment::${labelMatchKey(TENENCIA_CXC_PREFIX_LABEL)}::merged`
        : diagnosticAssetKey(
            freshnessRecordById.get(component.recordIds[0]) || {
              block:
                component.group === 'real_estate'
                  ? 'real_estate'
                  : component.group === 'mortgage_debt' || component.group === 'non_mortgage_debt'
                    ? 'debt'
                    : component.group === 'bank'
                      ? 'bank'
                      : 'investment',
              label: component.label,
              currency: 'CLP',
            },
          );
    freshnessMap.set(key, {
      label: component.label,
      block:
        component.group === 'real_estate'
          ? 'real_estate'
          : component.group === 'mortgage_debt' || component.group === 'non_mortgage_debt'
            ? 'debt'
            : component.group === 'bank'
              ? 'bank'
              : 'investment',
      assetType:
        component.group === 'mortgage_debt'
          ? 'mortgage_debt'
          : component.group === 'non_mortgage_debt'
            ? 'card_debt'
            : component.group === 'real_estate'
              ? 'property'
              : component.group,
      currency: 'ABS_CLP',
      amountClp: component.amountClp,
      amount: null,
      daysOld: component.daysOld,
      bucket: component.bucket,
      source: component.source,
      notes: component.recordIds.length > 1 ? ['Componente consolidado en freshness'] : [],
    });
  });

  const unionKeys = new Set<string>([
    ...uiMap.keys(),
    ...closeMap.keys(),
    ...freshnessMap.keys(),
  ]);

  const assetRows = [...unionKeys]
    .map<MonthlyClosePreflightAssetRow>((key) => {
      const ui = uiMap.get(key) || null;
      const close = closeMap.get(key) || null;
      const freshnessItem = freshnessMap.get(key) || null;
      const notes = Array.from(
        new Set([
          ...(ui?.notes || []),
          ...(close?.notes || []),
          ...(freshnessItem?.notes || []),
        ]),
      );
      const diffUiVsClose =
        ui && close ? Number((ui.amountClp - close.amountClp).toFixed(0)) : ui && !close ? ui.amountClp : close ? -close.amountClp : null;
      const diffFreshnessVsClose =
        freshnessItem && close
          ? Number((freshnessItem.amountClp - close.amountClp).toFixed(0))
          : freshnessItem && !close
            ? freshnessItem.amountClp
            : close
              ? -close.amountClp
              : null;
      const timestampMismatch =
        Boolean(ui && close) &&
        pickTimestamp([ui.updatedAt, ui.refreshedAt, ui.confirmedAt, ui.createdAt]) !==
          pickTimestamp([close.updatedAt, close.refreshedAt, close.confirmedAt, close.createdAt]);
      const sourceMismatch =
        Boolean(ui && close) &&
        ui.sources.join('|') !== close.sources.join('|');
      const missingInClose = Boolean(ui && !close && isAssetMaterial(ui.amountClp));
      const missingInUI = Boolean(close && !ui && isAssetMaterial(close.amountClp));
      const duplicateRisk = Boolean(ui?.duplicateRisk || close?.duplicateRisk);
      if (missingInClose) notes.push('Visible en Patrimonio UI, pero ausente en targetRecords del cierre');
      if (missingInUI) notes.push('Presente en targetRecords del cierre, pero no visible en Patrimonio UI equivalente');
      if (timestampMismatch) notes.push('Timestamp distinto entre UI equivalente y cierre');
      if (sourceMismatch) notes.push('Fuente distinta entre UI equivalente y cierre');
      const severity: MonthlyClosePreflightAssetRow['severity'] =
        missingInClose || missingInUI || Math.abs(Number(diffUiVsClose || 0)) > MATERIALITY_CLP
          ? 'high'
          : timestampMismatch || sourceMismatch || duplicateRisk
            ? 'medium'
            : 'low';

      return {
        assetId: key,
        label: ui?.label || close?.label || freshnessItem?.label || key,
        block: ui?.block || close?.block || freshnessItem?.block || 'unknown',
        assetType: ui?.assetType || close?.assetType || freshnessItem?.assetType || 'unknown',
        currency: ui?.currency || close?.currency || freshnessItem?.currency || 'unknown',
        amountPatrimonioUI: ui?.amount ?? null,
        amountFreshness: freshnessItem?.amount ?? null,
        amountCloseTarget: close?.amount ?? null,
        amountClpPatrimonioUI: ui?.amountClp ?? null,
        amountClpFreshness: freshnessItem?.amountClp ?? null,
        amountClpCloseTarget: close?.amountClp ?? null,
        createdAt: ui?.createdAt || close?.createdAt || null,
        updatedAt: ui?.updatedAt || close?.updatedAt || null,
        refreshedAt: ui?.refreshedAt || close?.refreshedAt || null,
        confirmedAt: ui?.confirmedAt || close?.confirmedAt || null,
        snapshotDate: ui?.snapshotDate || close?.snapshotDate || null,
        freshnessDays: freshnessItem?.daysOld ?? null,
        freshnessBucket: freshnessItem?.bucket ?? null,
        includedInPatrimonioUI: Boolean(ui),
        includedInFreshness: Boolean(freshnessItem),
        includedInClose: Boolean(close),
        sourcePatrimonioUI: ui?.sources.join(' / ') || null,
        sourceFreshness: freshnessItem?.source || null,
        sourceClose: close?.sources.join(' / ') || null,
        diffPatrimonioVsClose: diffUiVsClose,
        diffFreshnessVsClose,
        timestampMismatch,
        sourceMismatch,
        duplicateRisk,
        missingInClose,
        missingInUI,
        severity,
        notes,
      };
    })
    .sort((a, b) => {
      const severityRank = { high: 0, medium: 1, low: 2 };
      if (severityRank[a.severity] !== severityRank[b.severity]) return severityRank[a.severity] - severityRank[b.severity];
      return Math.abs(Number(b.amountClpCloseTarget || b.amountClpPatrimonioUI || 0)) - Math.abs(Number(a.amountClpCloseTarget || a.amountClpPatrimonioUI || 0));
    });

  const latestFreshnessMaterial = assetRows.filter(
    (row) => row.includedInFreshness && (isAssetMaterial(row.amountClpFreshness) || isAssetMaterial(row.amountClpCloseTarget)),
  );

  const previousCarryBase = buildPreviousCarryPreview(previousClosure, targetMonthKey, instruments);
  const currentTargetKeys = new Set(closeTargetRecords.map((record) => makeAssetKey(record)));
  const fillLabels =
    previousClosure
      ? (previousClosure.records?.length
          ? dedupeLatestByAsset(previousClosure.records)
          : [])
          .filter((record) => !currentTargetKeys.has(makeAssetKey(record)))
          .map((record) => record.label)
      : [];
  const fillMissingWarning = {
    wouldRun: previousClosure ? fillLabels.length > 0 : false,
    sourceMonth: previousClosure?.monthKey || null,
    sourceKind: previousCarryBase.sourceKind,
    labels: fillLabels,
    count: fillLabels.length,
  };

  const debtAlignmentWouldRun = shouldBlockMonthlyCloseForDebtMismatch({
    liveDebtClp: Math.abs(uiSectionAmounts.nonMortgageDebt),
    previewDebtClp: Math.abs(closeSectionAmounts.nonMortgageDebt),
  });
  const debtAlignmentWarning = {
    wouldAlign: debtAlignmentWouldRun && Math.abs(uiSectionAmounts.nonMortgageDebt) >= MATERIALITY_CLP,
    liveDebtClp: Math.abs(uiSectionAmounts.nonMortgageDebt),
    closeDebtClp: Math.abs(closeSectionAmounts.nonMortgageDebt),
  };

  const blockRows: MonthlyClosePreflightBlockRow[] = [
    {
      block: 'inversiones',
      valuePatrimonioUI: uiSectionAmounts.investment,
      valueFreshness: freshness.components
        .filter((component) => component.group === 'investment')
        .reduce((sum, component) => sum + component.amountClp, 0),
      valueCloseTarget: closeSectionAmounts.investment,
      diffUiVsClose: uiSectionAmounts.investment - closeSectionAmounts.investment,
      diffFreshnessVsClose:
        freshness.components
          .filter((component) => component.group === 'investment')
          .reduce((sum, component) => sum + component.amountClp, 0) - closeSectionAmounts.investment,
      ...statusFromDiff(uiSectionAmounts.investment - closeSectionAmounts.investment, 'Freshness usa exposición absoluta.'),
    },
    {
      block: 'bancos/cash',
      valuePatrimonioUI: uiSectionAmounts.bank,
      valueFreshness: freshness.components
        .filter((component) => component.group === 'bank')
        .reduce((sum, component) => sum + component.amountClp, 0),
      valueCloseTarget: closeSectionAmounts.bank,
      diffUiVsClose: uiSectionAmounts.bank - closeSectionAmounts.bank,
      diffFreshnessVsClose:
        freshness.components
          .filter((component) => component.group === 'bank')
          .reduce((sum, component) => sum + component.amountClp, 0) - closeSectionAmounts.bank,
      ...statusFromDiff(uiSectionAmounts.bank - closeSectionAmounts.bank, 'Freshness usa exposición absoluta.'),
    },
    {
      block: 'propiedad',
      valuePatrimonioUI: uiSectionAmounts.realEstateNet,
      valueFreshness: freshness.components
        .filter((component) => component.group === 'real_estate')
        .reduce((sum, component) => sum + component.amountClp, 0),
      valueCloseTarget: closeSectionAmounts.realEstateNet,
      diffUiVsClose: uiSectionAmounts.realEstateNet - closeSectionAmounts.realEstateNet,
      diffFreshnessVsClose:
        freshness.components
          .filter((component) => component.group === 'real_estate')
          .reduce((sum, component) => sum + component.amountClp, 0) - closeSectionAmounts.realEstateNet,
      ...statusFromDiff(uiSectionAmounts.realEstateNet - closeSectionAmounts.realEstateNet, 'Freshness usa exposición de valor, no neto.'),
    },
    {
      block: 'deuda hipotecaria',
      valuePatrimonioUI: closeSummary.mortgageDebtClp ?? null,
      valueFreshness: freshness.components
        .filter((component) => component.group === 'mortgage_debt')
        .reduce((sum, component) => sum + component.amountClp, 0),
      valueCloseTarget: closeSummary.mortgageDebtClp ?? null,
      diffUiVsClose: 0,
      diffFreshnessVsClose:
        freshness.components
          .filter((component) => component.group === 'mortgage_debt')
          .reduce((sum, component) => sum + component.amountClp, 0) - Number(closeSummary.mortgageDebtClp || 0),
      status: 'ok',
      notes: 'Se compara contra resumen canónico del cierre.',
    },
    {
      block: 'tarjetas/deudas',
      valuePatrimonioUI: uiSectionAmounts.nonMortgageDebt,
      valueFreshness: freshness.components
        .filter((component) => component.group === 'non_mortgage_debt')
        .reduce((sum, component) => sum + component.amountClp, 0),
      valueCloseTarget: closeSectionAmounts.nonMortgageDebt,
      diffUiVsClose: uiSectionAmounts.nonMortgageDebt - closeSectionAmounts.nonMortgageDebt,
      diffFreshnessVsClose:
        freshness.components
          .filter((component) => component.group === 'non_mortgage_debt')
          .reduce((sum, component) => sum + component.amountClp, 0) - closeSectionAmounts.nonMortgageDebt,
      ...statusFromDiff(uiSectionAmounts.nonMortgageDebt - closeSectionAmounts.nonMortgageDebt, 'Freshness usa deuda absoluta.'),
    },
    {
      block: 'patrimonio neto total',
      valuePatrimonioUI: uiSectionAmounts.totalNetClp,
      valueFreshness: freshness.totalExposureClp,
      valueCloseTarget: closeSectionAmounts.totalNetClp,
      diffUiVsClose: uiSectionAmounts.totalNetClp - closeSectionAmounts.totalNetClp,
      diffFreshnessVsClose: freshness.totalExposureClp - closeSectionAmounts.totalNetClp,
      ...statusFromDiff(uiSectionAmounts.totalNetClp - closeSectionAmounts.totalNetClp, 'Freshness no es neto, es exposición absoluta.'),
    },
    {
      block: 'patrimonio con riesgo',
      valuePatrimonioUI: uiSummary.netClpWithRisk ?? null,
      valueFreshness: freshness.riskCapitalIncluded ? freshness.totalExposureClp : null,
      valueCloseTarget: closeSummary.netClpWithRisk ?? null,
      diffUiVsClose: Number(uiSummary.netClpWithRisk || 0) - Number(closeSummary.netClpWithRisk || 0),
      diffFreshnessVsClose: null,
      ...statusFromDiff(
        Number(uiSummary.netClpWithRisk || 0) - Number(closeSummary.netClpWithRisk || 0),
        'Freshness no modela neto con riesgo.',
      ),
    },
  ];

  (['CLP', 'USD', 'EUR', 'UF'] as const).forEach((currency) => {
    const uiValue = uiDiagnosticRecords
      .filter((record) => record.currency === currency)
      .reduce((sum, record) => sum + toClp(record, safeFx), 0);
    const closeValue = closeDiagnosticRecords
      .filter((record) => record.currency === currency)
      .reduce((sum, record) => sum + toClp(record, safeFx), 0);
    const freshnessValue = freshness.components
      .filter((component) => component.label.includes(currency))
      .reduce((sum, component) => sum + component.amountClp, 0);
    blockRows.push({
      block: currency,
      valuePatrimonioUI: uiValue,
      valueFreshness: freshnessValue || null,
      valueCloseTarget: closeValue,
      diffUiVsClose: uiValue - closeValue,
      diffFreshnessVsClose: freshnessValue ? freshnessValue - closeValue : null,
      ...statusFromDiff(uiValue - closeValue, 'Fila de moneda agregada en CLP equivalente.'),
    });
  });

  const fxChecks = [
    validateFxRange('usd_clp', fxForClose.usdClp),
    validateFxRange('eur_clp', fxForClose.eurClp),
    validateFxRange('uf_clp', fxForClose.ufClp),
  ].filter(Boolean);
  const fxContext = input.fxContext;
  const economicDateValid = !fxContext || Boolean(
    fxContext.suggestion.economicDate &&
      fxContext.suggestion.economicDate.startsWith(`${candidateMonthKey}-`) &&
      fxContext.suggestion.monthKey === candidateMonthKey,
  );
  const fxSelectionMatches = !fxContext || Boolean(
      Math.abs(fxContext.selection.usedFxRates.usdClp - fxForClose.usdClp) < 1e-9 &&
      Math.abs(fxContext.selection.usedFxRates.eurClp - fxForClose.eurClp) < 1e-9 &&
      Math.abs(fxContext.selection.usedFxRates.ufClp - fxForClose.ufClp) < 1e-9,
  );
  const previousFx = fxContext?.previousClosureFxRates || null;
  const sameAsPrevious = (field: keyof WealthFxRates) =>
    Boolean(previousFx && Math.abs(Number(previousFx[field]) - Number(fxForClose[field])) < 1e-9);
  const allFxSameAsPrevious = sameAsPrevious('usdClp') && sameAsPrevious('eurClp') && sameAsPrevious('ufClp');
  const ufSameAsPrevious = sameAsPrevious('ufClp');
  const suggested = fxContext?.suggestion.suggestedFxRates || {};
  const manualDifferenceOverThreshold = (['usdClp', 'eurClp', 'ufClp'] as const).some((field) => {
    const suggestedValue = Number(suggested[field]);
    if (!Number.isFinite(suggestedValue) || suggestedValue <= 0) return false;
    return Math.abs(Number(fxForClose[field]) / suggestedValue - 1) > 0.01;
  });
  const fxOriginsKnown = !fxContext || (['usd', 'eur', 'uf'] as const).every(
    (key) => Boolean(fxContext.selection.rateOrigin[key] && fxContext.selection.metadata.source?.[key]),
  );

  const propertyRows = closeTargetRecords.filter(
    (record) => record.block === 'real_estate' && labelMatchKey(record.label) === labelMatchKey(REAL_ESTATE_PROPERTY_VALUE_LABEL),
  );
  const mortgageRows = closeTargetRecords.filter(
    (record) => record.block === 'debt' && isMortgagePrincipalDebtLabel(record.label),
  );
  const rawDebtRows = closeTargetRecords.filter((record) => isNonMortgageDebtRecord(record));
  const aggregateDebtRows = rawDebtRows.filter((record) => isAggregateNonMortgageDebtRecord(record));
  const detailedDebtRows = rawDebtRows.filter((record) => !isAggregateNonMortgageDebtRecord(record));
  const hasNaN = closeTargetRecords.some((record) => !Number.isFinite(Number(record.amount)));
  const hasCriticalNull = [
    closeSummary.netClp,
    closeSummary.netClpWithRisk,
    closeSummary.bankClp,
    closeSummary.nonMortgageDebtClp,
  ].some((value) => value === null || value === undefined || !Number.isFinite(Number(value)));
  const materialMissingUi = assetRows.filter((row) => row.missingInUI);
  const materialMissingClose = assetRows.filter((row) => row.missingInClose);
  const materialDiffs = assetRows.filter((row) => Math.abs(Number(row.diffPatrimonioVsClose || 0)) > MATERIALITY_CLP);
  const freshnessMismatches = latestFreshnessMaterial.filter(
    (row) => row.missingInClose || Math.abs(Number(row.diffFreshnessVsClose || 0)) > MATERIALITY_CLP,
  );
  const aggregateCompetitionConflicts = detectAggregateCompetitionConflicts(
    closeTargetRecords,
    safeFx,
    input.includeRiskCapitalInTotals,
  );
  const blockedAggregateCompetitionConflicts = aggregateCompetitionConflicts.filter(
    (conflict) => conflict.status === 'blocked',
  );
  const ignoredLegacyAggregateCompetitionConflicts = aggregateCompetitionConflicts.filter(
    (conflict) => conflict.status === 'ignored_legacy',
  );
  const assetDebtUiClp = assetRows
    .filter((row) => row.assetType === 'card_debt' && row.includedInPatrimonioUI)
    .reduce((sum, row) => sum + Math.abs(Number(row.amountClpPatrimonioUI || 0)), 0);
  const assetDebtCloseClp = assetRows
    .filter((row) => row.assetType === 'card_debt' && row.includedInClose)
    .reduce((sum, row) => sum + Math.abs(Number(row.amountClpCloseTarget || 0)), 0);

  const checks: MonthlyClosePreflightCheck[] = [
    buildCheck(
      'candidate_month',
      'monthKey candidato determinado',
      targetMonthKey ? 'ok' : 'fail',
      targetMonthKey ? `Mes candidato: ${targetMonthKey}` : 'No se pudo determinar el mes candidato.',
    ),
    buildCheck(
      'overwrite',
      'no hay overwrite inesperado',
      existingClosure ? 'warn' : 'ok',
      existingClosure ? `Ya existe cierre para ${targetMonthKey}; si continúas, habrá reemplazo.` : 'No existe cierre previo para ese mes.',
    ),
    buildCheck(
      'ui_assets_vs_close',
      'Patrimonio UI y cierre usan mismos assets materiales',
      materialMissingUi.length || materialMissingClose.length ? 'fail' : 'ok',
      materialMissingUi.length || materialMissingClose.length
        ? `Assets materiales desalineados: UI->cierre ${materialMissingClose.length}, cierre->UI ${materialMissingUi.length}.`
        : 'No hay assets materiales faltantes entre UI equivalente y cierre.',
    ),
    buildCheck(
      'ui_amounts_vs_close',
      'Patrimonio UI y cierre tienen mismos montos materiales',
      materialDiffs.length ? 'fail' : 'ok',
      materialDiffs.length
        ? `${materialDiffs.length} asset(s) materiales con diferencias sobre ${MATERIALITY_CLP.toLocaleString('es-CL')} CLP.`
        : 'No hay diferencias materiales entre UI equivalente y cierre.',
    ),
    buildCheck(
      'freshness_vs_close',
      'Frescura y cierre usan mismos assets materiales o diferencia explicada',
      freshnessMismatches.length ? 'warn' : 'ok',
      freshnessMismatches.length
        ? `${freshnessMismatches.length} componente(s) materiales de freshness no reconcilian de forma directa con cierre.`
        : 'Freshness y cierre reconcilian para los componentes materiales.',
    ),
    buildCheck(
      'summary_matches_records',
      'sum(targetRecords) == summary',
      Math.abs(Number(closeSummary.netClp || 0) - closeSectionAmounts.totalNetClp) <= DIFF_TOLERANCE_CLP ? 'ok' : 'fail',
      `Summary netClp ${Number(closeSummary.netClp || 0).toLocaleString('es-CL')} vs total canónico ${closeSectionAmounts.totalNetClp.toLocaleString('es-CL')}.`,
    ),
    buildCheck(
      'debt_assets_match_blocks',
      'tarjetas/deudas asset-level cuadra con subtotal canónico',
      Math.abs(assetDebtUiClp - Math.abs(uiSectionAmounts.nonMortgageDebt)) <= DIFF_TOLERANCE_CLP &&
        Math.abs(assetDebtCloseClp - Math.abs(closeSectionAmounts.nonMortgageDebt)) <= DIFF_TOLERANCE_CLP
        ? 'ok'
        : 'fail',
      `Debt assets UI ${assetDebtUiClp.toLocaleString('es-CL')} vs subtotal UI ${Math.abs(uiSectionAmounts.nonMortgageDebt).toLocaleString('es-CL')} · cierre ${assetDebtCloseClp.toLocaleString('es-CL')} vs subtotal cierre ${Math.abs(closeSectionAmounts.nonMortgageDebt).toLocaleString('es-CL')}.`,
    ),
    buildCheck(
      'mortgage_sign',
      'deuda hipotecaria con signo correcto',
      mortgageRows.every((record) => Number(record.amount || 0) >= 0) ? 'ok' : 'fail',
      mortgageRows.every((record) => Number(record.amount || 0) >= 0)
        ? 'La deuda hipotecaria se mantiene como monto positivo y se descuenta en el neto.'
        : 'Hay saldo hipotecario con signo inesperado.',
    ),
    buildCheck(
      'property_single',
      'propiedad incluida una sola vez',
      propertyRows.length <= 1 ? 'ok' : 'fail',
      propertyRows.length <= 1 ? 'No hay duplicación material de propiedad.' : `Se detectaron ${propertyRows.length} filas de propiedad.`,
    ),
    buildCheck(
      'debt_duplicates',
      'tarjetas/deudas no duplicadas',
      aggregateDebtRows.length > 0 && detailedDebtRows.length > 0 ? 'warn' : 'ok',
      aggregateDebtRows.length > 0 && detailedDebtRows.length > 0
        ? 'Coexisten deuda agregada y deuda detallada; revisar antes de cerrar.'
        : 'No hay mezcla visible de deuda agregada y detallada en targetRecords.',
    ),
    buildCheck(
      'aggregate_conflicts',
      'agregados no compiten contra detalle',
      blockedAggregateCompetitionConflicts.length
        ? 'fail'
        : ignoredLegacyAggregateCompetitionConflicts.length
          ? 'warn'
          : 'ok',
      blockedAggregateCompetitionConflicts.length
        ? blockedAggregateCompetitionConflicts.map(formatAggregateCompetitionConflict).join(' · ')
        : ignoredLegacyAggregateCompetitionConflicts.length
          ? `Agregado legacy ignorado porque el detalle canonico ya es la fuente activa: ${ignoredLegacyAggregateCompetitionConflicts
              .map(formatAggregateCompetitionConflict)
              .join(' · ')}`
          : 'No hay conflictos materiales entre agregado y detalle.',
    ),
    buildCheck(
      'fx_complete',
      'FX completo',
      fxChecks.length === 0 ? 'ok' : 'fail',
      fxChecks.length === 0 ? 'USD, EUR y UF están completos y dentro de rango.' : 'FX faltante o fuera de rango.',
    ),
    buildCheck(
      'fx_economic_date',
      'fecha económica corresponde al monthKey',
      economicDateValid ? 'ok' : 'fail',
      economicDateValid
        ? `Fecha económica: ${fxContext?.suggestion.economicDate}.`
        : 'La fecha económica no pertenece al mes seleccionado.',
    ),
    buildCheck(
      'fx_selection_current',
      'preview y cierre usan exactamente las mismas tasas',
      fxSelectionMatches ? 'ok' : 'fail',
      fxSelectionMatches
        ? 'Las tasas del preview coinciden con las tasas preparadas para persistencia.'
        : 'Las tasas visibles y las tasas preparadas para persistencia no coinciden.',
    ),
    buildCheck(
      'fx_origin_known',
      'procedencia FX identificada',
      fxOriginsKnown ? 'ok' : 'fail',
      fxOriginsKnown
        ? 'Cada tasa utilizada identifica origen automático, manual o fallback.'
        : 'Una o más tasas no tienen procedencia identificable.',
    ),
    buildCheck(
      'fx_same_as_previous',
      'tasas no heredadas silenciosamente',
      allFxSameAsPrevious ? 'warn' : 'ok',
      allFxSameAsPrevious
        ? `Las tasas utilizadas coinciden exactamente con el cierre anterior. Revisa que correspondan a ${candidateMonthKey}.`
        : 'Las tres tasas no repiten exactamente el cierre anterior.',
    ),
    buildCheck(
      'fx_uf_same_as_previous',
      'UF revisada contra cierre anterior',
      ufSameAsPrevious ? 'warn' : 'ok',
      ufSameAsPrevious
        ? 'La UF utilizada coincide con el cierre anterior. Confirma que corresponde al último día del mes seleccionado.'
        : 'La UF difiere del cierre anterior o no existe comparación.',
    ),
    buildCheck(
      'fx_manual_reason',
      'override manual documentado',
      fxContext?.selection.requiresManualReason ? 'fail' : 'ok',
      fxContext?.selection.requiresManualReason
        ? 'Las tasas manuales requieren un motivo antes de cerrar.'
        : 'No hay override manual sin motivo.',
    ),
    buildCheck(
      'fx_manual_difference',
      'diferencia manual contra referencia revisada',
      manualDifferenceOverThreshold ? 'warn' : 'ok',
      manualDifferenceOverThreshold
        ? 'Una tasa manual difiere más de 1% de la referencia sugerida.'
        : 'No hay diferencias manuales superiores a 1% contra la referencia disponible.',
    ),
    buildCheck(
      'fx_economic_confirmation',
      'confirmación de mes económico',
      !fxContext || fxContext.confirmations.economic ? 'ok' : 'fail',
      !fxContext || fxContext.confirmations.economic
        ? 'El usuario confirmó el mes económico de las tasas.'
        : 'Falta confirmar que las tasas corresponden al mes económico seleccionado.',
    ),
    buildCheck(
      'fx_manual_confirmation',
      'confirmación de tasas manuales',
      !fxContext?.selection.requiresManualConfirmation || fxContext.confirmations.manual ? 'ok' : 'fail',
      !fxContext?.selection.requiresManualConfirmation || fxContext.confirmations.manual
        ? 'La confirmación manual está satisfecha o no aplica.'
        : 'Falta confirmar el uso de tasas particulares.',
    ),
    buildCheck(
      'fx_fallback_confirmation',
      'confirmación de fallback',
      !fxContext?.selection.requiresFallbackConfirmation || fxContext.confirmations.fallback ? 'ok' : 'fail',
      !fxContext?.selection.requiresFallbackConfirmation || fxContext.confirmations.fallback
        ? 'La revisión de fallback está satisfecha o no aplica.'
        : 'Falta confirmar la revisión manual de tasas sin referencia automática.',
    ),
    buildCheck(
      'critical_values',
      'no hay NaN/null/undefined crítico',
      !hasNaN && !hasCriticalNull ? 'ok' : 'fail',
      !hasNaN && !hasCriticalNull ? 'No se detectaron NaN/null/undefined críticos.' : 'Hay montos no finitos o summary crítico incompleto.',
    ),
    buildCheck(
      'fill_missing',
      'si fillMissingWithPreviousClosure sería usado',
      fillMissingWarning.wouldRun ? 'warn' : 'ok',
      fillMissingWarning.wouldRun
        ? `El cierre podría arrastrar ${fillMissingWarning.count} asset(s) desde ${fillMissingWarning.sourceMonth}.`
        : 'No se detecta necesidad de arrastre automático desde cierre anterior.',
    ),
    buildCheck(
      'debt_alignment',
      'si se alinearía deuda automáticamente',
      debtAlignmentWarning.wouldAlign ? 'warn' : 'ok',
      debtAlignmentWarning.wouldAlign
        ? `La deuda visible (${debtAlignmentWarning.liveDebtClp.toLocaleString('es-CL')}) no cuadra con la base de cierre (${debtAlignmentWarning.closeDebtClp.toLocaleString('es-CL')}).`
        : 'No se detecta necesidad de alineación automática de deuda.',
    ),
    buildCheck(
      'checkpoint_undo',
      'checkpoint/undo esperado razonable',
      existingClosure ? 'warn' : 'ok',
      existingClosure
        ? 'El código crea checkpoint cloud-first, pero aquí solo podemos marcar overwrite como advertencia operativa.'
        : 'El código de cierre crea checkpoint cloud-first antes de persistir; en runtime debería permitir undo completo si el checkpoint guarda estado completo.',
    ),
  ];

  const warnings = checks
    .filter((check) => check.status !== 'ok')
    .map((check) => `${check.label}: ${check.message}`);

  const hasDataQualityFailure = checks.some((check) =>
    [
      'summary_matches_records',
      'mortgage_sign',
      'property_single',
      'fx_complete',
      'fx_economic_date',
      'fx_selection_current',
      'fx_origin_known',
      'fx_manual_reason',
      'fx_economic_confirmation',
      'fx_manual_confirmation',
      'fx_fallback_confirmation',
      'critical_values',
    ].includes(check.key) &&
    check.status === 'fail',
  );
  const hasSourceTruthFailure = checks.some((check) =>
    ['ui_assets_vs_close', 'ui_amounts_vs_close', 'aggregate_conflicts'].includes(check.key) &&
    check.status === 'fail',
  );

  const decision: MonthlyClosePreflightDecision = hasDataQualityFailure
    ? 'NO_GO_DATA_QUALITY'
    : hasSourceTruthFailure || fillMissingWarning.wouldRun || debtAlignmentWarning.wouldAlign
      ? 'NO_GO_SOURCE_OF_TRUTH_UNCLEAR'
      : 'GO_PARA_CERRAR';

  return {
    candidateMonthKey,
    previousMonthKey: previousClosure?.monthKey || null,
    uiMonthKey: input.uiMonthKey,
    hasExistingClosure: Boolean(existingClosure),
    wouldOverwrite: Boolean(existingClosure),
    decision,
    uiRecordsEquivalent,
    closeTargetRecords,
    closeSummary,
    fxForClose,
    fxContext,
    freshness,
    warnings,
    checks,
    assetRows,
    blockRows,
    checkpointUndoExpectation: existingClosure
      ? 'Overwrite con checkpoint cloud-first esperado, pero requiere revisión manual del riesgo operativo.'
      : 'Checkpoint cloud-first esperado antes del cierre; undo completo probable si el checkpoint guarda estado completo.',
    fillMissingWarning,
    debtAlignmentWarning,
    aggregateCompetitionConflicts,
  };
};
