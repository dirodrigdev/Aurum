import assert from 'node:assert/strict';
import {
  buildDecisionComparisonTable,
  buildEquivalenceThresholds,
  compareIndicatorDifference,
  computeIndicatorEquivalence,
} from './indicatorEquivalence';

{
  const rowA = {
    qasrStrict: 0.9155,
    csr85_4: 0.814,
    classicSuccessRate: 0.925,
    probRuin: 0.075,
    monthsInSevereCutMean: 26,
    maxConsecutiveSevereCutMonthsP75: 20,
    terminalWealthP25: 100,
    terminalWealthP50: 200,
    houseSaleRate: 0.3,
    severeCutMonthsDuringHouseSale: 3,
  };
  const rowB = { ...rowA, qasrStrict: 0.9127 };
  const eq = computeIndicatorEquivalence(rowA, rowB, 3000, 480);
  assert.equal(eq.qasr.equivalent, true);
}

{
  const rowA = {
    qasrStrict: 0.9155,
    csr85_4: 0.814,
    classicSuccessRate: 0.925,
    probRuin: 0.075,
    monthsInSevereCutMean: 26,
    maxConsecutiveSevereCutMonthsP75: 20,
    terminalWealthP25: 100,
    terminalWealthP50: 200,
    houseSaleRate: 0.3,
    severeCutMonthsDuringHouseSale: 3,
  };
  const rowB = { ...rowA, qasrStrict: 0.909 };
  const eq = computeIndicatorEquivalence(rowA, rowB, 3000, 480);
  assert.equal(eq.qasr.equivalent, false);
}

{
  const thresholds = buildEquivalenceThresholds(3000, {
    qasrStrict: 0.91,
    csr85_4: 0.81,
    classicSuccessRate: 0.92,
    probRuin: 0.08,
    monthsInSevereCutMean: 25,
    maxConsecutiveSevereCutMonthsP75: 20,
    terminalWealthP25: 1,
    terminalWealthP50: 1,
    houseSaleRate: 0.3,
    severeCutMonthsDuringHouseSale: 2,
  }, {
    qasrStrict: 0.91,
    csr85_4: 0.80,
    classicSuccessRate: 0.91,
    probRuin: 0.09,
    monthsInSevereCutMean: 25,
    maxConsecutiveSevereCutMonthsP75: 20,
    terminalWealthP25: 1,
    terminalWealthP50: 1,
    houseSaleRate: 0.3,
    severeCutMonthsDuringHouseSale: 2,
  });
  assert.equal(thresholds.csrProbAbs >= 0.02, true);
  assert.equal(thresholds.successProbAbs >= 0.02, true);
}

{
  const eq = compareIndicatorDifference(24, 26.5, 3);
  assert.equal(eq.equivalent, true);
  const neq = compareIndicatorDifference(24, 28, 3);
  assert.equal(neq.equivalent, false);
}

{
  const table = buildDecisionComparisonTable([
    {
      candidateId: 'a',
      mixLabel: 'RV 25 / RF 75',
      rvReal: 0.25,
      rfReal: 0.75,
      effectiveReturn: 0.03,
      maxSpendScalePassingQoL: 1.2,
      scale100: {
        qasrStrict: 0.915,
        csr85_4: 0.88,
        classicSuccessRate: 0.92,
        probRuin: 0.08,
        monthsInSevereCutMean: 25,
        maxConsecutiveSevereCutMonthsP75: 20,
        terminalWealthP25: 1_000,
        terminalWealthP50: 5_000,
        houseSaleRate: 0.4,
        severeCutMonthsDuringHouseSale: 2,
      },
      scale120: {
        qasrStrict: 0.90,
        csr85_4: 0.86,
        classicSuccessRate: 0.90,
        probRuin: 0.10,
        monthsInSevereCutMean: 30,
        maxConsecutiveSevereCutMonthsP75: 21,
        terminalWealthP25: 500,
        terminalWealthP50: 2_500,
        houseSaleRate: 0.5,
        severeCutMonthsDuringHouseSale: 2,
      },
      scale130: {
        qasrStrict: 0.89,
        csr85_4: 0.84,
        classicSuccessRate: 0.88,
        probRuin: 0.12,
        monthsInSevereCutMean: 34,
        maxConsecutiveSevereCutMonthsP75: 23,
        terminalWealthP25: 400,
        terminalWealthP50: 2_100,
        houseSaleRate: 0.6,
        severeCutMonthsDuringHouseSale: 3,
      },
    },
    {
      candidateId: 'b',
      mixLabel: 'RV 80 / RF 20',
      rvReal: 0.8,
      rfReal: 0.2,
      effectiveReturn: 0.06,
      maxSpendScalePassingQoL: 1.3,
      scale100: {
        qasrStrict: 0.913,
        csr85_4: 0.875,
        classicSuccessRate: 0.915,
        probRuin: 0.085,
        monthsInSevereCutMean: 26,
        maxConsecutiveSevereCutMonthsP75: 20,
        terminalWealthP25: 10_000,
        terminalWealthP50: 50_000,
        houseSaleRate: 0.2,
        severeCutMonthsDuringHouseSale: 1,
      },
      scale120: {
        qasrStrict: 0.905,
        csr85_4: 0.87,
        classicSuccessRate: 0.905,
        probRuin: 0.095,
        monthsInSevereCutMean: 27,
        maxConsecutiveSevereCutMonthsP75: 20,
        terminalWealthP25: 9_000,
        terminalWealthP50: 45_000,
        houseSaleRate: 0.2,
        severeCutMonthsDuringHouseSale: 1,
      },
      scale130: {
        qasrStrict: 0.902,
        csr85_4: 0.86,
        classicSuccessRate: 0.90,
        probRuin: 0.10,
        monthsInSevereCutMean: 28,
        maxConsecutiveSevereCutMonthsP75: 20,
        terminalWealthP25: 8_000,
        terminalWealthP50: 40_000,
        houseSaleRate: 0.2,
        severeCutMonthsDuringHouseSale: 1,
      },
    },
  ], { horizonMonths: 480, nSim: 3000 });
  assert.equal(table.rows.length, 2);
  assert.equal(table.rows.some((row) => row.severeCutPctBase !== null), true);
  assert.equal(table.rows[0].decisionScorePreview !== null, true);
  assert.equal(table.rows[0].scoreRank >= 1, true);
  const rowA = table.rows.find((row) => row.candidateId === 'a');
  const rowB = table.rows.find((row) => row.candidateId === 'b');
  assert.equal(Boolean(rowA && rowB), true);
  assert.equal(rowA!.headroomScore! < rowB!.headroomScore!, true);
}

{
  const table = buildDecisionComparisonTable([
    {
      candidateId: 'low_qol_high_terminal',
      mixLabel: 'RV 100 / RF 0',
      rvReal: 1,
      rfReal: 0,
      effectiveReturn: 0.08,
      maxSpendScalePassingQoL: null,
      scale100: {
        qasrStrict: 0.85,
        csr85_4: 0.70,
        classicSuccessRate: 0.85,
        probRuin: 0.15,
        monthsInSevereCutMean: 45,
        maxConsecutiveSevereCutMonthsP75: 30,
        terminalWealthP25: 100_000,
        terminalWealthP50: 300_000,
        houseSaleRate: 0.1,
        severeCutMonthsDuringHouseSale: 1,
      },
      scale120: {
        qasrStrict: 0.70,
        csr85_4: 0.50,
        classicSuccessRate: 0.70,
        probRuin: 0.30,
        monthsInSevereCutMean: 60,
        maxConsecutiveSevereCutMonthsP75: 35,
        terminalWealthP25: 50_000,
        terminalWealthP50: 200_000,
        houseSaleRate: 0.2,
        severeCutMonthsDuringHouseSale: 1,
      },
      scale130: {
        qasrStrict: 0.60,
        csr85_4: 0.40,
        classicSuccessRate: 0.60,
        probRuin: 0.40,
        monthsInSevereCutMean: 70,
        maxConsecutiveSevereCutMonthsP75: 40,
        terminalWealthP25: 30_000,
        terminalWealthP50: 150_000,
        houseSaleRate: 0.3,
        severeCutMonthsDuringHouseSale: 1,
      },
    },
    {
      candidateId: 'good_qol_medium_terminal',
      mixLabel: 'RV 25 / RF 75',
      rvReal: 0.25,
      rfReal: 0.75,
      effectiveReturn: 0.03,
      maxSpendScalePassingQoL: 1.2,
      scale100: {
        qasrStrict: 0.92,
        csr85_4: 0.86,
        classicSuccessRate: 0.93,
        probRuin: 0.07,
        monthsInSevereCutMean: 24,
        maxConsecutiveSevereCutMonthsP75: 18,
        terminalWealthP25: 2_000,
        terminalWealthP50: 6_000,
        houseSaleRate: 0.5,
        severeCutMonthsDuringHouseSale: 2,
      },
      scale120: {
        qasrStrict: 0.90,
        csr85_4: 0.85,
        classicSuccessRate: 0.91,
        probRuin: 0.09,
        monthsInSevereCutMean: 28,
        maxConsecutiveSevereCutMonthsP75: 20,
        terminalWealthP25: 1_500,
        terminalWealthP50: 4_500,
        houseSaleRate: 0.6,
        severeCutMonthsDuringHouseSale: 2,
      },
      scale130: {
        qasrStrict: 0.89,
        csr85_4: 0.83,
        classicSuccessRate: 0.89,
        probRuin: 0.11,
        monthsInSevereCutMean: 33,
        maxConsecutiveSevereCutMonthsP75: 23,
        terminalWealthP25: 1_200,
        terminalWealthP50: 3_800,
        houseSaleRate: 0.7,
        severeCutMonthsDuringHouseSale: 2,
      },
    },
  ], { horizonMonths: 480, nSim: 3000 });
  assert.equal(table.winnerByDecisionScoreCandidateId, 'good_qol_medium_terminal');
}

{
  const left = buildDecisionComparisonTable([
    {
      candidateId: 'x1',
      mixLabel: 'RV 50 / RF 50',
      rvReal: 0.5,
      rfReal: 0.5,
      effectiveReturn: 0.04,
      maxSpendScalePassingQoL: 1.2,
      scale100: {
        qasrStrict: 0.91,
        csr85_4: 0.85,
        classicSuccessRate: 0.91,
        probRuin: 0.09,
        monthsInSevereCutMean: 25,
        maxConsecutiveSevereCutMonthsP75: 20,
        terminalWealthP25: 5_000,
        terminalWealthP50: 8_000,
        houseSaleRate: 0.1,
        severeCutMonthsDuringHouseSale: 3,
      },
      scale120: {
        qasrStrict: 0.9,
        csr85_4: 0.84,
        classicSuccessRate: 0.90,
        probRuin: 0.10,
        monthsInSevereCutMean: 28,
        maxConsecutiveSevereCutMonthsP75: 21,
        terminalWealthP25: 4_000,
        terminalWealthP50: 7_000,
        houseSaleRate: 0.1,
        severeCutMonthsDuringHouseSale: 3,
      },
      scale130: {
        qasrStrict: 0.88,
        csr85_4: 0.82,
        classicSuccessRate: 0.89,
        probRuin: 0.11,
        monthsInSevereCutMean: 31,
        maxConsecutiveSevereCutMonthsP75: 22,
        terminalWealthP25: 3_000,
        terminalWealthP50: 6_000,
        houseSaleRate: 0.1,
        severeCutMonthsDuringHouseSale: 3,
      },
    },
  ], { horizonMonths: 480, nSim: 3000 }).rows[0].decisionScorePreview;
  const right = buildDecisionComparisonTable([
    {
      candidateId: 'x2',
      mixLabel: 'RV 50 / RF 50',
      rvReal: 0.5,
      rfReal: 0.5,
      effectiveReturn: 0.04,
      maxSpendScalePassingQoL: 1.2,
      scale100: {
        qasrStrict: 0.91,
        csr85_4: 0.85,
        classicSuccessRate: 0.91,
        probRuin: 0.09,
        monthsInSevereCutMean: 25,
        maxConsecutiveSevereCutMonthsP75: 20,
        terminalWealthP25: 5_000,
        terminalWealthP50: 8_000,
        houseSaleRate: 0.9,
        severeCutMonthsDuringHouseSale: 3,
      },
      scale120: {
        qasrStrict: 0.9,
        csr85_4: 0.84,
        classicSuccessRate: 0.90,
        probRuin: 0.10,
        monthsInSevereCutMean: 28,
        maxConsecutiveSevereCutMonthsP75: 21,
        terminalWealthP25: 4_000,
        terminalWealthP50: 7_000,
        houseSaleRate: 0.9,
        severeCutMonthsDuringHouseSale: 3,
      },
      scale130: {
        qasrStrict: 0.88,
        csr85_4: 0.82,
        classicSuccessRate: 0.89,
        probRuin: 0.11,
        monthsInSevereCutMean: 31,
        maxConsecutiveSevereCutMonthsP75: 22,
        terminalWealthP25: 3_000,
        terminalWealthP50: 6_000,
        houseSaleRate: 0.9,
        severeCutMonthsDuringHouseSale: 3,
      },
    },
  ], { horizonMonths: 480, nSim: 3000 }).rows[0].decisionScorePreview;
  assert.equal(left, right);
}

console.log('indicatorEquivalence tests passed');
