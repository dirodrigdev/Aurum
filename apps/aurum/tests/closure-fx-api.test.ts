import { describe, expect, it } from 'vitest';
// The Vercel endpoint is JavaScript by design; these exports keep its HTML parser testable offline.
// @ts-expect-error The API route has no standalone declaration file.
import { economicDateForMonth, extractDayValues, extractMonthSection } from '../api/fx/closure.js';

describe('closure FX historical API parser', () => {
  it('keeps descending SII month sections isolated', () => {
    const html = `
      <div class='meses' id='mes_junio'><h3>Junio</h3>
        <th><strong>30</strong></th><td>922.34</td>
      </div>
      <div class='meses' id='mes_mayo'><h3>Mayo</h3>
        <th><strong>29</strong></th><td>892.89</td>
        <th><strong>31</strong></th><td></td>
      </div>
      <div class='meses' id='mes_abril'><h3>Abril</h3>
        <th><strong>30</strong></th><td>901.76</td>
      </div>`;

    expect(extractDayValues(extractMonthSection(html, 5))).toEqual([{ day: 29, value: 892.89 }]);
    expect(extractDayValues(extractMonthSection(html, 6))).toEqual([{ day: 30, value: 922.34 }]);
  });

  it('isolates heading-based UF sections and derives month end', () => {
    const html = `
      <table><h2>Junio</h2><th><strong>30</strong></th><td>40.820,31</td></table>
      <table><h2>Mayo</h2><th><strong>31</strong></th><td>40.610,69</td></table>`;

    expect(economicDateForMonth('2026-05')).toBe('2026-05-31');
    expect(extractDayValues(extractMonthSection(html, 5))).toEqual([{ day: 31, value: 40610.69 }]);
  });
});
