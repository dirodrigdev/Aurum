export type RiskCapitalProfile = 'conservative' | 'base' | 'aggressive';

type RiskCapitalProfileConfig = {
  betaToRvGlobalFx: number;
  driftAdjAnnual: number;
  idioVolAnnual: number;
  jumpProbMonthly: number;
  jumpDrawdown: number;
};

const RISK_CAPITAL_PROFILE_CONFIG: Record<RiskCapitalProfile, RiskCapitalProfileConfig> = {
  conservative: {
    betaToRvGlobalFx: 0.9,
    driftAdjAnnual: -0.08,
    idioVolAnnual: 0.55,
    jumpProbMonthly: 0.03,
    jumpDrawdown: -0.30,
  },
  base: {
    betaToRvGlobalFx: 1.05,
    driftAdjAnnual: -0.06,
    idioVolAnnual: 0.70,
    jumpProbMonthly: 0.04,
    jumpDrawdown: -0.40,
  },
  aggressive: {
    betaToRvGlobalFx: 1.2,
    driftAdjAnnual: -0.03,
    idioVolAnnual: 0.85,
    jumpProbMonthly: 0.05,
    jumpDrawdown: -0.50,
  },
};

function randn(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function resolveRiskCapitalProfile(value: unknown): RiskCapitalProfile {
  if (value === 'conservative' || value === 'aggressive') return value;
  return 'base';
}

export function computeRiskCapitalMonthlyReturn(
  rvGlobalFxReturn: number,
  profile: RiskCapitalProfile,
  rng: () => number,
): number {
  const cfg = RISK_CAPITAL_PROFILE_CONFIG[profile];
  const idioShock = randn(rng) * (cfg.idioVolAnnual / Math.sqrt(12));
  const driftAdj = cfg.driftAdjAnnual / 12;
  const jumpShock = rng() < cfg.jumpProbMonthly ? cfg.jumpDrawdown : 0;
  const raw = (cfg.betaToRvGlobalFx * rvGlobalFxReturn) + driftAdj + idioShock + jumpShock;
  return Math.max(-0.95, Math.min(2.0, raw));
}
