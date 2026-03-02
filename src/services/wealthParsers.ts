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

  const stripped = raw.replace(/[^0-9.,-]/g, '');
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
    if (/,[0-9]{1,4}$/.test(stripped)) {
      normalized = stripped.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = stripped.replace(/,/g, '');
    }
  } else {
    normalized = stripped.replace(/\./g, '');
  }

  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
};

const findAmountAfterLabel = (text: string, label: RegExp): number | null => {
  const match = text.match(label);
  if (!match) return null;
  return parseLocalizedNumber(match[1]);
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
  const saldoActual = findAmountAfterLabel(text, /saldo\s+actual\s+es[:\s$]*([0-9.]+)/i);
  const inversion = findAmountAfterLabel(text, /inversi[oó]n\s+financiera[:\s$]*([0-9.]+)/i);
  const previsional = findAmountAfterLabel(text, /ahorro\s+previsional[:\s$]*([0-9.]+)/i);

  return build([
    saldoActual
      ? {
          source: 'SURA',
          block: 'investment',
          label: 'SURA saldo total',
          amount: saldoActual,
          currency: 'CLP',
          confidence: 0.96,
        }
      : null,
    inversion
      ? {
          source: 'SURA',
          block: 'investment',
          label: 'SURA inversión financiera',
          amount: inversion,
          currency: 'CLP',
          confidence: 0.9,
        }
      : null,
    previsional
      ? {
          source: 'SURA',
          block: 'investment',
          label: 'SURA ahorro previsional',
          amount: previsional,
          currency: 'CLP',
          confidence: 0.9,
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
      note: 'Revisar: se sumaron líneas de Valorización detectadas en la imagen.',
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
    .map((match, idx) => {
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
    .filter((item): item is ParsedWealthSuggestion => !!item);
};

export const parseWealthFromOcrText = (
  rawText: string,
  sourceHint: string = 'auto',
): ParsedWealthSuggestion[] => {
  const text = cleanText(rawText);
  const lower = text.toLowerCase();

  const hints = {
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

  if (hints.wise) return parseWise(text);
  if (hints.global66) return parseGlobal66(text);
  if (hints.suraResumen) return parseSuraResumen(text);
  if (hints.suraDetalle) return parseSuraDetalle(text);
  if (hints.btg) return parseBtg(text);
  if (hints.dividendo) return parseDividend(text);

  const rankedParsers = [parseSuraResumen, parseSuraDetalle, parseWise, parseGlobal66, parseBtg, parseDividend];

  for (const parser of rankedParsers) {
    const result = parser(text);
    if (result.length) return result;
  }

  return parseGeneric(text);
};
