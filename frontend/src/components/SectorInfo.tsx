import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Target, ArrowRight, FileText, Database, Settings, ShieldAlert, Sparkles, Building2, Server } from 'lucide-react';

const SectorInfo: React.FC = () => {
    const navigate = useNavigate();

    const services = [
        {
            title: 'Novo Dashboard / Relatório',
            description: 'Solicitação para criação de novos painéis visuais ou relatórios de dados personalizados.',
            icon: <FileText className="w-8 h-8 text-white" />,
            gradient: 'from-indigo-500 to-blue-600',
            shadow: 'shadow-indigo-200'
        },
        {
            title: 'Criar Automação',
            description: 'Desenvolvimento de fluxos automatizados (RPA/ETL) para otimizar seus processos manuais.',
            icon: <Settings className="w-8 h-8 text-white" />,
            gradient: 'from-cyan-500 to-teal-500',
            shadow: 'shadow-cyan-200'
        },
        {
            title: 'Sugestão / Inclusão de Campo',
            description: 'Melhorias, adição de campos ou ajustes finos em dashboards, automações e Empresanho.',
            icon: <Database className="w-8 h-8 text-white" />,
            gradient: 'from-emerald-500 to-green-600',
            shadow: 'shadow-emerald-200'
        },
        {
            title: 'Reportar Erro ou Problema',
            description: 'Relatar falhas técnicas, dados incorretos ou bugs urgentes em sistemas de dados.',
            icon: <ShieldAlert className="w-8 h-8 text-white" />,
            gradient: 'from-rose-500 to-red-600',
            shadow: 'shadow-rose-200'
        },
        {
            title: 'StarSoft (ERP)',
            description: 'Suporte, consultas ou ajustes relacionados ao ERP StarSoft.',
            icon: <Building2 className="w-8 h-8 text-white" />,
            gradient: 'from-amber-500 to-orange-600',
            shadow: 'shadow-amber-200'
        },
        {
            title: 'Infraestrutura',
            description: 'Chamados relacionados a rede, servidores, hardware e infraestrutura de TI.',
            icon: <Server className="w-8 h-8 text-white" />,
            gradient: 'from-slate-500 to-slate-700',
            shadow: 'shadow-slate-200'
        }
    ];

    return (
        <div className="min-h-full bg-slate-50/50 p-6 md:p-10 animate-in fade-in duration-700">
            <div className="max-w-6xl mx-auto">
                <div className="mb-12 text-center md:text-left">
                    <div className="inline-flex items-center px-3 py-1 rounded-full bg-slate-200 text-slate-600 text-[10px] font-black uppercase tracking-widest mb-4">
                        <Sparkles className="w-3 h-3 mr-2 text-yellow-500" /> Portal de Dados
                    </div>
                    <h1 className="text-4xl md:text-5xl font-black text-slate-900 tracking-tight mb-4 bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-600">
                        Nossos Serviços
                    </h1>
                    <p className="text-slate-500 dark:text-slate-200 text-lg md:text-xl font-medium leading-relaxed whitespace-nowrap">
                        Explore como nosso setor pode transformar seus dados em inteligência e automatizar suas rotinas.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-4 mb-10">
                    {services.map((service, idx) => (
                        <div
                            key={idx}
                            className={`group relative bg-white rounded-2xl p-5 border border-slate-100 shadow-sm hover:shadow-xl transition-all duration-300 overflow-hidden transform hover:-translate-y-1 hover:scale-[1.01]`}
                        >
                            {/* Gradient Background Effect on Hover */}
                            <div className={`absolute inset-0 bg-gradient-to-br ${service.gradient} opacity-0 group-hover:opacity-5 transition-opacity duration-300`}></div>

                            <div className="relative z-10 flex items-start gap-4">
                                <div className={`p-3 rounded-xl bg-gradient-to-br ${service.gradient} shadow-md ${service.shadow} group-hover:scale-105 transition-transform duration-300 shrink-0`}>
                                    {React.cloneElement(service.icon as React.ReactElement<{ className?: string }>, { className: "w-5 h-5 text-white" })}
                                </div>
                                <div className="flex-1">
                                    <h3 className="text-sm font-black text-slate-800 mb-1 group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-gradient-to-r group-hover:from-slate-900 group-hover:to-slate-600 transition-colors uppercase tracking-tight">
                                        {service.title}
                                    </h3>
                                    <p className="text-xs text-slate-500 leading-relaxed font-medium">
                                        {service.description}
                                    </p>
                                </div>
                                <div className="absolute top-5 right-5 opacity-0 group-hover:opacity-100 transform translate-x-2 group-hover:translate-x-0 transition-all duration-300">
                                    <ArrowRight className="w-4 h-4 text-slate-300" />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Call to Action Banner */}
                <div className="relative overflow-hidden rounded-[2.5rem] bg-slate-900 shadow-2xl transform transition-all hover:scale-[1.01]">
                    {/* Abstract Shapes */}
                    <div className="absolute top-0 right-0 w-96 h-96 bg-blue-600 rounded-full blur-3xl opacity-20 translate-x-1/2 -translate-y-1/2"></div>
                    <div className="absolute bottom-0 left-0 w-64 h-64 bg-purple-600 rounded-full blur-3xl opacity-20 -translate-x-1/2 translate-y-1/2"></div>

                    <div className="relative z-10 p-8 md:p-12 flex flex-col md:flex-row items-center justify-between gap-8">
                        <div>
                            <h2 className="text-3xl font-bold text-white mb-2">Tem uma demanda específica?</h2>
                            <p className="text-slate-300 text-lg">Abra um chamado agora mesmo e nossa equipe entrará em ação.</p>
                        </div>
                        <button
                            onClick={() => navigate('/tickets/new')}
                            className="group relative bg-white text-slate-900 px-8 py-4 rounded-xl font-bold uppercase tracking-widest hover:bg-red-500 hover:text-white transition-all shadow-xl flex items-center overflow-hidden"
                        >
                            <span className="relative z-10 flex items-center">
                                Abrir Novo Chamado
                                <ArrowRight className="w-5 h-5 ml-3 group-hover:translate-x-1 transition-transform" />
                            </span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SectorInfo;
