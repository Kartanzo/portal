import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Clock, Calendar, UserPlus, UserMinus, Check, X, AlertTriangle, ExternalLink } from 'lucide-react';
import { api } from '../../../app_api';
import { useToast } from '../../../contexts/ToastContext';
import VoltarDashboardRH from '../_shared/VoltarDashboardRH';
import ChipsPorSetor from '../_shared/ChipsPorSetor';
import HistoricoAuditoria from '../_shared/HistoricoAuditoria';
import RhPageBg from '../_shared/RhPageBg';
import KpiCard, { KpiGrid } from '../../common/KpiCard';

type Tipo = 'bh' | 'ferias' | 'mov';

interface Pendencia {
    tipo: Tipo;
    id: number;
    colaborador: string;
    resumo: string;
    detalhe: string;
    data: string;
    setor?: string;
    raw: any;
}

const fmtDate = (s?: string) => {
    if (!s) return '—';
    try { return new Date(s + 'T00:00:00').toLocaleDateString('pt-BR'); } catch { return s; }
};

const URG_LABEL: Record<string, string> = {
    normal: '🟢 Normal',
    importante: '🟡 Importante',
    urgente: '🔴 Urgente',
};

const AprovacoesPage: React.FC = () => {
    const toast = useToast();
    const [pend, setPend] = useState<Pendencia[]>([]);
    const [loading, setLoading] = useState(false);
    const [filtroTipo, setFiltroTipo] = useState<Tipo | ''>('');
    const [filtroSetor, setFiltroSetor] = useState('');
    const [detalhe, setDetalhe] = useState<Pendencia | null>(null);

    const carregar = async () => {
        setLoading(true);
        try {
            const [bh, fer, mov] = await Promise.all([
                api.rhBHListar({ status: 'pendente' }).catch(() => ({ itens: [] })),
                api.rhFeriasListar({ status: 'pendente' }).catch(() => ({ ferias: [] })),
                api.rhMovListar({ status: 'pendente' }).catch(() => ({ movimentacoes: [] })),
            ]);
            const lista: Pendencia[] = [];
            (bh.itens || []).forEach((i: any) => {
                lista.push({
                    tipo: 'bh',
                    id: i.id,
                    colaborador: i.colaborador_nome || '—',
                    resumo: `${i.horas?.toFixed(1)}h · ${i.tipo}`,
                    detalhe: i.motivo || '—',
                    data: i.data,
                    setor: i.colaborador_setor,
                    raw: i,
                });
            });
            (fer.ferias || []).forEach((f: any) => {
                lista.push({
                    tipo: 'ferias',
                    id: f.id,
                    colaborador: f.colaborador_nome || '—',
                    resumo: `${f.dias || '?'} dias · ${fmtDate(f.data_inicio)} → ${fmtDate(f.data_fim)}`,
                    detalhe: [f.abono_pecuniario && `Abono ${f.abono_dias || '?'}d`, f.adiantamento_13 && '13º adiantado'].filter(Boolean).join(' · ') || '—',
                    data: f.data_inicio,
                    setor: f.colaborador_setor,
                    raw: f,
                });
            });
            (mov.movimentacoes || []).forEach((m: any) => {
                lista.push({
                    tipo: 'mov',
                    id: m.id,
                    colaborador: m.titulo || m.colaborador_nome || '—',
                    resumo: `${m.tipo === 'admissao' ? 'Admissão' : 'Desligamento'}${m.cargo ? ' · ' + m.cargo : ''}`,
                    detalhe: `${URG_LABEL[m.urgencia || 'normal']} · prevista ${fmtDate(m.data_prevista)}`,
                    data: m.data_prevista || m.created_at,
                    setor: m.setor,
                    raw: m,
                });
            });
            // Mais antigos primeiro (mais urgente)
            lista.sort((a, b) => (a.data || '').localeCompare(b.data || ''));
            setPend(lista);
        } catch (e: any) {
            toast.showToast(e.message || 'Erro', 'error');
        } finally { setLoading(false); }
    };

    useEffect(() => { carregar(); }, []);

    const filtradas = useMemo(() => {
        let r = pend;
        if (filtroTipo) r = r.filter(p => p.tipo === filtroTipo);
        if (filtroSetor) r = r.filter(p => (p.setor || 'Sem setor') === filtroSetor);
        return r;
    }, [pend, filtroTipo, filtroSetor]);
    const contadores = useMemo(() => {
        const c = { bh: 0, ferias: 0, mov: 0 };
        pend.forEach(p => { c[p.tipo]++; });
        return c;
    }, [pend]);

    const aprovar = async (p: Pendencia) => {
        try {
            if (p.tipo === 'bh') await api.rhBHAprovar(p.id);
            else if (p.tipo === 'ferias') await api.rhFeriasAprovar(p.id);
            else { const r = await api.rhMovAprovar(p.id); if (r.ticket_id) toast.showToast(`Ticket TI #${String(r.ticket_id).slice(0, 8)} criado`, 'success'); }
            toast.showToast('Aprovado', 'success');
            carregar();
        } catch (e: any) { toast.showToast(e.message, 'error'); }
    };
    const rejeitar = async (p: Pendencia) => {
        try {
            if (p.tipo === 'bh') await api.rhBHRejeitar(p.id);
            else if (p.tipo === 'ferias') await api.rhFeriasRejeitar(p.id);
            else await api.rhMovRejeitar(p.id);
            toast.showToast('Rejeitado', 'success');
            carregar();
        } catch (e: any) { toast.showToast(e.message, 'error'); }
    };

    const linkTo = (p: Pendencia) => {
        if (p.tipo === 'mov') return '/rh/movimentacoes';
        if (p.tipo === 'ferias') return '/rh/jornada';
        return '/rh/jornada';
    };

    const tipoVisual: Record<Tipo, { label: string; icon: any; cor: string }> = {
        bh: { label: 'Banco de Horas', icon: Clock, cor: 'bg-blue-100 text-blue-700' },
        ferias: { label: 'Férias', icon: Calendar, cor: 'bg-amber-100 text-amber-700' },
        mov: { label: 'Movimentação', icon: UserPlus, cor: 'bg-rose-100 text-rose-700' },
    };

    return (
        <RhPageBg tema="rose">
                <header className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center shadow-lg shadow-rose-500/30">
                            <CheckCircle2 className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-black bg-gradient-to-r from-rose-600 to-pink-600 dark:from-rose-400 dark:to-pink-400 bg-clip-text text-transparent">
                                Aprovações Pendentes
                            </h1>
                            <p className="text-xs text-slate-500 mt-0.5">Tudo que precisa do seu sim ou não em um só lugar</p>
                        </div>
                    </div>
                    <VoltarDashboardRH />
                </header>

                <KpiGrid className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <KpiCard label="Banco de Horas" value={contadores.bh} Icon={Clock} color="blue" onClick={() => setFiltroTipo(filtroTipo === 'bh' ? '' : 'bh')} />
                    <KpiCard label="Férias" value={contadores.ferias} Icon={Calendar} color="amber" onClick={() => setFiltroTipo(filtroTipo === 'ferias' ? '' : 'ferias')} />
                    <KpiCard label="Movimentações" value={contadores.mov} Icon={UserPlus} color="red" onClick={() => setFiltroTipo(filtroTipo === 'mov' ? '' : 'mov')} />
                </KpiGrid>

                <ChipsPorSetor items={pend} setorKey="setor" value={filtroSetor} onChange={setFiltroSetor} />

                {loading ? <p className="p-6 text-center text-slate-500 text-sm">Carregando…</p> : filtradas.length === 0 ? (
                    <div className="p-10 text-center text-slate-400 bg-white dark:bg-slate-800 rounded-xl">
                        <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-emerald-400" />
                        <p className="text-sm font-bold text-emerald-600">Nenhuma pendência! Tudo aprovado.</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {filtradas.map((p) => {
                            const v = tipoVisual[p.tipo];
                            const Ic = v.icon;
                            const isMov = p.tipo === 'mov';
                            const isAdm = isMov && p.raw.tipo === 'admissao';
                            const isDes = isMov && p.raw.tipo === 'desligamento';
                            return (
                                <div key={`${p.tipo}-${p.id}`} onDoubleClick={() => setDetalhe(p)}
                                    className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3 flex items-center gap-3 flex-wrap cursor-pointer hover:border-rose-300"
                                    title="Duplo clique para ver detalhes">
                                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                                        isAdm ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300'
                                        : isDes ? 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300'
                                        : v.cor + ' dark:bg-opacity-30'
                                    }`}>
                                        {isAdm ? <UserPlus className="w-5 h-5" /> : isDes ? <UserMinus className="w-5 h-5" /> : <Ic className="w-5 h-5" />}
                                    </div>
                                    <div className="flex-1 min-w-[200px]">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400">{v.label}</span>
                                            <span className="text-slate-300 text-[10px]">·</span>
                                            <span className="text-[11px] text-slate-500">{fmtDate(p.data)}</span>
                                        </div>
                                        <p className="font-bold text-sm text-slate-800 dark:text-slate-100">{p.colaborador}</p>
                                        <p className="text-xs text-slate-600 dark:text-slate-300">{p.resumo}</p>
                                        {p.detalhe && p.detalhe !== '—' && <p className="text-[11px] text-slate-500 mt-0.5">{p.detalhe}</p>}
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <button onClick={() => setDetalhe(p)} className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-slate-500 hover:text-rose-600">
                                            <ExternalLink className="w-3 h-3" /> Detalhes
                                        </button>
                                        <button onClick={() => aprovar(p)} className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg">
                                            <Check className="w-3 h-3" /> Aprovar
                                        </button>
                                        <button onClick={() => rejeitar(p)} className="inline-flex items-center gap-1 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg">
                                            <X className="w-3 h-3" /> Rejeitar
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                <div className="text-[11px] text-slate-400 text-center pt-2">
                    <AlertTriangle className="w-3 h-3 inline mr-1" />
                    Movimentações aprovadas geram ticket TI automaticamente. Banco de horas e férias atualizam o status do colaborador.
                </div>

            {detalhe && (
                <DetalhePendenciaModal
                    pend={detalhe}
                    onClose={() => setDetalhe(null)}
                    onAprovar={async () => { await aprovar(detalhe); setDetalhe(null); }}
                    onRejeitar={async () => { await rejeitar(detalhe); setDetalhe(null); }}
                />
            )}
        </RhPageBg>
    );
};

const DetalhePendenciaModal: React.FC<{ pend: Pendencia; onClose: () => void; onAprovar: () => void; onRejeitar: () => void }> = ({ pend, onClose, onAprovar, onRejeitar }) => {
    const raw = pend.raw || {};
    const entidade = pend.tipo === 'bh' ? 'banco_horas' : pend.tipo === 'ferias' ? 'ferias' : 'movimentacao';
    const titulo = pend.tipo === 'mov' ? (raw.tipo === 'admissao' ? 'Requisição de Contratação' : 'Requisição de Desligamento')
        : pend.tipo === 'bh' ? 'Banco de Horas' : 'Férias';

    const fmtData = (s?: string) => s ? new Date(s).toLocaleDateString('pt-BR') : '—';
    const fmtDataHora = (s?: string) => s ? new Date(s).toLocaleString('pt-BR') : '—';

    return (
        <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 pt-20 pb-4 px-4 overflow-y-auto" onClick={onClose}>
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
                <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between bg-rose-50 dark:bg-rose-900/20">
                    <div>
                        <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">{titulo}</p>
                        <h3 className="font-bold">{pend.colaborador}</h3>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {pend.tipo === 'bh' && (
                            <>
                                <Linha label="Data" valor={fmtData(raw.data)} />
                                <Linha label="Horas" valor={`${raw.horas?.toFixed?.(1) || raw.horas}h`} />
                                <Linha label="Tipo" valor={raw.tipo} />
                                <Linha label="Setor" valor={raw.colaborador_setor} />
                                <Linha label="Motivo" valor={raw.motivo} colspan />
                                <Linha label="Criado em" valor={fmtDataHora(raw.created_at)} />
                            </>
                        )}
                        {pend.tipo === 'ferias' && (
                            <>
                                <Linha label="Início" valor={fmtData(raw.data_inicio)} />
                                <Linha label="Fim" valor={fmtData(raw.data_fim)} />
                                <Linha label="Dias" valor={raw.dias} />
                                <Linha label="Setor" valor={raw.colaborador_setor} />
                                <Linha label="Abono pecuniário" valor={raw.abono_pecuniario ? `${raw.abono_dias || '?'} dias` : '—'} />
                                <Linha label="Adiantamento 13º" valor={raw.adiantamento_13 ? 'Sim' : 'Não'} />
                                <Linha label="Observações" valor={raw.observacoes} colspan />
                                <Linha label="Criado em" valor={fmtDataHora(raw.created_at)} />
                            </>
                        )}
                        {pend.tipo === 'mov' && (
                            <>
                                <Linha label="Tipo" valor={raw.tipo} />
                                <Linha label="Cargo" valor={raw.cargo} />
                                <Linha label="Setor" valor={raw.setor} />
                                <Linha label="Urgência" valor={raw.urgencia} />
                                <Linha label="Data prevista" valor={fmtData(raw.data_prevista)} />
                                <Linha label="Status" valor={raw.status} />
                                <Linha label="Motivo" valor={raw.motivo} colspan />
                                <Linha label="Criado em" valor={fmtDataHora(raw.created_at)} />
                            </>
                        )}
                    </div>

                    {pend.tipo === 'mov' && raw.dados && (
                        <div>
                            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Detalhes da solicitação</p>
                            <div className="bg-slate-50 dark:bg-slate-900/40 rounded p-2 space-y-1 text-[11px]">
                                {raw.dados.equipamentos?.length > 0 && <p><strong>Equipamentos:</strong> {raw.dados.equipamentos.join(', ')}</p>}
                                {raw.dados.sistemas_externos?.length > 0 && <p><strong>Sistemas externos:</strong> {raw.dados.sistemas_externos.join(', ')}</p>}
                                {raw.dados.modulos_portal?.length > 0 && <p><strong>Módulos:</strong> {raw.dados.modulos_portal.join(', ')}</p>}
                                {raw.dados.pastas_rede?.length > 0 && <p><strong>Pastas:</strong> <code className="text-[10px]">{raw.dados.pastas_rede.join(' · ')}</code></p>}
                                {raw.dados.bloqueios?.length > 0 && <p><strong>Bloqueios:</strong> {raw.dados.bloqueios.join(', ')}</p>}
                                {raw.dados.devolucao_equipamentos?.length > 0 && <p><strong>Devolver:</strong> {raw.dados.devolucao_equipamentos.join(', ')}</p>}
                            </div>
                        </div>
                    )}

                    <HistoricoAuditoria entidade={entidade} entidadeId={pend.id} titulo="Histórico (quem fez o quê)" />
                </div>
                <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2">
                    <button onClick={onClose} className="px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg">Fechar</button>
                    <button onClick={onRejeitar} className="inline-flex items-center gap-1 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg">
                        <X className="w-3.5 h-3.5" /> Rejeitar
                    </button>
                    <button onClick={onAprovar} className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg">
                        <Check className="w-3.5 h-3.5" /> Aprovar
                    </button>
                </div>
            </div>
        </div>
    );
};

const Linha: React.FC<{ label: string; valor: any; colspan?: boolean }> = ({ label, valor, colspan }) => (
    <div className={colspan ? 'col-span-2' : ''}>
        <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">{label}</p>
        <p className="text-slate-700 dark:text-slate-200 font-semibold">{valor != null && valor !== '' ? String(valor) : '—'}</p>
    </div>
);

export default AprovacoesPage;
