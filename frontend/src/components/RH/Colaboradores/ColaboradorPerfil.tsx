import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Pencil, X, Save, Users, FileText, ClipboardList, History, CheckCircle2, AlertTriangle, Banknote, Hammer, MessageCircle, ExternalLink } from 'lucide-react';
import { api } from '../../../app_api';
import { useToast } from '../../../contexts/ToastContext';
import VoltarDashboardRH from '../_shared/VoltarDashboardRH';
import RhPageBg from '../_shared/RhPageBg';

const STATUS_LABELS: Record<string, string> = {
    ativo: 'Ativo',
    afastado: 'Afastado',
    demitido: 'Desligado',
    experiencia: 'Em experiência',
};
const STATUS_COR: Record<string, string> = {
    ativo: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    afastado: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    demitido: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
    experiencia: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
};

const fmtDate = (s?: string) => {
    if (!s) return '—';
    try { return new Date(s + 'T00:00:00').toLocaleDateString('pt-BR'); } catch { return s; }
};
const fmtMoney = (v?: number | null) =>
    v == null ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const tempoCasa = (admissao?: string) => {
    if (!admissao) return '';
    try {
        const a = new Date(admissao + 'T00:00:00');
        const hoje = new Date();
        const anos = hoje.getFullYear() - a.getFullYear();
        let meses = hoje.getMonth() - a.getMonth();
        let totalMeses = anos * 12 + meses;
        if (hoje.getDate() < a.getDate()) totalMeses -= 1;
        const y = Math.floor(totalMeses / 12);
        const m = totalMeses % 12;
        if (totalMeses < 1) return 'recém-admitido';
        return `${y > 0 ? `${y}a ` : ''}${m}m`;
    } catch { return ''; }
};

type Tab = 'resumo' | 'pessoais' | 'contratuais' | 'documentos' | 'folha' | 'historico';

const ColaboradorPerfil: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const nav = useNavigate();
    const toast = useToast();
    const [c, setC] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [aba, setAba] = useState<Tab>('resumo');

    // Modal de edição
    const [modalOpen, setModalOpen] = useState(false);
    const [form, setForm] = useState<any>({});
    const [salvando, setSalvando] = useState(false);
    // Modal WhatsApp
    const [whatsAppOpen, setWhatsAppOpen] = useState(false);

    const carregar = async () => {
        if (!id) return;
        setLoading(true);
        try {
            const data = await api.rhColaboradorObter(parseInt(id, 10));
            setC(data);
        } catch (e: any) {
            toast.showToast(e.message || 'Erro ao carregar colaborador', 'error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { carregar(); }, [id]);

    const abrirEditar = () => {
        setForm({ ...c });
        setModalOpen(true);
    };

    const salvar = async () => {
        if (!form.nome || !form.nome.trim()) {
            toast.showToast('Nome é obrigatório', 'error');
            return;
        }
        setSalvando(true);
        try {
            const payload: any = {};
            Object.entries(form).forEach(([k, v]) => {
                if (['id', 'created_at', 'updated_at'].includes(k)) return;
                payload[k] = v === '' ? null : v;
            });
            await api.rhColaboradorAtualizar(c.id, payload);
            toast.showToast('Atualizado', 'success');
            setModalOpen(false);
            carregar();
        } catch (e: any) {
            toast.showToast(e.message || 'Erro ao salvar', 'error');
        } finally {
            setSalvando(false);
        }
    };

    if (loading) {
        return <div className="p-8 text-center text-slate-500 text-sm">Carregando…</div>;
    }
    if (!c) {
        return (
            <div className="p-8 text-center">
                <p className="text-slate-500">Colaborador não encontrado.</p>
                <Link to="/rh/colaboradores" className="text-rose-600 hover:underline text-sm mt-2 inline-block">← Voltar para lista</Link>
            </div>
        );
    }

    const status = c.status || 'ativo';

    return (
        <RhPageBg tema="rose">
                {/* Header */}
                <div className="flex items-center gap-2">
                    <button onClick={() => nav('/rh/colaboradores')} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-rose-600">
                        <ArrowLeft className="w-3.5 h-3.5" /> Voltar para lista
                    </button>
                    <VoltarDashboardRH />
                </div>

                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 flex items-start gap-4 flex-wrap">
                    <AvatarUpload colaborador={c} onUpload={carregar} />

                    <div className="flex-1 min-w-[200px]">
                        <h1 className="text-xl font-black text-slate-800 dark:text-slate-100">{c.nome}</h1>
                        <p className="text-sm text-slate-600 dark:text-slate-300">{c.cargo || '—'} {c.setor && <>· {c.setor}</>}</p>
                        <p className="text-xs text-slate-500 mt-1">
                            {c.cpf && <>CPF {c.cpf}</>}
                            {c.matricula && <> · Matrícula {c.matricula}</>}
                        </p>
                        <div className="flex items-center gap-2 mt-2 text-xs">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_COR[status]}`}>
                                {STATUS_LABELS[status]}
                            </span>
                            {c.data_admissao && (
                                <span className="text-slate-500">
                                    Admitido em <strong>{fmtDate(c.data_admissao)}</strong> ({tempoCasa(c.data_admissao)})
                                </span>
                            )}
                        </div>
                    </div>
                    <button onClick={abrirEditar} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-bold hover:bg-rose-700">
                        <Pencil className="w-3.5 h-3.5" /> Editar
                    </button>
                </div>

                {/* Tabs */}
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                    <div className="border-b border-slate-200 dark:border-slate-700 flex flex-wrap text-xs">
                        {([
                            { k: 'resumo', l: 'Resumo', icon: Users },
                            { k: 'pessoais', l: 'Dados Pessoais', icon: ClipboardList },
                            { k: 'contratuais', l: 'Contratuais', icon: FileText },
                            { k: 'documentos', l: 'Documentos', icon: FileText },
                            { k: 'folha', l: 'Folha', icon: Banknote },
                            { k: 'historico', l: 'Histórico', icon: History },
                        ] as { k: Tab; l: string; icon: any }[]).map((t) => {
                            const Ic = t.icon;
                            const active = aba === t.k;
                            return (
                                <button
                                    key={t.k}
                                    onClick={() => setAba(t.k)}
                                    className={`px-3 py-2 inline-flex items-center gap-1.5 border-b-2 transition ${
                                        active ? 'border-rose-600 text-rose-600 dark:text-rose-300 font-bold' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-200'
                                    }`}
                                >
                                    <Ic className="w-3.5 h-3.5" /> {t.l}
                                </button>
                            );
                        })}
                    </div>

                    <div className="p-4">
                        {aba === 'resumo' && (
                            <div className="grid md:grid-cols-2 gap-4 text-xs">
                                <Card title="Próximos eventos">
                                    {c.data_admissao && eventosResumo(c).length > 0 ? (
                                        <ul className="space-y-1.5">
                                            {eventosResumo(c).map((ev, i) => (
                                                <li key={i} className="flex items-start gap-2">
                                                    {ev.feito ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-0.5" /> : <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />}
                                                    <span><strong>{ev.titulo}:</strong> {fmtDate(ev.data)} {ev.feito && <em className="text-emerald-600">(passado)</em>}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    ) : <p className="text-slate-400">Sem eventos programados.</p>}
                                </Card>
                                <Card title="Documentos">
                                    <p className="text-slate-400">Lista de documentos virá quando o módulo de Documentos for ativado.</p>
                                </Card>
                                <Card title="Observações" className="md:col-span-2">
                                    {c.observacoes ? <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-200">{c.observacoes}</p> : <p className="text-slate-400">Nenhuma observação.</p>}
                                </Card>
                            </div>
                        )}

                        {aba === 'pessoais' && (
                            <div className="grid md:grid-cols-2 gap-3 text-xs">
                                <Field label="Nome completo" value={c.nome} />
                                <Field label="CPF" value={c.cpf} />
                                <Field label="RG" value={c.rg} />
                                <Field label="Data de nascimento" value={fmtDate(c.data_nascimento)} />
                                <Field label="E-mail" value={c.email} />
                                <div className="flex flex-col">
                                    <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Telefone</span>
                                    <div className="flex items-center gap-2 mt-0.5">
                                        <span className="text-slate-800 dark:text-slate-100 font-semibold">{c.telefone || '—'}</span>
                                        {c.telefone && (
                                            <button onClick={() => setWhatsAppOpen(true)} title="Enviar WhatsApp"
                                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold">
                                                <MessageCircle className="w-3 h-3" /> WhatsApp
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <Field label="Endereço" value={c.endereco} className="md:col-span-2" />
                                <Field label="Banco" value={c.banco_nome} />
                                <Field label="Agência / Conta" value={[c.banco_agencia, c.banco_conta].filter(Boolean).join(' / ')} />
                            </div>
                        )}

                        {aba === 'contratuais' && (
                            <div className="grid md:grid-cols-2 gap-3 text-xs">
                                <Field label="Matrícula" value={c.matricula} />
                                <Field label="Cargo" value={c.cargo} />
                                <Field label="Setor" value={c.setor} />
                                <Field label="Tipo" value={c.tipo} />
                                <Field label="Jornada" value={c.jornada} />
                                <Field label="Salário" value={fmtMoney(c.salario)} />
                                <Field label="CTPS" value={c.ctps} />
                                <Field label="Status" value={STATUS_LABELS[c.status || 'ativo']} />
                                <Field label="Data de admissão" value={fmtDate(c.data_admissao)} />
                                <Field label="Data de desligamento" value={c.data_demissao ? fmtDate(c.data_demissao) : '—'} />
                            </div>
                        )}

                        {(aba === 'documentos' || aba === 'folha' || aba === 'historico') && (
                            <div className="py-10 text-center">
                                <Hammer className="w-10 h-10 mx-auto text-rose-300 mb-2" />
                                <p className="text-sm font-bold text-slate-600 dark:text-slate-300">
                                    {aba === 'documentos' ? 'Aba Documentos em construção' : aba === 'folha' ? 'Aba Folha em construção' : 'Aba Histórico em construção'}
                                </p>
                                <p className="text-xs text-slate-400 mt-1">
                                    Vai aparecer aqui quando o módulo correspondente for desenvolvido.
                                </p>
                            </div>
                        )}
                    </div>
                </div>

            {whatsAppOpen && <WhatsAppModal colaborador={c} onClose={() => setWhatsAppOpen(false)} />}

            {/* Modal Editar */}
            {modalOpen && (
                <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 pt-20 pb-4 px-4 overflow-y-auto" onClick={() => !salvando && setModalOpen(false)}>
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
                        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                            <h3 className="font-bold text-slate-800 dark:text-slate-100">Editar colaborador</h3>
                            <button onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
                            <section>
                                <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-1.5">Identificação</p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    <Input label="Nome completo *" value={form.nome || ''} onChange={(v) => setForm({ ...form, nome: v })} />
                                    <Input label="Matrícula" value={form.matricula || ''} onChange={(v) => setForm({ ...form, matricula: v })} />
                                    <Input label="CPF" value={form.cpf || ''} onChange={(v) => setForm({ ...form, cpf: v })} />
                                    <Input label="RG" value={form.rg || ''} onChange={(v) => setForm({ ...form, rg: v })} />
                                    <Input label="E-mail" type="email" value={form.email || ''} onChange={(v) => setForm({ ...form, email: v })} />
                                    <Input label="Telefone" value={form.telefone || ''} onChange={(v) => setForm({ ...form, telefone: v })} />
                                    <Input label="Data de nascimento" type="date" value={form.data_nascimento || ''} onChange={(v) => setForm({ ...form, data_nascimento: v })} />
                                </div>
                                <Input className="mt-2" label="Endereço" value={form.endereco || ''} onChange={(v) => setForm({ ...form, endereco: v })} />
                            </section>

                            <section>
                                <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-1.5">Contratuais</p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    <Input label="Cargo" value={form.cargo || ''} onChange={(v) => setForm({ ...form, cargo: v })} />
                                    <Input label="Setor" value={form.setor || ''} onChange={(v) => setForm({ ...form, setor: v })} />
                                    <Select label="Tipo" value={form.tipo || ''} onChange={(v) => setForm({ ...form, tipo: v })} options={['CLT', 'PJ', 'Temporario', 'Estagiario']} />
                                    <Select label="Status" value={form.status || 'ativo'} onChange={(v) => setForm({ ...form, status: v })} options={['ativo', 'experiencia', 'afastado', 'demitido']} />
                                    <Input label="CTPS" value={form.ctps || ''} onChange={(v) => setForm({ ...form, ctps: v })} />
                                    <Input label="Jornada" placeholder="44h semanais" value={form.jornada || ''} onChange={(v) => setForm({ ...form, jornada: v })} />
                                    <Input label="Salário (R$)" type="number" step="0.01" value={form.salario ?? ''} onChange={(v) => setForm({ ...form, salario: v === '' ? null : parseFloat(v) })} />
                                    <Input label="Data de admissão" type="date" value={form.data_admissao || ''} onChange={(v) => setForm({ ...form, data_admissao: v })} />
                                    <Input label="Data de desligamento" type="date" value={form.data_demissao || ''} onChange={(v) => setForm({ ...form, data_demissao: v })} />
                                </div>
                            </section>

                            <section>
                                <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-1.5">Banco</p>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                    <Input label="Banco" value={form.banco_nome || ''} onChange={(v) => setForm({ ...form, banco_nome: v })} />
                                    <Input label="Agência" value={form.banco_agencia || ''} onChange={(v) => setForm({ ...form, banco_agencia: v })} />
                                    <Input label="Conta" value={form.banco_conta || ''} onChange={(v) => setForm({ ...form, banco_conta: v })} />
                                </div>
                            </section>

                            <section>
                                <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-1.5">Observações</p>
                                <textarea
                                    value={form.observacoes || ''}
                                    onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
                                    className="w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs"
                                    rows={3}
                                />
                            </section>
                        </div>
                        <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2">
                            <button onClick={() => setModalOpen(false)} disabled={salvando} className="px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg">Cancelar</button>
                            <button onClick={salvar} disabled={salvando} className="inline-flex items-center gap-1 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg disabled:opacity-50">
                                <Save className="w-3.5 h-3.5" /> {salvando ? 'Salvando…' : 'Salvar'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </RhPageBg>
    );
};

// Modal de envio de mensagem WhatsApp pra um colaborador
const WhatsAppModal: React.FC<{ colaborador: any; onClose: () => void }> = ({ colaborador, onClose }) => {
    const toast = useToast();
    const [mensagem, setMensagem] = useState(`Olá ${(colaborador.nome || '').split(' ')[0]},\n\n`);
    const [modelos, setModelos] = useState<any[]>([]);
    const [modeloId, setModeloId] = useState<string>('');

    useEffect(() => {
        api.rhModelosListar({ ativo: true })
            .then((r) => setModelos((r.modelos || []).filter((m: any) => m.file_url)))
            .catch(() => {});
    }, []);

    // Sanitiza o telefone para formato wa.me (apenas dígitos, com país)
    const numeroLimpo = () => {
        const apenasDigitos = (colaborador.telefone || '').replace(/\D/g, '');
        if (!apenasDigitos) return '';
        return apenasDigitos.startsWith('55') ? apenasDigitos : `55${apenasDigitos}`;
    };

    const modeloSel = modelos.find(m => String(m.id) === modeloId);
    const mensagemFinal = useMemo(() => {
        let m = mensagem;
        if (modeloSel) {
            const link = `${window.location.origin}/api/rh/documentos/modelos/${modeloSel.id}/download`;
            m += `\n\n📄 *${modeloSel.codigo} — ${modeloSel.nome}*\n${link}`;
        }
        return m.trim();
    }, [mensagem, modeloSel]);

    const enviar = () => {
        const num = numeroLimpo();
        if (!num) { toast.showToast('Telefone inválido', 'error'); return; }
        const url = `https://wa.me/${num}?text=${encodeURIComponent(mensagemFinal)}`;
        window.open(url, '_blank');
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 pt-20 pb-4 px-4 overflow-y-auto" onClick={onClose}>
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
                <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between bg-emerald-50 dark:bg-emerald-900/20">
                    <div className="flex items-center gap-2">
                        <MessageCircle className="w-4 h-4 text-emerald-600" />
                        <h3 className="font-bold">Enviar WhatsApp · {colaborador.nome}</h3>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
                </div>
                <div className="p-4 space-y-3 text-xs">
                    <div className="text-[11px] text-slate-500">Para: <strong className="text-slate-700 dark:text-slate-200">{colaborador.telefone}</strong></div>

                    <label className="block">
                        <span className="text-[10px] text-slate-500 font-semibold">Mensagem</span>
                        <textarea value={mensagem} onChange={(e) => setMensagem(e.target.value)}
                            rows={6} className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs" />
                    </label>

                    <label className="block">
                        <span className="text-[10px] text-slate-500 font-semibold">Anexar documento (opcional)</span>
                        <select value={modeloId} onChange={(e) => setModeloId(e.target.value)}
                            className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs">
                            <option value="">— Nenhum documento —</option>
                            {modelos.length === 0 ? <option disabled>Nenhum modelo com arquivo disponível</option> :
                                modelos.map(m => (
                                    <option key={m.id} value={m.id}>{m.codigo} — {m.nome}</option>
                                ))}
                        </select>
                        {modeloSel && (
                            <p className="text-[10px] text-slate-500 mt-1">Será incluído como link na mensagem para o destinatário baixar.</p>
                        )}
                    </label>

                    <div className="bg-slate-50 dark:bg-slate-900/40 rounded p-2 text-[11px]">
                        <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-1">Pré-visualização</p>
                        <pre className="whitespace-pre-wrap font-sans text-slate-700 dark:text-slate-200">{mensagemFinal}</pre>
                    </div>
                </div>
                <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2">
                    <button onClick={onClose} className="px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button>
                    <button onClick={enviar} className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg">
                        <ExternalLink className="w-3.5 h-3.5" /> Abrir WhatsApp
                    </button>
                </div>
            </div>
        </div>
    );
};

// Calcula os marcos de experiência (45 dias / 90 dias) a partir da admissão
function eventosResumo(c: any): { titulo: string; data: string; feito: boolean }[] {
    if (!c.data_admissao) return [];
    const a = new Date(c.data_admissao + 'T00:00:00');
    const hoje = new Date();
    const mk = (dias: number, titulo: string) => {
        const d = new Date(a.getTime() + dias * 86400000);
        return { titulo, data: d.toISOString().slice(0, 10), feito: d < hoje };
    };
    const out = [
        mk(45, 'Avaliação 1º período de experiência'),
        mk(90, 'Avaliação 2º período de experiência'),
        mk(365, 'Aniversário de contratação (1 ano)'),
    ];
    return out;
}

const AvatarUpload: React.FC<{ colaborador: any; onUpload: () => void }> = ({ colaborador, onUpload }) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const handle = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        if (!f) return;
        setUploading(true);
        try {
            await api.rhColaboradorUploadFoto(colaborador.id, f);
            onUpload();
        } catch (err: any) {
            alert(err.message || 'Erro ao subir foto');
        } finally {
            setUploading(false);
            if (inputRef.current) inputRef.current.value = '';
        }
    };
    const iniciais = (colaborador.nome || '?').split(' ').slice(0, 2).map((s: string) => s[0]).join('').toUpperCase();
    return (
        <>
            <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handle} />
            <button
                onClick={() => inputRef.current?.click()}
                disabled={uploading}
                title={uploading ? 'Subindo…' : 'Clique para trocar a foto'}
                className="w-20 h-20 rounded-2xl overflow-hidden bg-gradient-to-br from-rose-500 to-pink-600 text-white text-2xl font-black flex items-center justify-center shadow-lg shadow-rose-500/30 hover:opacity-90 relative group"
            >
                {colaborador.foto_url ? (
                    <img src={colaborador.foto_url} alt={colaborador.nome} className="w-full h-full object-cover" />
                ) : iniciais}
                <span className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center text-[10px] uppercase tracking-wider transition">
                    {uploading ? '…' : 'Trocar'}
                </span>
            </button>
        </>
    );
};

const Card: React.FC<{ title: string; children: React.ReactNode; className?: string }> = ({ title, children, className = '' }) => (
    <div className={`bg-slate-50 dark:bg-slate-900/40 rounded-lg p-3 border border-slate-200 dark:border-slate-700 ${className}`}>
        <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-2">{title}</p>
        {children}
    </div>
);

const Field: React.FC<{ label: string; value?: any; className?: string }> = ({ label, value, className = '' }) => (
    <div className={`flex flex-col ${className}`}>
        <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">{label}</span>
        <span className="text-slate-800 dark:text-slate-100 font-semibold mt-0.5">{value || '—'}</span>
    </div>
);

const Input: React.FC<{ label: string; value: string | number; onChange: (v: string) => void; type?: string; step?: string; placeholder?: string; className?: string }> = ({ label, value, onChange, type = 'text', step, placeholder, className = '' }) => (
    <label className={`block ${className}`}>
        <span className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold">{label}</span>
        <input
            type={type} step={step} value={value} placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs"
        />
    </label>
);

const Select: React.FC<{ label: string; value: string; onChange: (v: string) => void; options: string[] }> = ({ label, value, onChange, options }) => (
    <label className="block">
        <span className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold">{label}</span>
        <select value={value} onChange={(e) => onChange(e.target.value)}
            className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs">
            <option value="">—</option>
            {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
    </label>
);

export default ColaboradorPerfil;
