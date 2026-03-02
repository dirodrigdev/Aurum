// src/types.ts

// Allow fixed known users but don't break if localStorage contains other strings.
export type User = 'Diego' | 'Gastón' | (string & {});

// Categorías heredadas (por si acaso)
export enum ExpenseCategoryLegacy {
  FOOD = 'Comida',
  TRANSPORT = 'Transporte',
  HOME = 'Hogar',
  ENTERTAINMENT = 'Ocio',
  SHOPPING = 'Compras',
  SERVICES = 'Servicios',
  HEALTH = 'Salud',
  OTHER = 'Otros',
}

export enum ProjectType {
  TRIP = 'viaje',
  PROJECT = 'proyecto',
}

// Monedas base
export enum Currency {
  EUR = 'EUR',
  USD = 'USD',
  ARS = 'ARS',
  BRL = 'BRL',
  CLP = 'CLP',
  MXN = 'MXN',
  COP = 'COP',
  JPY = 'JPY',
  KRW = 'KRW',
  THB = 'THB',
  IDR = 'IDR',
  LKR = 'LKR',
}

export type CurrencyType = Currency | string;

// --- ESTRUCTURAS DINÁMICAS ---

export interface Category {
  id: string;
  nombre: string;
  /** Clave estable para lógica/migraciones (p.ej. 'vuelos', 'alojamiento'). */
  key?: string;
  /** Label visible, preserva mayúsculas/minúsculas como se escribió. */
  label?: string;
  presupuestoMensual: number;
  activa: boolean;
  /** Si es una categoría de gasto fijo (solo Home). Se excluye del cálculo de "ritmo". */
  isFixed?: boolean;
  /** Alcance: home (gastos mensuales) o trip (viajes). Legacy: si falta, se asume home. */
  scope?: 'home' | 'trip';
  icono?: string;
}

export interface ClosingConfig {
  tipo: 'ultimoDia' | 'diaFijo';
  diaFijo?: number;
}

export interface CategoryReportDetail {
  categoryId?: string;
  categoryName: string;
  presupuesto: number;
  gastoReal: number;
  diferencia?: number;
}

export interface MonthlyReport {
  id: string;
  anio?: number;
  mes?: number;

  numeroPeriodo: number;
  fechaInicio?: string;
  fechaFin: string;
  fechaCierre: string;

  estado?: string;

  detalles: CategoryReportDetail[];
  totalGlobalPresupuesto: number;
  totalGlobalGasto: number;
  totalGlobalDiferencia: number;
}

// --- ENTIDADES PRINCIPALES ---

export interface MonthlyExpense {
  id?: string;
  fecha: string;
  monto: number;
  moneda: CurrencyType;
  categoria: string;
  categoryId?: string;
  descripcion?: string;
  imagen_adjunta_url?: string;
  creado_por_usuario_id: User;
  estado: 'activo' | 'borrado';
  created_at?: string;
  updated_at?: string;
  deleted_at?: string;
}

export interface Project {
  id?: string;

  tipo: ProjectType | string;

  nombre: string;
  descripcion?: string; // Para notas o subtítulos
  destino_principal?: string;

  moneda_principal: CurrencyType;
  moneda_proyecto: CurrencyType;


  // Agregados cacheados para evitar leer todos los ProjectExpenses en pantallas resumen
  gasto_total_eur?: number; // suma de monto_en_moneda_principal (EUR) del proyecto
  gastos_count?: number;    // cantidad de gastos asociados al proyecto
  gastos_updated_at?: string; // ISO

  // Presupuestos (Mantenemos legacy y camelCase para nuevos componentes)
  presupuesto_total?: number;
  presupuestoTotal?: number;

  personas?: number;

  // Noches
  noches_totales?: number;
  noches_fuera_madrid?: number;
  nochesHotel?: number; // Noches de hotel ingresadas manualmente

  tipo_cambio_referencia?: number;

  cerrado: boolean;
  finalizado?: boolean; // Check manual de "Viaje Terminado"

  estado_temporal?: 'futuro' | 'en_curso' | 'pasado';
  estado?: 'activo' | 'pausado' | 'finalizado' | 'borrado';

  // Fechas reales para lógica de Wallet y estados automáticos
  fechaInicio?: string;
  fechaFin?: string;

  // Estética
  color?: string; // Hexadecimal del color del viaje

  // Flags de analítica (no afectan totales; solo promedios/estadísticas)
  /** Viaje especial/invitación: se excluye de futuras estadísticas (p.ej. promedio hotel/vuelos). */
  exclude_from_trip_stats?: boolean;
  /** Proyecto extraordinario/one-off: se excluye de promedios de “estilo de vida”. */
  exclude_from_lifestyle_avg?: boolean;

  miembros?: string[];

  created_at?: string;
  updated_at?: string;
  deleted_at?: string;
}

/**
 * ProjectExpense - esquema objetivo (normalizado):
 * - monto_en_moneda_principal siempre en EUR
 * - monto_en_moneda_proyecto siempre en la moneda del proyecto
 * - monto_original/moneda_original reflejan lo que el usuario ingresó
 *
 * Nota: varios campos quedan opcionales para soportar legacy en Firestore.
 * Los helpers de db.ts los completan al escribir.
 */
export interface ProjectExpense {
  id?: string;
  proyecto_id: string;
  fecha: string;

  // Input original (puede faltar en legacy)
  monto_original?: number;
  moneda_original?: CurrencyType;
  tipo_cambio_usado?: number;

  // Normalizado (puede faltar en legacy)
  monto_en_moneda_proyecto?: number;
  monto_en_moneda_principal?: number;

  // En viajes se usa categoría; en otros proyectos se usa como "concepto" (y se duplica en descripcion)
  categoria: string;
  descripcion?: string;

  imagen_adjunta_url?: string;

  // Preferido
  creado_por_usuario_id?: User;

  // Legacy alias (por si quedó alguno escrito)
  creado_por?: User;

  estado?: 'activo' | 'borrado';

  created_at?: string;
  updated_at?: string;
  deleted_at?: string;
}
