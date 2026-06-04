import type { FinancialDataRoomManifest } from './dataRoomTypes';

export const buildFinancialDataRoomReadme = (manifest: FinancialDataRoomManifest) => {
  const gastappLine = manifest.includes.gastapp_monthly
    ? '- GastApp: incluida solo la vista mensual `aurum_monthly_from_periods_v1`.'
    : `- GastApp: no disponible en este ZIP (${manifest.source_status.gastapp_status}).`;

  return `# Base financiera consolidada\n\nEste ZIP contiene una base financiera consolidada pensada para análisis asistido por IA.\n\n## Qué usar primero\n- \`01_resumen_ejecutivo.csv\`: panorama rápido del bundle.\n- \`02_panel_mensual_consolidado.csv\`: serie mensual consolidada para cruces.\n- \`03_aurum_patrimonio_mensual.csv\` y \`05_aurum_detalle_bloques.csv\`: detalle patrimonial de Aurum.\n- \`09_midas_inputs_resultados.csv\`: inputs y snapshots relevantes de MIDAS.\n\n## Alcance de este MVP\n- Aurum: patrimonio mensual, cierres, retornos disponibles y detalle patrimonial.\n- MIDAS: configuración activa, universo instrumental y snapshot público de optimizables.\n${gastappLine}\n\n## Limitaciones\n- Este MVP no incluye todavía transacciones, categorías ni subcategorías completas de GastApp.\n- No depende de \`latestProjection\` de MIDAS.\n- Si una fuente no está disponible, el ZIP se genera parcial y el detalle queda en \`manifest.json\`.\n- No se deben inventar datos faltantes a partir de este bundle.\n\n## Integridad\n- Generado en modo solo lectura.\n- \`no_data_modified\` = true en \`manifest.json\`.\n`;
};
