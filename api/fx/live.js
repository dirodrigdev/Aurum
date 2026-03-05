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

const fetchJson = async (url, timeoutMs = 12000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const separator = url.includes('?') ? '&' : '?';
    const response = await fetch(`${url}${separator}_ts=${Date.now()}`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
};

const dateToYmd = (value) => {
  const d = new Date(String(value || '').trim());
  if (!Number.isFinite(d.getTime())) return '';
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Método no permitido' });
  }

  try {
    const [usdPayload, eurPayload, ufPayload] = await Promise.all([
      fetchJson('https://api.frankfurter.app/latest?from=USD&to=CLP'),
      fetchJson('https://api.frankfurter.app/latest?from=EUR&to=CLP'),
      fetchJson('https://mindicador.cl/api/uf'),
    ]);

    const usd = parseFlexibleNumeric(usdPayload?.rates?.CLP);
    const eur = parseFlexibleNumeric(eurPayload?.rates?.CLP);
    const ufFirst = Array.isArray(ufPayload?.serie) ? ufPayload.serie[0] : null;
    const uf = parseFlexibleNumeric(ufFirst?.valor);
    const ufDate = dateToYmd(ufFirst?.fecha);

    if (![usd, eur, uf].every((v) => Number.isFinite(v) && v > 0)) {
      throw new Error('Indicadores inválidos en respuesta');
    }

    return res.status(200).json({
      ok: true,
      rates: {
        usdClp: Math.round(usd),
        eurClp: Math.round(eur),
        ufClp: Math.round(uf),
      },
      source: `vercel-api: Frankfurter(USD/EUR)+Mindicador(UF:${ufDate || 's/f'})`,
      fetchedAt: new Date().toISOString(),
      ufDate,
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: `No pude obtener TC/UF online en backend: ${error?.message || 'desconocido'}`,
    });
  }
}
