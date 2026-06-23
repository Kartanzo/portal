import React from 'react';
import { Eye, EyeOff } from 'lucide-react';

const STATUS_STYLES: Record<string, string> = {
  'Aberto': 'bg-blue-100 text-blue-800 border-blue-200',
  'Em Análise': 'bg-yellow-100 text-yellow-800 border-yellow-200',
  'Aguardando Retorno': 'bg-orange-100 text-orange-800 border-orange-200',
  'Em Resolução': 'bg-purple-100 text-purple-800 border-purple-200',
  'Concluído': 'bg-green-100 text-green-800 border-green-200',
  'Cancelado': 'bg-gray-100 text-gray-600 border-gray-200',
  'Em processamento': 'bg-yellow-100 text-yellow-800 border-yellow-200',
  'Aguardando seu retorno': 'bg-orange-100 text-orange-800 border-orange-200',
};

const PRIORIDADE_STYLES: Record<string, string> = {
  'Baixa': 'bg-slate-100 text-slate-700 border-slate-200',
  'Média': 'bg-blue-100 text-blue-800 border-blue-200',
  'Alta': 'bg-orange-100 text-orange-800 border-orange-200',
  'Urgente': 'bg-red-100 text-red-800 border-red-200',
};

// Status que são invisíveis ao usuário externo
const STATUS_INVISIVEL_EXTERNO = ['Em Análise', 'Em Resolução'];

interface SacStatusBadgeProps {
  status: string;
  statusDisplay?: string;
  showVisibilityIcon?: boolean; // mostra ícone de olho riscado para internos
}

export const SacStatusBadge: React.FC<SacStatusBadgeProps> = ({
  status,
  statusDisplay,
  showVisibilityIcon = false,
}) => {
  const label = statusDisplay || status;
  const style = STATUS_STYLES[label] || STATUS_STYLES[status] || 'bg-gray-100 text-gray-600 border-gray-200';
  const invisivel = STATUS_INVISIVEL_EXTERNO.includes(status);

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${style}`}>
      {label}
      {showVisibilityIcon && invisivel && (
        <span title="Externo não vê este status"><EyeOff className="w-3 h-3 opacity-70" /></span>
      )}
    </span>
  );
};

interface SacPrioridadeBadgeProps {
  prioridade: string;
}

export const SacPrioridadeBadge: React.FC<SacPrioridadeBadgeProps> = ({ prioridade }) => {
  const style = PRIORIDADE_STYLES[prioridade] || 'bg-gray-100 text-gray-600 border-gray-200';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${style}`}>
      {prioridade}
    </span>
  );
};

// Banner de aviso para usuário interno quando status é invisível ao externo
export const SacVisibilidadeBanner: React.FC<{ status: string }> = ({ status }) => {
  if (!STATUS_INVISIVEL_EXTERNO.includes(status)) return null;
  return (
    <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-4 py-2.5 text-sm mb-4">
      <EyeOff className="w-4 h-4 flex-shrink-0" />
      <span>
        O cliente externo vê este chamado como <strong>"Em processamento"</strong> — ele não tem acesso ao status atual.
      </span>
    </div>
  );
};

export { STATUS_INVISIVEL_EXTERNO };
