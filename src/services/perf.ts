type PerfSnapshot = {
  listeners: number;
  listenersByKey: Record<string, number>;
  lastEventAt: string | null;
  lastEvent: string | null;
};

let state: PerfSnapshot = {
  listeners: 0,
  listenersByKey: {},
  lastEventAt: null,
  lastEvent: null,
};

type Listener = (s: PerfSnapshot) => void;
const listeners = new Set<Listener>();

const now = () => new Date().toISOString();

const emit = () => {
  for (const fn of listeners) {
    try {
      fn(state);
    } catch {
      // no-op
    }
  }
};

const bump = (event: string) => {
  state = { ...state, lastEventAt: now(), lastEvent: event };
  emit();
};

export const subscribePerf = (fn: Listener) => {
  listeners.add(fn);
  // Snapshot inmediato
  fn(state);
  return () => listeners.delete(fn);
};

export const getPerfSnapshot = () => state;

export const perfReset = () => {
  state = {
    listeners: 0,
    listenersByKey: {},
    lastEventAt: now(),
    lastEvent: 'reset',
  };
  emit();
};

export const perfIncListener = (key: string) => {
  const prev = state.listenersByKey[key] || 0;
  state = {
    ...state,
    listeners: state.listeners + 1,
    listenersByKey: { ...state.listenersByKey, [key]: prev + 1 },
  };
  bump(`listener+ ${key}`);
};

export const perfDecListener = (key: string) => {
  const prev = state.listenersByKey[key] || 0;
  const nextKey = Math.max(0, prev - 1);
  const nextByKey = { ...state.listenersByKey, [key]: nextKey };
  if (nextKey === 0) delete nextByKey[key];

  state = {
    ...state,
    listeners: Math.max(0, state.listeners - 1),
    listenersByKey: nextByKey,
  };
  bump(`listener- ${key}`);
};
