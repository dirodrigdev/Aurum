export type SimulationResultDigestMetrics = {
  success40: number | null;
  ruin40: number | null;
  houseSalePct: number | null;
  maxDrawdownP50: number | null;
};

export type SimulationResultDigestSource = {
  success40?: number | null;
  ruin40?: number | null;
  houseSalePct?: number | null;
  maxDrawdownP50?: number | null;
  nTotal?: number | null;
  maxDrawdownPercentiles?: Record<number | string, number> | null;
  probRuin?: number | null;
  probRuin40?: number | null;
};

export type SimulationResultDiagnostics = {
  resultDigest: string | null;
  resultInputHash: string | null;
  resultSeed: number | null;
  resultNSim: number | null;
  success40: number | null;
  ruin40: number | null;
  houseSalePct: number | null;
  maxDrawdownP50: number | null;
  completedAt: string | null;
  engineVersion: string;
  workerVersion: string;
  resultPathCount: number | null;
  isFinalForCurrentInput: boolean;
  previousResultDigest: string | null;
  previousResultInputHash: string | null;
  provisionalResultShownBeforeFinal: boolean;
};

export type BuildSimulationResultDiagnosticsInput = {
  result: SimulationResultDigestSource | null;
  resultInputHash: string | null;
  effectiveEngineInputHash: string | null;
  resultSeed: number | null;
  expectedSeed: number | null;
  resultNSim: number | null;
  expectedNSim: number | null;
  completedAt: string | null;
  simulationRunStatus: string;
  resultMetricsAvailable: boolean;
  lastRunInputHash: string | null;
  lastRenderedResultHash: string | null;
  engineVersion?: string;
  workerVersion?: string;
  previousResultDigest?: string | null;
  previousResultInputHash?: string | null;
  provisionalResultShownBeforeFinal?: boolean;
};

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rightRotate(value: number, shift: number) {
  return (value >>> shift) | (value << (32 - shift));
}

function sha256Hex(input: string): string {
  const bytes = Array.from(new TextEncoder().encode(input));
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while ((bytes.length % 64) !== 56) bytes.push(0);
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  bytes.push((high >>> 24) & 0xff, (high >>> 16) & 0xff, (high >>> 8) & 0xff, high & 0xff);
  bytes.push((low >>> 24) & 0xff, (low >>> 16) & 0xff, (low >>> 8) & 0xff, low & 0xff);

  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];

  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words = new Array<number>(64).fill(0);
    for (let idx = 0; idx < 16; idx += 1) {
      const base = offset + idx * 4;
      words[idx] =
        ((bytes[base] << 24) | (bytes[base + 1] << 16) | (bytes[base + 2] << 8) | bytes[base + 3]) >>> 0;
    }
    for (let idx = 16; idx < 64; idx += 1) {
      const s0 = rightRotate(words[idx - 15], 7) ^ rightRotate(words[idx - 15], 18) ^ (words[idx - 15] >>> 3);
      const s1 = rightRotate(words[idx - 2], 17) ^ rightRotate(words[idx - 2], 19) ^ (words[idx - 2] >>> 10);
      words[idx] = (words[idx - 16] + s0 + words[idx - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let idx = 0; idx < 64; idx += 1) {
      const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + SHA256_K[idx] + words[idx]) >>> 0;
      const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }

  return hash.map((part) => part.toString(16).padStart(8, '0')).join('');
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => typeof entryValue !== 'undefined')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`);
  return `{${entries.join(',')}}`;
}

function normalizeNumber(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Number(value.toFixed(12));
}

function resolveMetrics(result: SimulationResultDigestSource | null): SimulationResultDigestMetrics {
  if (!result) {
    return {
      success40: null,
      ruin40: null,
      houseSalePct: null,
      maxDrawdownP50: null,
    };
  }
  const success40 = normalizeNumber(result.success40 ?? (typeof result.probRuin40 === 'number' ? 1 - result.probRuin40 : null));
  const ruin40 = normalizeNumber(result.ruin40 ?? result.probRuin40 ?? result.probRuin ?? null);
  const houseSalePct = normalizeNumber(result.houseSalePct ?? null);
  const maxDrawdownP50 = normalizeNumber(
    result.maxDrawdownP50
      ?? result.maxDrawdownPercentiles?.[50]
      ?? result.maxDrawdownPercentiles?.['50']
      ?? null,
  );
  return { success40, ruin40, houseSalePct, maxDrawdownP50 };
}

export function buildSimulationResultDigest(params: {
  success40: number | null;
  ruin40: number | null;
  houseSalePct: number | null;
  maxDrawdownP50: number | null;
  resultSeed: number | null;
  resultNSim: number | null;
  resultInputHash: string | null;
}): string | null {
  const payload = {
    houseSalePct: normalizeNumber(params.houseSalePct),
    maxDrawdownP50: normalizeNumber(params.maxDrawdownP50),
    resultInputHash: params.resultInputHash,
    resultNSim: normalizeNumber(params.resultNSim),
    resultSeed: normalizeNumber(params.resultSeed),
    ruin40: normalizeNumber(params.ruin40),
    success40: normalizeNumber(params.success40),
  };
  if (Object.values(payload).some((value) => value === null)) return null;
  return sha256Hex(stableSerialize(payload));
}

export function buildSimulationResultDiagnostics(
  input: BuildSimulationResultDiagnosticsInput,
): SimulationResultDiagnostics {
  const metrics = resolveMetrics(input.result);
  const resultSeed = normalizeNumber(input.resultSeed);
  const expectedSeed = normalizeNumber(input.expectedSeed);
  const resultNSim = normalizeNumber(input.resultNSim);
  const expectedNSim = normalizeNumber(input.expectedNSim);
  const resultDigest = buildSimulationResultDigest({
    ...metrics,
    resultSeed,
    resultNSim,
    resultInputHash: input.resultInputHash,
  });
  const isFinalForCurrentInput = Boolean(
    resultDigest
      && input.resultInputHash
      && input.effectiveEngineInputHash
      && input.resultInputHash === input.effectiveEngineInputHash
      && resultSeed !== null
      && expectedSeed !== null
      && resultSeed === expectedSeed
      && resultNSim !== null
      && expectedNSim !== null
      && resultNSim === expectedNSim
      && input.simulationRunStatus === 'completed'
      && input.resultMetricsAvailable
      && input.lastRunInputHash === input.effectiveEngineInputHash
      && input.lastRenderedResultHash === input.effectiveEngineInputHash,
  );

  return {
    resultDigest,
    resultInputHash: input.resultInputHash,
    resultSeed,
    resultNSim,
    success40: metrics.success40 ?? null,
    ruin40: metrics.ruin40 ?? null,
    houseSalePct: metrics.houseSalePct ?? null,
    maxDrawdownP50: metrics.maxDrawdownP50 ?? null,
    completedAt: input.completedAt,
    engineVersion: input.engineVersion ?? 'm8-central-wrapper',
    workerVersion: input.workerVersion ?? 'primary-recalc-worker',
    resultPathCount: normalizeNumber(input.result?.nTotal ?? null),
    isFinalForCurrentInput,
    previousResultDigest: input.previousResultDigest ?? null,
    previousResultInputHash: input.previousResultInputHash ?? null,
    provisionalResultShownBeforeFinal: Boolean(input.provisionalResultShownBeforeFinal),
  };
}
