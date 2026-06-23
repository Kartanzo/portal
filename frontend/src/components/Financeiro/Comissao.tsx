/**
 * Comissão (Financeiro) — controle de comissões dos vendedores.
 * Navegação por MENU LATERAL em árvore: ANO -> MÊS -> EMPRESA (3LACKD BR / SP),
 * tudo derivado da REFERENCIA (que identifica o relatório). Ações escopadas pela referência.
 * Validação no nosso banco; PDFs antigos do Drive, novos por upload.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RefreshCw, CheckCircle2, XCircle, Clock, FileText, Upload, CloudDownload,
  Search, ChevronDown, ChevronRight, DollarSign, Layers, X, CheckCheck, Loader2, Calendar, Building2, Download, AlertTriangle, Send, Mail,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { api } from '../../app_api';
import PageBackground from '../common/PageBackground';
import KpiCard, { KpiGrid } from '../common/KpiCard';

interface RefInfo { referencia: string; total: number; com_pdf: number; aprovados: number; reprovados: number; pendentes: number; pdf_no_drive: number; }
interface Registro {
  id: string; codigo_vendedor: string; nome_fantasia: string; comissao: string; total_a_receber: string;
  referencia: string; status_validacao: string; validacao_sheet: string; tem_pdf: boolean;
  documento_id: string | null; origem_pdf: string | null; pdf_ref: string; tem_pdf_origem: boolean; email: string;
  realizado?: string; meta?: string; percentual?: string; premio?: string; premiacao?: string; total?: string;
  email_primario?: string; email_secundario?: string; email_enviado_em?: string | null;
}

const MESES: Record<string, string> = {
  '01': 'Janeiro', '02': 'Fevereiro', '03': 'Março', '04': 'Abril', '05': 'Maio', '06': 'Junho',
  '07': 'Julho', '08': 'Agosto', '09': 'Setembro', '10': 'Outubro', '11': 'Novembro', '12': 'Dezembro',
};

function parseValor(v?: string): number {
  if (!v) return 0;
  const n = parseFloat(String(v).replace(/\./g, '').replace(',', '.').replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}
const fmtBRL = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
// Célula de valor monetário: formata quando numérico; '—' para vazio/nan/inf.
function money(v?: string): string {
  if (v === undefined || v === null) return '—';
  const s = String(v).trim().toLowerCase();
  if (!s || s === 'nan' || s === 'inf' || s === '-') return '—';
  const n = parseValor(v);
  return n ? fmtBRL(n) : (s === '0' ? fmtBRL(0) : v);
}
function cell(v?: string): string {
  if (v === undefined || v === null) return '—';
  const s = String(v).trim();
  return (!s || s.toLowerCase() === 'nan') ? '—' : v;
}

// Extrai mês/ano/empresa da REFERENCIA (ex.: "RELATÓRIO COMISSÃO - 01.2025 - 3LACKD SP.XLS")
function parseRef(ref: string): { ano: string; mm: string; empresa: string; label: string } {
  const semExt = ref.replace(/\.(xls|xlsx|csv)\s*$/i, '');
  const dt = semExt.match(/(\d{1,2})[.\/](\d{4})/);
  const mm = dt ? dt[1].padStart(2, '0') : '';
  const ano = dt ? dt[2] : 'Sem ano';
  const partes = semExt.split(' - ').map(s => s.trim());
  const empresa = partes.length > 1 ? partes[partes.length - 1] : ref;
  const label = [mm ? `${mm}/${ano}` : '', empresa].filter(Boolean).join(' · ') || ref;
  return { ano, mm, empresa, label };
}

const StatusBadge: React.FC<{ s: string }> = ({ s }) => {
  const map: Record<string, { c: string; t: string }> = {
    aprovado: { c: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300', t: 'Aprovado' },
    reprovado: { c: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300', t: 'Reprovado' },
    pendente: { c: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300', t: 'Pendente' },
  };
  const x = map[s] || map.pendente;
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${x.c}`}>{x.t}</span>;
};

const Comissao: React.FC<{ user?: any }> = () => {
  const [refs, setRefs] = useState<RefInfo[]>([]);
  const [ultimaSync, setUltimaSync] = useState<string | null>(null);
  const [anosAbertos, setAnosAbertos] = useState<Set<string>>(new Set());
  const [mesesAbertos, setMesesAbertos] = useState<Set<string>>(new Set());
  const [selRef, setSelRef] = useState<string>('');
  const [registros, setRegistros] = useState<Registro[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<'' | 'sync' | 'drive' | 'lote' | 'email'>('');
  const [busyMsg, setBusyMsg] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [filtro, setFiltro] = useState('');
  const [toast, setToast] = useState<{ msg: string; tipo: 'ok' | 'erro' } | null>(null);
  const [resultado, setResultado] = useState<{ titulo: string; linhas: string[] } | null>(null);
  const [loteRes, setLoteRes] = useState<{ referencia: string; vinculados: string[]; nao_encontrados: string[]; ambiguos: string[]; semPdf: { codigo: string; nome: string }[] } | null>(null);
  const [confirmLote, setConfirmLote] = useState<File[] | null>(null);
  const [confirmEmail, setConfirmEmail] = useState(false);
  const [ccFixos, setCcFixos] = useState(true);
  const [reenviar, setReenviar] = useState(false);
  const [emailRes, setEmailRes] = useState<{ enviados: any[]; falhas: any[]; pulados: any[]; restantes: number; assunto: string; limite_atingido?: boolean } | null>(null);
  const loteInput = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const [tableW, setTableW] = useState(0);
  const syncFrom = (src: 'top' | 'body') => {
    if (!bodyRef.current || !topRef.current) return;
    if (src === 'top') bodyRef.current.scrollLeft = topRef.current.scrollLeft;
    else topRef.current.scrollLeft = bodyRef.current.scrollLeft;
  };

  const showToast = (msg: string, tipo: 'ok' | 'erro' = 'ok') => { setToast({ msg, tipo }); setTimeout(() => setToast(null), 4500); };

  const carregarArvore = useCallback(async () => {
    const { data } = await api.get('/financeiro/comissao/arvore');
    setRefs(data.referencias || []);
    setUltimaSync(data.ultima_sync || null);
  }, []);

  const carregarRegistros = useCallback(async (referencia: string) => {
    setLoading(true); setSel(new Set());
    try {
      const { data } = await api.get('/financeiro/comissao/registros', { params: { referencia } });
      setRegistros(data.registros || []);
    } catch (e: any) { showToast(e?.message || 'Erro ao carregar registros', 'erro'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { carregarArvore().catch(e => showToast(e?.message || 'Erro ao carregar', 'erro')); }, []); // eslint-disable-line

  // Árvore Ano -> Mês -> [Empresa(referência)]
  const arvore = useMemo(() => {
    const anos = new Map<string, Map<string, { empresa: string; referencia: string; info: RefInfo }[]>>();
    for (const rf of refs) {
      const pr = parseRef(rf.referencia);
      if (!anos.has(pr.ano)) anos.set(pr.ano, new Map());
      const mmap = anos.get(pr.ano)!;
      const key = pr.mm || '—';
      if (!mmap.has(key)) mmap.set(key, []);
      mmap.get(key)!.push({ empresa: pr.empresa, referencia: rf.referencia, info: rf });
    }
    return Array.from(anos.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([ano, mmap]) => ({
        ano,
        total: Array.from(mmap.values()).flat().reduce((s, l) => s + l.info.total, 0),
        meses: Array.from(mmap.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([mm, leaves]) => ({
            mm, nome: MESES[mm] || mm,
            leaves: leaves.sort((x, y) => x.empresa.localeCompare(y.empresa)),
          })),
      }));
  }, [refs]);

  const toggleAno = (ano: string) => setAnosAbertos(s => { const n = new Set(s); n.has(ano) ? n.delete(ano) : n.add(ano); return n; });
  const toggleMes = (k: string) => setMesesAbertos(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const selecionarRef = (ref: string) => { setSelRef(ref); setFiltro(''); carregarRegistros(ref); };

  const refrescar = async () => { await carregarArvore(); if (selRef) await carregarRegistros(selRef); };

  const sincronizar = async () => {
    setBusy('sync'); setBusyMsg('Sincronizando a planilha…');
    try {
      const { data } = await api.post('/financeiro/comissao/sync');
      showToast(`Sincronizado: ${data.inseridos} novos, ${data.atualizados} atualizados.`);
      await refrescar();
    } catch (e: any) { showToast(e?.message || 'Erro ao sincronizar', 'erro'); }
    finally { setBusy(''); }
  };

  const buscarDrive = async () => {
    if (!selRef) return;
    setBusy('drive'); setBusyMsg('Buscando PDFs no Drive… pode levar alguns segundos.');
    try {
      const { data } = await api.post('/financeiro/comissao/buscar-drive', { referencia: selRef });
      setResultado({
        titulo: 'PDFs do Drive',
        linhas: [
          `Baixados nesta rodada: ${data.baixados} de ${data.total_pendentes}.`,
          ...(data.restantes ? [`Ainda restam ${data.restantes} — clique novamente para continuar.`] : ['Todos os PDFs de origem foram baixados.']),
          ...(data.falhas || []).slice(0, 20).map((f: any) => `Falha: ${f.motivo}`),
        ],
      });
      await refrescar();
    } catch (e: any) { showToast(e?.message || 'Erro ao buscar do Drive (tente novamente)', 'erro'); }
    finally { setBusy(''); }
  };

  const validar = async (ids: string[], status: 'aprovado' | 'reprovado') => {
    if (!ids.length) return;
    try {
      await api.post('/financeiro/comissao/validar', { ids, status });
      setRegistros(rs => rs.map(r => (ids.includes(r.id) ? { ...r, status_validacao: status } : r)));
      setSel(new Set());
      showToast(`${ids.length} registro(s) marcados como ${status}.`);
      carregarArvore();
    } catch (e: any) { showToast(e?.message || 'Erro ao validar', 'erro'); }
  };

  const uploadIndividual = async (regId: string, file?: File | null) => {
    if (!file) return;
    try { await api.comissaoUploadDoc(regId, file); showToast('PDF vinculado.'); await refrescar(); }
    catch (e: any) { showToast(e?.message || 'Erro no upload', 'erro'); }
  };

  const uploadLote = async (files: File[]) => {
    if (!files.length || !selRef) return;
    setBusy('lote'); setBusyMsg(`Enviando e vinculando ${files.length} PDF(s)…`);
    try {
      const data = await api.comissaoUploadLote(selRef, files);
      setLoteRes({
        referencia: selRef,
        vinculados: data.vinculados || [],
        nao_encontrados: data.nao_encontrados || [],
        ambiguos: data.ambiguos || [],
        semPdf: data.vendedores_sem_pdf || [],
      });
      await refrescar();
    } catch (e: any) { showToast(e?.message || 'Erro no upload em lote', 'erro'); }
    finally { setBusy(''); if (loteInput.current) loteInput.current.value = ''; }
  };

  const registrosFiltrados = useMemo(() => {
    const f = filtro.trim().toLowerCase();
    return f ? registros.filter(r => `${r.codigo_vendedor} ${r.nome_fantasia}`.toLowerCase().includes(f)) : registros;
  }, [registros, filtro]);

  // mede a largura da tabela para a barra de rolagem horizontal do topo
  useEffect(() => {
    const id = setTimeout(() => { if (bodyRef.current) setTableW(bodyRef.current.scrollWidth); }, 60);
    return () => clearTimeout(id);
  }, [registrosFiltrados, selRef]);

  const kpis = useMemo(() => ({
    total: registros.length,
    soma: registros.reduce((s, r) => s + parseValor(r.comissao), 0),
    aprovados: registros.filter(r => r.status_validacao === 'aprovado').length,
    reprovados: registros.filter(r => r.status_validacao === 'reprovado').length,
    pendentes: registros.filter(r => r.status_validacao === 'pendente').length,
    comPdf: registros.filter(r => r.tem_pdf).length,
  }), [registros]);

  // Elegíveis para e-mail: APROVADOS, com PDF e com algum e-mail. Se houver seleção, restringe a ela.
  const elegiveisEmail = useMemo(() => {
    const base = sel.size > 0 ? registros.filter(r => sel.has(r.id)) : registros;
    return base.filter(r => r.status_validacao === 'aprovado' && r.tem_pdf && (r.email_primario || r.email_secundario) && (reenviar || !r.email_enviado_em));
  }, [registros, sel]);

  const enviarEmails = async () => {
    setConfirmEmail(false);
    if (!selRef) return;
    setBusy('email'); setBusyMsg('Enviando e-mails… pode levar alguns segundos.');
    try {
      const ids = sel.size > 0 ? Array.from(sel) : undefined;
      const { data } = await api.post('/financeiro/comissao/enviar-emails', { referencia: selRef, ids, cc_fixos: ccFixos, reenviar });
      setEmailRes({ enviados: data.enviados || [], falhas: data.falhas || [], pulados: data.pulados || [], restantes: data.restantes || 0, assunto: data.assunto || '', limite_atingido: data.limite_atingido || false });
    } catch (e: any) { showToast(e?.message || 'Erro ao enviar e-mails', 'erro'); }
    finally { setBusy(''); setReenviar(false); }
  };

  const exportarEmail = () => {
    if (!emailRes) return;
    const wb = XLSX.utils.book_new();
    const add = (nome: string, aoa: any[][]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), nome);
    add('Enviados', [['Código', 'Nome', 'Para'], ...emailRes.enviados.map((e: any) => [e.codigo, e.nome, e.to])]);
    add('Pulados', [['Código', 'Nome', 'Motivo'], ...emailRes.pulados.map((e: any) => [e.codigo, e.nome, e.motivo])]);
    if (emailRes.falhas.length) add('Falhas', [['Código', 'Nome', 'Erro'], ...emailRes.falhas.map((e: any) => [e.codigo, e.nome, e.erro])]);
    XLSX.writeFile(wb, `envio_emails_${parseRef(selRef).label.replace(/[^\w]+/g, '_')}.xlsx`);
  };

  const toggleSel = (id: string) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const todosSel = registrosFiltrados.length > 0 && registrosFiltrados.every(r => sel.has(r.id));
  const toggleTodos = () => setSel(s => { if (todosSel) return new Set(); const n = new Set(s); registrosFiltrados.forEach(r => n.add(r.id)); return n; });

  const codDoArquivo = (nome: string) => { const m = nome.match(/^\s*0*(\d+)/); return m ? m[1] : ''; };
  const exportarLote = () => {
    if (!loteRes) return;
    const label = parseRef(loteRes.referencia).label;
    const wb = XLSX.utils.book_new();
    const add = (nome: string, aoa: any[][]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), nome);
    add('Resumo', [
      ['Referência', loteRes.referencia],
      ['Vinculados', loteRes.vinculados.length],
      ['Sem correspondência', loteRes.nao_encontrados.length],
      ['Ambíguos', loteRes.ambiguos.length],
      ['Vendedores sem PDF', loteRes.semPdf.length],
    ]);
    add('Sem correspondencia', [['Arquivo', 'Código detectado'], ...loteRes.nao_encontrados.map(f => [f, codDoArquivo(f)])]);
    add('Vendedores sem PDF', [['Código', 'Nome'], ...loteRes.semPdf.map(v => [v.codigo, v.nome])]);
    add('Vinculados', [['Arquivo'], ...loteRes.vinculados.map(f => [f])]);
    if (loteRes.ambiguos.length) add('Ambiguos', [['Arquivo', 'Código detectado'], ...loteRes.ambiguos.map(f => [f, codDoArquivo(f)])]);
    XLSX.writeFile(wb, `upload_lote_${label.replace(/[^\w]+/g, '_')}.xlsx`);
  };

  const btn = 'inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium cursor-pointer disabled:opacity-50 transition';
  const refSel = selRef ? parseRef(selRef) : null;
  const th = 'px-2.5 py-2 whitespace-nowrap bg-slate-50 dark:bg-slate-800';
  const td = 'px-2.5 py-1.5 whitespace-nowrap';

  return (
    <PageBackground>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <DollarSign className="w-6 h-6 text-emerald-600" /> Comissão
          </h1>
          <p className="text-sm text-slate-500">Controle e validação financeira das comissões por ano, mês e empresa.{ultimaSync && <span className="ml-2 text-slate-400">· Última atualização: {new Date(ultimaSync).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>}</p>
        </div>
        <button onClick={sincronizar} disabled={!!busy} className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>
          <RefreshCw className={`w-4 h-4 ${busy === 'sync' ? 'animate-spin' : ''}`} /> Sincronizar planilha
        </button>
      </div>

      <div className="flex gap-4 items-start">
        {/* MENU LATERAL: Ano -> Mês -> Empresa */}
        <aside className="w-72 shrink-0 bg-white dark:bg-slate-800 rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 overflow-hidden self-start">
          <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-700 text-xs font-bold uppercase tracking-wide text-slate-400">Períodos</div>
          <div className="max-h-[72vh] overflow-y-auto p-2 space-y-1">
            {refs.length === 0 && <div className="text-sm text-slate-400 px-2 py-3">Sincronize a planilha para começar.</div>}
            {arvore.map(an => (
              <div key={an.ano}>
                <button onClick={() => toggleAno(an.ano)}
                  className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/50">
                  {anosAbertos.has(an.ano) ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                  <Calendar className="w-4 h-4 text-emerald-600" />
                  <span className="flex-1 text-left">{an.ano}</span>
                  <span className="text-[11px] text-slate-400">{an.total}</span>
                </button>
                {anosAbertos.has(an.ano) && (
                  <div className="ml-3 pl-2 border-l border-slate-200 dark:border-slate-700 space-y-0.5 py-1">
                    {an.meses.map(me => {
                      const k = `${an.ano}-${me.mm}`;
                      return (
                        <div key={k}>
                          <button onClick={() => toggleMes(k)}
                            className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[13px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/50">
                            {mesesAbertos.has(k) ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
                            <span className="flex-1 text-left">{me.nome}</span>
                          </button>
                          {mesesAbertos.has(k) && (
                            <div className="ml-3 pl-2 border-l border-slate-100 dark:border-slate-700/60 space-y-0.5 py-0.5">
                              {me.leaves.map(lf => {
                                const ativo = selRef === lf.referencia;
                                return (
                                  <button key={lf.referencia} onClick={() => selecionarRef(lf.referencia)}
                                    className={`w-full text-left px-2 py-1.5 rounded-md text-xs flex items-center gap-1.5 ${ativo
                                      ? 'bg-emerald-600 text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/50'}`}>
                                    <Building2 className={`w-3.5 h-3.5 ${ativo ? 'text-white/90' : 'text-slate-400'}`} />
                                    <span className="flex-1 truncate" title={lf.referencia}>{lf.empresa}</span>
                                    <span className={`text-[10px] ${ativo ? 'text-white/80' : 'text-slate-400'}`}>{lf.info.com_pdf}/{lf.info.total}</span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </aside>

        {/* CONTEÚDO */}
        <div className="flex-1 min-w-0">
          {!selRef ? (
            <div className="bg-white dark:bg-slate-800 rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 py-20 text-center text-slate-400">
              <Layers className="mx-auto mb-3 text-slate-300" size={40} />
              Selecione um período no menu à esquerda (Ano → Mês → Empresa).
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                <div className="text-sm">
                  <span className="font-semibold text-slate-700 dark:text-slate-200">{refSel?.label}</span>
                  <div className="text-[11px] text-slate-400 truncate max-w-md" title={selRef}>{selRef}</div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={buscarDrive} disabled={!!busy} className={`${btn} bg-indigo-600 text-white hover:bg-indigo-700`}>
                    <CloudDownload className="w-4 h-4" /> Buscar PDFs do Drive
                  </button>
                  <button onClick={() => loteInput.current?.click()} disabled={!!busy} className={`${btn} bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200`}>
                    <Upload className="w-4 h-4" /> Carregar PDFs em lote
                  </button>
                  <input ref={loteInput} type="file" accept="application/pdf" multiple className="hidden"
                    onChange={e => { const fs = e.target.files; if (fs && fs.length && selRef) setConfirmLote(Array.from(fs)); if (loteInput.current) loteInput.current.value = ''; }} />
                  <button onClick={() => { if (elegiveisEmail.length === 0) { showToast('Nenhum vendedor APROVADO com PDF e e-mail neste recorte.', 'erro'); return; } setConfirmEmail(true); }} disabled={!!busy} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>
                    <Send className="w-4 h-4" /> Enviar e-mails
                  </button>
                </div>
              </div>

              <KpiGrid className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
                <KpiCard label="Vendedores" value={String(kpis.total)} Icon={Layers} color="blue" />
                <KpiCard label="Total comissão" value={fmtBRL(kpis.soma)} Icon={DollarSign} color="emerald" />
                <KpiCard label="Aprovados" value={String(kpis.aprovados)} Icon={CheckCircle2} color="emerald" />
                <KpiCard label="Reprovados" value={String(kpis.reprovados)} Icon={XCircle} color="red" />
                <KpiCard label="Pendentes" value={String(kpis.pendentes)} Icon={Clock} color="amber" />
                <KpiCard label="Com PDF" value={`${kpis.comPdf}/${kpis.total}`} Icon={FileText} color="indigo" />
              </KpiGrid>

              <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                <div className="relative w-full max-w-xs">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input value={filtro} onChange={e => setFiltro(e.target.value)} placeholder="Buscar por código ou nome…"
                    className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40" />
                </div>
                {sel.size > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-500">{sel.size} selecionado(s)</span>
                    <button onClick={() => validar(Array.from(sel), 'aprovado')} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>
                      <CheckCheck className="w-4 h-4" /> Aprovar
                    </button>
                    <button onClick={() => validar(Array.from(sel), 'reprovado')} className={`${btn} bg-red-600 text-white hover:bg-red-700`}>
                      <XCircle className="w-4 h-4" /> Reprovar
                    </button>
                  </div>
                )}
              </div>

              <div className="bg-white dark:bg-slate-800 rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 overflow-hidden">
                {loading ? (
                  <div className="py-16 text-center text-slate-400">Carregando…</div>
                ) : registrosFiltrados.length === 0 ? (
                  <div className="py-16 text-center text-slate-400">Nenhum vendedor nesta referência.</div>
                ) : (
                  <>
                    {/* Barra de rolagem horizontal no TOPO (sempre visível, sincronizada com a tabela) */}
                    <div ref={topRef} onScroll={() => syncFrom('top')} className="overflow-x-auto overflow-y-hidden border-b border-slate-100 dark:border-slate-700">
                      <div style={{ width: tableW || '100%', height: 1 }} />
                    </div>
                    <div ref={bodyRef} onScroll={() => syncFrom('body')} className="overflow-auto max-h-[calc(100vh-360px)]">
                    <table className="min-w-full text-xs">
                      <thead className="sticky top-0 z-10">
                        <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100 dark:border-slate-700">
                          <th className={`${th} w-8`}><input type="checkbox" checked={todosSel} onChange={toggleTodos} className="cursor-pointer" /></th>
                          <th className={th}>Código</th>
                          <th className={th}>Vendedor</th>
                          <th className={`${th} text-right`}>Meta</th>
                          <th className={`${th} text-right`}>Realizado</th>
                          <th className={`${th} text-right`}>%</th>
                          <th className={`${th} text-right`}>Comissão</th>
                          <th className={`${th} text-right`}>Prêmio</th>
                          <th className={`${th} text-right`}>Total a receber</th>
                          <th className={th}>Validação</th>
                          <th className={th}>PDF</th>
                          <th className={`${th} text-right`}>Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {registrosFiltrados.map(r => (
                          <tr key={r.id} className="border-b border-slate-50 dark:border-slate-700/50 hover:bg-slate-50/60 dark:hover:bg-slate-700/30">
                            <td className="px-2.5 py-1.5"><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggleSel(r.id)} className="cursor-pointer" /></td>
                            <td className="px-2.5 py-1.5 font-mono text-xs text-slate-500">{r.codigo_vendedor}</td>
                            <td className="px-2.5 py-1.5 whitespace-nowrap">
                              <div className="font-medium text-slate-700 dark:text-slate-200">{r.nome_fantasia}</div>
                              {(r.email_primario || r.email_secundario) && (
                                <div className="text-[10px] text-slate-400 lowercase" title={`Primário: ${r.email_primario || '—'}\nSecundário: ${r.email_secundario || '—'}`}>
                                  {r.email_primario || r.email_secundario}{r.email_secundario && r.email_primario ? ` (+1)` : ''}
                                </div>
                              )}
                              {r.email_enviado_em && (
                                <div className="text-[10px] text-emerald-600 dark:text-emerald-400" title={`E-mail enviado em ${new Date(r.email_enviado_em).toLocaleString('pt-BR')}`}>e-mail enviado</div>
                              )}
                            </td>
                            <td className="px-2.5 py-1.5 text-right tabular-nums text-slate-500">{money(r.meta)}</td>
                            <td className="px-2.5 py-1.5 text-right tabular-nums text-slate-500">{money(r.realizado)}</td>
                            <td className="px-2.5 py-1.5 text-right tabular-nums text-slate-500">{cell(r.percentual)}</td>
                            <td className="px-2.5 py-1.5 text-right tabular-nums font-medium">{fmtBRL(parseValor(r.comissao))}</td>
                            <td className="px-2.5 py-1.5 text-right tabular-nums text-slate-500">{money(r.premio)}</td>
                            <td className="px-2.5 py-1.5 text-right tabular-nums">{money(r.total_a_receber)}</td>
                            <td className="px-2.5 py-1.5"><StatusBadge s={r.status_validacao} /></td>
                            <td className="px-2.5 py-1.5">
                              {r.tem_pdf && r.documento_id ? (
                                <a href={api.comissaoDocUrl(r.documento_id)} target="_blank" rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700">
                                  <FileText className="w-3.5 h-3.5" /> Ver{r.origem_pdf === 'drive' ? ' (Drive)' : ''}
                                </a>
                              ) : r.tem_pdf_origem ? (
                                <span className="text-[11px] text-amber-600" title="Tem PDF na origem — use “Buscar PDFs do Drive”">no Drive</span>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                            <td className="px-2.5 py-1.5">
                              <div className="flex items-center justify-end gap-1.5">
                                <button onClick={() => validar([r.id], 'aprovado')} title="Aprovar"
                                  className="p-1.5 rounded-md text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"><CheckCircle2 className="w-4 h-4" /></button>
                                <button onClick={() => validar([r.id], 'reprovado')} title="Reprovar"
                                  className="p-1.5 rounded-md text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"><XCircle className="w-4 h-4" /></button>
                                <label title="Carregar PDF deste vendedor" className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer">
                                  <Upload className="w-4 h-4" />
                                  <input type="file" accept="application/pdf" className="hidden" onChange={e => uploadIndividual(r.id, e.target.files?.[0])} />
                                </label>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {busy && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl px-6 py-5 flex items-center gap-3 max-w-sm">
            <Loader2 className="w-6 h-6 text-emerald-600 animate-spin shrink-0" />
            <div className="text-sm text-slate-700 dark:text-slate-200">{busyMsg || 'Processando…'}</div>
          </div>
        </div>
      )}

      {toast && (
        <div className={`fixed bottom-5 right-5 z-[310] px-4 py-3 rounded-lg shadow-lg text-sm text-white ${toast.tipo === 'ok' ? 'bg-emerald-600' : 'bg-red-600'}`}>
          {toast.msg}
        </div>
      )}

      {/* Confirmação ANTES de enviar e-mails */}
      {confirmEmail && refSel && (
        <div className="fixed inset-0 z-[320] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4" onClick={() => setConfirmEmail(false)}>
          <div className="bg-white dark:bg-slate-800 rounded-xl w-full max-w-md overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 bg-emerald-50 dark:bg-emerald-950/30 border-b border-emerald-200 dark:border-emerald-900/50">
              <h3 className="font-bold text-emerald-800 dark:text-emerald-200 flex items-center gap-2"><Send className="w-5 h-5" /> Enviar e-mails de comissão</h3>
            </div>
            <div className="p-5 text-sm text-slate-600 dark:text-slate-300 space-y-2">
              <p>Serão enviados <b>{elegiveisEmail.length} e-mail(s)</b> — <b>1 por vendedor</b> — apenas para os <b>aprovados com PDF e e-mail</b> da referência:</p>
              <div className="rounded-lg bg-slate-50 dark:bg-slate-900/40 px-3 py-2">
                <div className="font-semibold text-slate-800 dark:text-slate-100">{refSel.label}</div>
                <div className="text-[11px] text-slate-400 break-all">{selRef}</div>
              </div>
              <ul className="text-xs list-disc pl-5 space-y-0.5">
                <li>Assunto conterá <b>{refSel.ano}-{refSel.mm}-{refSel.empresa}</b></li>
                <li><b>Para:</b> e-mail primário do vendedor</li>
                <li><b>Cópia:</b> e-mail secundário{ccFixos ? ' + comissao@blackd.com.br + vendas@blackd.com.br' : ''}</li>
                <li>O <b>PDF</b> do vendedor vai anexado</li>
                <li>{sel.size > 0 ? 'Apenas os vendedores selecionados (e elegíveis)' : 'Todos os aprovados com PDF desta referência'}</li>
              </ul>
              <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 mt-1 cursor-pointer">
                <input type="checkbox" checked={ccFixos} onChange={e => setCcFixos(e.target.checked)} className="cursor-pointer" />
                Enviar cópia para <b>comissao@</b> e <b>vendas@</b> blackd.com.br
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 mt-1 cursor-pointer">
                <input type="checkbox" checked={reenviar} onChange={e => setReenviar(e.target.checked)} className="cursor-pointer" />
                Reenviar inclusive para quem <b>já recebeu</b> (por padrão, só envia para os que faltam)
              </label>
            </div>
            <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2">
              <button onClick={() => setConfirmEmail(false)} className="px-4 py-2 rounded-lg text-sm font-medium bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200">Cancelar</button>
              <button onClick={enviarEmails} className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 inline-flex items-center gap-1.5"><Send className="w-4 h-4" /> Confirmar e enviar</button>
            </div>
          </div>
        </div>
      )}

      {/* Resultado do envio de e-mails */}
      {emailRes && (
        <div className="fixed inset-0 z-[320] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4" onClick={() => setEmailRes(null)}>
          <div className="bg-white dark:bg-slate-800 rounded-xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 bg-slate-50 dark:bg-slate-900/40 border-b border-slate-200 dark:border-slate-700">
              <div>
                <h3 className="font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2"><Mail className="w-5 h-5 text-emerald-600" /> Resultado do envio de e-mails</h3>
                {emailRes.assunto && <div className="text-[11px] text-slate-400">Assunto: {emailRes.assunto}</div>}
              </div>
              <button onClick={() => setEmailRes(null)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-5 py-3 flex items-center gap-2 flex-wrap border-b border-slate-100 dark:border-slate-700">
              <div className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-100 text-emerald-700">{emailRes.enviados.length} enviados</div>
              <div className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-600">{emailRes.pulados.length} pulados</div>
              {emailRes.falhas.length > 0 && <div className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-100 text-red-700">{emailRes.falhas.length} falhas</div>}
              {emailRes.restantes > 0 && <div className="text-xs text-amber-600">Restam {emailRes.restantes} — clique em Enviar novamente.</div>}
              {emailRes.limite_atingido && <div className="w-full text-xs font-semibold text-red-600">Limite diário de envio do Gmail atingido. Os não enviados ficaram pendentes — tente novamente mais tarde/amanhã (enviará só os que faltam).</div>}
              <button onClick={exportarEmail} className="ml-auto inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700">
                <Download className="w-4 h-4" /> Exportar Excel
              </button>
            </div>
            <div className="p-5 overflow-auto grid grid-cols-1 md:grid-cols-2 gap-5">
              {emailRes.enviados.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wide text-emerald-700 mb-1.5">Enviados</h4>
                  <div className="rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 overflow-hidden">
                    <table className="min-w-full text-xs">
                      <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-[10px] uppercase text-slate-400"><tr><th className="px-2.5 py-1.5 w-14">Cód</th><th className="px-2.5 py-1.5">Vendedor</th><th className="px-2.5 py-1.5">Para</th></tr></thead>
                      <tbody>{emailRes.enviados.map((e: any, i: number) => <tr key={i} className="border-t border-slate-100 dark:border-slate-700/50"><td className="px-2.5 py-1.5 font-mono text-slate-500">{e.codigo}</td><td className="px-2.5 py-1.5">{e.nome}</td><td className="px-2.5 py-1.5 text-slate-500 lowercase">{e.to}</td></tr>)}</tbody>
                    </table>
                  </div>
                </div>
              )}
              {emailRes.pulados.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-1.5">Pulados</h4>
                  <div className="rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 overflow-hidden">
                    <table className="min-w-full text-xs">
                      <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-[10px] uppercase text-slate-400"><tr><th className="px-2.5 py-1.5 w-14">Cód</th><th className="px-2.5 py-1.5">Vendedor</th><th className="px-2.5 py-1.5">Motivo</th></tr></thead>
                      <tbody>{emailRes.pulados.map((e: any, i: number) => <tr key={i} className="border-t border-slate-100 dark:border-slate-700/50"><td className="px-2.5 py-1.5 font-mono text-slate-500">{e.codigo}</td><td className="px-2.5 py-1.5">{e.nome}</td><td className="px-2.5 py-1.5 text-amber-600">{e.motivo}</td></tr>)}</tbody>
                    </table>
                  </div>
                </div>
              )}
              {emailRes.falhas.length > 0 && (
                <div className="md:col-span-2">
                  <h4 className="text-xs font-bold uppercase tracking-wide text-red-700 mb-1.5">Falhas</h4>
                  <div className="rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 overflow-hidden">
                    <table className="min-w-full text-xs">
                      <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-[10px] uppercase text-slate-400"><tr><th className="px-2.5 py-1.5 w-14">Cód</th><th className="px-2.5 py-1.5">Vendedor</th><th className="px-2.5 py-1.5">Erro</th></tr></thead>
                      <tbody>{emailRes.falhas.map((e: any, i: number) => <tr key={i} className="border-t border-slate-100 dark:border-slate-700/50"><td className="px-2.5 py-1.5 font-mono text-slate-500">{e.codigo}</td><td className="px-2.5 py-1.5">{e.nome}</td><td className="px-2.5 py-1.5 text-red-600">{e.erro}</td></tr>)}</tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-700 text-right">
              <button onClick={() => setEmailRes(null)} className="px-4 py-2 rounded-lg text-sm font-medium bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200">Fechar</button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmação ANTES de processar o lote — deixa explícita a referência (ano/mês/empresa) */}
      {confirmLote && (
        <div className="fixed inset-0 z-[320] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4" onClick={() => setConfirmLote(null)}>
          <div className="bg-white dark:bg-slate-800 rounded-xl w-full max-w-md overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-900/50">
              <h3 className="font-bold text-amber-800 dark:text-amber-200 flex items-center gap-2"><Upload className="w-5 h-5" /> Confirmar vínculo dos PDFs</h3>
            </div>
            <div className="p-5 text-sm text-slate-600 dark:text-slate-300 space-y-2">
              <p>Você vai vincular <b>{confirmLote.length} PDF(s)</b> à referência:</p>
              <div className="rounded-lg bg-slate-50 dark:bg-slate-900/40 px-2.5 py-1.5">
                <div className="font-semibold text-slate-800 dark:text-slate-100">{refSel?.label}</div>
                <div className="text-[11px] text-slate-400 break-all">{selRef}</div>
              </div>
              <p>O vínculo é feito pelo <b>código do vendedor</b> (ex.: 024 ↔ 24). Confira se os PDFs são deste período/empresa antes de confirmar.</p>
            </div>
            <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2">
              <button onClick={() => setConfirmLote(null)} className="px-4 py-2 rounded-lg text-sm font-medium bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200">Cancelar</button>
              <button onClick={() => { const f = confirmLote; setConfirmLote(null); uploadLote(f); }} className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700">Confirmar e vincular</button>
            </div>
          </div>
        </div>
      )}

      {/* Resultado do upload em lote — estruturado por colunas + exportar Excel */}
      {loteRes && (() => {
        const chip = (cor: string, n: number, txt: string) => (
          <div className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${cor}`}>{n} {txt}</div>
        );
        return (
          <div className="fixed inset-0 z-[320] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4" onClick={() => setLoteRes(null)}>
            <div className="bg-white dark:bg-slate-800 rounded-xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-3 bg-slate-50 dark:bg-slate-900/40 border-b border-slate-200 dark:border-slate-700">
                <div>
                  <h3 className="font-bold text-slate-700 dark:text-slate-200">Resultado do upload em lote</h3>
                  <div className="text-[11px] text-slate-400">{parseRef(loteRes.referencia).label}</div>
                </div>
                <button onClick={() => setLoteRes(null)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
              </div>

              <div className="px-5 py-3 flex items-center gap-2 flex-wrap border-b border-slate-100 dark:border-slate-700">
                {chip('bg-emerald-100 text-emerald-700', loteRes.vinculados.length, 'vinculados')}
                {chip('bg-amber-100 text-amber-700', loteRes.nao_encontrados.length, 'sem correspondência')}
                {chip('bg-orange-100 text-orange-700', loteRes.ambiguos.length, 'ambíguos')}
                {chip('bg-slate-100 text-slate-600', loteRes.semPdf.length, 'sem PDF')}
                <button onClick={exportarLote} className="ml-auto inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700">
                  <Download className="w-4 h-4" /> Exportar Excel
                </button>
              </div>

              <div className="p-5 overflow-auto grid grid-cols-1 md:grid-cols-2 gap-5">
                {loteRes.nao_encontrados.length > 0 && (
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wide text-amber-700 mb-1.5 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> Arquivos sem correspondência</h4>
                    <div className="rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 overflow-hidden">
                      <table className="min-w-full text-xs">
                        <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-[10px] uppercase text-slate-400">
                          <tr><th className="px-2.5 py-1.5">Arquivo</th><th className="px-2.5 py-1.5 w-16">Código</th></tr>
                        </thead>
                        <tbody>
                          {loteRes.nao_encontrados.map((f, i) => (
                            <tr key={i} className="border-t border-slate-100 dark:border-slate-700/50">
                              <td className="px-2.5 py-1.5 text-slate-600 dark:text-slate-300">{f}</td>
                              <td className="px-2.5 py-1.5 font-mono text-slate-400">{codDoArquivo(f) || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {loteRes.semPdf.length > 0 && (
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-1.5">Vendedores ainda sem PDF</h4>
                    <div className="rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 overflow-hidden">
                      <table className="min-w-full text-xs">
                        <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-[10px] uppercase text-slate-400">
                          <tr><th className="px-2.5 py-1.5 w-16">Código</th><th className="px-2.5 py-1.5">Nome</th></tr>
                        </thead>
                        <tbody>
                          {loteRes.semPdf.map((v, i) => (
                            <tr key={i} className="border-t border-slate-100 dark:border-slate-700/50">
                              <td className="px-2.5 py-1.5 font-mono text-slate-500">{v.codigo}</td>
                              <td className="px-2.5 py-1.5 text-slate-600 dark:text-slate-300">{v.nome}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {loteRes.ambiguos.length > 0 && (
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wide text-orange-700 mb-1.5">Arquivos ambíguos</h4>
                    <div className="rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 overflow-hidden">
                      <table className="min-w-full text-xs">
                        <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-[10px] uppercase text-slate-400">
                          <tr><th className="px-2.5 py-1.5">Arquivo</th><th className="px-2.5 py-1.5 w-16">Código</th></tr>
                        </thead>
                        <tbody>
                          {loteRes.ambiguos.map((f, i) => (
                            <tr key={i} className="border-t border-slate-100 dark:border-slate-700/50">
                              <td className="px-2.5 py-1.5 text-slate-600 dark:text-slate-300">{f}</td>
                              <td className="px-2.5 py-1.5 font-mono text-slate-400">{codDoArquivo(f) || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>

              <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-700 text-right">
                <button onClick={() => setLoteRes(null)} className="px-4 py-2 rounded-lg text-sm font-medium bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200">Fechar</button>
              </div>
            </div>
          </div>
        );
      })()}

      {resultado && (
        <div className="fixed inset-0 z-[320] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4" onClick={() => setResultado(null)}>
          <div className="bg-white dark:bg-slate-800 rounded-xl w-full max-w-lg overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 bg-slate-50 dark:bg-slate-900/40 border-b border-slate-200 dark:border-slate-700">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">{resultado.titulo}</h3>
              <button onClick={() => setResultado(null)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 max-h-[60vh] overflow-auto space-y-1 text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap">
              {resultado.linhas.map((l, i) => <div key={i}>{l}</div>)}
            </div>
            <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-700 text-right">
              <button onClick={() => setResultado(null)} className="px-4 py-2 rounded-lg text-sm font-medium bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200">Fechar</button>
            </div>
          </div>
        </div>
      )}
    </PageBackground>
  );
};

export default Comissao;
