
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { User } from '../types';
import { Card } from '../components/Components';
import { User as UserIcon, UserCheck } from 'lucide-react';

export const Onboarding = () => {
  const navigate = useNavigate();

  const handleSelectUser = (user: User) => {
    localStorage.setItem('currentUser', user);
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-brand-50 flex flex-col items-center justify-center p-6">
      <div className="text-center mb-10">
        <h1 className="text-4xl font-bold text-brand-900 mb-2 tracking-tight">GastApp</h1>
        <p className="text-brand-700">Gestión de gastos simple</p>
      </div>

      <div className="grid grid-cols-1 gap-6 w-full max-w-sm">
        <UserCard name="Diego" onClick={() => handleSelectUser('Diego')} />
        <UserCard name="Gastón" onClick={() => handleSelectUser('Gastón')} />
      </div>
    </div>
  );
};

const UserCard = ({ name, onClick }: { name: string; onClick: () => void }) => (
  <button 
    onClick={onClick}
    className="group relative flex items-center p-6 bg-white rounded-2xl shadow-sm border border-brand-100 hover:border-brand-300 hover:shadow-md transition-all active:scale-95"
  >
    <div className="h-14 w-14 rounded-full bg-brand-100 flex items-center justify-center text-brand-600 mr-5 group-hover:bg-brand-600 group-hover:text-white transition-colors">
      <UserIcon size={24} />
    </div>
    <div className="text-left">
      <span className="block text-sm text-gray-500">Continuar como</span>
      <span className="block text-2xl font-bold text-slate-800">{name}</span>
    </div>
    <div className="absolute right-6 text-brand-200 group-hover:text-brand-600 transition-colors">
      <UserCheck size={24} />
    </div>
  </button>
);