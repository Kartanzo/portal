import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    Users, CheckCircle2, AlertTriangle, UserPlus, ClipboardList, Clock,
    Settings, Package, ChevronRight, Cake, Building2, BarChart3, Crown,
    BadgeCheck, GraduationCap, HardHat, BookOpen, Briefcase, FileText, ChevronDown,
} from 'lucide-react';
import { ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, LineChart, Line, CartesianGrid } from 'recharts';
import { api } from '../../../app_api';
import { useToast } from '../../../contexts/ToastContext';
import { hasRhPermission } from '../_shared/rhAuth';
import AvisosDrawer from './AvisosDrawer';
import AcoesRapidas from './AcoesRapidas';

const detectaNivel = (cargo: string | null | undefined): string => {
    const c = (cargo || '').toLowerCase();
    if (/\b(diretor|diretora|ceo|presidente)\b/.test(c)) return 'Diretoria';
    if (/\b(gerente)\b/.test(c)) return 'Gerência';
    if (/\b(coordenador|coordenadora)\b/.test(c)) return 'Coordenação';
    if (/\b(supervisor|supervisora|lider|líder)\b/.test(c)) return 'Supervisão';
    if (/\b(analista|programador|designer|engenheiro|engenheira)\b/.test(c)) return 'Analista';
    if (/\b(assistente)\b/.test(c)) return 'Assistente';
    if (/\b(auxiliar)\b/.test(c)) return 'Auxiliar';
    if (/\b(ajudante|operador|operadora|conferente|vendedor|vendedora)\b/.test(c)) return 'Operacional';
    if (/\b(estagi[áa]rio|estagi[áa]ria)\b/.test(c)) return 'Estagiário';
    return 'Outros';
};

const NIVEIS_ICONS: Record<string, any> = {
    Diretoria: Crown, Gerência: Briefcase, Coordenação: BadgeCheck, Supervisão: BadgeCheck,
    Analista: BookOpen, Assistente: BookOpen, Auxiliar: HardHat, Operacional: HardHat,
    Estagiário: GraduationCap, Outros: Users,
};

const fmtDate = (s?: string) => {
    if (!s) return '';
    try { return new Date(s + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }); } catch { return s; }
};

interface AtalhoCard {
    module: string;
    to: string;
    titulo: string;
    icon: any;
    cor: string;
    badge?: string | number;
    badgeCor?: string;
}

const DashboardRH: React.FC = () => {
    const toast = useToast();
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [insightsAberto, setInsightsAberto] = useState(false);

    useEffect(() => {
        (async () => {
            try {
                const [colabs, vagas, bh, fer, mov] = await Promise.all([
                    hasRhPermission('rh_colaboradores') ? api.rhColaboradoresListar().catch(() => ({ colaboradores: [] })) : Promise.resolve({ colaboradores: [] }),
                    hasRhPermission('rh_recrutamento') ? api.rhVagasListar({ status: 'aberta' }).catch(() => ({ vagas: [] })) : Promise.resolve({ vagas: [] }),
                    hasRhPermission('rh_jornada') ? api.rhBHListar({ status: 'pendente' }).catch(() => ({ itens: [] })) : Promise.resolve({ itens: [] }),
                    hasRhPermission('rh_jornada') ? api.rhFeriasListar({ status: 'pendente' }).catch(() => ({ ferias: [] })) : Promise.resolve({ ferias: [] }),
                    hasRhPermission('rh_movimentacoes') ? api.rhMovListar({ status: 'pendente' }).catch(() => ({ movimentacoes: [] })) : Promise.resolve({ movimentacoes: [] }),
                ]);
                setData({
                    colaboradores: colabs.colaboradores || [],
                    vagas: vagas.vagas || [],
                    bh_pend: bh.itens || [],
                    fer_pend: fer.ferias || [],
                    mov_pend: mov.movimentacoes || [],
                });
            } catch (e: any) {
                toast.showToast(e.message || 'Erro', 'error');
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const stats = useMemo(() => {
        if (!data) return null;
        const c = data.colaboradores;
        const ativos = c.filter((x: any) => x.status === 'ativo').length;
        const experiencia = c.filter((x: any) => x.status === 'experiencia').length;
        const afastados = c.filter((x: any) => x.status === 'afastado').length;
        const total = ativos + experiencia + afastados;
        const totalPend = data.bh_pend.length + data.fer_pend.length + data.mov_pend.length;
        const setores = new Set(c.filter((x: any) => x.status !== 'demitido').map((x: any) => x.setor || 'Sem setor')).size;
        const hoje = new Date();
        const mesAtual = hoje.toISOString().slice(0, 7);
        const aniv = c.filter((x: any) =>
            x.data_admissao && x.data_admissao.slice(5, 7) === mesAtual.slice(5, 7) && x.status !== 'demitido'
        ).sort((a: any, b: any) => (a.data_admissao || '').slice(8, 10).localeCompare((b.data_admissao || '').slice(8, 10)));
        return { ativos, experiencia, afastados, total, totalPend, setores, aniv };
    }, [data]);

    const porSetor = useMemo(() => {
        if (!data) return [] as { setor: string; n: number }[];
        const m: Record<string, number> = {};
        data.colaboradores.filter((c: any) => c.status !== 'demitido').forEach((c: any) => {
            const k = c.setor || 'Sem setor';
            m[k] = (m[k] || 0) + 1;
        });
        return Object.entries(m).map(([setor, n]) => ({ setor, n })).sort((a, b) => b.n - a.n);
    }, [data]);

    const porNivel = useMemo(() => {
        if (!data) return [] as { nivel: string; n: number }[];
        const m: Record<string, number> = {};
        data.colaboradores.filter((c: any) => c.status !== 'demitido').forEach((c: any) => {
            const n = detectaNivel(c.cargo);
            m[n] = (m[n] || 0) + 1;
        });
        return Object.entries(m).map(([nivel, n]) => ({ nivel, n })).sort((a, b) => b.n - a.n);
    }, [data]);

    // últimos 6 meses de admissões/desligamentos (precisa ficar ANTES dos returns condicionais)
    const dadosMovimentos = useMemo(() => {
        if (!data) return [] as { mes: string; admissoes: number; desligamentos: number }[];
        const out: { mes: string; admissoes: number; desligamentos: number }[] = [];
        const hoje = new Date();
        for (let i = 5; i >= 0; i--) {
            const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
            const ym = d.toISOString().slice(0, 7);
            const adm = data.colaboradores.filter((c: any) => (c.data_admissao || '').startsWith(ym)).length;
            const des = data.colaboradores.filter((c: any) => (c.data_demissao || '').startsWith(ym)).length;
            out.push({ mes: d.toLocaleDateString('pt-BR', { month: 'short' }), admissoes: adm, desligamentos: des });
        }
        return out;
    }, [data]);

    const atalhos: AtalhoCard[] = useMemo(() => {
        if (!data || !stats) return [];
        const totalAprov = stats.totalPend;
        return [
            { module: 'rh_colaboradores', to: '/rh/colaboradores', titulo: 'Colaboradores', icon: Users, cor: 'from-blue-500 to-indigo-600', badge: stats.ativos },
            { module: 'rh_aprovacoes', to: '/rh/aprovacoes', titulo: 'Aprovações', icon: CheckCircle2, cor: 'from-rose-500 to-pink-600', badge: totalAprov > 0 ? totalAprov : undefined, badgeCor: 'bg-white text-rose-700' },
            { module: 'rh_recrutamento', to: '/rh/recrutamento', titulo: 'Recrutamento', icon: ClipboardList, cor: 'from-emerald-500 to-green-600', badge: data.vagas.length > 0 ? `${data.vagas.length} vagas` : undefined },
            { module: 'rh_jornada', to: '/rh/jornada', titulo: 'Jornada · BH e Férias', icon: Clock, cor: 'from-amber-500 to-orange-600', badge: (data.bh_pend.length + data.fer_pend.length) || undefined, badgeCor: 'bg-white text-amber-700' },
            { module: 'rh_movimentacoes', to: '/rh/movimentacoes', titulo: 'Movimentações', icon: UserPlus, cor: 'from-violet-500 to-purple-600', badge: data.mov_pend.length || undefined, badgeCor: 'bg-white text-violet-700' },
            { module: 'rh_documentos', to: '/rh/documentos', titulo: 'Documentos', icon: FileText, cor: 'from-cyan-500 to-teal-600' },
            { module: 'rh_config', to: '/rh/config', titulo: 'Configurações', icon: Settings, cor: 'from-stone-500 to-zinc-600' },
        ].filter(a => hasRhPermission(a.module));
    }, [data, stats]);

    if (loading || !stats) {
        return <div className="p-8 text-center text-slate-500 text-sm">Carregando…</div>;
    }

    // dados pros gráficos
    const dadosStatus = [
        { name: 'Ativo', value: stats.ativos, cor: '#10b981' },
        { name: 'Experiência', value: stats.experiencia, cor: '#8b5cf6' },
        { name: 'Afastado', value: stats.afastados, cor: '#f59e0b' },
    ].filter(d => d.value > 0);

    const dadosAprovacoes = [
        { name: 'Banco de Horas', value: data.bh_pend.length, cor: '#3b82f6' },
        { name: 'Férias', value: data.fer_pend.length, cor: '#f59e0b' },
        { name: 'Movimentações', value: data.mov_pend.length, cor: '#ec4899' },
    ].filter(d => d.value > 0);

    const dadosSetor = porSetor.slice(0, 8).map(s => ({ setor: s.setor, qtd: s.n }));

    return (
        <div className="-m-4 md:-m-6 lg:-m-8 min-h-[calc(100vh-2rem)] relative overflow-hidden bg-gradient-to-br from-rose-50 via-pink-50/50 to-fuchsia-50 dark:from-slate-900 dark:via-rose-950/40 dark:to-fuchsia-950/40">
            {/* Blobs decorativos */}
            <div className="pointer-events-none absolute -top-32 -left-32 w-[480px] h-[480px] rounded-full bg-rose-300/40 blur-3xl dark:bg-rose-700/20" />
            <div className="pointer-events-none absolute top-1/3 -right-40 w-[520px] h-[520px] rounded-full bg-pink-300/40 blur-3xl dark:bg-pink-700/20" />
            <div className="pointer-events-none absolute bottom-0 left-1/3 w-[480px] h-[480px] rounded-full bg-fuchsia-300/30 blur-3xl dark:bg-fuchsia-800/20" />
            <div className="pointer-events-none absolute -bottom-24 -right-24 w-[400px] h-[400px] rounded-full bg-amber-200/30 blur-3xl dark:bg-amber-800/15" />

            {/* Grid pattern sutil */}
            <div className="pointer-events-none absolute inset-0 opacity-[0.04] dark:opacity-[0.08]"
                style={{
                    backgroundImage: 'linear-gradient(rgb(190,18,60) 1px, transparent 1px), linear-gradient(90deg, rgb(190,18,60) 1px, transparent 1px)',
                    backgroundSize: '40px 40px',
                }} />

            <div className="relative p-4 sm:p-6 max-w-[1400px] mx-auto space-y-4">
                {/* HEADER FULL WIDTH */}
                <header className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                        <h1 className="text-2xl font-black bg-gradient-to-r from-rose-600 to-pink-600 dark:from-rose-400 dark:to-pink-400 bg-clip-text text-transparent">
                            RH / DP
                        </h1>
                        <p className="text-xs text-slate-500 mt-0.5">
                            <strong>{stats.total}</strong> colaboradores · <strong>{stats.setores}</strong> setores
                            {stats.totalPend > 0 && (
                                <> · <Link to="/rh/aprovacoes" className="text-rose-600 font-bold hover:underline">{stats.totalPend} pendência{stats.totalPend > 1 ? 's' : ''}</Link></>
                            )}
                        </p>
                    </div>
                </header>

                <div className="flex gap-4">
                <div className="flex-1 min-w-0 space-y-4">

                    {/* BUSCA + CADASTRO RÁPIDO */}
                    <AcoesRapidas />

                    {/* ATALHOS — grade limpa */}
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                        {atalhos.map((a) => {
                            const Ic = a.icon;
                            return (
                                <Link key={a.module} to={a.to}
                                    className={`relative block rounded-2xl bg-gradient-to-br ${a.cor} text-white p-4 hover:shadow-xl transition shadow-md`}>
                                    <Ic className="w-7 h-7 mb-2 opacity-90" />
                                    <p className="font-black text-sm leading-tight">{a.titulo}</p>
                                    <div className="mt-3 flex items-center justify-between">
                                        <span className="text-[11px] opacity-90 inline-flex items-center gap-1">
                                            Acessar <ChevronRight className="w-3 h-3" />
                                        </span>
                                        {a.badge !== undefined && (
                                            <span className={`text-[10px] font-black rounded-full px-1.5 py-0.5 min-w-[20px] text-center ${a.badgeCor || 'bg-white/20'}`}>
                                                {a.badge}
                                            </span>
                                        )}
                                    </div>
                                </Link>
                            );
                        })}
                    </div>

                    {/* GRÁFICOS INFORMATIVOS — sempre visíveis */}
                    <div className="grid md:grid-cols-3 gap-3">
                        {/* Pizza de status */}
                        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Quadro atual</p>
                            {dadosStatus.length === 0 ? <p className="text-xs text-slate-400">Sem dados.</p> : (
                                <ResponsiveContainer width="100%" height={160}>
                                    <PieChart>
                                        <Pie data={dadosStatus} dataKey="value" nameKey="name" innerRadius={35} outerRadius={60} paddingAngle={2}>
                                            {dadosStatus.map((d, i) => <Cell key={i} fill={d.cor} />)}
                                        </Pie>
                                        <Tooltip />
                                        <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                                    </PieChart>
                                </ResponsiveContainer>
                            )}
                        </div>

                        {/* Pizza de aprovações */}
                        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Aprovações pendentes</p>
                            {dadosAprovacoes.length === 0 ? (
                                <p className="text-xs text-emerald-600 mt-12 text-center">✓ Nenhuma pendência</p>
                            ) : (
                                <ResponsiveContainer width="100%" height={160}>
                                    <PieChart>
                                        <Pie data={dadosAprovacoes} dataKey="value" nameKey="name" innerRadius={35} outerRadius={60} paddingAngle={2}>
                                            {dadosAprovacoes.map((d, i) => <Cell key={i} fill={d.cor} />)}
                                        </Pie>
                                        <Tooltip />
                                        <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                                    </PieChart>
                                </ResponsiveContainer>
                            )}
                        </div>

                        {/* Linha admissões x desligamentos */}
                        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Movimento · últimos 6 meses</p>
                            <ResponsiveContainer width="100%" height={160}>
                                <LineChart data={dadosMovimentos}>
                                    <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
                                    <XAxis dataKey="mes" tick={{ fontSize: 9 }} />
                                    <YAxis tick={{ fontSize: 9 }} allowDecimals={false} />
                                    <Tooltip />
                                    <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                                    <Line type="monotone" dataKey="admissoes" stroke="#10b981" strokeWidth={2} name="Admissões" />
                                    <Line type="monotone" dataKey="desligamentos" stroke="#ef4444" strokeWidth={2} name="Desligamentos" />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Bar chart de colaboradores por setor */}
                    {dadosSetor.length > 0 && (
                        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Colaboradores por setor</p>
                            <ResponsiveContainer width="100%" height={Math.max(120, dadosSetor.length * 28)}>
                                <BarChart data={dadosSetor} layout="vertical" margin={{ left: 80 }}>
                                    <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
                                    <XAxis type="number" tick={{ fontSize: 9 }} allowDecimals={false} />
                                    <YAxis dataKey="setor" type="category" tick={{ fontSize: 10 }} width={75} />
                                    <Tooltip />
                                    <Bar dataKey="qtd" fill="#e11d48" radius={[0, 4, 4, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    )}

                    {/* Ações de desenvolvedor (admin only) — discretas no rodapé */}
                    <details className="text-[11px] text-slate-400">
                        <summary className="cursor-pointer hover:text-slate-600">Ferramentas de teste</summary>
                        <div className="mt-2 flex gap-2">
                            <button
                                onClick={async () => {
                                    if (!confirm('⚠️ Apagar TUDO de RH?')) return;
                                    try {
                                        await api.rhClearDummy();
                                        toast.showToast('Dados apagados', 'success');
                                        window.location.reload();
                                    } catch (e: any) { toast.showToast(e.message, 'error'); }
                                }}
                                className="text-[10px] px-2 py-1 border border-red-300 text-red-600 rounded hover:bg-red-50">
                                🗑️ Limpar
                            </button>
                            <button
                                onClick={async () => {
                                    if (!confirm('Gerar dados dummy?')) return;
                                    try {
                                        await api.rhSeedDummy();
                                        toast.showToast('Dados gerados', 'success');
                                        window.location.reload();
                                    } catch (e: any) { toast.showToast(e.message, 'error'); }
                                }}
                                className="text-[10px] px-2 py-1 border border-rose-300 text-rose-600 rounded hover:bg-rose-50">
                                🧪 Gerar dummy
                            </button>
                        </div>
                    </details>
                </div>

                <AvisosDrawer />
                </div>
            </div>
        </div>
    );
};

export default DashboardRH;
