import { format } from 'date-fns';
import { collection, doc, getDoc, getDocsFromServer } from 'firebase/firestore';

import { db } from './firebase';
import {
  getExpensesInRangeOnce,
  getCustomCurrencies,
} from './db';

type AnyDoc = Record<string, any>;

// ZIP (store) sin dependencias externas.
// - Método: sin compresión (STORE)
// - CRC32: implementado aquí para permitir ZIP válido
const _crcTable: number[] = (() => {
  const t: number[] = [];
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();

const crc32 = (data: Uint8Array) => {
  let crc = 0 ^ -1;
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ _crcTable[(crc ^ data[i]) & 0xFF];
  }
  return (crc ^ -1) >>> 0;
};

const u16le = (n: number) => new Uint8Array([n & 0xFF, (n >>> 8) & 0xFF]);
const u32le = (n: number) => new Uint8Array([n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF]);

const concat = (chunks: Uint8Array[]) => {
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
};

const dosDateTime = (date: Date) => {
  const year = Math.max(1980, date.getFullYear());
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);
  const dosTime = (hours << 11) | (minutes << 5) | seconds;
  const dosDate = ((year - 1980) << 9) | (month << 5) | day;
  return { dosTime, dosDate };
};

type ZipFile = { path: string; data: Uint8Array };
// Input simplificado: contenido como string o bytes
type ZipEntryInput = { path: string; content: string | Uint8Array };


const makeZipBlob = (files: ZipFile[]) => {
  const encoder = new TextEncoder();
  const now = new Date();
  const { dosTime, dosDate } = dosDateTime(now);

  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];

  let offset = 0;
  for (const f of files) {
    const nameBytes = encoder.encode(f.path);
    const data = f.data;
    const crc = crc32(data);
    const compMethod = 0; // store

    // Local file header
    const localHeader = concat([
      u32le(0x04034b50),
      u16le(20), // version needed
      u16le(0), // flags
      u16le(compMethod),
      u16le(dosTime),
      u16le(dosDate),
      u32le(crc),
      u32le(data.length),
      u32le(data.length),
      u16le(nameBytes.length),
      u16le(0), // extra len
      nameBytes,
    ]);

    localChunks.push(localHeader, data);

    // Central directory header
    const centralHeader = concat([
      u32le(0x02014b50),
      u16le(20), // version made by
      u16le(20), // version needed
      u16le(0),
      u16le(compMethod),
      u16le(dosTime),
      u16le(dosDate),
      u32le(crc),
      u32le(data.length),
      u32le(data.length),
      u16le(nameBytes.length),
      u16le(0),
      u16le(0),
      u16le(0),
      u16le(0),
      u32le(0),
      u32le(offset),
      nameBytes,
    ]);
    centralChunks.push(centralHeader);

    offset += localHeader.length + data.length;
  }

  const centralDir = concat(centralChunks);
  const centralOffset = offset;
  const centralSize = centralDir.length;

  const endRecord = concat([
    u32le(0x06054b50),
    u16le(0),
    u16le(0),
    u16le(files.length),
    u16le(files.length),
    u32le(centralSize),
    u32le(centralOffset),
    u16le(0),
  ]);

  const zipBytes = concat([...localChunks, centralDir, endRecord]);
  return new Blob([zipBytes], { type: 'application/zip' });
};

function createZipStore(entries: ZipEntryInput[]): Blob {
  const encoder = new TextEncoder();
  const files: ZipFile[] = entries.map((e) => ({
    path: e.path,
    data: typeof e.content === 'string' ? encoder.encode(e.content) : e.content,
  }));
  return makeZipBlob(files);
}

export type ClosingReportForBackup = {
  id: string;
  numeroPeriodo: number;
  fechaInicioYMD?: string;
  fechaFinYMD?: string;
  fechaInicio?: string;
  fechaFin?: string;
  totalGlobalGasto?: number;
  totalGlobalPresupuesto?: number;
};

const safe = (val: any) => {
  const s = String(val ?? '').replace(/\r?\n/g, ' ').trim();
  // Escape simple para CSV con ;
  if (s.includes(';') || s.includes('"')) return `"${s.replace(/"/g, '""')}"`;
  return s;
};

const fmtNum = (n: any) => {
  const num = Number(n);
  if (!isFinite(num)) return '0';
  return String(num).replace('.', ',');
};

const extractYMD = (iso?: string): string | null => {
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
};

const ensureYMD = (r: ClosingReportForBackup, which: 'start' | 'end'): string | null => {
  const direct = which === 'start' ? r.fechaInicioYMD : r.fechaFinYMD;
  if (direct) return direct;
  const fromIso = which === 'start' ? extractYMD(r.fechaInicio) : extractYMD(r.fechaFin);
  return fromIso;
};

async function fetchColl<T = AnyDoc>(name: string): Promise<Array<T & { id: string }>> {
  const snap = await getDocsFromServer(collection(db, name));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
}

async function fetchClosingConfig(): Promise<any> {
  const snap = await getDoc(doc(db, 'meta', 'closing_config'));
  return snap.exists() ? snap.data() : null;
}

async function fetchPeriodSummaries(): Promise<any[]> {
  // Colección: period_summaries
  return fetchColl<any>('period_summaries');
}

function buildExcelTotalCsv(opts: {
  monthlyExpenses: any[];
  projects: any[];
  projectExpenses: any[];
}): string {
  const { monthlyExpenses, projects, projectExpenses } = opts;
  let csv = 'Origen;Fecha;Categoría;Descripción;Monto_EUR;Moneda_Original;Monto_Original;Proyecto;Usuario\n';

  monthlyExpenses
    .filter((e) => e?.estado !== 'borrado')
    .forEach((e) => {
      const userName = safe(e?.creado_por_usuario_id || 'UNKNOWN');
      csv += `DIARIO;${safe(e?.fecha)};${safe(e?.categoria)};${safe(e?.descripcion)};${fmtNum(e?.monto)};${safe(e?.moneda || 'EUR')};${fmtNum(e?.monto)};;${userName}\n`;
    });

  projectExpenses
    .filter((e) => e?.estado !== 'borrado')
    .forEach((e) => {
      const p = projects.find((x) => x.id === e?.proyecto_id);
      const projectName = p?.nombre ? safe(p.nombre) : (e?.proyecto_id ? `[MISSING PROJECT] ${safe(e.proyecto_id)}` : '');
      const userName = safe(e?.creado_por_usuario_id || e?.creado_por || 'UNKNOWN');
      csv += `PROYECTO;${safe(e?.fecha)};${safe(e?.categoria)};${safe(e?.descripcion)};${fmtNum(e?.monto_en_moneda_principal)};${safe(e?.moneda_original || 'EUR')};${fmtNum(e?.monto_original)};${projectName};${userName}\n`;
    });

  return '\uFEFF' + csv;
}

function buildHomePeriodExpensesCsv(items: any[]): string {
  let csv = 'Fecha;Categoría;Descripción;Monto;Moneda;Usuario\n';
  items
    .filter((e) => e?.estado !== 'borrado')
    .sort((a, b) => String(a?.fecha || '').localeCompare(String(b?.fecha || '')))
    .forEach((e) => {
      const userName = safe(e?.creado_por_usuario_id || 'UNKNOWN');
      csv += `${safe(e?.fecha)};${safe(e?.categoria)};${safe(e?.descripcion)};${fmtNum(e?.monto)};${safe(e?.moneda || 'EUR')};${userName}\n`;
    });
  return '\uFEFF' + csv;
}

export async function buildClosingBackupZip(params: {
  reports: ClosingReportForBackup[];
  deviceLabel?: string;
}): Promise<{ blob: Blob; filename: string; meta: { periods: number[] } }> {
  const reports = (params.reports || [])
    .filter((r) => !!r && Number.isFinite(Number(r.numeroPeriodo)))
    .sort((a, b) => Number(a.numeroPeriodo) - Number(b.numeroPeriodo));

  const periods = reports.map((r) => Number(r.numeroPeriodo));

  const nowStr = format(new Date(), 'yyyyMMdd_HHmm');
  const firstP = periods[0];
  const lastP = periods[periods.length - 1];

  const lastEnd = reports.length ? ensureYMD(reports[reports.length - 1], 'end') : null;
  const firstStart = reports.length ? ensureYMD(reports[0], 'start') : null;

  const filename = `GastApp_BACKUP_${firstP === lastP ? `P${firstP}` : `P${firstP}-P${lastP}`}_${firstStart || 'NA'}_${lastEnd || 'NA'}_${nowStr}.zip`;

  const files: ZipEntryInput[] = [];

  // 1) Archivos por periodo (home)
  const periodIndex: any[] = [];
  for (const r of reports) {
    const pNum = Number(r.numeroPeriodo);
    const startYMD = ensureYMD(r, 'start');
    const endYMD = ensureYMD(r, 'end');
    periodIndex.push({ numeroPeriodo: pNum, reportId: r.id, startYMD, endYMD });

    files.push({
      path: `periods/P${pNum}/report.json`,
      content: JSON.stringify(r, null, 2),
    });

    if (startYMD && endYMD) {
      const expenses = await getExpensesInRangeOnce(startYMD, endYMD);
      files.push({
        path: `periods/P${pNum}/home_expenses.csv`,
        content: buildHomePeriodExpensesCsv(expenses),
      });
    }
  }
  files.push({
    path: 'periods/index.json',
    content: JSON.stringify({ generated_at: new Date().toISOString(), periods: periodIndex }, null, 2),
  });

  // 2) Backup full (JSON + CSV total)
  const [
    categories,
    monthly_expenses,
    projects,
    project_expenses,
    monthly_reports,
    period_summaries,
    activity_logs,
    closing_config,
    custom_currencies,
  ] = await Promise.all([
    fetchColl<any>('categories'),
    fetchColl<any>('monthly_expenses'),
    fetchColl<any>('projects'),
    fetchColl<any>('project_expenses'),
    fetchColl<any>('monthly_reports'),
    fetchPeriodSummaries(),
    fetchColl<any>('activity_logs').catch(() => []),
    fetchClosingConfig(),
    getCustomCurrencies().catch(() => []),
  ]);

  const backupJson = {
    meta: {
      created_at: new Date().toISOString(),
      device: params.deviceLabel || null,
      version: 1,
    },
    data: {
      categories,
      monthly_expenses,
      projects,
      project_expenses,
      monthly_reports,
      period_summaries,
      activity_logs,
      closing_config,
      custom_currencies,
    },
  };

  const manifest = {
    meta: {
      created_at: new Date().toISOString(),
      device: params.deviceLabel || null,
      version: 1,
      export_mode: 'A_FULL_SNAPSHOT',
      periods,
      firstStart: firstStart || null,
      lastEnd: lastEnd || null,
    },
    collections: {
      categories: categories.length,
      monthly_expenses: monthly_expenses.length,
      projects: projects.length,
      project_expenses: project_expenses.length,
      monthly_reports: monthly_reports.length,
      period_summaries: Array.isArray(period_summaries) ? period_summaries.length : 0,
      activity_logs: activity_logs.length,
      custom_currencies: Array.isArray(custom_currencies) ? custom_currencies.length : 0,
      closing_config: closing_config ? 1 : 0,
    },
  };

  files.push({ path: 'all_history/backup.json', content: JSON.stringify(backupJson, null, 2) });
  files.push({ path: 'all_history/manifest.json', content: JSON.stringify(manifest, null, 2) });
  files.push({
    path: 'all_history/excel_total.csv',
    content: buildExcelTotalCsv({ monthlyExpenses: monthly_expenses, projects, projectExpenses: project_expenses }),
  });

  // 3) Meta humana
  files.push({
    path: 'README.txt',
    content: [
      'GastApp Backup ZIP',
      `Generado: ${new Date().toISOString()}`,
      `Periodos incluidos: ${periods.join(', ')}`,
      '',
      'Contenido:',
      '- periods/Pxx/report.json + home_expenses.csv (día a día del periodo)',
      '- all_history/backup.json (snapshot completo Firestore)',
      '- all_history/manifest.json (conteo de colecciones exportadas)',
      '- all_history/excel_total.csv (CSV gigante para Excel)',
      '',
      'Nota: el CSV usa separador ; y coma decimal.',
      '',
    ].join('\n'),
  });

  const blob = createZipStore(files);
  return { blob, filename, meta: { periods } };
}

export function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
