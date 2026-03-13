const FETCH_TIMEOUT_MS = 5000;
const BCCH_SERIES_ENDPOINT = 'https://si3.bcentral.cl/SieteRestWS/SieteRestWS.ashx';
const setSharedHeaders = (res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
};

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

const formatYmd = (date) => {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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
    usdSource: 'frankfurter.app',
    eurSource: 'frankfurter.app',
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
    usdSource: 'open.er-api.com',
    eurSource: 'open.er-api.com',
  };
};

const fetchUsdEurCrossFromOpenErApi = async (usdClpFromBcentral) => {
  const usdPayload = await withTimeout('https://open.er-api.com/v6/latest/USD', 'json');
  const eurPerUsd = clampRate(usdPayload?.rates?.EUR, 0.5, 1.5, 'EUR por USD');
  const eurClp = usdClpFromBcentral / eurPerUsd;
  return {
    usd: clampRate(usdClpFromBcentral, 500, 2000, 'USD/CLP'),
    eur: clampRate(eurClp, 600, 2500, 'EUR/CLP'),
    source: 'bcentral.cl + open.er-api.com',
    usdSource: 'bcentral.cl',
    eurSource: 'open.er-api.com (cross EUR/USD)',
  };
};

const fetchUsdFromBcentral = async () => {
  const user = String(process.env.BCCH_USER || '').trim();
  const pass = String(process.env.BCCH_PASS || '').trim();
  const series = String(process.env.BCCH_USD_SERIES || '').trim();
  if (!user || !pass || !series) {
    throw new Error('Faltan credenciales/serie BCCh (BCCH_USER, BCCH_PASS, BCCH_USD_SERIES)');
  }

  const today = new Date();
  const firstDate = formatYmd(new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000));
  const lastDate = formatYmd(today);
  const url =
    `${BCCH_SERIES_ENDPOINT}?` +
    `user=${encodeURIComponent(user)}` +
    `&pass=${encodeURIComponent(pass)}` +
    `&timeseries=${encodeURIComponent(series)}` +
    `&function=GetSeries` +
    `&firstdate=${encodeURIComponent(firstDate)}` +
    `&lastdate=${encodeURIComponent(lastDate)}`;

  const rawText = await withTimeout(url, 'text', 8000);
  let payload = null;
  try {
    payload = JSON.parse(rawText);
  } catch {
    payload = null;
  }

  // Algunos clientes/ambientes reciben formatos no JSON; hacemos fallback defensivo.
  if (!payload) {
    const codeMatch = String(rawText).match(/<Codigo>\s*([0-9-]+)\s*<\/Codigo>/i);
    const descMatch = String(rawText).match(/<Descripcion>\s*([^<]+)\s*<\/Descripcion>/i);
    const obsMatches = [...String(rawText).matchAll(/<Obs>[\s\S]*?<indexDateString>\s*([^<]+)\s*<\/indexDateString>[\s\S]*?<value>\s*([^<]+)\s*<\/value>[\s\S]*?<statusCode>\s*([^<]+)\s*<\/statusCode>[\s\S]*?<\/Obs>/gi)];
    payload = {
      Codigo: codeMatch ? Number(codeMatch[1]) : NaN,
      Descripcion: descMatch ? String(descMatch[1]).trim() : '',
      Series: {
        Obs: obsMatches.map((m) => ({
          indexDateString: String(m[1] || '').trim(),
          value: String(m[2] || '').trim(),
          statusCode: String(m[3] || '').trim(),
        })),
      },
    };
  }

  const statusCode = Number(payload?.Codigo ?? payload?.codigo);
  if (!payload || !Number.isFinite(statusCode) || statusCode !== 0) {
    throw new Error(
      `BCCh sin respuesta válida (${String(payload?.Descripcion || payload?.descripcion || payload?.Codigo || 'sin detalle')})`,
    );
  }

  const obs = Array.isArray(payload?.Series?.Obs) ? payload.Series.Obs : Array.isArray(payload?.series?.obs) ? payload.series.obs : [];
  const valid = obs
    .map((item) => ({
      value: parseFlexibleNumeric(item?.value),
      status: String(item?.statusCode || ''),
      date: String(item?.indexDateString || ''),
      dateMs: (() => {
        const d = String(item?.indexDateString || '').trim();
        const m = d.match(/^(\d{2})-(\d{2})-(\d{4})$/);
        if (!m) return Number.NaN;
        const dt = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
        const ms = dt.getTime();
        return Number.isFinite(ms) ? ms : Number.NaN;
      })(),
    }))
    .filter((item) => Number.isFinite(item.value) && item.value > 0 && item.status.toUpperCase() === 'OK');

  if (!valid.length) {
    throw new Error('BCCh no devolvió observaciones USD válidas');
  }

  const latest = [...valid].sort((a, b) => {
    const ta = Number.isFinite(a.dateMs) ? a.dateMs : -Infinity;
    const tb = Number.isFinite(b.dateMs) ? b.dateMs : -Infinity;
    return tb - ta;
  })[0];
  return {
    usd: clampRate(latest.value, 500, 2000, 'USD/CLP'),
    date: latest.date || '',
    source: `bcentral.cl:${series}`,
  };
};

const resolveUsdEur = async () => {
  const strategies = [
    {
      name: 'bcentral+open-er',
      run: async () => {
        const usd = await fetchUsdFromBcentral();
        const cross = await fetchUsdEurCrossFromOpenErApi(usd.usd);
        return {
          ...cross,
          source: `${cross.source} (USD ${usd.source}${usd.date ? ` ${usd.date}` : ''})`,
          usdSource: `${usd.source}${usd.date ? ` ${usd.date}` : ''}`,
        };
      },
    },
    { name: 'open-er', run: fetchUsdEurFromOpenErApi },
    { name: 'frankfurter', run: fetchUsdEurFromFrankfurter },
  ];
  const errors = [];

  for (let i = 0; i < strategies.length; i += 1) {
    const strategy = strategies[i];
    try {
      const result = await strategy.run();
      if (i > 0 && errors.length) {
        return {
          ...result,
          fallbackUsed: true,
          fallbackReason: errors.join(' | '),
        };
      }
      return result;
    } catch (error) {
      errors.push(`${strategy.name}: ${String(error?.message || error || 'error')}`);
    }
  }

  throw new Error(`USD/EUR sin respuesta válida (${errors.join(' | ')})`);
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
  const strategies = [() => fetchUfFromWebPage('https://www.valoruf.cl')];
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
  setSharedHeaders(res);
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
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
      source: `vercel-api: ${fx.source}${fx.fallbackUsed ? ' (fallback)' : ''} + ${ufData.source}`,
      sources: {
        usdClp: fx.usdSource || fx.source,
        eurClp: fx.eurSource || fx.source,
        ufClp: ufData.source,
      },
      diagnostics: fx.fallbackReason ? { fxFallbackReason: fx.fallbackReason } : undefined,
      fetchedAt: new Date().toISOString(),
      ufDate: ufData.ufDate || '',
    });
  } catch {
    return res.status(502).json({
      ok: false,
      error: 'No pude obtener TC/UF online en backend.',
    });
  }
}
