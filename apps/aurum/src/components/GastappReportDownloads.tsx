import React from 'react';
import { Button, Card } from './Components';
import {
  requestGastappReportDownload,
  type GastappReportExportKind,
  type GastappReportRange,
} from '../services/gastappFullHandoff';

export type GastappReportDownloadState = {
  status: 'idle' | 'loading' | 'ok' | 'error';
  message: string;
};

const INITIAL_DOWNLOADS: Record<GastappReportExportKind, GastappReportDownloadState> = {
  summary_xlsx: { status: 'idle', message: '' },
  full_xlsx: { status: 'idle', message: '' },
  ai_json: { status: 'idle', message: '' },
};

const REPORTS: Array<[GastappReportExportKind, string]> = [
  ['summary_xlsx', 'Descargar informe resumido (.xlsx)'],
  ['full_xlsx', 'Descargar informe completo (.xlsx)'],
  ['ai_json', 'Descargar datos para IA (.json)'],
];

const RANGES: Array<[GastappReportRange, string]> = [
  ['12p', 'Últimos 12 períodos'],
  ['24p', 'Últimos 24 períodos'],
  ['36p', 'Últimos 36 períodos'],
  ['all', 'Todo el historial'],
];

export const GastappReportDownloads: React.FC = () => {
  const [downloads, setDownloads] = React.useState(INITIAL_DOWNLOADS);
  const [pendingReportKind, setPendingReportKind] = React.useState<GastappReportExportKind | null>(null);

  const download = async (kind: GastappReportExportKind, reportRange: GastappReportRange) => {
    setDownloads((current) => ({
      ...current,
      [kind]: { status: 'loading', message: 'Preparando descarga…' },
    }));
    try {
      await requestGastappReportDownload(kind, reportRange);
      setDownloads((current) => ({
        ...current,
        [kind]: { status: 'ok', message: 'Descarga completada.' },
      }));
    } catch (error) {
      setDownloads((current) => ({
        ...current,
        [kind]: {
          status: 'error',
          message: `No se pudo descargar: ${String((error as any)?.message || error || 'error')}`,
        },
      }));
    }
  };

  return (
    <Card className="border border-emerald-200 bg-emerald-50/30 p-3" data-testid="gastapp-reports-block">
      <div className="text-sm font-semibold text-slate-900">Descargas de GastApp</div>
      <div className="mt-1 text-[11px] text-slate-600">Informes bajo demanda · la descarga se prepara en GastApp y vuelve a Aurum</div>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {REPORTS.map(([kind, label]) => {
          const report = downloads[kind];
          return (
            <div key={kind} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2">
              <Button
                variant="secondary"
                size="sm"
                className="w-full"
                disabled={report.status === 'loading'}
                onClick={() => setPendingReportKind(kind)}
              >
                {report.status === 'loading' ? 'Preparando…' : label}
              </Button>
              {!!report.message && <div className="mt-1 whitespace-pre-line break-words text-[10px] text-slate-600">{report.message}</div>}
            </div>
          );
        })}
      </div>

      {pendingReportKind && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/35 px-4 py-6" role="presentation">
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="gastapp-report-range-title"
            data-testid="gastapp-report-range-modal"
          >
            <div className="text-base font-bold text-slate-900" id="gastapp-report-range-title">¿Qué períodos quieres incluir?</div>
            <div className="mt-1 text-xs text-slate-500">La selección sólo afecta al archivo descargado.</div>
            <div className="mt-4 grid gap-2">
              {RANGES.map(([reportRange, label]) => (
                <button
                  key={reportRange}
                  type="button"
                  className="flex min-h-10 items-center justify-between rounded-xl border border-slate-200 px-3 text-left text-sm font-semibold text-slate-700 transition hover:border-emerald-300 hover:bg-emerald-50"
                  onClick={() => {
                    const kind = pendingReportKind;
                    setPendingReportKind(null);
                    void download(kind, reportRange);
                  }}
                >
                  <span>{label}</span>
                  <span className="text-[11px] font-normal text-slate-400">{reportRange}</span>
                </button>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <Button type="button" variant="outline" size="sm" onClick={() => setPendingReportKind(null)}>
                Cancelar
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
};
