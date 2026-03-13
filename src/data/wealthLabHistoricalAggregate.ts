export type WealthLabExternalAggregatePoint = {
  usdClp: number;
  usdWithRisk: number;
  clpWithRisk: number;
  usdWithoutRisk: number;
  clpWithoutRisk: number;
  source: 'external_series';
};

export const WEALTH_LAB_EXTERNAL_AGGREGATE: Record<string, WealthLabExternalAggregatePoint> = {
  '2023-05': { usdClp: 790.0, usdWithRisk: 418138.0, clpWithRisk: 1092606615.0, usdWithoutRisk: 362338.0, clpWithoutRisk: 1027106615.0, source: 'external_series' },
  '2023-06': { usdClp: 793.0, usdWithRisk: 385484.0, clpWithRisk: 1129961296.0, usdWithoutRisk: 335429.0, clpWithoutRisk: 1070877780.0, source: 'external_series' },
  '2023-07': { usdClp: 810.0, usdWithRisk: 399623.0, clpWithRisk: 1153722687.6, usdWithoutRisk: 339286.0, clpWithoutRisk: 1083209763.6, source: 'external_series' },
  '2023-08': { usdClp: 865.0, usdWithRisk: 396553.73869565217, clpWithRisk: 1169585969.0, usdWithoutRisk: 340543.73869565217, clpWithoutRisk: 1106045969.0, source: 'external_series' },
  '2023-09': { usdClp: 893.0, usdWithRisk: 387455.2, clpWithRisk: 1184923435.8815765, usdWithoutRisk: 331944.2, clpWithoutRisk: 1119604398.8815765, source: 'external_series' },
  '2023-10': { usdClp: 937.0, usdWithRisk: 375295.1, clpWithRisk: 1216310794.0, usdWithoutRisk: 308295.1, clpWithoutRisk: 1131310794.0, source: 'external_series' },
  '2023-11': { usdClp: 887.0, usdWithRisk: 377137.5272897196, clpWithRisk: 1216351718.0, usdWithoutRisk: 307337.5272897196, clpWithoutRisk: 1125051718.0, source: 'external_series' },
  '2023-12': { usdClp: 870.0, usdWithRisk: 390214.593, clpWithRisk: 1232909648.0, usdWithoutRisk: 314294.593, clpWithoutRisk: 1133998648.0, source: 'external_series' },
  '2024-01': { usdClp: 909.0, usdWithRisk: 394522.88999999996, clpWithRisk: 1269356922.0, usdWithoutRisk: 315699.88999999996, clpWithoutRisk: 1160356922.0, source: 'external_series' },
  '2024-02': { usdClp: 957.0, usdWithRisk: 402136.0904, clpWithRisk: 1343862541.502153, usdWithoutRisk: 310105.0904, clpWithoutRisk: 1209978938.502153, source: 'external_series' },
  '2024-03': { usdClp: 963.0, usdWithRisk: 423955.9757, clpWithRisk: 1390100037.0, usdWithoutRisk: 305518.9757, clpWithoutRisk: 1216623297.0, source: 'external_series' },
  '2024-04': { usdClp: 955.0, usdWithRisk: 412333.92110000004, clpWithRisk: 1383259445.0, usdWithoutRisk: 302053.92110000004, clpWithoutRisk: 1221674373.0, source: 'external_series' },
  '2024-05': { usdClp: 906.0, usdWithRisk: 419996.9432, clpWithRisk: 1373350493.0, usdWithoutRisk: 301511.9432, clpWithoutRisk: 1207312593.0, source: 'external_series' },
  '2024-06': { usdClp: 937.0, usdWithRisk: 408487.54000000004, clpWithRisk: 1376180500.0, usdWithoutRisk: 298129.54000000004, clpWithoutRisk: 1213840500.0, source: 'external_series' },
  '2024-07': { usdClp: 946.5, usdWithRisk: 412545.7836, clpWithRisk: 1399522029.0, usdWithoutRisk: 299305.7836, clpWithoutRisk: 1233870967.0, source: 'external_series' },
  '2024-08': { usdClp: 930.0, usdWithRisk: 396372.40520000004, clpWithRisk: 1396190664.0, usdWithoutRisk: 287130.40520000004, clpWithoutRisk: 1241258896.0, source: 'external_series' },
  '2024-09': { usdClp: 922.0, usdWithRisk: 393894.4617, clpWithRisk: 1400198199.0, usdWithoutRisk: 285923.4617, clpWithoutRisk: 1245198199.0, source: 'external_series' },
  '2024-10': { usdClp: 949.0, usdWithRisk: 392895.7406126126, clpWithRisk: 1433337248.0, usdWithoutRisk: 280561.7406126126, clpWithoutRisk: 1268954040.0, source: 'external_series' },
  '2024-11': { usdClp: 976.2, usdWithRisk: 428431.1579245283, clpWithRisk: 1526384850.0, usdWithoutRisk: 269489.1579245283, clpWithoutRisk: 1277834850.0, source: 'external_series' },
  '2024-12': { usdClp: 989.0, usdWithRisk: 431169.04, clpWithRisk: 1541933312.0, usdWithoutRisk: 259214.03999999998, clpWithoutRisk: 1282127595.0, source: 'external_series' },
  '2025-01': { usdClp: 982.0, usdWithRisk: 430903.70999999996, clpWithRisk: 1573038243.0, usdWithoutRisk: 245809.70999999996, clpWithoutRisk: 1300835384.0, source: 'external_series' },
  '2025-02': { usdClp: 942.0, usdWithRisk: 336331.1, clpWithRisk: 1605285187.0, usdWithoutRisk: 165864.09999999998, clpWithoutRisk: 1365032038.0, source: 'external_series' },
  '2025-03': { usdClp: 923.0, usdWithRisk: 285680.96, clpWithRisk: 1556362881.0, usdWithoutRisk: 136034.96000000002, clpWithoutRisk: 1353821915.0, source: 'external_series' },
  '2025-04': { usdClp: 943.0, usdWithRisk: 298578.72, clpWithRisk: 1569639934.0, usdWithoutRisk: 138119.71999999997, clpWithoutRisk: 1349552112.0, source: 'external_series' },
  '2025-05': { usdClp: 935.0, usdWithRisk: 318440.43200000003, clpWithRisk: 1657122590.0, usdWithoutRisk: 132259.43200000003, clpWithoutRisk: 1398124346.0, source: 'external_series' },
  '2025-06': { usdClp: 934.0, usdWithRisk: 342304.715, clpWithRisk: 1636609740.0, usdWithoutRisk: 128619.71500000003, clpWithoutRisk: 1415423353.0, source: 'external_series' },
  '2025-07': { usdClp: 957.0, usdWithRisk: 389332.38, clpWithRisk: 1708145514.0, usdWithoutRisk: 125756.38, clpWithoutRisk: 1467178756.0, source: 'external_series' },
  '2025-08': { usdClp: 961.0, usdWithRisk: 372712.39, clpWithRisk: 1730680221.0, usdWithoutRisk: 124724.39000000001, clpWithoutRisk: 1501804471.0, source: 'external_series' },
  '2025-09': { usdClp: 961.0, usdWithRisk: 376017.15597294486, clpWithRisk: 1751733941.0, usdWithoutRisk: 117751.15597294486, clpWithoutRisk: 1520577912.0, source: 'external_series' },
  '2025-10': { usdClp: 940.0, usdWithRisk: 364974.6, clpWithRisk: 1776996938.0, usdWithoutRisk: 105610.59999999998, clpWithoutRisk: 1529268682.0, source: 'external_series' },
  '2025-11': { usdClp: 929.0, usdWithRisk: 310856.55, clpWithRisk: 1697645293.0, usdWithoutRisk: 105139.54999999999, clpWithoutRisk: 1522394589.0, source: 'external_series' },
  '2025-12': { usdClp: 909.0, usdWithRisk: 303489.4, clpWithRisk: 1689397805.0, usdWithoutRisk: 104216.40000000002, clpWithoutRisk: 1524136381.0, source: 'external_series' },
  '2026-01': { usdClp: 865.0, usdWithRisk: 278279.6, clpWithRisk: 1659167103.0, usdWithoutRisk: 103554.59999999998, clpWithoutRisk: 1520958402.0, source: 'external_series' },
  '2026-02': { usdClp: 873.0, usdWithRisk: 242621.6, clpWithRisk: 1654658111.4, usdWithoutRisk: 97326.6, clpWithoutRisk: 1539115267.4, source: 'external_series' },
  '2026-03': { usdClp: 873.0, usdWithRisk: 243487.9985, clpWithRisk: 1660564885.2307997, usdWithoutRisk: 97611.8185, clpWithoutRisk: 1544559869.8547997, source: 'external_series' },
};
