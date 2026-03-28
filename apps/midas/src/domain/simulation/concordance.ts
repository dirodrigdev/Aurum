export type RuinZone = 'low' | 'moderate' | 'delicate' | 'high';
export type ConcordanceStatus = 'green' | 'yellow' | 'red';

export type ConcordanceReport = {
  status: ConcordanceStatus;
  diffAbsPp: number;
  centralZone: RuinZone;
  controlZone: RuinZone;
};

const ZONE_ORDER: RuinZone[] = ['low', 'moderate', 'delicate', 'high'];

export function classifyRuinZone(probRuin: number): RuinZone {
  if (probRuin < 0.10) return 'low';
  if (probRuin < 0.20) return 'moderate';
  if (probRuin < 0.35) return 'delicate';
  return 'high';
}

function zoneDistance(a: RuinZone, b: RuinZone): number {
  return Math.abs(ZONE_ORDER.indexOf(a) - ZONE_ORDER.indexOf(b));
}

export function evaluateConcordance(
  centralProbRuin: number,
  controlProbRuin: number,
): ConcordanceReport {
  const centralZone = classifyRuinZone(centralProbRuin);
  const controlZone = classifyRuinZone(controlProbRuin);
  const diffAbsPp = Math.abs(centralProbRuin - controlProbRuin) * 100;
  const distance = zoneDistance(centralZone, controlZone);

  if (diffAbsPp > 7 || distance > 1) {
    return { status: 'red', diffAbsPp, centralZone, controlZone };
  }
  if ((diffAbsPp >= 3 && diffAbsPp <= 7) || distance === 1) {
    return { status: 'yellow', diffAbsPp, centralZone, controlZone };
  }
  return { status: 'green', diffAbsPp, centralZone, controlZone };
}
