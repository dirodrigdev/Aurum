// preprocessData.ts
// Pre-procesamiento log-aditivo del dataset histórico.
// Recentra los retornos a expectativas forward-looking
// preservando exactamente la volatilidad y la secuencia de crisis.
//
// Método: r_nuevo = exp(ln(1 + r_hist) - mu_hist_m + mu_fwd_m) - 1
// Donde mu son medias mensuales en log-space.
//
// Validado numéricamente: vol preservada al 100%, retorno ajustado exacto.

export interface ForwardReturnTargets {
  rvGlobal:    number; // retorno anual forward RV Global
  rfGlobal:    number; // retorno anual forward RF Global
  rvChile:     number; // retorno anual forward RV Chile blend
  rfChileReal: number; // retorno anual forward RF Chile real / UF
  ipcChile:    number; // inflacion Chile anual forward
  clpUsdDrift: number; // drift anual CLP/USD forward
}

// Targets calibrados - consenso Claude + ChatGPT + DeepSeek + Gemini
// Indices del array loadHistoricalData():
// [0]=rvg, [1]=rfg, [2]=sura, [3]=afp, [4]=rfcl_uf_real, [5]=ipc, [6]=hicp, [7]=dCLPUSD, [8]=dEURUSD
export const DEFAULT_FORWARD_TARGETS: ForwardReturnTargets = {
  rvGlobal:    0.065,
  rfGlobal:    0.0305,
  rvChile:     0.075,
  // Esta serie historica representa retorno real / UF.
  // El target debe permanecer en terminos reales para ser consistente
  // con rfChileUFAnnual y con el ajuste nominal posterior dentro del motor.
  rfChileReal: 0.0102,
  ipcChile:    0.038,
  clpUsdDrift: 0.020,
};

/**
 * Aplica ajuste log-aditivo a una columna del dataset.
 * Preserva volatilidad y estructura temporal exactamente.
 */
function adjustColumn(
  col: number[],
  targetAnnual: number,
): number[] {
  const logReturns = col.map(r => Math.log1p(r));
  const muHistM = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
  const muFwdM = Math.log1p(targetAnnual) / 12;
  const delta = muFwdM - muHistM;
  return logReturns.map(lr => Math.expm1(lr + delta));
}

function adjustChileBlendColumns(
  sura: number[],
  afp: number[],
  targetAnnual: number,
): [number[], number[]] {
  const blendLogs = sura.map((_, i) => Math.log1p((0.55 * sura[i]) + (0.45 * afp[i])));
  const muHistM = blendLogs.reduce((a, b) => a + b, 0) / blendLogs.length;
  const muFwdM = Math.log1p(targetAnnual) / 12;
  const delta = muFwdM - muHistM;
  return [
    sura.map(r => Math.expm1(Math.log1p(r) + delta)),
    afp.map(r => Math.expm1(Math.log1p(r) + delta)),
  ];
}

/**
 * Pre-procesa el dataset completo aplicando ajustes forward-looking.
 * Llamar ANTES del bootstrap, no dentro del loop de simulacion.
 */
export function preprocessHistoricalData(
  data: number[][],
  targets: ForwardReturnTargets = DEFAULT_FORWARD_TARGETS,
): number[][] {
  const cols = Array.from({ length: 9 }, (_, i) => data.map(row => row[i]));
  const [suraAdjusted, afpAdjusted] = adjustChileBlendColumns(cols[2], cols[3], targets.rvChile);

  const adjusted = [
    adjustColumn(cols[0], targets.rvGlobal),
    adjustColumn(cols[1], targets.rfGlobal),
    suraAdjusted,
    afpAdjusted,
    // row[4] es r_RFcl_UF: retorno real / UF del sleeve chileno defensivo.
    // Se ajusta con un target real, no nominal.
    adjustColumn(cols[4], targets.rfChileReal),
    adjustColumn(cols[5], targets.ipcChile),
    cols[6],
    adjustColumn(cols[7], targets.clpUsdDrift),
    cols[8],
  ];

  return data.map((_, i) => adjusted.map(col => col[i]));
}
