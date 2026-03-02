// src/utils/tripCategories.ts
// Fuente única de verdad para categorías de Viajes (Trips).

import type React from 'react';
import {
  Plane,
  Hotel,
  Utensils,
  ShoppingBag,
  Car,
  Ticket,
  Landmark,
  Sparkles,
} from 'lucide-react';

export type TripCategoryKey =
  | 'vuelo'
  | 'hotel'
  | 'comida'
  | 'compras'
  | 'transporte'
  | 'actividades'
  | 'impuestos'
  | 'extra';

export type TripCategoryDef = {
  key: TripCategoryKey;
  label: string; // corto para chip
  icon: React.ComponentType<any>;
  // Aliases/legacy: strings que podrían venir en documentos antiguos.
  // OJO: se comparan en lower-case y sin tildes.
  aliases?: string[];
};

export const TRIP_CATEGORIES: TripCategoryDef[] = [
  { key: 'vuelo', label: 'Vuelo', icon: Plane, aliases: ['vuelos', 'flight', 'aereo', 'aéreo', 'avion', 'avión'] },
  { key: 'hotel', label: 'Hotel', icon: Hotel, aliases: ['alojamiento', 'hospedaje', 'hostel', 'airbnb', 'accommodation'] },
  { key: 'comida', label: 'Comida', icon: Utensils, aliases: ['food', 'restaurante', 'restaurantes', 'cena', 'almuerzo', 'desayuno'] },
  { key: 'compras', label: 'Compras', icon: ShoppingBag, aliases: ['shopping', 'souvenir', 'souvenirs'] },
  { key: 'transporte', label: 'Transp.', icon: Car, aliases: ['transp', 'taxi', 'uber', 'bus', 'metro', 'tren', 'train', 'car', 'auto'] },
  { key: 'actividades', label: 'Activ.', icon: Ticket, aliases: ['ocio', 'actividad', 'activ', 'tickets', 'tour', 'tours', 'excursion', 'excursión', 'entradas'] },
  { key: 'impuestos', label: 'Imp.', icon: Landmark, aliases: ['imp', 'tasas', 'tasa', 'tax', 'taxes', 'fees', 'fee', 'impuesto', 'impuestos'] },
  { key: 'extra', label: 'Extra', icon: Sparkles, aliases: ['otros', 'otro', 'misc', 'miscellaneous', 'varios'] },
];

const normalize = (v: any): string => {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return '';
  // Quita tildes para robustez (aéreo -> aereo)
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '');
};

// Lee categoría desde varios campos legacy (string u objeto).
export const resolveTripCategoryRaw = (input: any): any => {
  if (!input) return '';
  if (typeof input === 'string') return input;

  // Common: ProjectExpense completo
  const candidates = [
    input.categoria,
    input.categoryId,
    input.category,
    input.categoria_id,
    input.tipo,
    input.tipo_gasto,
  ];

  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c;
    // Si quedó un objeto (p.ej. { id, nombre } o DocumentReference), intentamos extraer algo útil.
    if (c && typeof c === 'object') {
      if (typeof (c as any).nombre === 'string') return (c as any).nombre;
      if (typeof (c as any).name === 'string') return (c as any).name;
      if (typeof (c as any).id === 'string') return (c as any).id;
      if (typeof (c as any).path === 'string') return (c as any).path;
    }
  }

  return '';
};

export const resolveTripCategoryKey = (input: any): TripCategoryKey => {
  const raw = resolveTripCategoryRaw(input);
  const c = normalize(raw);
  if (!c) return 'extra';

  // Normalizaciones rápidas conocidas (plural/sinónimos)
  if (c === 'vuelos') return 'vuelo';
  if (c.startsWith('vuel')) return 'vuelo';
  if (c.startsWith('hotel')) return 'hotel';
  if (c.startsWith('aloj')) return 'hotel';
  if (c.startsWith('hosp')) return 'hotel';
  if (c.startsWith('airbnb')) return 'hotel';

  if (c.startsWith('transp')) return 'transporte';
  if (c.startsWith('activ')) return 'actividades';
  if (c.startsWith('ocio')) return 'actividades';
  if (c.startsWith('imp')) return 'impuestos';
  if (c === 'otros' || c === 'otro') return 'extra';

  // Si ya viene como key canonical, ok.
  const keys = new Set(TRIP_CATEGORIES.map((x) => x.key));
  if (keys.has(c as any)) return c as TripCategoryKey;

  // Matching por aliases
  for (const def of TRIP_CATEGORIES) {
    const aliases = (def.aliases || []).map(normalize);
    if (aliases.includes(c)) return def.key;
    // match parcial (ej: "taxi madrid")
    if (aliases.some((a) => a && c.includes(a))) return def.key;
  }

  return 'extra';
};

export const getTripCategoryIcon = (input: any): React.ComponentType<any> => {
  const key = resolveTripCategoryKey(input);
  return TRIP_CATEGORIES.find((x) => x.key === key)?.icon || Sparkles;
};
