export interface ParseNumberOptions {
  /**
   * Si es true, una cadena vacía se interpretará como 0 en vez de NaN.
   * Útil para inputs opcionales donde el "no ingreso" equivale a 0.
   */
  emptyAsZero?: boolean;

  /**
   * Si es true, valores no numéricos o mal formateados se devuelven como 0 en vez de NaN.
   */
  invalidAsZero?: boolean;
}

/**
 * Normaliza una cadena numérica que puede venir en distintos formatos locales.
 *
 * Reglas principales:
 * - Ignora espacios internos.
 * - Soporta separadores de miles con "." o ",".
 * - Soporta separador decimal "." o ",".
 * - Si hay "." y "," a la vez, el último símbolo se considera decimal y el resto miles.
 */
export const normalizeNumberString = (raw: string): string | null => {
  if (raw == null) return null;

  const compact = String(raw).trim().replace(/\s+/g, '');
  if (!compact) return null;

  let normalized = compact;
  const hasComma = compact.includes(',');
  const hasDot = compact.includes('.');

  if (hasComma && hasDot) {
    if (compact.lastIndexOf(',') > compact.lastIndexOf('.')) {
      normalized = compact.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = compact.replace(/,/g, '');
    }
  } else if (hasComma) {
    const commaAsThousands = /^\d{1,3}(,\d{3})+$/.test(compact);
    normalized = commaAsThousands ? compact.replace(/,/g, '') : compact.replace(',', '.');
  } else if (hasDot) {
    const dotAsThousands = /^\d{1,3}(\.\d{3})+$/.test(compact);
    normalized = dotAsThousands ? compact.replace(/\./g, '') : compact;
  }

  return normalized;
};

/**
 * Parser numérico unificado para inputs de usuario en Aurum.
 *
 * - Usa `normalizeNumberString` para resolver "."/"," como miles o decimal.
 * - Devuelve NaN por defecto en caso de input vacío o inválido, salvo que se configure lo contrario.
 */
export const parseUnifiedNumber = (raw: string, options: ParseNumberOptions = {}): number => {
  const { emptyAsZero = false, invalidAsZero = false } = options;

  const normalized = normalizeNumberString(raw);
  if (normalized == null) {
    if (emptyAsZero || invalidAsZero) return 0;
    return Number.NaN;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    if (invalidAsZero) return 0;
    return Number.NaN;
  }

  return parsed;
};

/**
 * Variante estricta: vacíos/errores -> NaN.
 * Útil para validaciones de TC/UF, tasas, etc.
 */
export const parseStrictNumber = (raw: string): number =>
  parseUnifiedNumber(raw, { emptyAsZero: false, invalidAsZero: false });

/**
 * Variante tolerante: vacíos/errores -> 0.
 * Sustituto directo para parseos permisivos.
 */
export const parseNumberOrZero = (raw: string): number =>
  parseUnifiedNumber(raw, { emptyAsZero: true, invalidAsZero: true });
