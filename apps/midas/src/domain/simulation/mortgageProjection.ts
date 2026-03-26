import type { MortgageProjectionStatus, RealEstateInput } from '../model/types';

export type MortgageProjectionPoint = {
  month: number;
  propertyValueCLP: number;
  mortgageDebtCLP: number;
  realEstateEquityCLP: number;
};

export type MortgageProjection = {
  status: MortgageProjectionStatus;
  amortizationUF: number[];
  notes: string[];
};

type AmortizationRow = {
  monthKey: string;
  amortizationUF: number;
};

const AMORTIZATION_CSV = `date,amortizationUF
2026-03,27.7661
2026-04,27.8330
2026-05,27.9001
2026-06,27.9674
2026-07,28.0348
2026-08,28.1024
2026-09,28.1701
2026-10,28.2380
2026-11,28.3061
2026-12,28.3743
2027-01,28.4427
2027-02,28.5113
2027-03,28.5800
2027-04,28.6489
2027-05,28.7179
2027-06,28.7871
2027-07,28.8565
2027-08,28.9260
2027-09,28.9957
2027-10,29.0656
2027-11,29.1356
2027-12,29.2058
2028-01,29.2762
2028-02,29.3467
2028-03,29.4174
2028-04,29.4883
2028-05,29.5593
2028-06,29.6305
2028-07,29.7019
2028-08,29.7734
2028-09,29.8451
2028-10,29.9170
2028-11,29.9890
2028-12,30.0612
2029-01,30.1336
2029-02,30.2061
2029-03,30.2788
2029-04,30.3517
2029-05,30.4247
2029-06,30.4979
2029-07,30.5713
2029-08,30.6448
2029-09,30.7185
2029-10,30.7924
2029-11,30.8664
2029-12,30.9406
2030-01,31.0150
2030-02,31.0895
2030-03,31.1642
2030-04,31.2391
2030-05,31.3141
2030-06,31.3893
2030-07,31.4647
2030-08,31.5402
2030-09,31.6159
2030-10,31.6918
2030-11,31.7678
2030-12,31.8440
2031-01,31.9204
2031-02,31.9969
2031-03,32.0736
2031-04,32.1505
2031-05,32.2275
2031-06,32.3047
2031-07,32.3821
2031-08,32.4596
2031-09,32.5373
2031-10,32.6152
2031-11,32.6932
2031-12,32.7714
2032-01,32.8498
2032-02,32.9283
2032-03,33.0070
2032-04,33.0859
2032-05,33.1649
2032-06,33.2441
2032-07,33.3235
2032-08,33.4030
2032-09,33.4827
2032-10,33.5626
2032-11,33.6426
2032-12,33.7228
2033-01,33.8032
2033-02,33.8837
2033-03,33.9644
2033-04,34.0452
2033-05,34.1262
2033-06,34.2074
2033-07,34.2887
2033-08,34.3702
2033-09,34.4518
2033-10,34.5336
2033-11,34.6156
2033-12,34.6977
2034-01,34.7800
2034-02,34.8624
2034-03,34.9450
2034-04,35.0278
2034-05,35.1107
2034-06,35.1938
2034-07,35.2770
2034-08,35.3604
2034-09,35.4440
2034-10,35.5277
2034-11,35.6116
2034-12,35.6956
2035-01,35.7798
2035-02,35.8642
2035-03,35.9487
2035-04,36.0334
2035-05,36.1182
2035-06,36.2032
2035-07,36.2884
2035-08,36.3737
2035-09,36.4592
2035-10,36.5448
2035-11,36.6306
2035-12,36.7166
2036-01,36.8027
2036-02,36.8890
2036-03,36.9754
2036-04,37.0620
2036-05,37.1487
2036-06,37.2356
2036-07,37.3227
2036-08,37.4099
2036-09,37.4973
2036-10,37.5848
2036-11,37.6725
2036-12,37.7603
2037-01,37.8483
2037-02,37.9365
2037-03,38.0248
2037-04,38.1133
2037-05,38.2019
2037-06,38.2907
2037-07,38.3796
2037-08,38.4687
2037-09,38.5580
2037-10,38.6474
2037-11,38.7369
2037-12,38.8267
2038-01,38.9165
2038-02,39.0066
2038-03,39.0968
2038-04,39.1872
2038-05,39.2777
2038-06,39.3684
2038-07,39.4592
2038-08,39.5502
2038-09,39.6413
2038-10,39.7326
2038-11,39.8240
2038-12,39.9156
2039-01,40.0074
2039-02,40.0993
2039-03,40.1913
2039-04,40.2836
2039-05,40.3759
2039-06,40.4685
2039-07,40.5611
2039-08,40.6540
2039-09,40.7469
2039-10,40.8401
2039-11,40.9333
2039-12,41.0268
2040-01,41.1203
2040-02,41.2141
2040-03,41.3079
2040-04,41.4020
2040-05,41.4961
2040-06,41.5904
2040-07,41.6849
2040-08,41.7794
2040-09,41.8742
2040-10,41.9690
2040-11,42.0640
2040-12,42.1592
2041-01,42.2544
2041-02,42.3499
2041-03,42.4454
2041-04,42.5411
2041-05,42.6369
2041-06,42.7329
2041-07,42.8289
2041-08,42.9251
2041-09,43.0215
2041-10,43.1179
2041-11,43.2146
2041-12,43.3113
2042-01,43.4082
2042-02,43.5052
2042-03,43.6023
2042-04,43.6996
2042-05,43.7970
2042-06,43.8946
2042-07,43.9922
2042-08,44.0901
2042-09,44.1880
2042-10,44.2861
2042-11,44.3843
2042-12,44.4826
2043-01,44.5811
2043-02,44.6797
2043-03,44.7784
2043-04,44.8773
2043-05,44.9762
2043-06,45.0754
2043-07,45.1746
2043-08,45.2740
2043-09,45.3735
2043-10,45.4731
2043-11,45.5729
2043-12,45.6727
2044-01,45.7727
2044-02,45.8729
2044-03,45.9731
2044-04,46.0735
2044-05,46.1740
2044-06,46.2746
2044-07,46.3754
2044-08,46.4762
2044-09,46.5772
2044-10,46.6784
2044-11,46.7796
2044-12,46.8810
2045-01,46.9825
2045-02,47.0841
2045-03,47.1858
2045-04,47.2877
2045-05,47.3896
2045-06,47.4917
2045-07,47.5939
2045-08,47.6963
2045-09,47.7987
2045-10,47.9013
2045-11,48.0040
2045-12,48.1068
2046-01,48.2097
2046-02,48.3128
2046-03,48.4160
`;

const asFiniteOrNull = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseMonthKey = (value: string | undefined | null) => {
  if (!value) return null;
  const trimmed = value.trim();
  const match = /^(\d{4})-(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
  return { year, month, key: `${match[1]}-${match[2]}` };
};

const monthToIndex = (year: number, month: number) => year * 12 + (month - 1);

const indexToMonthKey = (index: number) => {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const monthStr = month < 10 ? `0${month}` : `${month}`;
  return `${year}-${monthStr}`;
};

const addMonths = (monthKey: string, months: number) => {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) return null;
  const index = monthToIndex(parsed.year, parsed.month) + months;
  return indexToMonthKey(index);
};

const parseAmortizationCsv = (csv: string): AmortizationRow[] => {
  const rows = csv.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (rows.length <= 1) return [];
  const result: AmortizationRow[] = [];
  for (let i = 1; i < rows.length; i += 1) {
    const [rawDate, rawValue] = rows[i].split(',').map((cell) => cell.trim());
    const date = parseMonthKey(rawDate);
    const amortizationUF = asFiniteOrNull(rawValue);
    if (!date || amortizationUF === null) continue;
    result.push({ monthKey: date.key, amortizationUF });
  }
  return result;
};

const buildScheduleIndex = (rows: AmortizationRow[]) => {
  const schedule = new Map<number, number>();
  let minIndex: number | null = null;
  let maxIndex: number | null = null;
  for (const row of rows) {
    const parsed = parseMonthKey(row.monthKey);
    if (!parsed) continue;
    const idx = monthToIndex(parsed.year, parsed.month);
    schedule.set(idx, row.amortizationUF);
    if (minIndex === null || idx < minIndex) minIndex = idx;
    if (maxIndex === null || idx > maxIndex) maxIndex = idx;
  }
  return { schedule, minIndex, maxIndex };
};

export function buildMortgageProjection(
  input: RealEstateInput | undefined,
  horizonMonths: number,
  options?: { csvOverride?: string },
): MortgageProjection {
  const notes: string[] = [];
  const horizon = Math.max(0, Math.floor(horizonMonths));
  const amortizationUF = Array.from({ length: horizon }, () => 0);

  const equityCLP = asFiniteOrNull(input?.realEstateEquityCLP);
  const ufSnapshotCLP = asFiniteOrNull(input?.ufSnapshotCLP);
  const snapshotMonth = typeof input?.snapshotMonth === 'string' ? input?.snapshotMonth.trim() : '';
  if (equityCLP === null || equityCLP < 0) notes.push('mortgage-uf-missing-equity');
  if (!ufSnapshotCLP || ufSnapshotCLP <= 0) notes.push('mortgage-uf-missing-uf');
  if (!snapshotMonth) notes.push('mortgage-uf-missing-snapshot-month');
  if (notes.length > 0) {
    notes.push('mortgage-uf-missing-inputs');
    return {
      status: 'fallback_incomplete',
      amortizationUF,
      notes,
    };
  }

  const rows = parseAmortizationCsv(options?.csvOverride ?? AMORTIZATION_CSV);
  if (rows.length === 0) {
    return {
      status: 'fallback_incomplete',
      amortizationUF,
      notes: ['mortgage-uf-empty-table'],
    };
  }

  const { schedule, minIndex, maxIndex } = buildScheduleIndex(rows);
  if (minIndex === null || maxIndex === null) {
    return {
      status: 'fallback_incomplete',
      amortizationUF,
      notes: ['mortgage-uf-invalid-table'],
    };
  }

  const expectedFirst = addMonths(snapshotMonth, 1);
  if (expectedFirst && indexToMonthKey(minIndex) !== expectedFirst) {
    notes.push(`warn-and-run:amortization-first-month-mismatch:${indexToMonthKey(minIndex)}:${expectedFirst}`);
  }

  const snapshotParsed = parseMonthKey(snapshotMonth);
  if (!snapshotParsed) {
    return {
      status: 'fallback_incomplete',
      amortizationUF,
      notes: ['mortgage-uf-invalid-snapshot-month'],
    };
  }

  const snapshotIndex = monthToIndex(snapshotParsed.year, snapshotParsed.month);
  let lastValue: number | null = null;
  let missingCount = 0;
  let missingFirst: string | null = null;
  let missingLast: string | null = null;
  let usedNextCount = 0;
  let tableEnded = false;

  for (let t = 0; t < horizon; t += 1) {
    const currentIndex = snapshotIndex + t + 1;
    if (currentIndex > maxIndex) {
      amortizationUF[t] = 0;
      if (!tableEnded) {
        notes.push(`warn-and-run:amortization-ended:${indexToMonthKey(currentIndex)}`);
        tableEnded = true;
      }
      continue;
    }

    const direct = schedule.get(currentIndex);
    if (direct !== undefined) {
      amortizationUF[t] = direct;
      lastValue = direct;
      continue;
    }

    missingCount += 1;
    const currentKey = indexToMonthKey(currentIndex);
    missingFirst = missingFirst ?? currentKey;
    missingLast = currentKey;

    if (lastValue !== null) {
      amortizationUF[t] = lastValue;
      continue;
    }

    let nextValue: number | null = null;
    for (let idx = currentIndex + 1; idx <= maxIndex; idx += 1) {
      const maybe = schedule.get(idx);
      if (maybe !== undefined) {
        nextValue = maybe;
        break;
      }
    }
    if (nextValue !== null) {
      amortizationUF[t] = nextValue;
      usedNextCount += 1;
      continue;
    }

    amortizationUF[t] = 0;
  }

  if (missingCount > 0) {
    notes.push(
      `warn-and-run:amortization-missing-months:${missingCount}:${missingFirst ?? ''}:${missingLast ?? ''}:${usedNextCount}`,
    );
  }

  notes.push('mortgage-uf-schedule');
  return {
    status: 'uf_schedule',
    amortizationUF,
    notes,
  };
}
