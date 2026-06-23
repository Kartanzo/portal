import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftRight, ListChecks, LayoutGrid, CalendarDays, Tag, Sparkles, ArrowRight, Users, MessageSquare, History } from 'lucide-react';

const cards = [
  {
    title: 'Todos os Chamados',
    description: 'Visualize, filtre e acompanhe todas as solicitações entre setores em uma lista organizada.',
    icon: <ListChecks className="w-7 h-7 text-white" />,
    gradient: 'from-indigo-500 to-blue-600',
    to: '/inter-sector-tickets',
  },
  {
    title: 'Kanban',
    description: 'Acompanhe o progresso visual dos chamados em colunas por status — do aberto à conclusão.',
    icon: <LayoutGrid className="w-7 h-7 text-white" />,
    gradient: 'from-cyan-500 to-teal-500',
    to: '/inter-sector-kanban',
  },
  {
    title: 'Agenda',
    description: 'Visualize prazos e entregas de chamados em formato de calendário para planejamento.',
    icon: <CalendarDays className="w-7 h-7 text-white" />,
    gradient: 'from-amber-500 to-orange-600',
    to: '/inter-sector-schedule',
  },
  {
    title: 'Categorias do Setor',
    description: 'Configure e gerencie as categorias e subcategorias que organizam os chamados do seu setor.',
    icon: <Tag className="w-7 h-7 text-white" />,
    gradient: 'from-rose-500 to-red-600',
    to: '/sector-categories',
  },
];

const benefits = [
  { icon: <MessageSquare className="w-5 h-5" />, label: 'Clareza nas solicitações', color: 'text-indigo-500' },
  { icon: <Sparkles className="w-5 h-5" />, label: 'Agilidade nas respostas', color: 'text-amber-500' },
  { icon: <History className="w-5 h-5" />, label: 'Histórico completo', color: 'text-emerald-500' },
  { icon: <Users className="w-5 h-5" />, label: 'Colaboração entre áreas', color: 'text-rose-500' },
];

const InterSectorInfo: React.FC = () => {
  return (
    <div className="min-h-full bg-slate-50/50 dark:bg-slate-900 p-6 md:p-10 animate-in fade-in duration-700">
      <div className="max-w-6xl mx-auto">
        {/* Hero */}
        <div className="mb-10 text-center md:text-left">
          <div className="inline-flex items-center px-3 py-1 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-200 text-[10px] font-black uppercase tracking-widest mb-4">
            <ArrowLeftRight className="w-3 h-3 mr-2 text-red-500" /> Comunicação Interna
          </div>
          <h1 className="text-4xl md:text-5xl font-black text-slate-900 dark:text-slate-50 tracking-tight mb-4">
            Chamado entre Setores
          </h1>
          <p className="text-slate-600 dark:text-slate-300 text-lg md:text-xl font-medium leading-relaxed max-w-3xl">
            Comunicação interna mais eficiente: organizando demandas, otimizando o fluxo entre as áreas e
            garantindo o registro completo de cada solicitação.
          </p>
        </div>

        {/* Sobre */}
        <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-700 p-6 md:p-8 mb-8">
          <div className="grid md:grid-cols-3 gap-6">
            <div className="md:col-span-2 space-y-4">
              <h2 className="text-xl font-black text-slate-900 dark:text-slate-50 uppercase tracking-tight">Sobre o projeto</h2>
              <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                Com o objetivo de organizar as demandas e otimizar o fluxo de informações entre as áreas, foi
                implementado o projeto <strong>Chamado entre Setores</strong>, iniciativa idealizada por <strong>Malu</strong>, da equipe Comercial.
              </p>
              <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                A ferramenta centraliza as solicitações trocadas entre os departamentos em um campo estruturado,
                eliminando ruídos, reduzindo retrabalho e garantindo o acompanhamento de cada demanda. Atualmente,
                as áreas <strong>Comercial</strong>, <strong>Financeiro</strong> e <strong>Logística</strong> já utilizam o recurso de forma integrada.
              </p>
              <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                A iniciativa reforça a cultura de colaboração e eficiência da empresa, além de evidenciar o
                protagonismo dos colaboradores na construção de soluções que transformam a rotina de trabalho.
              </p>
            </div>
            <div className="space-y-3">
              <h3 className="text-xs font-black text-slate-400 dark:text-slate-400 uppercase tracking-widest">Principais Ganhos</h3>
              {benefits.map((b, i) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-700/50 border border-slate-100 dark:border-slate-600">
                  <div className={b.color}>{b.icon}</div>
                  <span className="text-sm font-bold text-slate-700 dark:text-slate-100">{b.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Acessos rapidos */}
        <h2 className="text-xs font-black text-slate-400 dark:text-slate-400 uppercase tracking-widest mb-3 ml-1">Acesso Rápido</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">
          {cards.map((c, i) => (
            <Link
              key={i}
              to={c.to}
              className="group relative bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-100 dark:border-slate-700 shadow-sm hover:shadow-xl transition-all duration-300 overflow-hidden transform hover:-translate-y-1 hover:scale-[1.01]"
            >
              <div className={`absolute inset-0 bg-gradient-to-br ${c.gradient} opacity-0 group-hover:opacity-5 transition-opacity duration-300`} />
              <div className="relative z-10 flex items-start gap-4">
                <div className={`p-3 rounded-xl bg-gradient-to-br ${c.gradient} shadow-md group-hover:scale-105 transition-transform duration-300 shrink-0`}>
                  {c.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-black text-slate-900 dark:text-slate-50 mb-1 uppercase tracking-tight">{c.title}</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-300 leading-relaxed">{c.description}</p>
                </div>
                <ArrowRight className="w-5 h-5 text-slate-300 dark:text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-100 group-hover:translate-x-1 transition-all shrink-0 mt-1" />
              </div>
            </Link>
          ))}
        </div>

        {/* CTA novo chamado */}
        <div className="rounded-3xl p-8 md:p-10 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white relative overflow-hidden">
          <div className="absolute -top-12 -right-12 w-48 h-48 bg-red-600/20 rounded-full blur-3xl" />
          <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div>
              <h3 className="text-2xl md:text-3xl font-black tracking-tight mb-2">Tem uma demanda para outro setor?</h3>
              <p className="text-slate-300 text-sm md:text-base">Abra um chamado agora mesmo e mantenha tudo registrado.</p>
            </div>
            <Link
              to="/inter-sector-tickets/new"
              className="inline-flex items-center gap-2 px-6 py-3 bg-red-600 hover:bg-red-700 rounded-xl font-black uppercase text-sm tracking-wider transition-all shadow-lg shadow-red-900/30 hover:scale-105"
            >
              Abrir Novo Chamado <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InterSectorInfo;
