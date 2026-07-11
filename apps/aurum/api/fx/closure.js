const FETCH_TIMEOUT_MS = 8000;
const BCCH_SERIES_ENDPOINT = 'https://si3.bcentral.cl/SieteRestWS/SieteRestWS.ashx';
const BCCH_EUR_SERIES = 'F072.CLP.EUR.N.O.D';

const setSharedHeaders = (res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
};

const parseFlexibleNumeric = (value) => {
  const normalized = String(value ?? '').replace(/[^\d,.-]/g, '').trim();
  if (!normalized) return Number.NaN;
  const lastComma = normalized.lastIndexOf(',');
  const lastDot = normalized.lastIndexOf('.');
  let prepared = normalized;
  if (lastComma >= 0 && lastDot >= 0) {
    prepared = lastComma > lastDot
      ? normalized.replace(/\./g, '').replace(',', '.')
      : normalized.replace(/,/g, '');
  } else if (lastComma >= 0) {
    prepared = normalized.replace(',', '.');
  }
  const parsed = Number(prepared);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const fetchText = async (url) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
};

const economicDateForMonth = (monthKey) => {
  const match = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${match[1]}-${match[2]}-${String(lastDay).padStart(2, '0')}`;
};

const extractMonthSection = (html, monthNumber) => {
  const monthNames = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ];
  const name = monthNames[monthNumber - 1];
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
  if (!heading) throw new Error(`No encontré ${name} en la fuente oficial`);
  const tag = heading.marker.slice(0, 3);
  const nextHeading = lower.indexOf(tag, heading.index + heading.marker.length);
  return String(html).slice(heading.index, nextHeading > heading.index ? nextHeading : undefined);
};

const extractDayValues = (section) => {
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

const fetchSiiMonthRate = async ({ year, month, kind, exactLastDay }) => {
  const url = `https://www.sii.cl/valores_y_fechas/${kind}/${kind}${year}.htm`;
  const html = await fetchText(url);
  const values = extractDayValues(extractMonthSection(html, month));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const selected = exactLastDay
    ? values.find((item) => item.day === lastDay)
    : [...values].reverse().find((item) => item.day <= lastDay);
  if (!selected) throw new Error(`${kind.toUpperCase()} sin valor oficial dentro del mes`);
  return {
    value: selected.value,
    effectiveDate: `${year}-${String(month).padStart(2, '0')}-${String(selected.day).padStart(2, '0')}`,
    source: url,
  };
};

const parseBcchObservations = (rawText) => {
  let payload = null;
  try {
    payload = JSON.parse(rawText);
  } catch {
    payload = null;
  }
  if (!payload) {
    const obsMatches = [...String(rawText).matchAll(/<Obs>[\s\S]*?<indexDateString>\s*([^<]+)\s*<\/indexDateString>[\s\S]*?<value>\s*([^<]+)\s*<\/value>[\s\S]*?<statusCode>\s*([^<]+)\s*<\/statusCode>[\s\S]*?<\/Obs>/gi)];
    return obsMatches.map((match) => ({
      date: String(match[1] || '').trim(),
      value: parseFlexibleNumeric(match[2]),
      status: String(match[3] || '').trim(),
    }));
  }
  const obs = Array.isArray(payload?.Series?.Obs)
    ? payload.Series.Obs
    : Array.isArray(payload?.series?.obs)
      ? payload.series.obs
      : [];
  return obs.map((item) => ({
    date: String(item?.indexDateString || '').trim(),
    value: parseFlexibleNumeric(item?.value),
    status: String(item?.statusCode || '').trim(),
  }));
};

const fetchBcentralEur = async ({ year, month, economicDate }) => {
  const user = String(process.env.BCCH_USER || '').trim();
  const pass = String(process.env.BCCH_PASS || '').trim();
  if (!user || !pass) throw new Error('Faltan credenciales BCCh para EUR/CLP');
  const firstDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const url =
    `${BCCH_SERIES_ENDPOINT}?user=${encodeURIComponent(user)}` +
    `&pass=${encodeURIComponent(pass)}` +
    `&timeseries=${encodeURIComponent(BCCH_EUR_SERIES)}` +
    `&function=GetSeries&firstdate=${encodeURIComponent(firstDate)}` +
    `&lastdate=${encodeURIComponent(economicDate)}`;
  const observations = parseBcchObservations(await fetchText(url))
    .filter((item) => Number.isFinite(item.value) && item.value > 0 && item.status.toUpperCase() === 'OK')
    .map((item) => {
      const match = item.date.match(/^(\d{2})-(\d{2})-(\d{4})$/);
      return {
        ...item,
        isoDate: match ? `${match[3]}-${match[2]}-${match[1]}` : '',
      };
    })
    .filter((item) => item.isoDate.startsWith(`${year}-${String(month).padStart(2, '0')}-`))
    .sort((left, right) => right.isoDate.localeCompare(left.isoDate));
  if (!observations.length) throw new Error('BCCh no devolvió EUR/CLP válido dentro del mes');
  return {
    value: observations[0].value,
    effectiveDate: observations[0].isoDate,
    source: `bcentral.cl:${BCCH_EUR_SERIES}`,
  };
};

export default async function handler(req, res) {
  setSharedHeaders(res);
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Método no permitido' });
  }
  const monthKey = String(req.query?.monthKey || '');
  const economicDate = economicDateForMonth(monthKey);
  if (!economicDate) return res.status(400).json({ ok: false, error: 'monthKey inválido' });
  const [year, month] = monthKey.split('-').map(Number);
  const warnings = [];
  const rates = {};
  const sources = {};
  const effectiveDates = {};
  const loaders = [
    ['usdClp', 'usd', () => fetchSiiMonthRate({ year, month, kind: 'dolar', exactLastDay: false })],
    ['eurClp', 'eur', () => fetchBcentralEur({ year, month, economicDate })],
    ['ufClp', 'uf', () => fetchSiiMonthRate({ year, month, kind: 'uf', exactLastDay: true })],
  ];
  await Promise.all(loaders.map(async ([field, key, load]) => {
    try {
      const result = await load();
      rates[field] = result.value;
      sources[key] = result.source;
      effectiveDates[key] = result.effectiveDate;
    } catch (error) {
      warnings.push(`${key.toUpperCase()}: ${String(error?.message || 'fuente no disponible')}`);
    }
  }));
  if (!Object.keys(rates).length) {
    return res.status(502).json({ ok: false, error: 'No se encontraron tasas históricas para el mes solicitado.' });
  }
  return res.status(200).json({
    ok: true,
    monthKey,
    economicDate,
    rates,
    sources,
    effectiveDates,
    retrievedAt: new Date().toISOString(),
    warnings,
  });
}

export { economicDateForMonth, extractDayValues, extractMonthSection };
