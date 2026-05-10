import type { M8InputFingerprint } from './m8InputFingerprint';

export type SimulationActionLevel = 'ok' | 'review' | 'provisional' | 'blocked';

export type SimulationActionStatus = {
  level: SimulationActionLevel;
  headline: string;
  message: string;
  actionItems: string[];
  technicalItems: string[];
  canTrustResult: boolean;
  canUseForDecision: boolean;
  primaryActionLabel?: string;
};

export type BuildSimulationActionStatusInput = {
  authResolved: boolean;
  isCanonicalUserSession: boolean;
  authErrorMessage: string | null;
  cloudHydrationReady: boolean;
  simulationConfigSource: 'cloud' | 'local_cache' | 'fallback';
  universeSourceOrigin: 'firestore' | 'cache-local' | 'none';
  aurumIntegrationStatus: 'loading' | 'refreshing' | 'available' | 'partial' | 'missing' | 'error' | 'unconfigured';
  hasValidSpendingPhases: boolean;
  hasValidCapital: boolean;
  hasValidUniverseMix: boolean;
  fingerprint: M8InputFingerprint;
};

const limitItems = (items: string[], max = 3) => items.filter(Boolean).slice(0, max);

export function buildSimulationActionStatus(input: BuildSimulationActionStatusInput): SimulationActionStatus {
  const technicalItems: string[] = [];
  const actionItems: string[] = [];

  if (!input.authResolved) {
    return {
      level: 'provisional',
      headline: 'Validando sesión',
      message: 'Estamos confirmando la sesión Google antes de usar la configuración canónica.',
      actionItems: limitItems(['Esperar validación de sesión.']),
      technicalItems,
      canTrustResult: false,
      canUseForDecision: false,
      primaryActionLabel: 'Sincronizar',
    };
  }

  if (!input.isCanonicalUserSession) {
    return {
      level: 'blocked',
      headline: 'Inicia sesión con Google',
      message: 'MIDAS necesita una sesión Google canónica para comparar desktop y mobile con la misma configuración.',
      actionItems: limitItems([
        'Entrar con Google para cargar la configuración M8 compartida.',
        input.authErrorMessage ? `Revisar error de auth: ${input.authErrorMessage}` : '',
      ]),
      technicalItems,
      canTrustResult: false,
      canUseForDecision: false,
      primaryActionLabel: 'Entrar con Google',
    };
  }

  if (!input.hasValidCapital) {
    actionItems.push('Falta capital simulable válido para correr M8.');
  }
  if (!input.hasValidSpendingPhases) {
    actionItems.push('Faltan gastos válidos en fases F1–F4.');
  }
  if (!input.hasValidUniverseMix) {
    actionItems.push('No hay mix de instrumentos válido para la simulación.');
  }
  if (input.aurumIntegrationStatus === 'missing' || input.aurumIntegrationStatus === 'error') {
    actionItems.push('No hay snapshot Aurum válido sincronizado.');
  }

  const isBlocked = actionItems.length > 0;
  const isProvisional = !isBlocked && !input.cloudHydrationReady;

  if (input.simulationConfigSource !== 'cloud') {
    technicalItems.push('Parámetros de simulación desde cache/fallback.');
  }
  if (input.universeSourceOrigin !== 'firestore') {
    technicalItems.push('Mix de instrumentos no viene desde cloud Firestore.');
  }
  technicalItems.push(...input.fingerprint.warnings);

  const reviewItems = technicalItems.filter((item) =>
    !item.toLowerCase().includes('hydratación cloud incompleta'),
  );

  if (isBlocked) {
    return {
      level: 'blocked',
      headline: 'No usar este resultado todavía',
      message: 'Faltan datos críticos o hay una fuente inválida. Corrige esto antes de usar la simulación.',
      actionItems: limitItems(actionItems),
      technicalItems,
      canTrustResult: false,
      canUseForDecision: false,
      primaryActionLabel: 'Revisar Ajustes',
    };
  }

  if (isProvisional) {
    return {
      level: 'provisional',
      headline: 'Resultado provisional',
      message: 'La app todavía está sincronizando fuentes. Espera la sincronización antes de decidir.',
      actionItems: limitItems([
        'Esperar sincronización cloud completa.',
        input.simulationConfigSource !== 'cloud' ? 'Validar parámetros F1–F4 sincronizados.' : '',
      ]),
      technicalItems,
      canTrustResult: false,
      canUseForDecision: false,
      primaryActionLabel: 'Sincronizar',
    };
  }

  if (reviewItems.length > 0) {
    return {
      level: 'review',
      headline: 'Revisar 1 punto',
      message: 'El resultado sigue usable, pero conviene revisar un punto antes de tomar decisiones importantes.',
      actionItems: limitItems([
        input.universeSourceOrigin !== 'firestore'
          ? 'Sincronizar mix de instrumentos desde cloud.'
          : 'Revisar fuente local/fallback activa.',
      ]),
      technicalItems,
      canTrustResult: true,
      canUseForDecision: true,
      primaryActionLabel: 'Sincronizar',
    };
  }

  return {
    level: 'ok',
    headline: 'No necesitas hacer nada',
    message: 'Resultado confiable. Las fuentes principales están sincronizadas y el input M8 es estable.',
    actionItems: [],
    technicalItems,
    canTrustResult: true,
    canUseForDecision: true,
    primaryActionLabel: 'Recalcular',
  };
}
