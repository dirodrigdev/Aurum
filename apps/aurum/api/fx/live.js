const FETCH_TIMEOUT_MS = 5000;
const BCCH_SERIES_ENDPOINT = 'https://si3.bcentral.cl/SieteRestWS/SieteRestWS.ashx';
const CHILE_TIME_ZONE = 'America/Santiago';
const safeDiagnosticMessage = (error) =>
  String(error?.message || error || 'error')
    .replace(/([?&](?:user|pass|password|token|api[_-]?key)=)[^&\s]*/gi, '$1[redacted]')
    .replace(/(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, '$1[redacted]')
    .slice(0, 500);

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

const canonicalChileTodayYmd = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CHILE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const extractSiiMonthSection = (html, monthNumber) => {
  const monthNames = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ];
  const name = monthNames[monthNumber - 1];
  if (!name) throw new Error(`Mes inválido para buscar UF en SII (${monthNumber})`);
  const lower = String(html || '').toLowerCase();
  const idMarkers = [`id='mes_${name}'`, `id="mes_${name}"`];
  const idStart = idMarkers.map((marker) => lower.indexOf(marker)).find((index) => index >= 0);
  if (idStart !== undefined) {
    const nextContainers = ["<div class='meses'", '<div class="meses"']
      .map((marker) => lower.indexOf(marker, idStart + 1))
      .filter((index) => index > idStart);
    return String(html).slice(idStart, nextContainers.length ? Math.min(...nextContainers) : undefined);
  }

  const headingMarkers = [`<h2>${name}</h2>`, `<h3>${name}</h3>`];
  const heading = headingMarkers
    .map((marker) => ({ marker, index: lower.indexOf(marker) }))
    .find((item) => item.index >= 0);
  if (!heading) throw new Error(`No encontré ${name} en la fuente oficial SII`);
  const tag = heading.marker.slice(0, 3);
  const nextHeading = lower.indexOf(tag, heading.index + heading.marker.length);
  return String(html).slice(heading.index, nextHeading > heading.index ? nextHeading : undefined);
};

const extractSiiDayValues = (section) => {
  const values = [];
  const pattern = /<th[^>]*>\s*<strong>\s*(\d{1,2})\s*<\/strong>\s*<\/th>\s*<td[^>]*>\s*([^<]*)\s*<\/td>/gi;
  let match = pattern.exec(section);
  while (match) {
    const day = Number(match[1]);
    const value = parseFlexibleNumeric(match[2]);
    if (Number.isInteger(day) && day >= 1 && day <= 31 && Number.isFinite(value) && value > 0) {
      values.push({ day, value });
    }
    match = pattern.exec(section);
  }
  return values.sort((left, right) => left.day - right.day);
};

const fetchUfFromSii = async (now = new Date()) => {
  const [yearText, monthText, dayText] = canonicalChileTodayYmd(now).split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const url = `https://www.sii.cl/valores_y_fechas/uf/uf${year}.htm`;
  const html = await withTimeout(url, 'text', 8000);
  const values = extractSiiDayValues(extractSiiMonthSection(html, month));
  const selected = [...values].reverse().find((item) => item.day <= day);
  if (!selected) throw new Error(`UF sin valor oficial en SII hasta ${yearText}-${monthText}-${dayText}`);

  return {
    uf: clampRate(selected.value, 20000, 60000, 'UF/CLP'),
    ufDate: `${yearText}-${monthText}-${String(selected.day).padStart(2, '0')}`,
    source: `sii.cl:${yearText}-${monthText}-${String(selected.day).padStart(2, '0')}`,
  };
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
      const detail = safeDiagnosticMessage(error);
      errors.push(`${strategy.name}: ${detail}`);
      console.warn('[api/fx/live] USD/EUR source strategy failed', {
        strategy: strategy.name,
        detail,
      });
    }
  }

  throw new Error(`USD/EUR sin respuesta válida (${errors.join(' | ')})`);
};

const resolveUf = async () => {
  try {
    return await fetchUfFromSii();
  } catch (error) {
    const detail = safeDiagnosticMessage(error);
    console.warn('[api/fx/live] UF source failed', {
      source: 'sii.cl',
      detail,
    });
    throw new Error(`UF sin respuesta válida (sii.cl: ${detail})`);
  }
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
  } catch (error) {
    console.error('[api/fx/live] request failed', {
      requestId: String(req.headers?.['x-vercel-id'] || '').slice(0, 120),
      detail: safeDiagnosticMessage(error),
    });
    return res.status(502).json({
      ok: false,
      error: 'No pude obtener TC/UF online en backend.',
    });
  }
}

export { canonicalChileTodayYmd, extractSiiDayValues, extractSiiMonthSection, fetchUfFromSii };
