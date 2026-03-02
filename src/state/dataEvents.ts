/**
 * Lightweight in-app event bus to force refreshes after Firestore writes.
 * Goal: avoid "totales fantasmas" (UI showing stale aggregates vs. movements).
 *
 * Important:
 * - This is NOT a Firestore listener.
 * - It's only a local "invalidate/reload" signal for screens that do point-in-time fetches.
 */

export type DataEventName =
  | 'active_period_changed'
  | 'monthly_expenses_changed'
  | 'period_summaries_changed'
  | 'monthly_reports_changed'
  | 'closing_config_changed'
  | 'categories_changed'
  | 'projects_changed'
  | 'project_expenses_changed'
  | 'custom_currencies_changed';

type Listener = () => void;

const listeners = new Map<DataEventName, Set<Listener>>();

export function emitDataEvent(name: DataEventName) {
  const set = listeners.get(name);
  if (!set || set.size === 0) return;

  // Clone to avoid issues if a listener unsubscribes mid-emit
  [...set].forEach((fn) => {
    try {
      fn();
    } catch (e) {
      // Never break the app because of an invalidation callback
      console.error('[dataEvents] listener error', name, e);
    }
  });
}

export function subscribeDataEvent(name: DataEventName, listener: Listener): () => void {
  let set = listeners.get(name);
  if (!set) {
    set = new Set<Listener>();
    listeners.set(name, set);
  }
  set.add(listener);

  return () => {
    const current = listeners.get(name);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) listeners.delete(name);
  };
}
