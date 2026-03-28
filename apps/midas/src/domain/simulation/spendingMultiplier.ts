import type { SpendingRule } from '../model/types';

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function getSpendingTarget(
  cnt15: number,
  cnt25: number,
  rule: SpendingRule,
): number {
  if (cnt25 >= rule.consecutiveMonths) return clamp01(rule.hardCut);
  if (cnt15 >= rule.consecutiveMonths) return clamp01(rule.softCut);
  return 1;
}

export function updateSpendingMultiplier(
  current: number,
  target: number,
  rule: SpendingRule,
): number {
  const cutAlpha = clamp01(rule.adjustmentAlpha);
  const recoveryAlpha = clamp01(rule.recoveryAlpha ?? 0.8);
  const alpha = target > current ? recoveryAlpha : cutAlpha;
  return clamp01(current + alpha * (target - current));
}
