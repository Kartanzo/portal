import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { User } from '../../types';
import { api } from '../../app_api';
import { useToast } from '../../contexts/ToastContext';
import {
  ArrowLeft, Send, Upload, Loader2, Lock, Eye, EyeOff, FileText, Image, Video, X, Trash2
} from 'lucide-react';
import { SacStatusBadge, SacPrioridadeBadge, SacVisibilidadeBanner } from './SacStatusBadge';
import { formatDateBR } from '../dateUtils';
import { Card } from '../ui/Card';
import { FieldBox } from '../ui/FieldBox';
import { SectionTitle } from '../ui/SectionTitle';
import { Button } from '../ui/Button';
import { toast } from '../ui/Toaster';
import { useConfirm } from '../../contexts/ConfirmContext';

interface Props { user: User; }

const SETORES = ['SAC', 'Logística', 'Financeiro', 'Comercial', 'Qualidade'];
const PRIORIDADES = ['Baixa', 'Média', 'Alta', 'Urgente'];
const STATUS_VALIDOS = ['Aberto', 'Em Análise', 'Aguardando Retorno', 'Em Resolução', 'Concluído', 'Cancelado'];


const SacDetail: React.FC<Props> = ({ user }) => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const isExterno = user.role === 'externo';
  const isInternal = !isExterno;
  const canEdit = user.permissions?.['sac']?.can_edit || ['super_user', 'ceo', 'admin'].includes(user.role) || (user.role === 'user' && user.sector === 'SAC');

  const [ticket, setTicket] = useState<any>(null);
  const [comentarios, setComentarios] = useState<any[]>([]);
  const [anexos, setAnexos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [texto, setTexto] = useState('');
  const [visivelExterno, setVisivelExterno] = useState(true);
  const [files, setFiles] = useState<File[]>([]);
  const [stagedStatus, setStagedStatus] = useState<string | null>(null);
  const [stagedPrioridade, setStagedPrioridade] = useState<string | null>(null);
  const [stagedSetor, setStagedSetor] = useState<string | null>(null);
  const [stagedFrete, setStagedFrete] = useState<string | null>(null);
  const [savingFields, setSavingFields] = useState(false);
  const [mobileTab, setMobileTab] = useState<'detalhes' | 'historico'>('detalhes');
  // T7 — status interno por setor
  const [statusInternoOpts, setStatusInternoOpts] = useState<Record<string, string[]>>({});
  const [savingStatusInterno, setSavingStatusInterno] = useState(false);
  // T3 — retornar ao SAC
  const [showRetornar, setShowRetornar] = useState(false);
  const [motivoRetorno, setMotivoRetorno] = useState('');
  const [retornando, setRetornando] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [t, c, a] = await Promise.all([
        api.get(`/sac/tickets/${id}`),
        api.get(`/sac/tickets/${id}/comentarios`),
        api.get(`/sac/tickets/${id}/anexos`),
      ]);
      const tData = (t as any)?.data ?? t;
      const cData = (c as any)?.data ?? c;
      const aData = (a as any)?.data ?? a;
      setTicket(tData);
      setComentarios(Array.isArray(cData) ? cData : []);
      setAnexos(Array.isArray(aData) ? aData : []);
    } catch {
      showToast('Erro ao carregar chamado', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  // Carrega opções de status interno (agrupadas por setor)
  useEffect(() => {
    api.get('/sac/tipos-problema?categoria=status_interno').then((r: any) => {
      const list = (r?.data ?? r) || [];
      const grouped: Record<string, string[]> = {};
      (Array.isArray(list) ? list : []).filter((t: any) => t.ativo && t.setor).forEach((t: any) => {
        (grouped[t.setor] = grouped[t.setor] || []).push(t.nome);
      });
      setStatusInternoOpts(grouped);
    }).catch(() => {});
  }, []);

  const canEditStatusInterno = (setor: string) =>
    canEdit && (['super_user', 'ceo', 'admin'].includes(user.role) || user.sector === 'SAC' || user.sector === 'Qualidade' || user.sector === setor);

  const handleSalvarStatusInterno = async (setor: string, status: string) => {
    setSavingStatusInterno(true);
    try {
      const fd = new FormData();
      fd.append('setor', setor);
      fd.append('status', status);
      const res = await fetch(`/api/sac/tickets/${id}/status-interno`, { credentials: 'include', method: 'PATCH', headers: { 'user-id': user.id }, body: fd });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || 'Erro'); }
      showToast('Status interno atualizado', 'success');
      load();
    } catch (e: any) { showToast(e.message || 'Erro ao atualizar status interno', 'error'); }
    finally { setSavingStatusInterno(false); }
  };

  const handleRetornarSac = async () => {
    if (!motivoRetorno.trim()) return;
    setRetornando(true);
    try {
      const fd = new FormData();
      fd.append('motivo', motivoRetorno);
      const res = await fetch(`/api/sac/tickets/${id}/retornar-sac`, { credentials: 'include', method: 'POST', headers: { 'user-id': user.id }, body: fd });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || 'Erro'); }
      showToast('Chamado retornado ao SAC', 'success');
      setShowRetornar(false); setMotivoRetorno('');
      load();
    } catch (e: any) { showToast(e.message || 'Erro ao retornar ao SAC', 'error'); }
    finally { setRetornando(false); }
  };

  const hasStagedChanges = stagedStatus !== null || stagedPrioridade !== null || stagedSetor !== null || stagedFrete !== null;

  const handleSalvarCampos = async () => {
    setSavingFields(true);
    try {
      const reqs: Promise<any>[] = [];
      if (stagedStatus !== null) {
        const fd = new FormData(); fd.append('status', stagedStatus);
        reqs.push(fetch(`/api/sac/tickets/${id}/status`, { credentials: 'include',  method: 'PATCH', headers: { 'user-id': user.id }, body: fd }));
      }
      if (stagedPrioridade !== null) {
        const fd = new FormData(); fd.append('prioridade', stagedPrioridade);
        reqs.push(fetch(`/api/sac/tickets/${id}/prioridade`, { credentials: 'include',  method: 'PATCH', headers: { 'user-id': user.id }, body: fd }));
      }
      if (stagedSetor !== null) {
        const fd = new FormData(); fd.append('setor_destino', stagedSetor);
        reqs.push(fetch(`/api/sac/tickets/${id}/setor`, { credentials: 'include',  method: 'PATCH', headers: { 'user-id': user.id }, body: fd }));
      }
      if (stagedFrete !== null) {
        const fd = new FormData(); fd.append('valor_frete', stagedFrete);
        reqs.push(fetch(`/api/sac/tickets/${id}/frete`, { credentials: 'include',  method: 'PATCH', headers: { 'user-id': user.id }, body: fd }));
      }
      await Promise.all(reqs);
      setStagedStatus(null); setStagedPrioridade(null); setStagedSetor(null); setStagedFrete(null);
      showToast('Alterações salvas', 'success');
      load();
    } catch { showToast('Erro ao salvar alterações', 'error'); }
    finally { setSavingFields(false); }
  };

  const handleEnviarComentario = async () => {
    if (!texto.trim() && files.length === 0 && !hasStagedChanges) return;
    setSending(true);
    try {
      if (hasStagedChanges) await handleSalvarCampos();
      if (texto.trim() || files.length > 0) {
        const fd = new FormData();
        fd.append('user_id', user.id);
        fd.append('texto', texto);
        fd.append('visivel_externo', String(isExterno ? true : visivelExterno));
        files.forEach(f => fd.append('file', f));
        await fetch(`/api/sac/tickets/${id}/comentarios`, { credentials: 'include', 
          method: 'POST', headers: { 'user-id': user.id }, body: fd,
        });
      }
      setTexto('');
      setFiles([]);
      load();
    } catch { showToast('Erro ao enviar', 'error'); }
    finally { setSending(false); }
  };

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
    </div>
  );

  if (!ticket) return (
    <div className="text-center py-20 text-slate-400">Chamado não encontrado</div>
  );


  // Shared blocks for reuse in mobile tabs and desktop layout
  const blockDadosTicket = (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2 mb-4">
        <div>
          <span className="font-mono font-bold text-indigo-700 text-base">{ticket.protocolo}</span>
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            <SacStatusBadge status={ticket.status} statusDisplay={ticket.status_display} showVisibilityIcon={isInternal} />
            {isInternal && <SacPrioridadeBadge prioridade={ticket.prioridade} />}
          </div>
        </div>
        <span className="text-xs text-slate-400 whitespace-nowrap">{ticket.criado_em ? formatDateBR(ticket.criado_em) : '-'}</span>
      </div>

    </div>
  );

  // Cards estruturados — usando primitivos UI (Card, FieldBox, SectionTitle)
  const cardCliente = (
    <Card>
      <SectionTitle>Dados do Cliente</SectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
        <div className="lg:col-span-3"><FieldBox label="Razão Social / Nome" value={ticket.razao_social} /></div>
        <div className="lg:col-span-2"><FieldBox label="CNPJ / CPF" value={ticket.cnpj_cpf} /></div>
        <div className="lg:col-span-1"><FieldBox label="Canal Compra" value={ticket.canal_compra} /></div>
        <div className="lg:col-span-3"><FieldBox label="E-mail de Contato" value={ticket.email_contato} /></div>
        <div className="lg:col-span-1"><FieldBox label="Canal" value={ticket.canal} /></div>
        <div className="lg:col-span-2"><FieldBox label="Tipo de Problema" value={ticket.tipo_problema} /></div>
      </div>
    </Card>
  );

  const hasNfData = ticket.numero_nf || ticket.pedido || ticket.nota_fiscal_emissao || ticket.entrega || ticket.desc_tipodocumento || ticket.descricao_segmento;
  const cardNf = hasNfData ? (
    <Card>
      <SectionTitle>Nota Fiscal / Pedido</SectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {ticket.numero_nf && <FieldBox label="Número NF" value={ticket.numero_nf} />}
        {ticket.pedido && <FieldBox label="Pedido" value={ticket.pedido} />}
        {ticket.nota_fiscal_emissao && <FieldBox label="Data Emissão NF" value={formatDateBR(ticket.nota_fiscal_emissao)} />}
        {ticket.entrega && <FieldBox label="Data Entrega" value={formatDateBR(ticket.entrega)} />}
        {ticket.desc_tipodocumento && <FieldBox label="Tipo Documento" value={ticket.desc_tipodocumento} />}
        {ticket.descricao_segmento && <FieldBox label="Segmento" value={ticket.descricao_segmento} />}
      </div>
    </Card>
  ) : null;

  const cardProdutos = Array.isArray(ticket.produtos) && ticket.produtos.length > 0 ? (
    <Card>
      <SectionTitle>Produtos ({ticket.produtos.length})</SectionTitle>
      <div className="space-y-3">
        {ticket.produtos.map((p: any, idx: number) => (
          <div key={p.id} className="border border-slate-200 dark:border-slate-700 rounded-lg p-3 bg-slate-50 dark:bg-slate-900/40">
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">Produto {idx + 1}</div>
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <div className="sm:col-span-2"><FieldBox label="Código" value={p.codigo_produto} /></div>
              <div className="sm:col-span-5"><FieldBox label="Descrição" value={p.descricao_produto} /></div>
              <div className="sm:col-span-1"><FieldBox label="Qtd NF" value={p.quantidade ?? 1} /></div>
              <div className="sm:col-span-1"><FieldBox label="Qtd defeito" value={p.quantidade_defeito ?? '—'} /></div>
              <div className="sm:col-span-3"><FieldBox label="Tipo de Problema" value={p.tipo_problema} /></div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  ) : null;

  const cardDetalhamento = ticket.detalhamento ? (
    <Card>
      <SectionTitle>Detalhamento</SectionTitle>
      <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2.5">
        <p className="text-sm text-slate-700 dark:text-slate-100 whitespace-pre-wrap break-words">{ticket.detalhamento}</p>
      </div>
    </Card>
  ) : null;

  const blockGerenciar = isInternal && canEdit ? (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 shadow-sm space-y-3">
      <h3 className="font-semibold text-sm text-slate-700 dark:text-slate-100">Gerenciar Chamado</h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 gap-3">
        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Status</label>
          <select value={stagedStatus ?? ticket.status} onChange={e => setStagedStatus(e.target.value)}
            className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${stagedStatus !== null ? 'border-indigo-400 bg-indigo-50' : 'border-slate-300'}`}>
            {STATUS_VALIDOS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {!stagedStatus && ticket.status_display && (
            <p className="text-xs text-slate-400 mt-1">
              <span className="font-medium text-slate-500">Cliente vê:</span>{' '}
              <span className="text-indigo-600 font-medium">{ticket.status_display}</span>
            </p>
          )}
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Prioridade</label>
          <select value={stagedPrioridade ?? ticket.prioridade} onChange={e => setStagedPrioridade(e.target.value)}
            className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${stagedPrioridade !== null ? 'border-indigo-400 bg-indigo-50' : 'border-slate-300'}`}>
            {PRIORIDADES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Setor Destino</label>
          <select value={stagedSetor ?? ticket.setor_destino} onChange={e => setStagedSetor(e.target.value)}
            className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${stagedSetor !== null ? 'border-indigo-400 bg-indigo-50' : 'border-slate-300'}`}>
            {SETORES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Valor do Frete (R$)</label>
          <input type="number" step="0.01" min="0"
            value={stagedFrete ?? (ticket.valor_frete ?? '')}
            onChange={e => setStagedFrete(e.target.value)}
            placeholder="0,00 (reposição — Logística)"
            className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${stagedFrete !== null ? 'border-indigo-400 bg-indigo-50' : 'border-slate-300'}`} />
        </div>
      </div>
      {ticket.setor_destino && ticket.setor_destino !== 'SAC' && (
        <button type="button" onClick={() => setShowRetornar(true)}
          className="w-full px-3 py-2 text-sm font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors">
          Retornar ao SAC
        </button>
      )}
    </div>
  ) : null;

  const cardStatusInterno = isInternal && Array.isArray(ticket.setores_envolvidos) && ticket.setores_envolvidos.length > 0 ? (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 shadow-sm space-y-3">
      <h3 className="font-semibold text-sm text-slate-700 dark:text-slate-100">Status Interno por Setor</h3>
      <p className="text-[11px] text-slate-400">Visível só internamente. Ao alterar, notifica apenas os setores envolvidos (SAC e destino).</p>
      <div className="space-y-3">
        {ticket.setores_envolvidos.map((setor: string) => {
          const opts = statusInternoOpts[setor] || [];
          const atual = ticket.status_interno?.[setor] || '';
          const editavel = canEditStatusInterno(setor);
          return (
            <div key={setor}>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">{setor}</label>
              <select value={atual} disabled={!editavel || savingStatusInterno}
                onChange={e => handleSalvarStatusInterno(setor, e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-100 disabled:text-slate-400">
                <option value="">— Sem status —</option>
                {opts.map(o => <option key={o} value={o}>{o}</option>)}
                {atual && !opts.includes(atual) && <option value={atual}>{atual}</option>}
              </select>
              {!editavel && <p className="text-[10px] text-slate-400 mt-1">Somente o setor {setor} (ou SAC/Qualidade) pode alterar.</p>}
              {editavel && opts.length === 0 && <p className="text-[10px] text-amber-500 mt-1">Nenhum status interno cadastrado para {setor} (cadastre em Tipos de Problema).</p>}
            </div>
          );
        })}
      </div>
    </div>
  ) : null;

  const isSuperUser = user.role === 'super_user';
  const handleDeleteAnexo = async (anexoId: number) => {
    const ok = await confirm({
      title: 'Deletar anexo',
      message: 'Esta ação é irreversível. O arquivo será removido permanentemente.',
      confirmText: 'Deletar',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/sac/anexos/${anexoId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'user-id': user.id },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Erro ao deletar');
      }
      setAnexos(prev => prev.filter(a => a.id !== anexoId));
    } catch (e: any) {
      toast.error(`Falha: ${e.message || e}`);
    }
  };

  const blockAnexos = anexos.length > 0 ? (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 shadow-sm">
      <h3 className="font-semibold text-sm mb-3 text-slate-700 dark:text-slate-100">Anexos ({anexos.length})</h3>
      <div className="space-y-2">
        {anexos.map(a => (
          <div key={a.id} className="flex items-center gap-2 border border-slate-100 rounded-lg p-2 hover:bg-slate-50 transition-colors">
            <a href={`/api/uploads${a.url}`} target="_blank" rel="noreferrer"
              className="flex items-center gap-2 text-xs text-indigo-600 hover:text-indigo-800 flex-1 min-w-0">
              <FileText className="w-4 h-4 flex-shrink-0" />
              <span className="truncate">{a.nome_arquivo}</span>
            </a>
            {isSuperUser && (
              <button
                onClick={() => handleDeleteAnexo(a.id)}
                title="Deletar anexo (super_user)"
                className="p-1 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded transition-colors flex-shrink-0"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  ) : null;

  const blockInfo = (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 shadow-sm text-sm space-y-2">
      <InfoRow label="Aberto por" value={ticket.aberto_por_nome || '—'} />
      <InfoRow label="Abertura" value={ticket.criado_em ? formatDateBR(ticket.criado_em) : '-'} />
      <InfoRow label="Última atualização" value={ticket.atualizado_em ? formatDateBR(ticket.atualizado_em) : '-'} />
      {isInternal && <InfoRow label="Setor Destino" value={ticket.setor_destino} />}
    </div>
  );

  const blockHistorico = (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 pt-4 pb-2 border-b border-slate-100 dark:border-slate-700">
        <h3 className="font-semibold text-slate-700 dark:text-slate-100">Histórico / Comentários</h3>
      </div>

      {/* Input de resposta — ANTES do histórico */}
      <div className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-4 space-y-3">
        {isInternal && (
          <div className="flex gap-2">
            <button type="button" onClick={() => setVisivelExterno(true)}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-semibold rounded-xl border-2 transition-all ${
                visivelExterno ? 'bg-blue-600 border-blue-600 text-white shadow-md' : 'bg-white border-slate-200 text-slate-400 hover:border-blue-300 hover:text-blue-600'
              }`}>
              <Eye className="w-4 h-4" /> Público
            </button>
            <button type="button" onClick={() => setVisivelExterno(false)}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-semibold rounded-xl border-2 transition-all ${
                !visivelExterno ? 'bg-amber-500 border-amber-500 text-white shadow-md' : 'bg-white border-slate-200 text-slate-400 hover:border-amber-300 hover:text-amber-600'
              }`}>
              <Lock className="w-4 h-4" /> Nota Interna
            </button>
          </div>
        )}

        <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={3}
          placeholder={isExterno ? 'Adicione uma resposta...' : 'Escreva um comentário...'}
          className={`w-full border-2 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 resize-none transition-colors ${
            !isExterno && !visivelExterno
              ? 'border-amber-300 bg-amber-50 focus:ring-amber-400 text-slate-900'
              : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:ring-indigo-500'
          }`}
        />

        {files.length > 0 && (
          <div className="space-y-1">
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-slate-600 bg-white border border-slate-200 rounded-lg px-3 py-2">
                <FileText className="w-4 h-4 flex-shrink-0" />
                <span className="flex-1 truncate">{f.name}</span>
                <button onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-500"><X className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <label htmlFor="sac-reply-file"
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer">
            <Upload className="w-3.5 h-3.5" /> Anexar
          </label>
          <input id="sac-reply-file" type="file" multiple
            style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px' }}
            onChange={e => {
              const picked = Array.from(e.target.files || []);
              if (picked.length > 0) setFiles(prev => [...prev, ...picked]);
            }} />
          <button onClick={handleEnviarComentario}
            disabled={sending || (!texto.trim() && files.length === 0 && !hasStagedChanges)}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors ml-auto">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Enviar
          </button>
        </div>
      </div>

      {/* Lista do histórico */}
      <div className="divide-y divide-slate-50 dark:divide-slate-700 max-h-[50vh] overflow-y-auto">
        {comentarios.length === 0 && (
          <p className="text-sm text-center py-8 text-slate-400">Nenhuma atualização ainda</p>
        )}
        {[...comentarios].reverse().map(c => (
          <div key={c.id} className={`flex gap-3 px-4 py-3 ${c.is_system ? 'opacity-60' : ''}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${
              c.autor_role === 'externo' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
            }`}>
              {c.autor_nome ? c.autor_nome[0].toUpperCase() : '?'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 mb-1">
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">{c.autor_nome || 'Sistema'}</span>
                {isInternal && !c.visivel_externo && (
                  <span className="flex items-center gap-0.5 text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                    <Lock className="w-2.5 h-2.5" /> Interno
                  </span>
                )}
                <span className="text-xs ml-auto text-slate-400">{c.criado_em ? formatDateBR(c.criado_em) : ''}</span>
              </div>
              <div className={`text-sm rounded-lg px-3 py-2 break-words ${
                !c.visivel_externo
                  ? 'border border-amber-200 bg-amber-50 text-slate-700'
                  : 'bg-slate-50 dark:bg-slate-700 border border-slate-100 dark:border-slate-600 text-slate-700 dark:text-slate-200'
              }`}>
                {c.texto}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="max-w-[1600px] mx-auto pb-6 dark:text-slate-100 px-2 sm:px-4">
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => navigate('/sac')} className="flex items-center gap-2 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 text-sm transition-colors">
          <ArrowLeft className="w-4 h-4" /> Voltar aos chamados
        </button>
        {isSuperUser && (
          <button
            onClick={async () => {
              const ok = await confirm({
                title: 'Excluir chamado',
                message: 'O chamado será ocultado da lista. O registro permanece no banco e pode ser restaurado depois.',
                confirmText: 'Excluir',
                variant: 'danger',
              });
              if (!ok) return;
              try {
                const res = await fetch(`/api/sac/tickets/${id}`, {
                  method: 'DELETE',
                  credentials: 'include',
                  headers: { 'user-id': user.id },
                });
                if (!res.ok) {
                  const err = await res.json().catch(() => ({}));
                  throw new Error(err.detail || 'Erro ao excluir');
                }
                toast.success('Chamado excluído.');
                navigate('/sac');
              } catch (e: any) {
                toast.error(`Falha: ${e.message || e}`);
              }
            }}
            title="Excluir chamado (super_user) — soft-delete, registro mantido no banco"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" /> Excluir chamado
          </button>
        )}
      </div>

      {isInternal && <SacVisibilidadeBanner status={ticket.status} />}

      {/* Mobile tabs (hidden on lg+) */}
      <div className="flex lg:hidden bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm mb-4 overflow-hidden">
        <button onClick={() => setMobileTab('detalhes')}
          className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${mobileTab === 'detalhes' ? 'bg-indigo-600 text-white' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'}`}>
          Detalhes
        </button>
        <button onClick={() => setMobileTab('historico')}
          className={`flex-1 py-2.5 text-sm font-semibold transition-colors border-l border-slate-200 dark:border-slate-700 ${mobileTab === 'historico' ? 'bg-indigo-600 text-white' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'}`}>
          Histórico {comentarios.length > 0 && <span className="ml-1 text-xs">({comentarios.length})</span>}
        </button>
      </div>

      {/* Mobile: tab Detalhes */}
      <div className={`lg:hidden space-y-4 ${mobileTab === 'detalhes' ? 'block' : 'hidden'}`}>
        {blockDadosTicket}
        {cardCliente}
        {cardNf}
        {cardProdutos}
        {cardDetalhamento}
        {blockGerenciar}
        {cardStatusInterno}
        {blockAnexos}
        {blockInfo}
      </div>

      {/* Mobile: tab Histórico */}
      <div className={`lg:hidden ${mobileTab === 'historico' ? 'block' : 'hidden'}`}>
        {blockHistorico}
      </div>

      {/* Desktop: side-by-side layout (lg+) */}
      <div className="hidden lg:grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          {blockDadosTicket}
          {cardCliente}
          {cardNf}
          {cardProdutos}
          {cardDetalhamento}
          {blockHistorico}
        </div>
        <div className="space-y-4">
          {blockGerenciar}
          {cardStatusInterno}
          {blockAnexos}
          {blockInfo}
        </div>
      </div>

      {showRetornar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-md w-full p-5 space-y-3">
            <h3 className="font-semibold text-slate-800 dark:text-slate-100">Retornar ao SAC</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">Descreva o motivo / dúvida. A equipe SAC será notificada.</p>
            <textarea value={motivoRetorno} onChange={e => setMotivoRetorno(e.target.value)} rows={4}
              className="w-full border border-slate-300 dark:border-slate-600 dark:bg-slate-900 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Motivo do retorno ao SAC..." />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setShowRetornar(false); setMotivoRetorno(''); }}
                className="px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg">Cancelar</button>
              <button type="button" onClick={handleRetornarSac} disabled={!motivoRetorno.trim() || retornando}
                className="px-3 py-2 text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed">
                {retornando ? 'Enviando...' : 'Retornar ao SAC'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const Field: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{label}</p>
    <p className="text-slate-800 mt-0.5 break-words">{value}</p>
  </div>
);

const InfoRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex justify-between gap-2">
    <span className="text-slate-400 text-xs">{label}</span>
    <span className="text-slate-700 text-xs font-medium text-right">{value}</span>
  </div>
);

export default SacDetail;
