import type { SimulationConfigHydrationStatus } from '../../integrations/midas/simulationConfigCanonical';
import type { AurumIntegrationAuthStatus } from '../../integrations/aurum/firebase';

export type MidasAuthGateStatus =
  | 'checkingAuth'
  | 'loginRequired'
  | 'signingIn'
  | 'redirectPending'
  | 'authenticatedButAnonymous'
  | 'authError'
  | 'cloudConfigLoading'
  | 'cloudConfigMissing'
  | 'cloudConfigError'
  | 'ready';

export type BuildAuthGateStatusInput = {
  authStatus: AurumIntegrationAuthStatus;
  authResolved: boolean;
  authSigningIn: boolean;
  authErrorMessage: string | null;
  simulationConfigHydrationStatus: SimulationConfigHydrationStatus;
  simulationConfigErrorMessage: string | null;
};

export type AuthGateStatusViewModel = {
  status: MidasAuthGateStatus;
  headline: string;
  message: string;
  detail: string | null;
  primaryActionLabel: string | null;
  secondaryActionLabel: string | null;
  showPrimaryAction: boolean;
  showSecondaryAction: boolean;
  isBlocking: boolean;
};

export function buildAuthGateStatus(input: BuildAuthGateStatusInput): AuthGateStatusViewModel {
  if (!input.authResolved || input.authStatus === 'checkingAuth') {
    return {
      status: 'checkingAuth',
      headline: 'Validando sesión segura',
      message: 'Estamos confirmando tu sesión Google antes de cargar la configuración canónica de MIDAS.',
      detail: input.authErrorMessage,
      primaryActionLabel: null,
      secondaryActionLabel: null,
      showPrimaryAction: false,
      showSecondaryAction: false,
      isBlocking: true,
    };
  }

  if (input.authSigningIn || input.authStatus === 'signingIn') {
    return {
      status: 'signingIn',
      headline: 'Abriendo Google',
      message: 'Estamos iniciando el flujo de Google. Completa el acceso para continuar.',
      detail: null,
      primaryActionLabel: null,
      secondaryActionLabel: null,
      showPrimaryAction: false,
      showSecondaryAction: false,
      isBlocking: true,
    };
  }

  if (input.authStatus === 'redirectPending') {
    return {
      status: 'redirectPending',
      headline: 'Completando inicio de sesión',
      message: 'Google ya respondió. Estamos terminando de validar la sesión en este dispositivo.',
      detail: input.authErrorMessage,
      primaryActionLabel: 'Reintentar',
      secondaryActionLabel: 'Cerrar sesión',
      showPrimaryAction: true,
      showSecondaryAction: true,
      isBlocking: true,
    };
  }

  if (input.authStatus === 'loginRequired') {
    return {
      status: 'loginRequired',
      headline: 'Necesitas iniciar sesión con Google',
      message: 'MIDAS usa una sesión Google canónica para sincronizar la misma configuración M8 entre desktop y mobile.',
      detail: input.authErrorMessage,
      primaryActionLabel: 'Entrar con Google',
      secondaryActionLabel: null,
      showPrimaryAction: true,
      showSecondaryAction: false,
      isBlocking: true,
    };
  }

  if (input.authStatus === 'authenticatedButAnonymous') {
    return {
      status: 'authenticatedButAnonymous',
      headline: 'La sesión actual no es canónica',
      message: 'Detectamos una sesión anónima o incompleta. Inicia sesión con Google para usar la configuración compartida de MIDAS.',
      detail: input.authErrorMessage,
      primaryActionLabel: 'Entrar con Google',
      secondaryActionLabel: 'Cerrar sesión',
      showPrimaryAction: true,
      showSecondaryAction: true,
      isBlocking: true,
    };
  }

  if (input.authStatus === 'authError') {
    return {
      status: 'authError',
      headline: 'No pudimos validar la sesión',
      message: 'La app no logró cerrar correctamente la validación de Google. Puedes reintentar o limpiar la sesión local.',
      detail: input.authErrorMessage,
      primaryActionLabel: 'Reintentar',
      secondaryActionLabel: 'Cerrar sesión',
      showPrimaryAction: true,
      showSecondaryAction: true,
      isBlocking: true,
    };
  }

  if (input.simulationConfigHydrationStatus === 'loading') {
    return {
      status: 'cloudConfigLoading',
      headline: 'Sesión Google validada',
      message: 'Ahora estamos cargando la configuración canónica M8 desde cloud.',
      detail: null,
      primaryActionLabel: 'Reintentar',
      secondaryActionLabel: 'Cerrar sesión',
      showPrimaryAction: true,
      showSecondaryAction: true,
      isBlocking: true,
    };
  }

  if (input.simulationConfigHydrationStatus === 'missing') {
    return {
      status: 'cloudConfigMissing',
      headline: 'No existe configuración cloud todavía',
      message: 'La sesión Google ya está validada, pero este usuario todavía no tiene una configuración M8 canónica guardada.',
      detail: input.simulationConfigErrorMessage,
      primaryActionLabel: 'Reintentar',
      secondaryActionLabel: 'Cerrar sesión',
      showPrimaryAction: true,
      showSecondaryAction: true,
      isBlocking: true,
    };
  }

  if (input.simulationConfigHydrationStatus === 'error') {
    return {
      status: 'cloudConfigError',
      headline: 'No pudimos leer la configuración M8',
      message: 'La sesión Google está lista, pero la configuración cloud falló. Revisa el error técnico o reintenta la sincronización.',
      detail: input.simulationConfigErrorMessage,
      primaryActionLabel: 'Reintentar',
      secondaryActionLabel: 'Cerrar sesión',
      showPrimaryAction: true,
      showSecondaryAction: true,
      isBlocking: true,
    };
  }

  return {
    status: 'ready',
    headline: 'Listo',
    message: 'La sesión Google y la configuración canónica están disponibles.',
    detail: null,
    primaryActionLabel: null,
    secondaryActionLabel: null,
    showPrimaryAction: false,
    showSecondaryAction: false,
    isBlocking: false,
  };
}
