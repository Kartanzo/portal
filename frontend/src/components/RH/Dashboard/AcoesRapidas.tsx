import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { UserPlus, Search, FileText, Download, ExternalLink, User } from 'lucide-react';
import { api } from '../../../app_api';
import { hasRhPermission } from '../_shared/rhAuth';

const AcoesRapidas: React.FC = () => {
    const [busca, setBusca] = useState('');
    const [modelos, setModelos] = useState<any[]>([]);
    const [colabs, setColabs] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [aberto, setAberto] = useState(false);

    const podeColabEdit = hasRhPermission('rh_colaboradores', 'can_edit');
    const podeColabView = hasRhPermission('rh_colaboradores');
    const podeDocs = hasRhPermission('rh_documentos');

    useEffect(() => {
        setLoading(true);
        Promise.all([
            podeDocs ? api.rhModelosListar({ ativo: true }).catch(() => ({ modelos: [] })) : Promise.resolve({ modelos: [] }),
            podeColabView ? api.rhColaboradoresListar().catch(() => ({ colaboradores: [] })) : Promise.resolve({ colaboradores: [] }),
        ]).then(([m, c]) => {
            setModelos(m.modelos || []);
            setColabs(c.colaboradores || []);
        }).finally(() => setLoading(false));
    }, []);

    const colabsFiltrados = useMemo(() => {
        if (!podeColabView) return [];
        const q = busca.trim().toLowerCase();
        if (!q) return colabs.slice(0, 5);
        return colabs.filter(c =>
            (c.nome || '').toLowerCase().includes(q) ||
            (c.cpf || '').toLowerCase().includes(q) ||
            (c.email || '').toLowerCase().includes(q) ||
            (c.matricula || '').toLowerCase().includes(q) ||
            (c.cargo || '').toLowerCase().includes(q)
        ).slice(0, 8);
    }, [busca, colabs, podeColabView]);

    const modelosFiltrados = useMemo(() => {
        if (!podeDocs) return [];
        if (!busca.trim()) return modelos.slice(0, 6);
        const q = busca.toLowerCase();
        return modelos.filter(m =>
            (m.codigo || '').toLowerCase().includes(q) ||
            (m.nome || '').toLowerCase().includes(q) ||
            (m.categoria || '').toLowerCase().includes(q)
        ).slice(0, 10);
    }, [busca, modelos, podeDocs]);

    const semNada = colabsFiltrados.length === 0 && modelosFiltrados.length === 0;

    if (!podeColabEdit && !podeDocs && !podeColabView) return null;

    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Ações rápidas</p>
            <div className="flex flex-wrap gap-2">
                {podeColabEdit && (
                    <Link to="/rh/colaboradores?new=1"
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gradient-to-br from-rose-500 to-pink-600 text-white text-xs font-bold hover:opacity-90 shadow shadow-rose-500/30">
                        <UserPlus className="w-4 h-4" /> Cadastrar colaborador
                    </Link>
                )}

                {(podeColabView || podeDocs) && (
                    <div className="flex-1 min-w-[250px] relative">
                        <Search className="w-3.5 h-3.5 absolute left-2.5 top-3 text-slate-400" />
                        <input
                            value={busca}
                            onChange={(e) => { setBusca(e.target.value); setAberto(true); }}
                            onFocus={() => setAberto(true)}
                            onBlur={() => setTimeout(() => setAberto(false), 200)}
                            placeholder="Buscar colaborador ou documento (nome, CPF, matrícula, F 091, ficha cadastral…)"
                            className="w-full pl-8 pr-3 py-2 text-xs border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900"
                        />
                        {aberto && (
                            <div className="absolute z-30 top-full left-0 right-0 mt-1 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 shadow-xl max-h-96 overflow-y-auto">
                                {loading ? (
                                    <p className="p-3 text-center text-xs text-slate-400">Carregando…</p>
                                ) : semNada ? (
                                    <p className="p-3 text-center text-xs text-slate-400">Nada encontrado</p>
                                ) : (
                                    <>
                                        {colabsFiltrados.length > 0 && (
                                            <div>
                                                <p className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-slate-500 font-bold bg-slate-50 dark:bg-slate-900/40 border-b border-slate-200 dark:border-slate-700">
                                                    Colaboradores · {colabsFiltrados.length}
                                                </p>
                                                <ul className="divide-y divide-slate-100 dark:divide-slate-700">
                                                    {colabsFiltrados.map((c) => (
                                                        <li key={c.id}>
                                                            <Link to={`/rh/colaboradores/${c.id}`}
                                                                className="flex items-center gap-2 px-3 py-2 hover:bg-rose-50/40 dark:hover:bg-rose-900/10">
                                                                <div className="w-7 h-7 rounded-full overflow-hidden bg-gradient-to-br from-rose-400 to-pink-500 text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                                                                    {c.foto_url ? <img src={c.foto_url} alt={c.nome} className="w-full h-full object-cover" /> : (c.nome || '?').split(' ').slice(0, 2).map((s: string) => s[0]).join('').toUpperCase()}
                                                                </div>
                                                                <div className="flex-1 min-w-0">
                                                                    <p className="text-xs font-bold truncate">{c.nome}</p>
                                                                    <p className="text-[10px] text-slate-400 truncate">{c.cargo || '—'} {c.setor && <>· {c.setor}</>} {c.matricula && <>· #{c.matricula}</>}</p>
                                                                </div>
                                                                <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                                                            </Link>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}
                                        {modelosFiltrados.length > 0 && (
                                            <div>
                                                <p className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-slate-500 font-bold bg-slate-50 dark:bg-slate-900/40 border-b border-t border-slate-200 dark:border-slate-700">
                                                    Documentos · {modelosFiltrados.length}
                                                </p>
                                                <ul className="divide-y divide-slate-100 dark:divide-slate-700">
                                                    {modelosFiltrados.map((m) => (
                                                        <li key={m.id} className="flex items-center gap-2 px-3 py-2 hover:bg-rose-50/40 dark:hover:bg-rose-900/10">
                                                            <FileText className="w-3.5 h-3.5 text-rose-500 flex-shrink-0" />
                                                            <div className="flex-1 min-w-0">
                                                                <p className="text-xs font-bold truncate"><code className="text-[10px] text-rose-600 mr-1">{m.codigo}</code>{m.nome}</p>
                                                                {m.categoria && <p className="text-[10px] text-slate-400">{m.categoria}</p>}
                                                            </div>
                                                            {m.file_url ? (
                                                                <a href={api.rhModeloDownloadUrl(m.id)} className="text-emerald-600 hover:bg-emerald-50 p-1 rounded" title="Baixar"><Download className="w-3.5 h-3.5" /></a>
                                                            ) : <span className="text-slate-300" title="Sem arquivo"><Download className="w-3.5 h-3.5" /></span>}
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}
                                    </>
                                )}
                                <div className="border-t border-slate-200 dark:border-slate-700 p-2 flex justify-between text-[11px]">
                                    {podeColabView && <Link to="/rh/colaboradores" className="text-rose-600 hover:underline inline-flex items-center gap-1"><User className="w-3 h-3" /> Todos colaboradores</Link>}
                                    {podeDocs && <Link to="/rh/documentos" className="text-rose-600 hover:underline inline-flex items-center gap-1"><FileText className="w-3 h-3" /> Todos documentos</Link>}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default AcoesRapidas;
