import type { FinancialDataRoomManifest } from './dataRoomTypes';

const formatLedgerPreviewPeriodRange = (value: FinancialDataRoomManifest['gastapp_ledger_preview_period_range']) => {
  if (!value) return 'sin período informado';
  if (value.label) return value.label;
  const periodLabel = value.fromPeriod && value.toPeriod ? `${value.fromPeriod}→${value.toPeriod}` : null;
  const monthLabel = value.fromMonthKey && value.toMonthKey ? `${value.fromMonthKey}→${value.toMonthKey}` : null;
  return [periodLabel, monthLabel].filter(Boolean).join(' / ') || 'sin período informado';
};

export const buildFinancialDataRoomReadme = (manifest: FinancialDataRoomManifest) => {
  const includesTransactions = manifest.includes.gastapp_transactions;
  const gastappLine = manifest.includes.gastapp_monthly
    ? '- GastApp: incluida solo la vista mensual `aurum_monthly_from_periods_v1`.'
    : `- GastApp: no disponible en este ZIP (${manifest.source_status.gastapp_status}).`;
  const gastappLedgerLine = manifest.gastapp_ledger_preview_available
    ? `- GastApp ledger preview: incluido como anexo de validación (${formatLedgerPreviewPeriodRange(manifest.gastapp_ledger_preview_period_range)}).`
    : `- GastApp ledger preview: no disponible en este ZIP (${manifest.gastapp_ledger_preview_status}).`;
  const gastappTransactionsLine = includesTransactions && manifest.gastapp_data_room_v2
    ? `- GastApp Data Room v2: incluido con transacciones (${manifest.gastapp_data_room_v2.period_summaries_count} resúmenes, ${manifest.gastapp_data_room_v2.row_count} filas).`
    : '- GastApp Data Room v2: no incluido en este ZIP.';

  return `# ${includesTransactions ? 'Base financiera con transacciones' : 'Base financiera consolidada'}

Este ZIP contiene una base financiera ${includesTransactions ? 'con transacciones' : 'consolidada'} pensada para análisis asistido por IA.

## Qué usar primero
- \`01_resumen_ejecutivo.csv\`: panorama rápido del bundle.
- \`02_panel_mensual_consolidado.csv\`: serie mensual consolidada para cruces.
- \`03_aurum_patrimonio_mensual.csv\` y \`05_aurum_detalle_bloques.csv\`: detalle patrimonial de Aurum.
- \`09_midas_inputs_resultados.csv\`: inputs y snapshots relevantes de MIDAS.
${includesTransactions ? '- `gastapp_data_room_v2_period_summaries.csv` y `gastapp_data_room_v2_rows.csv`: capa profunda de GastApp Data Room v2.\n' : ''}
## Alcance de este MVP
- Aurum: patrimonio mensual, cierres, retornos disponibles y detalle patrimonial.
- MIDAS: configuración activa, universo instrumental y snapshot público de optimizables.
${gastappLine}
${gastappLedgerLine}
${gastappTransactionsLine}

## GastApp ledger preview
- Es un anexo de preview/validación, no una fuente oficial de cálculo.
- No reemplaza \`aurum_monthly_from_periods_v1\`.
- No entra a Retorno Económico.
- No alimenta MIDAS.
- No cambia patrimonio.
- Por ahora cubre solo los períodos publicados en preview, actualmente P29–P36.

## GastApp Data Room v2
- La capa profunda se descarga solo cuando el usuario la pide explícitamente.
- Incluye el manifest publicado, resúmenes por período y filas paginadas exportadas a JSON/CSV.
- Si \`readinessStatus=warning\` pero \`officialRefreshAllowed=true\` y \`blockers=[]\`, este ZIP conserva la advertencia y sigue exportando.
- No reemplaza la fuente mensual oficial de Retornos.

## Limitaciones
- Este MVP no incluye todavía categorías ni subcategorías completas de GastApp.
- El anexo ledger preview no reemplaza la vista mensual oficial actual de GastApp.
- No depende de \`latestProjection\` de MIDAS.
- Si una fuente no está disponible, el ZIP se genera parcial y el detalle queda en \`manifest.json\`.
- No se deben inventar datos faltantes a partir de este bundle.

## Integridad
- Generado en modo solo lectura.
- \`no_data_modified\` = true en \`manifest.json\`.
`;
};
