import { useEffect, useState } from 'react';
import type { DataEventName } from '../state/dataEvents';
import { subscribeDataEvent } from '../state/dataEvents';

/**
 * React hook that returns a monotonically increasing number whenever the event is emitted.
 * Use it as a dependency in useEffect/useMemo to force reload of "once" fetch screens.
 */
export function useDataEvent(name: DataEventName) {
  const [rev, setRev] = useState(0);

  useEffect(() => {
    const unsub = subscribeDataEvent(name, () => setRev((r) => r + 1));
    return () => {
      unsub();
    };
  }, [name]);

  return rev;
}
