import { WealthBlock, WealthCurrency } from './wealthStorage';

export interface ParsedWealthSuggestion {
  source: string;
  block: WealthBlock;
  label: string;
  amount: number;
  currency: WealthCurrency;
  confidence: number;
  note?: string;
}

const cleanText = (input: string) =>
  input
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\r/g, '')
    .trim();

const parseLocalizedNumber = (raw: string): number | null => {
  if (!raw) return null;

  const normalizedRaw = raw
    .replace(/[Oo]/g, '0')
    .replace(/[Il|]/g, '1')
    .replace(/[Ss]/g, '5')
    .replace(/[’'`´]/g, '.');

  const stripped = normalizedRaw.replace(/[^0-9.,-]/g, '');
  if (!stripped) return null;

  const hasDot = stripped.includes('.');
  const hasComma = stripped.includes(',');

  let normalized = stripped;

  if (hasDot && hasComma) {
    const lastDot = stripped.lastIndexOf('.');
    const lastComma = stripped.lastIndexOf(',');

    if (lastComma > lastDot) {
      normalized = stripped.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = stripped.replace(/,/g, '');
    }
  } else if (hasComma) {
    const commaGroups = stripped.split(',');
    const looksLikeThousands = commaGroups.length > 2 || commaGroups.slice(1).every((g) => g.length === 3);
    if (looksLikeThousands) {
      normalized = stripped.replace(/,/g, '');
    } else if (/,[0-9]{1,4}$/.test(stripped)) {
      normalized = stripped.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = stripped.replace(/,/g, '');
    }
  } else {
    const dotGroups = stripped.split('.');
    const looksLikeThousands = dotGroups.length > 2 || dotGroups.slice(1).every((g) => g.length === 3);
    normalized = looksLikeThousands ? stripped.replace(/\./g, '') : stripped;
  }

  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
};

const findAmountAfterLabel = (text: string, label: RegExp): number | null => {
  const match = text.match(label);
  if (!match) return null;
  return parseLocalizedNumber(match[1]);
};

const findAmountNearText = (text: string, pattern: RegExp): number | null => {
  const match = text.match(pattern);
  if (!match) return null;
  return parseLocalizedNumber(match[1]);
};

const extractAllLargeAmounts = (text: string): number[] => {
  return [...text.matchAll(/([0-9OoIl|Ss][0-9OoIl|Ss\s.,'`´’]{4,})/g)]
    .map((m) => parseLocalizedNumber(m[1]) || 0)
    .filter((n) => Number.isFinite(n) && n > 0);
};

const extractLargestAmountFromSnippet = (snippet: string): number | null => {
  const values = [...snippet.matchAll(/([0-9OoIl|Ss][0-9OoIl|Ss\s.,'`´’]{4,})/g)]
    .map((m) => parseLocalizedNumber(m[1]) || 0)
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => b - a);
  return values[0] || null;
};

const build = (items: Array<ParsedWealthSuggestion | null>): ParsedWealthSuggestion[] => {
  return items.filter((item): item is ParsedWealthSuggestion => !!item && item.amount > 0);
};

const parseWise = (text: string): ParsedWealthSuggestion[] => {
  const m = text.match(/([0-9][0-9.,]{2,})\s*USD/i);
  const amount = m ? parseLocalizedNumber(m[1]) : null;
  if (!amount) return [];

  return [{
    source: 'Wise',
    block: 'bank',
    label: 'Wise Cuenta principal USD',
    amount,
    currency: 'USD',
    confidence: 0.95,
  }];
};

const parseGlobal66 = (text: string): ParsedWealthSuggestion[] => {
  const m = text.match(/([0-9][0-9.,]{2,})\s*USD/i);
  const amount = m ? parseLocalizedNumber(m[1]) : null;
  if (!amount) return [];

  return [{
    source: 'Global66',
    block: 'bank',
    label: 'Global66 Cuenta Vista USD',
    amount,
    currency: 'USD',
    confidence: 0.93,
  }];
};

const parseSuraResumen = (text: string): ParsedWealthSuggestion[] => {
  const saldoActual =
    findAmountNearText(text, /saldo\s*actual(?:\s*es)?[^0-9]{0,24}([0-9][0-9.,]{4,})/i) ||
    findAmountNearText(text, /mi\s*resumen[\s\S]{0,140}?saldo[^0-9]{0,24}([0-9][0-9.,]{4,})/i);
  const inversion = findAmountNearText(text, /inversi[oó]n\s*financiera[^0-9]{0,24}([0-9][0-9.,]{4,})/i);
  const previsional = findAmountNearText(text, /ahorro\s*previsional[^0-9]{0,24}([0-9][0-9.,]{4,})/i);
  const detail =
    inversion && previsional
      ? `Detalle OCR: inversión financiera ${inversion.toLocaleString('es-CL')} + previsional ${previsional.toLocaleString('es-CL')}`
      : undefined;

  return build([
    saldoActual
      ? {
          source: 'SURA',
          block: 'investment',
          label: 'SURA saldo total',
          amount: saldoActual,
          currency: 'CLP',
          confidence: 0.96,
          note: detail,
        }
      : null,
  ]);
};

const parseSuraDetalle = (text: string): ParsedWealthSuggestion[] => {
  const fondosMutuos = findAmountAfterLabel(text, /fondos\s+mutuos\s*\$?\s*([0-9.]+)/i);
  const seguroAhorro = findAmountAfterLabel(text, /seguro\s+ahorro\s+patrimonial\s+plus[\s\S]{0,40}?\$\s*([0-9.]+)/i);
  const saldo = findAmountAfterLabel(text, /saldo\s*\$\s*([0-9.]+)/i);

  return build([
    fondosMutuos
      ? {
          source: 'SURA',
          block: 'investment',
          label: 'SURA Fondos Mutuos',
          amount: fondosMutuos,
          currency: 'CLP',
          confidence: 0.88,
        }
      : null,
    seguroAhorro
      ? {
          source: 'SURA',
          block: 'investment',
          label: 'SURA Seguro Ahorro Patrimonial Plus',
          amount: seguroAhorro,
          currency: 'CLP',
          confidence: 0.88,
        }
      : null,
    saldo
      ? {
          source: 'SURA',
          block: 'investment',
          label: 'SURA saldo total',
          amount: saldo,
          currency: 'CLP',
          confidence: 0.92,
        }
      : null,
  ]);
};

const parseBtg = (text: string): ParsedWealthSuggestion[] => {
  const matches = [...text.matchAll(/valorizaci[oó]n\s*\$\s*([0-9.]+)/gi)];
  if (!matches.length) return [];

  const total = matches.reduce((sum, m) => {
    const amount = parseLocalizedNumber(m[1]) || 0;
    return sum + amount;
  }, 0);

  if (total <= 0) return [];

  return [
    {
      source: 'BTG Pactual',
      block: 'investment',
      label: 'BTG total valorización (OCR)',
      amount: total,
      currency: 'CLP',
      confidence: 0.82,
      note: `Detalle OCR: ${matches
        .map((m) => parseLocalizedNumber(m[1]) || 0)
        .filter((n) => n > 0)
        .map((n) => n.toLocaleString('es-CL'))
        .join(' + ')}`,
    },
  ];
};

const parsePlanvital = (text: string): ParsedWealthSuggestion[] => {
  // Prioridad 1: valor dentro del bloque "Total ahorrado actual" (OCR robusto)
  const blockMatch =
    text.match(/total\s+ahorrad[oó][\s\S]{0,140}?actual[\s\S]{0,180}/i) ||
    text.match(/total[\s\S]{0,120}?ahorrad[oó][\s\S]{0,220}/i);
  const totalFromBlock = blockMatch ? extractLargestAmountFromSnippet(blockMatch[0]) : null;

  // Prioridad 2: detección directa junto a etiqueta
  const nearLabelA = findAmountNearText(text, /total\s+ahorrad[oó]\s+actual[^0-9]{0,40}([0-9][0-9\s.,]{4,})/i);
  const nearLabelB = findAmountNearText(text, /total\s+ahorrado[^0-9]{0,40}([0-9][0-9\s.,]{4,})/i);

  // Prioridad 2: fallback robusto para OCR ruidoso: tomar el monto mayor del documento
  const largestAmount = extractAllLargeAmounts(text).sort((a, b) => b - a)[0] || null;
  const candidates = [totalFromBlock, nearLabelA, nearLabelB, largestAmount]
    .filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0);
  const amount = candidates.length ? Math.max(...candidates) : null;
  if (!amount) return [];

  return [
    {
      source: 'PlanVital',
      block: 'investment',
      label: 'PlanVital saldo total',
      amount,
      currency: 'CLP',
      confidence: totalFromBlock || nearLabelA || nearLabelB ? 0.94 : 0.78,
      note: totalFromBlock || nearLabelA || nearLabelB
        ? undefined
        : 'No se detectó "Total ahorrado actual" claramente. Se usó el monto más alto detectado.',
    },
  ];
};

const parseDividend = (text: string): ParsedWealthSuggestion[] => {
  const totalPagar = findAmountAfterLabel(text, /total\s+a\s+pagar[\s\S]{0,40}?([0-9]+[.,][0-9]{2,4})/i);
  const deudaDespues = findAmountAfterLabel(text, /deuda\s+despu[eé]s\s+del\s+pago[\s\S]{0,40}?([0-9]+[.,][0-9]{2,4})/i);
  const saldoAntes = findAmountAfterLabel(text, /saldo\s+deuda\s+antes\s+del\s+pago[\s\S]{0,40}?([0-9]+[.,][0-9]{2,4})/i);

  return build([
    totalPagar
      ? {
          source: 'Scotiabank dividendo',
          block: 'debt',
          label: 'Dividendo hipotecario mensual',
          amount: totalPagar,
          currency: 'CLP',
          confidence: 0.7,
          note: 'OCR sugiere que el monto puede estar en UF. Confirmar antes de guardar.',
        }
      : null,
    (deudaDespues || saldoAntes)
      ? {
          source: 'Scotiabank dividendo',
          block: 'debt',
          label: 'Saldo deuda hipotecaria',
          amount: deudaDespues || (saldoAntes as number),
          currency: 'CLP',
          confidence: 0.72,
          note: 'OCR sugiere que el monto puede estar en UF. Confirmar moneda/valor.',
        }
      : null,
  ]);
};

const parseGeneric = (text: string): ParsedWealthSuggestion[] => {
  const amountMatches = [...text.matchAll(/\$\s*([0-9][0-9.,]{4,})/g)].slice(0, 3);
  if (!amountMatches.length) return [];

  return amountMatches
    .map<ParsedWealthSuggestion | null>((match, idx) => {
      const amount = parseLocalizedNumber(match[1]);
      if (!amount || amount <= 0) return null;

      return {
        source: 'OCR genérico',
        block: 'investment' as WealthBlock,
        label: `Monto detectado ${idx + 1}`,
        amount,
        currency: 'CLP' as WealthCurrency,
        confidence: 0.4,
        note: 'Detección genérica: valida origen y moneda.',
      };
    })
    .filter((item): item is ParsedWealthSuggestion => item !== null);
};

export const parseWealthFromOcrText = (
  rawText: string,
  sourceHint: string = 'auto',
): ParsedWealthSuggestion[] => {
  const text = cleanText(rawText);
  const lower = text.toLowerCase();

  const hints = {
    planvital:
      sourceHint === 'planvital' ||
      lower.includes('planvital') ||
      lower.includes('plan vital') ||
      lower.includes('afp') ||
      lower.includes('total ahorrado') ||
      lower.includes('ahorrado actual'),
    wise: sourceHint === 'wise' || lower.includes('wise'),
    global66:
      sourceHint === 'global66' ||
      lower.includes('global66') ||
      lower.includes('dólar estadounidense') ||
      lower.includes('dolar estadounidense'),
    suraResumen:
      sourceHint === 'sura_resumen' ||
      (lower.includes('sura') && lower.includes('mi resumen') && lower.includes('saldo actual es')),
    suraDetalle:
      sourceHint === 'sura_detalle' ||
      (lower.includes('sura') && lower.includes('fondos mutuos') && lower.includes('seguro ahorro')),
    btg:
      sourceHint === 'btg' ||
      (lower.includes('btg') && lower.includes('valorización')) ||
      (lower.includes('btg') && lower.includes('valorizacion')),
    dividendo:
      sourceHint === 'dividendo' ||
      lower.includes('aviso de vencimiento dividendo hipotecario') ||
      lower.includes('dividendo hipotecario') ||
      lower.includes('scotiabank'),
  };

  if (hints.planvital) return parsePlanvital(text);
  if (hints.wise) return parseWise(text);
  if (hints.global66) return parseGlobal66(text);
  if (hints.suraResumen) return parseSuraResumen(text);
  if (hints.suraDetalle) return parseSuraDetalle(text);
  if (hints.btg) return parseBtg(text);
  if (hints.dividendo) return parseDividend(text);

  const rankedParsers = [parsePlanvital, parseSuraResumen, parseSuraDetalle, parseWise, parseGlobal66, parseBtg, parseDividend];

  for (const parser of rankedParsers) {
    const result = parser(text);
    if (result.length) return result;
  }

  return parseGeneric(text);
};
