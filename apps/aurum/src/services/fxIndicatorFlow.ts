export const FX_INDICATOR_APPLIED_SNAPSHOT_KEY = 'aurum.fx-indicators.applied.v1';
export const FX_INDICATOR_PENDING_SNAPSHOT_KEY = 'aurum.fx-indicators.pending.v1';
export const FX_INDICATOR_MONTH_STARTED_KEY = 'aurum.fx-indicators.month-started.v1';
export const FX_INDICATOR_SUPPRESS_AFTER_START_KEY = 'aurum.fx-indicators.suppress-after-start.v1';

export type FxIndicatorGateState = {
  monthStarted: boolean;
  suppressAfterStart: boolean;
  hasPendingPrompt: boolean;
};

export const buildFxIndicatorGateState = (input: FxIndicatorGateState) => ({
  showPrompt: input.monthStarted && !input.suppressAfterStart && input.hasPendingPrompt,
  showInlineNotice: input.monthStarted && input.hasPendingPrompt,
  suppressAutoPrompt: !input.monthStarted || input.suppressAfterStart,
});
