// src/components/AddProjectExpenseModal.tsx
import React, { useState, useEffect } from 'react';
import { X, Save, RefreshCw } from 'lucide-react';
import { collection, addDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { Project, Currency } from '../types';
import { Button, Input, cn, getCategoryIcon } from './Components';

// Categorías rápidas para viajes
const TRIP_CATEGORIES = [
  'Comida', 'Transporte', 'Alojamiento', 'Ocio', 
  'Compras', 'Vuelos', 'Salud', 'Otros'
];

interface Props {
  isOpen: boolean;
  onClose: () => void;
  project: Project | null;
}

export const AddProjectExpenseModal = ({ isOpen, onClose, project }: Props) => {
  // Evitar render si no está abierto
  if (!isOpen || !project) return null;

  const [form, setForm] = useState({
    monto: '',
    moneda: project.moneda_principal || 'EUR',
    categoria: 'Comida',
    descripcion: '',
    fecha: new Date().toISOString().split('T')[0]
  });
  const [busy, setBusy] = useState(false);

  // Reiniciar form al abrir
  useEffect(() => {
    if (isOpen && project) {
      setForm(prev => ({
        ...prev,
        moneda: project.moneda_principal || 'EUR'
      }));
    }
  }, [isOpen, project]);

  const handleSubmit = async () => {
    if (!form.monto || !form.fecha) return;
    setBusy(true);
    
    try {
      const montoNum = parseFloat(form.monto);
      
      // NOTA: Para MVP asumimos 1:1 si es la misma moneda, 
      // o guardamos el original y luego se podría editar el tipo de cambio.
      // Aquí simplificamos guardando el monto como "principal" directamente.
      
      await addDoc(collection(db, 'project_expenses'), {
        proyecto_id: project.id,
        fecha: new Date(form.fecha).toISOString(),
        
        monto_original: montoNum,
        moneda_original: form.moneda,
        
        // Asumimos cambio 1 si es la misma, o pendiente de ajuste.
        // Lo crítico es que se guarde el gasto.
        tipo_cambio_usado: 1, 
        monto_en_moneda_proyecto: montoNum, 
        monto_en_moneda_principal: montoNum, // Esto se debería calcular real en v2
        
        categoria: form.categoria,
        descripcion: form.descripcion,
        creado_por_usuario_id: localStorage.getItem('currentUser') || 'Diego',
        estado: 'activo',
        created_at: new Date().toISOString()
      });
      
      onClose();
      // Reset
      setForm({
        monto: '',
        moneda: project.moneda_principal || 'EUR',
        categoria: 'Comida',
        descripcion: '',
        fecha: new Date().toISOString().split('T')[0]
      });
    } catch (e) {
      console.error("Error guardando gasto:", e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      {/* Click fuera para cerrar */}
      <div className="absolute inset-0" onClick={onClose}></div>
      
      <div className="bg-white w-full max-w-md rounded-[2.5rem] p-6 shadow-2xl relative z-10 animate-in slide-in-from-bottom-10 duration-300">
        
        <div className="flex justify-between items-center mb-6 pl-2">
          <h2 className="text-xl font-black text-slate-900 tracking-tight">Nuevo Gasto</h2>
          <button onClick={onClose} className="p-2.5 bg-slate-100 rounded-full text-slate-500 hover:bg-slate-200 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-5">
          {/* Monto y Moneda */}
          <div className="flex gap-3">
             <div className="flex-1 space-y-1">
               <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Monto</label>
               <Input 
                 type="number" 
                 value={form.monto} 
                 onChange={e => setForm({...form, monto: e.target.value})}
                 className="bg-slate-50 border-none font-black text-3xl h-16 rounded-2xl placeholder:text-slate-300"
                 placeholder="0.00"
                 autoFocus
               />
             </div>
             <div className="w-28 space-y-1">
               <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Moneda</label>
               <div className="relative h-16 bg-slate-50 rounded-2xl flex items-center justify-center border border-slate-100">
                  <span className="font-bold text-slate-800">{form.moneda}</span>
                  <select 
                    value={form.moneda}
                    onChange={e => setForm({...form, moneda: e.target.value})}
                    className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                  >
                    {Object.values(Currency).map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
               </div>
             </div>
          </div>

          {/* Categoría Grid */}
          <div className="space-y-1">
             <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Categoría</label>
             <div className="grid grid-cols-4 gap-2">
               {TRIP_CATEGORIES.map(cat => {
                 const isSelected = form.categoria === cat;
                 return (
                   <button
                     key={cat}
                     onClick={() => setForm({...form, categoria: cat})}
                     className={cn(
                       "flex flex-col items-center justify-center py-3 px-1 rounded-2xl transition-all border",
                       isSelected
                         ? "bg-slate-900 text-white border-slate-900 shadow-md transform scale-105" 
                         : "bg-white text-slate-400 border-slate-100 hover:bg-slate-50"
                     )}
                   >
                     {React.createElement(getCategoryIcon(cat), { size: 20 })}
                     <span className="text-[8px] font-bold mt-1 truncate w-full text-center uppercase tracking-wider">{cat}</span>
                   </button>
                 );
               })}
             </div>
          </div>

          {/* Detalles */}
          <div className="space-y-2">
            <Input 
              type="text" 
              value={form.descripcion} 
              onChange={e => setForm({...form, descripcion: e.target.value})}
              className="bg-slate-50 border-none font-bold text-sm h-12 rounded-xl"
              placeholder="Descripción (ej: Cena aeropuerto)"
            />
            <Input 
              type="date" 
              value={form.fecha} 
              onChange={e => setForm({...form, fecha: e.target.value})}
              className="bg-slate-50 border-none font-bold text-sm h-12 rounded-xl text-center"
            />
          </div>

          <Button 
            onClick={handleSubmit} 
            disabled={busy || !form.monto}
            className="w-full bg-blue-600 hover:bg-blue-700 py-6 rounded-2xl font-black uppercase text-xs shadow-xl active:scale-95 transition-all mt-2"
          >
            {busy ? <RefreshCw className="animate-spin" /> : <><Save className="mr-2" size={18}/> Registrar Gasto</>}
          </Button>

        </div>
      </div>
    </div>
  );
};
