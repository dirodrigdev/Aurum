const FETCH_TIMEOUT_MS = 5000;

const parseFlexibleNumeric = (value) => {
  const normalized = String(value ?? '')
    .replace(/[^\d,.-]/g, '')
    .replace(/\s+/g, '')
    .trim();
  if (!normalized) return Number.NaN;

  const hasComma = normalized.includes(',');
  const hasDot = normalized.includes('.');
  let prepared = normalized;

  if (hasComma && hasDot) {
    const lastComma = normalized.lastIndexOf(',');
    const lastDot = normalized.lastIndexOf('.');
    if (lastComma > lastDot) {
      prepared = normalized.replace(/\./g, '').replace(',', '.');
    } else {
      prepared = normalized.replace(/,/g, '');
    }
  } else if (hasComma) {
    prepared = normalized.replace(',', '.');
  }

  const n = Number(prepared);
  return Number.isFinite(n) ? n : Number.NaN;
};

const withTimeout = async (url, responseType = 'json', timeoutMs = FETCH_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const separator = url.includes('?') ? '&' : '?';
    const response = await fetch(`${url}${separator}_ts=${Date.now()}`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (responseType === 'text') return await response.text();
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
};

const clampRate = (value, min, max, label) => {
  const n = parseFlexibleNumeric(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`${label} fuera de rango (${String(value)})`);
  }
  return n;
};

const dateToYmd = (value) => {
  const d = new Date(String(value || '').trim());
  if (!Number.isFinite(d.getTime())) return '';
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};

const stripHtml = (html) =>
  String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const findUfCandidate = (text) => {
  const cleaned = stripHtml(text);
  if (!cleaned) return Number.NaN;

  const markerRegex = /(UF|UNIDAD DE FOMENTO)[^0-9]{0,40}(\d{1,3}(?:[.\s]\d{3})+(?:,\d+)?|\d{4,6}(?:,\d+)?)/gi;
  const markerCandidates = [];
  let markerMatch = markerRegex.exec(cleaned);
  while (markerMatch) {
    const parsed = parseFlexibleNumeric(markerMatch[2]);
    if (Number.isFinite(parsed) && parsed >= 20000 && parsed <= 60000) {
      markerCandidates.push(parsed);
    }
    markerMatch = markerRegex.exec(cleaned);
  }
  if (markerCandidates.length) {
    return markerCandidates.sort((a, b) => Math.abs(a - 39000) - Math.abs(b - 39000))[0];
  }

  const genericRegex = /\d{1,3}(?:[.\s]\d{3})+(?:,\d+)?|\d{4,6}(?:,\d+)?/g;
  const genericMatches = cleaned.match(genericRegex) || [];
  const genericCandidates = genericMatches
    .map((candidate) => parseFlexibleNumeric(candidate))
    .filter((n) => Number.isFinite(n) && n >= 20000 && n <= 60000);

  if (!genericCandidates.length) return Number.NaN;
  return genericCandidates.sort((a, b) => Math.abs(a - 39000) - Math.abs(b - 39000))[0];
};

const fetchUsdEurFromFrankfurter = async () => {
  const [usdPayload, eurPayload] = await Promise.all([
    withTimeout('https://api.frankfurter.app/latest?from=USD&to=CLP', 'json'),
    withTimeout('https://api.frankfurter.app/latest?from=EUR&to=CLP', 'json'),
  ]);

  return {
    usd: clampRate(usdPayload?.rates?.CLP, 500, 2000, 'USD/CLP'),
    eur: clampRate(eurPayload?.rates?.CLP, 600, 2500, 'EUR/CLP'),
    source: 'frankfurter.app',
  };
};

const fetchUsdEurFromOpenErApi = async () => {
  const [usdPayload, eurPayload] = await Promise.all([
    withTimeout('https://open.er-api.com/v6/latest/USD', 'json'),
    withTimeout('https://open.er-api.com/v6/latest/EUR', 'json'),
  ]);

  return {
    usd: clampRate(usdPayload?.rates?.CLP, 500, 2000, 'USD/CLP'),
    eur: clampRate(eurPayload?.rates?.CLP, 600, 2500, 'EUR/CLP'),
    source: 'open.er-api.com',
  };
};

const fetchUsdEurFromMindicador = async () => {
  const payload = await withTimeout('https://mindicador.cl/api', 'json');
  return {
    usd: clampRate(payload?.dolar?.valor, 500, 2000, 'USD/CLP'),
    eur: clampRate(payload?.euro?.valor, 600, 2500, 'EUR/CLP'),
    source: 'mindicador.cl/api',
  };
};

const resolveUsdEur = async () => {
  const strategies = [fetchUsdEurFromFrankfurter, fetchUsdEurFromOpenErApi, fetchUsdEurFromMindicador];
  const errors = [];

  for (const strategy of strategies) {
    try {
      return await strategy();
    } catch (error) {
      errors.push(String(error?.message || error || 'error'));
    }
  }

  throw new Error(`USD/EUR sin respuesta válida (${errors.join(' | ')})`);
};

const fetchUfFromMindicador = async () => {
  const payload = await withTimeout('https://mindicador.cl/api/uf', 'json');
  const first = Array.isArray(payload?.serie) ? payload.serie[0] : null;
  const uf = clampRate(first?.valor, 20000, 60000, 'UF/CLP');
  const ufDate = dateToYmd(first?.fecha);

  return {
    uf,
    ufDate,
    source: `mindicador.cl/api/uf${ufDate ? `(${ufDate})` : ''}`,
  };
};

const fetchUfFromWebPage = async (url) => {
  const html = await withTimeout(url, 'text');
  const uf = findUfCandidate(html);
  if (!Number.isFinite(uf)) {
    throw new Error('UF no encontrada en HTML');
  }
  return {
    uf,
    ufDate: '',
    source: `scraping:${url}`,
  };
};

const resolveUf = async () => {
  const strategies = [
    fetchUfFromMindicador,
    () => fetchUfFromWebPage('https://www.valoruf.cl'),
    () => fetchUfFromWebPage('https://www.mindicador.cl/'),
  ];
  const errors = [];

  for (const strategy of strategies) {
    try {
      return await strategy();
    } catch (error) {
      errors.push(String(error?.message || error || 'error'));
    }
  }

  throw new Error(`UF sin respuesta válida (${errors.join(' | ')})`);
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Método no permitido' });
  }

  try {
    const [fx, ufData] = await Promise.all([resolveUsdEur(), resolveUf()]);

    return res.status(200).json({
      ok: true,
      rates: {
        usdClp: Math.round(fx.usd),
        eurClp: Math.round(fx.eur),
        ufClp: Math.round(ufData.uf),
      },
      source: `vercel-api: ${fx.source} + ${ufData.source}`,
      fetchedAt: new Date().toISOString(),
      ufDate: ufData.ufDate || '',
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: `No pude obtener TC/UF online en backend: ${error?.message || 'desconocido'}`,
    });
  }
}
