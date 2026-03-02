import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';

import { Input, cn } from './Components';
import {
  CURRENCY_LIST,
  getCurrencyLabel,
  isKnownCurrencyCode,
  normalizeCurrencyCode,
} from '../data/currencyMaster';

type Props = {
  value: string;
  onChange: (code: string) => void;

  // Modo custom ("OTRA") controlado por el padre para mantener cambios mínimos
  isCustom: boolean;
  onToggleCustom: (next: boolean) => void;

  // UI
  className?: string;
  buttonClassName?: string;
  placeholder?: string;

  // Custom
  customMaxLength?: number;

  // Lista de monedas custom (persistidas)
  customCurrencies?: Array<{ code: string; name: string }>;
};

const sanitizeCustom = (raw: string, maxLen: number) => {
  // Mayúsculas + sin espacios + solo A-Z / 0-9
  const upper = (raw || '').toUpperCase();
  const cleaned = upper.replace(/\s+/g, '').replace(/[^A-Z0-9]/g, '');
  return cleaned.slice(0, maxLen);
};

export const CurrencyPicker: React.FC<Props> = ({
  value,
  onChange,
  isCustom,
  onToggleCustom,
  className,
  buttonClassName,
  placeholder = 'Buscar moneda…',
  customMaxLength = 10,
  customCurrencies = [],
}) => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const normalizedValue = normalizeCurrencyCode(value);

  const customMap = useMemo(() => {
    const map: Record<string, string> = {};
    (customCurrencies || []).forEach((c) => {
      const code = normalizeCurrencyCode(c?.code || '');
      if (!code) return;
      map[code] = String(c?.name || code);
    });
    return map;
  }, [customCurrencies]);

  const fullList = useMemo(() => {
    const extras = Object.keys(customMap).map((code) => ({ code, name: customMap[code] }));
    extras.sort((a, b) => a.code.localeCompare(b.code));
    // Evita duplicar códigos ISO si un custom usa el mismo code
    const base = CURRENCY_LIST.filter((c) => !customMap[c.code]);
    return [...extras, ...base];
  }, [customMap]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return fullList;
    return fullList.filter((c) => {
      return (
        c.code.toLowerCase().includes(query) ||
        c.name.toLowerCase().includes(query)
      );
    });
  }, [q, fullList]);

  // Cerrar al click afuera
  useEffect(() => {
    if (!open) return;
    const onDoc = (ev: MouseEvent) => {
      const el = wrapRef.current;
      if (!el) return;
      if (ev.target instanceof Node && !el.contains(ev.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Focus al input de búsqueda al abrir
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  // Si el padre nos cambia value a algo no conocido y no estamos en custom, no forzamos nada.
  // Mantiene el comportamiento estable. En edición, el padre decide isCustom basado en el maestro.

  if (isCustom) {
    return (
      <div className={cn('flex gap-2', className)}>
        <Input
          value={normalizedValue}
          onChange={(e) => onChange(sanitizeCustom(e.target.value, customMaxLength))}
          className={cn(
            'bg-slate-50 border-none font-bold text-center h-12 rounded-xl',
          )}
          placeholder="SIGLA"
          maxLength={customMaxLength}
        />
        <button
          type="button"
          onClick={() => onToggleCustom(false)}
          className="bg-slate-200 px-3 rounded-xl text-xs font-bold"
          title="Volver al listado"
        >
          <X size={16} />
        </button>
      </div>
    );
  }

  const label = normalizedValue
    ? (customMap[normalizedValue] ? `${normalizedValue} — ${customMap[normalizedValue]}` : getCurrencyLabel(normalizedValue))
    : 'Seleccionar moneda';

  const isKnown = normalizedValue ? (isKnownCurrencyCode(normalizedValue) || !!customMap[normalizedValue]) : false;

  return (
    <div ref={wrapRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'w-full h-12 bg-slate-50 rounded-xl border-none font-bold text-xs px-3 outline-none flex items-center justify-between',
          buttonClassName,
        )}
      >
        <span className={cn(!isKnown && normalizedValue ? 'text-orange-600' : 'text-slate-900')}>{label}</span>
        <ChevronDown size={16} className={cn('text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute z-50 mt-2 w-full rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden">
          <div className="p-3 border-b border-slate-100">
            <Input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-10 rounded-xl"
              placeholder={placeholder}
            />
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-2">
              Escribe código (MXN) o nombre (peso)
            </p>
          </div>

          <div className="max-h-72 overflow-auto">
            {filtered.slice(0, 80).map((c) => (
              <button
                key={c.code}
                type="button"
                onClick={() => {
                  onChange(c.code);
                  setOpen(false);
                  setQ('');
                }}
                className={cn(
                  'w-full text-left px-4 py-2.5 text-xs font-bold hover:bg-slate-50 flex items-center justify-between',
                  c.code === normalizedValue && 'bg-slate-50',
                )}
              >
                <span>{c.code}</span>
                <span className="text-slate-500 font-medium truncate ml-3">{c.name}</span>
              </button>
            ))}

            <div className="border-t border-slate-100" />

            <button
              type="button"
              onClick={() => {
                onToggleCustom(true);
                onChange('');
                setOpen(false);
                setQ('');
              }}
              className="w-full text-left px-4 py-3 text-xs font-black hover:bg-slate-50"
            >
              OTRA…
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
