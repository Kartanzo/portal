import React, { useEffect, useState } from 'react';
import { History, User } from 'lucide-react';
import { api } from '../../../app_api';

interface Props {
    entidade: string;
    entidadeId: string | number;
    titulo?: string;
}

const ACAO_COR: Record<string, string> = {
    criou: 'text-emerald-600',
    editou: 'text-blue-600',
    aprovou: 'text-emerald-700',
    rejeitou: 'text-red-600',
    removeu: 'text-red-700',
    atribuiu: 'text-violet-600',
    devolveu_estoque: 'text-amber-600',
};
const ACAO_LABEL: Record<string, string> = {
    criou: '✏️ Criou',
    editou: '🔧 Editou',
    aprovou: '✅ Aprovou',
    rejeitou: '❌ Rejeitou',
    removeu: '🗑️ Removeu',
    atribuiu: '📥 Atribuiu',
    devolveu_estoque: '📤 Devolveu ao estoque',
};

const fmt = (s?: string) => {
    if (!s) return '';
    try { return new Date(s).toLocaleString('pt-BR'); } catch { return s; }
};

const HistoricoAuditoria: React.FC<Props> = ({ entidade, entidadeId, titulo }) => {
    const [historico, setHistorico] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        setLoading(true);
        api.rhAuditListar(entidade, entidadeId)
            .then((r) => setHistorico(r.historico || []))
            .catch(() => setHistorico([]))
            .finally(() => setLoading(false));
    }, [entidade, entidadeId]);

    return (
        <div className="bg-slate-50 dark:bg-slate-900/40 rounded-lg p-3 border border-slate-200 dark:border-slate-700">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-2 inline-flex items-center gap-1">
                <History className="w-3 h-3" /> {titulo || 'Histórico'}
            </p>
            {loading ? (
                <p className="text-[11px] text-slate-400">Carregando…</p>
            ) : historico.length === 0 ? (
                <p className="text-[11px] text-slate-400 italic">Nenhum evento registrado.</p>
            ) : (
                <ul className="space-y-1.5">
                    {historico.map((h) => (
                        <li key={h.id} className="flex items-start gap-2 text-[11px]">
                            <span className="font-mono text-slate-400 whitespace-nowrap">{fmt(h.data)}</span>
                            <span className={`font-bold ${ACAO_COR[h.acao] || 'text-slate-600'}`}>{ACAO_LABEL[h.acao] || h.acao}</span>
                            {h.user_nome ? (
                                <span className="inline-flex items-center gap-0.5 text-slate-600 dark:text-slate-300">
                                    <User className="w-2.5 h-2.5" /> {h.user_nome}
                                </span>
                            ) : h.user_id ? (
                                <span className="text-slate-400">user {String(h.user_id).slice(0, 8)}</span>
                            ) : null}
                            {h.detalhes && Object.keys(h.detalhes).length > 0 && (
                                <span className="text-slate-400 italic truncate" title={JSON.stringify(h.detalhes)}>
                                    {Object.entries(h.detalhes).filter(([_, v]) => v).map(([k, v]) => `${k}: ${String(v).slice(0, 30)}`).join(' · ')}
                                </span>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

export default HistoricoAuditoria;
