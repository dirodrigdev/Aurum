import { afterEach, describe, expect, it, vi } from 'vitest';
// The Vercel endpoint is JavaScript by design; these exports keep its SII parser testable offline.
// @ts-expect-error The API route has no standalone declaration file.
import {
  canonicalChileTodayYmd,
  extractSiiDayValues,
  extractSiiMonthSection,
  fetchUfFromSii,
} from '../api/fx/live.js';

afterEach(() => vi.unstubAllGlobals());

describe('live FX UF source', () => {
  it('parses only the requested SII month and its Chilean decimal values', () => {
    const html = `
      <div class='meses' id='mes_octubre'><h3>Octubre</h3>
        <th><strong>04</strong></th><td>40.820,31</td>
        <th><strong>05</strong></th><td>40.821,12</td>
      </div>
      <div class='meses' id='mes_noviembre'><h3>Noviembre</h3>
        <th><strong>01</strong></th><td>40.900,00</td>
      </div>`;

    expect(extractSiiDayValues(extractSiiMonthSection(html, 10))).toEqual([
      { day: 4, value: 40820.31 },
      { day: 5, value: 40821.12 },
    ]);
  });

  it('uses the latest official UF available on the current Chilean calendar day', async () => {
    const html = `
      <div class='meses' id='mes_octubre'><h3>Octubre</h3>
        <th><strong>04</strong></th><td>40.820,31</td>
        <th><strong>05</strong></th><td>40.821,12</td>
      </div>`;
    const fetchMock = vi.fn(async () => new Response(html, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchUfFromSii(new Date('2026-10-05T02:00:00.000Z'));

    expect(canonicalChileTodayYmd(new Date('2026-10-05T02:00:00.000Z'))).toBe('2026-10-04');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toContain('/uf/uf2026.htm');
    expect(result).toEqual({
      uf: 40820.31,
      ufDate: '2026-10-04',
      source: 'sii.cl:2026-10-04',
    });
  });
});
