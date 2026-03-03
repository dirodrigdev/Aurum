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
    block: 'investment',
    label: 'Wise Cuenta principal USD',
    amount,
    currency: 'USD',
    confidence: 0.95,
  }];
};

const parseGlobalUsdCandidate = (raw: string): number | null => {
  const parsed = parseLocalizedNumber(raw);
  if (!parsed) return null;

  const digitsOnly = raw.replace(/[^0-9]/g, '');
  const compact = Number(digitsOnly);
  if (!Number.isFinite(compact) || compact <= 0) return parsed;

  // OCR de Global66 a veces pierde/mueve el separador decimal:
  // 67,09843  -> 6709843 (debe ser 67,098.43)
  // 67.09843  -> 67.09843 (debe ser 67,098.43)
  if ((parsed < 1000 || parsed > 1_000_000) && digitsOnly.length >= 5 && digitsOnly.length <= 9) {
    const corrected = compact / 100;
    if (corrected >= 1000 && corrected <= 1_000_000) return corrected;
  }

  return parsed;
};

const parseGlobal66 = (text: string): ParsedWealthSuggestion[] => {
  const headerSectionMatch = text.match(
    /d[o0ó]lar\s*estadounidense[\s\S]{0,260}?(?:rendim|datos\s+de\s+tu\s+cuenta|n[°º]\s*de\s+cuenta|ingresar|$)/i,
  );
  const headerSection = headerSectionMatch?.[0] || '';
  if (headerSection) {
    const headerAmountCandidates = [...headerSection.matchAll(/([0-9OoIl|Ss][0-9OoIl|Ss\s.,'`´’]{3,})/g)]
      .map((m) => parseGlobalUsdCandidate(m[1]) || 0)
      .filter((n) => Number.isFinite(n) && n >= 1000 && n <= 1_000_000)
      .sort((a, b) => b - a);

    const headerAmount = headerAmountCandidates[0] || null;
    if (headerAmount) {
      return [{
        source: 'Global66',
        block: 'investment',
        label: 'Global66 Cuenta Vista USD',
        amount: headerAmount,
        currency: 'USD',
        confidence: 0.99,
      }];
    }
  }

  const collectGlobalCandidates = (scopeText: string, scopeWeight: number) => {
    const scopeLower = cleanText(scopeText).toLowerCase();
    return [...scopeText.matchAll(/([0-9OoIl|Ss][0-9OoIl|Ss\s.,'`´’]{2,})\s*(?:[a-zA-Z]{1,2}\s*)?USD/gi)]
      .map((m) => {
        const amount = parseGlobalUsdCandidate(m[1]);
        if (!amount || amount <= 0) return null;
        const idx = m.index || 0;
        const context = scopeLower.slice(Math.max(0, idx - 100), idx + 120);
        let score = scopeWeight;

        if (amount >= 1000 && amount <= 1_000_000) score += 2;
        if (amount >= 10_000) score += 2;
        if (amount > 1_000_000) score -= 6;

        if (context.includes('dolar estadounidense') || context.includes('dólar estadounidense')) score += 7;
        if (context.includes('cuenta')) score += 2;

        // No queremos tomar rendimientos/movimientos como saldo principal.
        if (
          context.includes('rendim') ||
          context.includes('interes') ||
          context.includes('conversi') ||
          context.includes('comision') ||
          context.includes('retirad') ||
          context.includes('transacci')
        ) {
          score -= 9;
        }

        return { amount, score };
      })
      .filter((item): item is { amount: number; score: number } => !!item);
  };

  const lowerText = cleanText(text).toLowerCase();
  const topCutIdx = lowerText.indexOf('datos de tu cuenta');
  const topSectionText = topCutIdx > 0 ? text.slice(0, topCutIdx) : text.slice(0, Math.min(text.length, 900));

  const candidates = [
    ...collectGlobalCandidates(topSectionText, 3),
    ...collectGlobalCandidates(text, 0),
  ];

  candidates.sort((a, b) => (b.score === a.score ? b.amount - a.amount : b.score - a.score));
  const amount = candidates[0]?.amount || null;
  if (!amount) return [];

  return [{
    source: 'Global66',
    block: 'investment',
    label: 'Global66 Cuenta Vista USD',
    amount,
    currency: 'USD',
    confidence: 0.93,
  }];
};

const parseSuraResumen = (text: string): ParsedWealthSuggestion[] => {
  const inversion = findAmountNearText(text, /inversi[oó]n\s*financiera[^0-9]{0,24}([0-9][0-9.,]{4,})/i);
  const previsional = findAmountNearText(text, /ahorro\s*previsional[^0-9]{0,24}([0-9][0-9.,]{4,})/i);
  return build([
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
  const financialTotal = saldo || ((fondosMutuos || 0) + (seguroAhorro || 0)) || null;

  return build([
    financialTotal
      ? {
          source: 'SURA',
          block: 'investment',
          label: 'SURA inversión financiera',
          amount: financialTotal,
          currency: 'CLP',
          confidence: saldo ? 0.9 : 0.86,
          note:
            fondosMutuos && seguroAhorro
              ? `Detalle OCR: Fondos Mutuos ${fondosMutuos.toLocaleString('es-CL')} + Seguro ${seguroAhorro.toLocaleString('es-CL')}`
              : undefined,
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
  const plausibleCandidates = candidates.filter((n) => n >= 10_000_000 && n <= 2_000_000_000);
  const amount = (plausibleCandidates.length ? Math.max(...plausibleCandidates) : Math.max(...candidates)) || null;
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
  // Parser estricto para "Aviso de vencimiento dividendo hipotecario" (Scotiabank).
  // Priorizamos "PACTADO" y "Saldo después del pago" para evitar tomar números basura.
  const extractFromContext = (pattern: RegExp, min: number, max: number) => {
    const values = [...text.matchAll(pattern)]
      .map((m) => parseLocalizedNumber(m[1]) || 0)
      .filter((n) => Number.isFinite(n) && n >= min && n <= max)
      .sort((a, b) => b - a);
    return values[0] || null;
  };

  const ufLikeCandidates = [...text.matchAll(/([0-9]{1,3}(?:[.\s][0-9]{3})?[.,][0-9]{4})/g)]
    .map((m) => parseLocalizedNumber(m[1]) || 0)
    .filter((n) => Number.isFinite(n) && n > 0);

  const ufDividendCandidates = ufLikeCandidates.filter((n) => n >= 51 && n <= 53).sort((a, b) => b - a);
  const ufDebtCandidates = ufLikeCandidates.filter((n) => n >= 2000 && n <= 8850).sort((a, b) => a - b);

  // Dividendo mensual en UF suele venir en formato 53,2439 (rango típico acotado).
  const totalPagar =
    extractFromContext(
      /total\s+a\s+pagar\s+por\s+tipo\s+de\s+dividendo[\s\S]{0,240}?pactado[^0-9]{0,40}([0-9][0-9\s.,]{2,16})/gi,
      51,
      53,
    ) ||
    extractFromContext(
      /dividendo\s+a\s+pagar[\s\S]{0,260}?pactado[^0-9]{0,40}([0-9][0-9\s.,]{2,16})/gi,
      51,
      53,
    ) ||
    extractFromContext(/pactado[^0-9]{0,24}([0-9]{1,3}[.,][0-9]{2,4})/gi, 51, 53) ||
    ufDividendCandidates[0] ||
    null;

  // Saldo deuda en UF suele estar en miles (ej: 8.831,5350).
  const effectiveDebt =
    extractFromContext(/saldo\s+despu[eé]s\s+del\s+pago[^0-9]{0,80}([0-9][0-9\s.,]{2,20})/gi, 2000, 8850) ||
    extractFromContext(/deuda\s+despu[eé]s\s+del\s+pago[^0-9]{0,80}([0-9][0-9\s.,]{2,20})/gi, 2000, 8850) ||
    // Fallback robusto para este formato de aviso: normalmente el menor saldo UF es "después del pago".
    ufDebtCandidates[0] ||
    null;

  const effectiveDividend = totalPagar || null;

  return build([
    effectiveDividend
      ? {
          source: 'Scotiabank dividendo',
          block: 'debt',
          label: 'Dividendo hipotecario mensual',
          amount: effectiveDividend,
          currency: 'UF',
          confidence: 0.9,
          note: 'Detectado desde campo PACTADO del documento hipotecario (normalmente en UF).',
        }
      : null,
    effectiveDebt
      ? {
          source: 'Scotiabank dividendo',
          block: 'debt',
          label: 'Saldo deuda hipotecaria',
          amount: effectiveDebt,
          currency: 'UF',
          confidence: 0.9,
          note: 'Detectado desde campo "Saldo después del pago" (normalmente en UF).',
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

  if (sourceHint === 'dividendo') return parseDividend(text);
  if (sourceHint === 'planvital') return parsePlanvital(text);
  if (sourceHint === 'sura_resumen') return parseSuraResumen(text);
  if (sourceHint === 'sura_detalle') return parseSuraDetalle(text);
  if (sourceHint === 'btg') return parseBtg(text);
  if (sourceHint === 'wise') return parseWise(text);
  if (sourceHint === 'global66') return parseGlobal66(text);

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
      lower.includes('scotiabank') ||
      lower.includes('hipotecario') ||
      lower.includes('saldo deuda') ||
      lower.includes('vencimiento'),
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
