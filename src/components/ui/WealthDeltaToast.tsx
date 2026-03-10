import React, { useEffect, useState } from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { formatCurrencyNoDecimals } from '../../utils/wealthFormat';

interface WealthDeltaToastProps {
  visible: boolean;
  delta: number;
  reason?: string;
}

export const WealthDeltaToast: React.FC<WealthDeltaToastProps> = ({ visible, delta, reason }) => {
  const [rendered, setRendered] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    let frame = 0;
    let timeout = 0;

    if (visible) {
      setRendered(true);
      frame = window.requestAnimationFrame(() => setShown(true));
    } else {
      setShown(false);
      timeout = window.setTimeout(() => setRendered(false), 240);
    }

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      if (timeout) window.clearTimeout(timeout);
    };
  }, [visible]);

  if (!rendered || Math.abs(delta) < 0.5) return null;

  const positive = delta > 0;
  const deltaText = `${positive ? '+' : '-'}${formatCurrencyNoDecimals(Math.abs(delta), 'CLP')}`;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[130] flex justify-end px-4 sm:bottom-6">
      <div
        className={`w-full max-w-xs rounded-2xl border px-4 py-3 shadow-2xl transition-all duration-200 ease-out ${
          shown ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
        } ${
          positive
            ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
            : 'border-red-300 bg-red-50 text-red-900'
        }`}
      >
        <div className="flex items-center gap-2">
          {positive ? <ArrowUpRight size={20} /> : <ArrowDownRight size={20} />}
          <div className="text-2xl font-bold tracking-tight">{deltaText}</div>
        </div>
        <div className="mt-1 text-xs opacity-90">{reason || 'Patrimonio actualizado'}</div>
      </div>
    </div>
  );
};

