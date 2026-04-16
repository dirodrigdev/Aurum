import type { WealthCurrency, WealthFxRates } from './wealthStorage';

export const fromClpUsingFx = (
  amountClp: number,
  currency: WealthCurrency,
  fx: Pick<WealthFxRates, 'usdClp' | 'eurClp' | 'ufClp'>,
): number => {
  if (currency === 'CLP') return amountClp;
  if (currency === 'USD') return amountClp / Math.max(1, fx.usdClp);
  if (currency === 'EUR') return amountClp / Math.max(1, fx.eurClp);
  return amountClp / Math.max(1, fx.ufClp);
};

export const buildDisplayDeltaFromClp = ({
  currentClp,
  previousClp,
  currency,
  currentFx,
  previousFx,
}: {
  currentClp: number;
  previousClp: number;
  currency: WealthCurrency;
  currentFx: Pick<WealthFxRates, 'usdClp' | 'eurClp' | 'ufClp'>;
  previousFx: Pick<WealthFxRates, 'usdClp' | 'eurClp' | 'ufClp'>;
}): {
  currentDisplay: number;
  previousDisplay: number;
  deltaDisplay: number;
  pctDisplay: number | null;
} => {
  const currentDisplay = fromClpUsingFx(currentClp, currency, currentFx);
  const previousDisplay = fromClpUsingFx(previousClp, currency, previousFx);
  const deltaDisplay = currentDisplay - previousDisplay;
  const pctDisplay = previousDisplay !== 0 ? (deltaDisplay / previousDisplay) * 100 : null;
  return { currentDisplay, previousDisplay, deltaDisplay, pctDisplay };
};
