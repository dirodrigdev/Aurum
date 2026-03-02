// src/pages/Budgets.tsx
import React, { useState, useEffect } from 'react';
import { 
  Plus, 
  Edit2, 
  Save, 
  X, 
  Layers, 
  AlertCircle, 
  CheckCircle2, 
  RefreshCw,
  TrendingUp,
  History,
  Wrench,
  ChevronDown,
  Info
} from 'lucide-react';

/** * UI COMPONENTS & SERVICES
 * Importamos los componentes core y la instancia de db (Firestore)
 */
import { 
  Card, 
  Button, 
  Input, 
  getCategoryIcon, 
  cn 
} from '../components/Components';
import { 
  subscribeToCategories, 
  saveCategory 
} from '../services/db';
import { db } from '../services/firebase'; 
import { 
  collection, 
  getDocs, 
  query, 
  where, 
  writeBatch, 
  doc, 
  addDoc, 
  serverTimestamp 
} from 'firebase/firestore';
import { Category } from '../types';
import { emitDataEvent } from '../state/dataEvents';

/**
 * CONFIGURACIÓN DE ICONOS
 * Lista maestra disponible para la selección de categorías
 */
const CATEGORY_ICONS = [
  'ShoppingCart', 'Car', 'Home', 'Utensils', 'Zap', 'Heart', 
  'Smartphone', 'CreditCard', 'Gift', 'Coffee', 'Music', 'Map', 
  'Briefcase', 'Star', 'User', 'Settings', 'Plane', 'Anchor'
];

export const Budgets = () => {
  // --- ESTADOS DE DATOS ---
  const [categories, setCategories] = useState<Category[]>([]);
  const [isEditing, setIsEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  
  // --- ESTADOS DE UI (REPLEGABLES) ---
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isMaintOpen, setIsMaintOpen] = useState(false);
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // --- ESTADOS DE FORMULARIO ---
  const [form, setForm] = useState({
    nombre: '',
    presupuestoMensual: 0,
    icono: 'ShoppingCart',
    activa: true
  });

  // --- ESTADOS DE MANTENIMIENTO (CIRUGÍA) ---
  const [maintOldName, setMaintOldName] = useState('');
  const [maintNewName, setMaintNewName] = useState('');

  const currentUser = localStorage.getItem('currentUser') || 'Usuario';

  /**
   * EFECTO INICIAL: Suscripción a tiempo real de categorías
   */
  useEffect(() => {
    const unsubscribe = subscribeToCategories((data) => {
      // Ordenamos alfabéticamente para facilitar la lectura
      const sorted = data.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
      setCategories(sorted);
    });
    return () => unsubscribe();
  }, []);

  /**
   * RESET: Limpia el formulario y cierra secciones
   */
  const resetForm = () => {
    setForm({ nombre: '', presupuestoMensual: 0, icono: 'ShoppingCart', activa: true });
    setIsEditing(null);
    setIsFormOpen(false);
  };

  /**
   * BITÁCORA: Registra acciones críticas en Firestore (activity_logs)
   */
  const logActivity = async (accion: string, detalle: string, afectados: number = 0) => {
    try {
      await addDoc(collection(db, 'activity_logs'), {
        fecha: serverTimestamp(),
        usuario: currentUser,
        accion: accion,
        detalle: detalle,
        registrosAfectados: afectados,
        tipo: 'ESTRUCTURAL'
      });
    } catch (e) {
      console.error("Error crítico escribiendo en bitácora:", e);
    }
  };

  /**
   * LÓGICA DE CIRUGÍA: Renombrado Batch en Firestore
   * Busca y reemplaza el string de categoría en todos los gastos históricos.
   */
  const renameCategoryInExpenses = async (oldName: string, newName: string) => {
    const batch = writeBatch(db);
    let totalUpdated = 0;
    const collectionsToProcess = ['monthly_expenses', 'project_expenses'];
    
    for (const collName of collectionsToProcess) {
      const q = query(collection(db, collName), where('categoria', '==', oldName));
      const snap = await getDocs(q);
      snap.forEach((d) => {
        batch.update(doc(db, collName, d.id), { categoria: newName });
        totalUpdated++;
      });
    }
    
    if (totalUpdated > 0) {
      await batch.commit();
      emitDataEvent('monthly_expenses_changed');
      emitDataEvent('project_expenses_changed');
      emitDataEvent('period_summaries_changed');
    }
    return totalUpdated;
  };

  /**
   * HANDLER: Ejecuta la cirugía de renombrado desde la zona de mantenimiento
   */
  const handleMaintenanceRename = async () => {
    if (!maintOldName || !maintNewName) return;
    const catToUpdate = categories.find(c => c.nombre === maintOldName);
    if (!catToUpdate) {
      alert("Error: La categoría seleccionada ya no existe.");
      return;
    }

    const confirmMsg = `¡ACCIÓN IRREVERSIBLE!\n\nSe cambiará "${maintOldName}" por "${maintNewName}" en TODA la base de datos (${maintOldName} dejará de existir).\n\n¿Estás seguro de proceder?`;
    if (!window.confirm(confirmMsg)) return;

    setBusy(true);
    try {
      const afectados = await renameCategoryInExpenses(maintOldName, maintNewName);
      // Actualizamos la categoría en sí
      await saveCategory({ ...catToUpdate, nombre: maintNewName });
      // Registramos en bitácora
      await logActivity('CIRUGIA_RENOMBRAR', `De "${maintOldName}" a "${maintNewName}"`, afectados);
      
      setMsg({ text: `Cirugía exitosa: ${afectados} registros actualizados.`, type: 'success' });
      setMaintOldName(''); 
      setMaintNewName('');
      setIsMaintOpen(false);
    } catch (e) {
      setMsg({ text: 'Error durante la cirugía de base de datos.', type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  /**
   * HANDLER: Guarda o Edita una categoría (Solo monto y metadata)
   */
  const handleSaveBudget = async () => {
    if (!form.nombre.trim()) return;
    setBusy(true);
    try {
      const oldCat = isEditing ? categories.find(c => c.id === isEditing) : null;
      
      await saveCategory({
        id: isEditing || undefined,
        nombre: form.nombre.trim(),
        presupuestoMensual: Number(form.presupuestoMensual),
        icono: form.icono,
        activa: form.activa ?? true
      } as Category);

      // Si es edición y el monto cambió, logueamos el ajuste de presupuesto
      if (oldCat && oldCat.presupuestoMensual !== Number(form.presupuestoMensual)) {
        await logActivity(
          'AJUSTE_PRESUPUESTO', 
          `"${form.nombre}": €${oldCat.presupuestoMensual} -> €${form.presupuestoMensual}`
        );
      } else if (!isEditing) {
        await logActivity('NUEVA_CATEGORIA', `Se creó "${form.nombre}"`);
      }

      setMsg({ text: 'Configuración guardada correctamente ✅', type: 'success' });
      resetForm();
    } catch (e) {
      setMsg({ text: 'Error al conectar con Firestore.', type: 'error' });
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(null), 3000);
    }
  };

  /**
   * HANDLER: Toggle de Activación (Switch On/Off)
   */
  const handleToggleActive = async (cat: Category) => {
    const newState = !cat.activa;
    setBusy(true);
    try {
      await saveCategory({ ...cat, activa: newState });
      await logActivity(
        newState ? 'CATEGORIA_ON' : 'CATEGORIA_OFF', 
        `La categoría "${cat.nombre}" fue ${newState ? 'activada' : 'desactivada'}`
      );
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4 space-y-6 pb-24 animate-revealFromCenter bg-slate-50/50 min-h-screen">
      
      {/* --- HEADER --- */}
      <div className="flex justify-between items-center py-2">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-slate-900 rounded-lg text-white shadow-lg">
              <Layers size={20} />
            </div>
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Presupuestos</h1>
          </div>
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-[0.2em] mt-1 ml-1">Gestión de Techos de Gasto</p>
        </div>
        
        {/* BOTÓN FLOTANTE / TRIGGER FORM */}
        <button 
          onClick={() => { resetForm(); setIsFormOpen(!isFormOpen); }}
          className={cn(
            "p-3 rounded-full transition-all shadow-xl active:scale-90", 
            isFormOpen ? "bg-red-500 text-white rotate-45" : "bg-slate-900 text-white"
          )}
        >
          <Plus size={24} />
        </button>
      </div>

      {/* --- FORMULARIO REPLEGABLE (NEW/EDIT) --- */}
      {isFormOpen && (
        <Card className="p-6 border-none shadow-2xl bg-white rounded-[2rem] space-y-6 animate-in slide-in-from-top-4">
          <div className="flex items-center justify-between border-b border-slate-50 pb-3">
             <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
               {isEditing ? <Edit2 size={14}/> : <Plus size={14}/>}
               {isEditing ? 'Editar Monto' : 'Definir Nueva Categoría'}
             </h2>
             <button onClick={() => setIsFormOpen(false)} className="text-slate-300 hover:text-slate-500">
               <X size={20} />
             </button>
          </div>

          <div className="grid grid-cols-4 gap-4">
            <div className="col-span-3 space-y-1">
              <label className="text-[9px] font-black text-slate-400 ml-1 uppercase">Nombre</label>
              <Input 
                value={form.nombre} 
                onChange={e => setForm({...form, nombre: e.target.value})}
                disabled={!!isEditing} // No permitimos renombrar aquí para forzar el uso de 'Cirugía'
                placeholder="Ej: Gasolina"
                className={cn("bg-slate-50 border-none font-bold h-12", !!isEditing && "opacity-50 cursor-not-allowed")}
              />
            </div>
            <div className="col-span-1 space-y-1">
              <label className="text-[9px] font-black text-slate-400 uppercase text-center block">Icono</label>
              <div className="relative h-12 bg-slate-50 rounded-xl flex items-center justify-center border border-slate-100">
                {React.createElement(getCategoryIcon(form.icono), { size: 22, className: 'text-slate-700' })}
                <select 
                  className="absolute inset-0 opacity-0 cursor-pointer w-full" 
                  value={form.icono} 
                  onChange={e => setForm({...form, icono: e.target.value})}
                >
                  {CATEGORY_ICONS.map(icon => <option key={icon} value={icon}>{icon}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[9px] font-black text-slate-400 ml-1 uppercase">Presupuesto Mensual</label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 font-black text-slate-300 text-lg">€</span>
              <Input 
                type="number" 
                value={form.presupuestoMensual} 
                onChange={e => setForm({...form, presupuestoMensual: Number(e.target.value)})} 
                className="bg-slate-50 border-none font-black text-xl h-14 pl-10 rounded-2xl text-slate-900" 
              />
            </div>
          </div>

          <Button 
            onClick={handleSaveBudget} 
            disabled={busy || !form.nombre} 
            className={cn(
              "w-full py-8 rounded-2xl shadow-xl transition-all active:scale-95",
              isEditing ? "bg-blue-600" : "bg-slate-900"
            )}
          >
            {busy ? <RefreshCw className="animate-spin" size={20}/> : <span className="font-black uppercase text-xs tracking-[0.2em]">{isEditing ? 'Actualizar Presupuesto' : 'Confirmar y Crear'}</span>}
          </Button>
        </Card>
      )}

      {/* --- LISTADO DE CATEGORÍAS --- */}
      <div className="space-y-4">
        <div className="flex items-center justify-between px-1">
           <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
             <TrendingUp size={12}/> Categorías Activas
           </h2>
           <span className="text-[9px] font-bold text-slate-300">{categories.filter(c => c.activa).length} ON</span>
        </div>

        <div className="grid grid-cols-1 gap-4">
          {categories.map((cat) => (
            <div 
              key={cat.id} 
              className={cn(
                "group p-6 rounded-[2.5rem] bg-white border border-slate-100 shadow-sm flex items-center justify-between transition-all",
                !cat.activa && "opacity-40 grayscale bg-slate-50"
              )}
            >
              <div className="flex items-center gap-5">
                <div className={cn(
                  "p-5 rounded-3xl shadow-inner transition-all", 
                  cat.activa ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-400"
                )}>
                  {React.createElement(getCategoryIcon(cat.icono), { size: 28 })}
                </div>
                <div className="flex flex-col">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-tighter mb-1">{cat.nombre}</p>
                  <p className="text-2xl font-black text-slate-900 tracking-tighter leading-none">
                    €{cat.presupuestoMensual.toLocaleString('es-ES')}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-5">
                {/* SWITCH TOGGLE ESTILO IOS */}
                <div 
                  onClick={() => handleToggleActive(cat)}
                  className={cn(
                    "w-14 h-7 rounded-full p-1 cursor-pointer transition-colors duration-500 ease-in-out relative shadow-inner", 
                    cat.activa ? "bg-emerald-500" : "bg-slate-300"
                  )}
                >
                  <div className={cn(
                    "bg-white w-5 h-5 rounded-full shadow-lg transform transition-transform duration-300 ease-out", 
                    cat.activa ? "translate-x-7" : "translate-x-0"
                  )} />
                </div>
                
                {/* BOTÓN EDIT (SOLO MONTO) */}
                <button 
                  onClick={() => { 
                    setIsEditing(cat.id || null); 
                    setForm({ 
                      nombre: cat.nombre, 
                      presupuestoMensual: cat.presupuestoMensual, 
                      icono: cat.icono || 'ShoppingCart', 
                      activa: cat.activa ?? true 
                    }); 
                    setIsFormOpen(true); 
                    window.scrollTo({ top: 0, behavior: 'smooth' }); 
                  }}
                  className="p-3 text-slate-300 hover:text-blue-500 transition-colors bg-slate-50 rounded-2xl hover:bg-blue-50"
                >
                  <Edit2 size={18} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* --- SECCIÓN MANTENIMIENTO (CIRUGÍA DE CATEGORÍAS) --- */}
      <div className="pt-8 border-t border-slate-100">
        <button 
          onClick={() => setIsMaintOpen(!isMaintOpen)}
          className="w-full flex items-center justify-between p-5 bg-slate-100/50 rounded-3xl text-slate-500 hover:bg-slate-100 transition-all border border-dashed border-slate-200"
        >
          <div className="flex items-center gap-2 font-black text-[10px] uppercase tracking-widest">
            <Wrench size={16} className="text-orange-500"/> Zona de Cirugía Histórica
          </div>
          <ChevronDown size={18} className={cn("transition-transform duration-300", isMaintOpen && "rotate-180")} />
        </button>

        {isMaintOpen && (
          <Card className="mt-4 p-6 bg-white border border-orange-100 rounded-3xl space-y-5 animate-in zoom-in-95">
            <div className="flex gap-2 items-start bg-orange-50 p-3 rounded-2xl">
              <AlertCircle size={20} className="text-orange-600 shrink-0 mt-0.5" />
              <p className="text-[10px] text-orange-800 font-bold leading-relaxed">
                PELIGRO: Esta herramienta renombra una categoría en todos los gastos pasados. 
                El nombre antiguo se perderá para siempre y se fusionará con el nuevo.
              </p>
            </div>
            
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Categoría actual a reemplazar</label>
                <select 
                  value={maintOldName} 
                  onChange={e => setMaintOldName(e.target.value)}
                  className="w-full h-12 px-4 bg-slate-50 rounded-xl text-xs font-black border-none text-slate-800"
                >
                  <option value="">Seleccionar del historial...</option>
                  {categories.map(c => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Nuevo nombre definitivo</label>
                <Input 
                  value={maintNewName} 
                  onChange={e => setMaintNewName(e.target.value)} 
                  placeholder="Ej: Alimentación" 
                  className="text-sm font-black h-12 bg-slate-50 border-none"
                />
              </div>

              <Button 
                onClick={handleMaintenanceRename} 
                disabled={busy || !maintOldName || !maintNewName}
                className="w-full bg-orange-600 hover:bg-red-700 text-white py-5 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] shadow-lg active:scale-95 transition-all"
              >
                {busy ? <RefreshCw className="animate-spin" size={18}/> : 'Ejecutar Reemplazo Global'}
              </Button>
            </div>
            
            <div className="flex items-center justify-center gap-2 py-2 opacity-30">
               <History size={14}/>
               <p className="text-[9px] font-black uppercase tracking-tighter">Próximamente: Fusión de Categorías (Parking Lot)</p>
            </div>
          </Card>
        )}
      </div>

      {/* --- NOTIFICACIONES --- */}
      {msg && (
        <div className="fixed bottom-24 left-6 right-6 p-4 bg-slate-900 text-white rounded-[2rem] shadow-2xl flex items-center justify-center gap-3 animate-in slide-in-from-bottom-10">
          {msg.type === 'success' ? <CheckCircle2 className="text-emerald-400" size={20}/> : <AlertCircle className="text-red-400" size={20}/>}
          <span className="text-[10px] font-black uppercase tracking-widest">{msg.text}</span>
        </div>
      )}
    </div>
  );
};