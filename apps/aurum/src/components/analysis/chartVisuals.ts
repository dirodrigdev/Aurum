export const buildSmartVisualDomain = (values: number[]) => {
  if (!values.length) {
    return { domainMin: 0, domainMax: 1 };
  }

  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = maxValue - minValue;
  const meanValue = values.reduce((sum, value) => sum + value, 0) / values.length;
  const meanMagnitude = Math.max(Math.abs(meanValue), Math.abs(maxValue), Math.abs(minValue), 1);
  const padding = range > 0 ? Math.max(range * 0.1, meanMagnitude * 0.01) : Math.max(meanMagnitude * 0.02, 1);

  let domainMin = minValue - padding;
  let domainMax = maxValue + padding;

  if (minValue > 0 && domainMin <= 0) {
    const zeroIsNear = minValue <= Math.max(range * 0.25, meanMagnitude * 0.03, 1);
    if (!zeroIsNear) {
      domainMin = Math.max(minValue - padding, meanMagnitude * 0.001);
    }
  }

  if (maxValue < 0 && domainMax >= 0) {
    const zeroIsNear = Math.abs(maxValue) <= Math.max(range * 0.25, meanMagnitude * 0.03, 1);
    if (!zeroIsNear) {
      domainMax = Math.min(maxValue + padding, -meanMagnitude * 0.001);
    }
  }

  if (domainMax <= domainMin) {
    domainMax = domainMin + Math.max(padding, 1);
  }

  return { domainMin, domainMax };
};
