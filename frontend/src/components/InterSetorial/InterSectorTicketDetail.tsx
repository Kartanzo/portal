import React, { useState, useEffect, useRef } from 'react';
import { User } from '../../types';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../../app_api';
import { useToast } from '../../contexts/ToastContext';
import { ArrowLeft, Send, Loader, X, Paperclip, Share2, Plus, Clock, User as UserIcon, ArrowRight, Tag, Calendar, Layers, Users, UserPlus, Trash2 } from 'lucide-react';
import { formatDateBR } from '../dateUtils';

const ALL_STATUSES = ['Aberto', 'Em Atendimento', 'Aguardando Usuário', 'Em Validação', 'Aguardando Suporte', 'Concluído', 'Cancelado'];
const ALL_PRIORITIES = ['Baixa', 'Média', 'Alta', 'Urgente'];

const STATUS_STYLE: Record<string, string> = {
  'Aberto': 'text-blue-700 bg-blue-50 border-blue-200',
  'Em Atendimento': 'text-orange-700 bg-orange-50 border-orange-200',
  'Aguardando Usuário': 'text-yellow-700 bg-yellow-50 border-yellow-200',
  'Em Validação': 'text-purple-700 bg-purple-50 border-purple-200',
  'Aguardando Suporte': 'text-indigo-700 bg-indigo-50 border-indigo-200',
  'Concluído': 'text-green-700 bg-green-50 border-green-200',
  'Cancelado': 'text-slate-500 bg-slate-50 border-slate-200',
};

const PRIORITY_STYLE: Record<string, string> = {
  'Urgente': 'bg-red-100 text-red-800 border-red-300',
  'Alta': 'bg-orange-100 text-orange-800 border-orange-300',
  'Média': 'bg-blue-100 text-blue-800 border-blue-300',
  'Baixa': 'bg-slate-100 text-slate-700 border-slate-300',
};

const AVATAR_COLORS = ['bg-red-500', 'bg-indigo-500', 'bg-emerald-500', 'bg-amber-500', 'bg-violet-500', 'bg-pink-500', 'bg-sky-500'];
const avatarColor = (name: string) => AVATAR_COLORS[(name || '').charCodeAt(0) % AVATAR_COLORS.length];

interface Props { user: User; }

const InterSectorTicketDetail: React.FC<Props> = ({ user }) => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [ticket, setTicket] = useState<any>(null);
  const [updates, setUpdates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sendingMsg, setSendingMsg] = useState(false);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<any[]>([]);
  const [allSectors, setAllSectors] = useState<string[]>([]);
  const [showForwardForm, setShowForwardForm] = useState(false);
  const [forwardSector, setForwardSector] = useState('');
  const [forwarding, setForwarding] = useState(false);
  const [participants, setParticipants] = useState<any[]>([]);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [participantSearch, setParticipantSearch] = useState('');
  const [showParticipantDropdown, setShowParticipantDropdown] = useState(false);

  const isSuperUser = user.role === 'super_user';

  const canInteract = () => {
    if (!ticket) return false;
    if (isSuperUser) return true;
    if (ticket.status === 'Concluído') return false;
    const managed = (user.managed_sectors || '').split(/;\s*/).filter(Boolean);
    const allowedUserSectors = [user.sector, ...managed].filter(Boolean);
    const allowedTicketSectors = [ticket.target_sector, ...(ticket.involved_sectors || [])].filter(Boolean);
    return allowedUserSectors.some(sector => allowedTicketSectors.includes(sector));
  };

  useEffect(() => {
    if (!id) return;
    Promise.all([
      api.getInterSectorTicket(id),
      api.getInterSectorTicketUpdates(id),
      api.getInterSectorParticipants(id).catch(() => []),
    ]).then(([t, u, p]) => {
      setTicket(t);
      setUpdates(u);
      setParticipants(Array.isArray(p) ? p : []);
    }).catch(() => showToast('Erro ao carregar chamado.', 'error'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    api.getInterSectorSectors().then(d => setAllUsers(d.allowed_users || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (ticket?.target_sector) {
      api.getSectorCategories(ticket.target_sector).then(setCategories).catch(() => setCategories([]));
    }
  }, [ticket?.target_sector]);

  useEffect(() => {
    api.getSectors().then((data: any[]) => {
      setAllSectors(data.filter((s: any) => s.is_active).map((s: any) => s.name).sort());
    }).catch(() => {});
  }, []);

  const handleUpdate = async (field: string, value: any) => {
    if (!id) return;
    setSaving(true);
    try {
      await api.updateInterSectorTicket(id, { [field]: value });
      setTicket((prev: any) => ({ ...prev, [field]: value }));
      showToast('Atualizado.', 'success');
    } catch (err: any) {
      showToast(err.message || 'Erro ao atualizar.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSendMessage = async () => {
    if (!id) return;
    if (!message.trim()) {
      showToast('Digite uma mensagem antes de enviar.', 'error');
      return;
    }
    setSendingMsg(true);
    try {
      await api.addInterSectorTicketUpdate(id, message.trim() || '', user.id, files.length > 0 ? files : undefined);
      const updated = await api.getInterSectorTicketUpdates(id);
      setUpdates(updated);
      setMessage('');
      setFiles([]);
      showToast('Comentário enviado.', 'success');
    } catch {
      showToast('Erro ao enviar comentário.', 'error');
    } finally {
      setSendingMsg(false);
    }
  };

  const handleForward = async () => {
    if (!id || !forwardSector) return;
    setForwarding(true);
    try {
      const result = await api.forwardInterSectorTicket(id, forwardSector);
      setTicket((prev: any) => ({ ...prev, involved_sectors: result.involved_sectors }));
      const updated = await api.getInterSectorTicketUpdates(id);
      setUpdates(updated);
      setForwardSector('');
      setShowForwardForm(false);
      showToast(`Chamado reencaminhado para ${forwardSector}.`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Erro ao reencaminhar.', 'error');
    } finally {
      setForwarding(false);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center py-20 text-slate-400 text-sm">
      <Loader className="w-5 h-5 animate-spin mr-2" /> Carregando...
    </div>
  );
  if (!ticket) return <div className="flex items-center justify-center py-20 text-slate-400 text-sm">Chamado não encontrado.</div>;

  const friendlyId = `CS-${ticket.id.substring(0, 8).toUpperCase()}`;
  const sortedUpdates = [...updates].reverse();

  return (
    <div className="max-w-6xl mx-auto space-y-5">

      {/* ── Header ── */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/inter-sector-tickets')}
          className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shrink-0">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-0.5">
            <span className="text-xs font-bold text-red-600 font-mono">{friendlyId}</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase border ${STATUS_STYLE[ticket.status] || 'text-slate-600 bg-slate-50 border-slate-200'}`}>{ticket.status}</span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${PRIORITY_STYLE[ticket.priority] || ''}`}>{ticket.priority}</span>
            <span className="text-slate-300">·</span>
            <span className="text-xs text-slate-500">{ticket.requester_name} ({ticket.requester_sector || '—'}) → {ticket.target_sector}</span>
            <span className="text-slate-300">·</span>
            <span className="text-xs text-slate-400">{formatDateBR(ticket.created_at)}</span>
          </div>
          <h1 className="text-xl font-bold text-slate-900 truncate">{ticket.title}</h1>
        </div>
      </div>

      {/* ── Main Grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* ── Left Column ── */}
        <div className="lg:col-span-2 space-y-5">

          {/* Descrição */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
              <Tag className="w-4 h-4 text-slate-400" />
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Descrição</h3>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap break-words"
                style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                {ticket.description || <span className="text-slate-400 italic">Sem descrição.</span>}
              </p>
            </div>
          </div>

          {/* Histórico de Comentários */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Send className="w-4 h-4 text-slate-400" />
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Histórico de Comentários</h3>
              </div>
              <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full font-semibold">{updates.length}</span>
            </div>

            <div className="px-5 py-4 space-y-4">
              {sortedUpdates.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-4">Nenhum comentário ainda.</p>
              ) : (
                sortedUpdates.map(u => (
                  <div key={u.id} className={u.is_system
                    ? 'flex items-start gap-2 py-2 px-3 bg-slate-50 rounded-lg border border-slate-100 text-xs text-slate-500 italic'
                    : 'flex items-start gap-3'
                  }>
                    {!u.is_system && (
                      <div className={`w-8 h-8 rounded-full ${avatarColor(u.user_name || '')} flex items-center justify-center shrink-0 text-white font-bold text-xs`}>
                        {(u.user_name || '?')[0].toUpperCase()}
                      </div>
                    )}
                    {u.is_system ? (
                      <div className="flex flex-col gap-1">
                        <span>{u.message}</span>
                        {u.attachment_path && (
                          <a href={`${api.API_PREFIX}/inter-sector-ticket-updates/${u.id}/attachment`} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 mt-0.5 text-xs text-indigo-600 hover:text-indigo-800 hover:underline bg-indigo-50 px-2 py-1 rounded w-fit">
                            <Paperclip className="w-3 h-3" />
                            {u.attachment_name || u.attachment_path.split('/').pop()}
                          </a>
                        )}
                      </div>
                    ) : (
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2 mb-1">
                          <span className="text-sm font-semibold text-slate-800">{u.user_name}</span>
                          <span className="text-[10px] text-slate-400">{formatDateBR(u.created_at)}</span>
                        </div>
                        {u.message && (
                          <p className="text-sm text-slate-600 whitespace-pre-wrap break-words"
                            style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                            {u.message}
                          </p>
                        )}
                        {u.attachment_path && (
                          <a href={`${api.API_PREFIX}/inter-sector-ticket-updates/${u.id}/attachment`} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 mt-1.5 text-xs text-indigo-600 hover:text-indigo-800 hover:underline bg-indigo-50 px-2 py-1 rounded">
                            <Paperclip className="w-3 h-3" />
                            {u.attachment_name || u.attachment_path.split('/').pop()}
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Caixa de resposta */}
            {canInteract() && (
              <div className="px-5 pb-5 pt-1 border-t border-slate-100 space-y-3">
                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  rows={3}
                  placeholder="Adicione um comentário..."
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none bg-slate-50 focus:bg-white transition-colors"
                />
                {files.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {files.map((f, i) => (
                      <div key={i} className="flex items-center gap-1.5 bg-slate-100 border border-slate-200 rounded px-2 py-1 text-xs text-slate-600">
                        <Paperclip className="w-3 h-3 text-slate-400" />
                        <span className="max-w-[120px] truncate">{f.name}</span>
                        <button onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}
                          className="text-slate-400 hover:text-red-500 ml-0.5">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="ist-reply-file" className="flex items-center gap-1.5 cursor-pointer text-xs text-slate-500 hover:text-slate-700 px-3 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
                    <Paperclip className="w-3.5 h-3.5" />
                    Anexar
                  </label>
                  <input id="ist-reply-file" type="file" multiple
                    style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px' }}
                    onChange={e => {
                      const picked = Array.from(e.target.files || []);
                      if (picked.length > 0) setFiles(prev => [...prev, ...picked]);
                    }} />
                  <button
                    onClick={handleSendMessage}
                    disabled={sendingMsg || (!message.trim() && files.length === 0)}
                    className="flex items-center gap-2 px-4 py-1.5 text-xs font-bold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors">
                    {sendingMsg ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                    Enviar
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Right Column: Info Panel ── */}
        <div className="space-y-4">

          {/* Informações */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="px-5 py-3 border-b border-slate-100">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Informações</h3>
            </div>
            <div className="px-5 py-4 space-y-4">

              {/* Status */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Status</label>
                {canInteract() ? (
                  <select value={ticket.status} onChange={e => handleUpdate('status', e.target.value)}
                    disabled={saving}
                    className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 bg-white disabled:opacity-60">
                    {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                ) : (
                  <span className={`inline-flex px-2.5 py-1 rounded-full text-[10px] font-black uppercase border ${STATUS_STYLE[ticket.status] || ''}`}>
                    {ticket.status}
                  </span>
                )}
              </div>

              {/* Prioridade */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Prioridade</label>
                {canInteract() ? (
                  <select value={ticket.priority} onChange={e => handleUpdate('priority', e.target.value)}
                    disabled={saving}
                    className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 bg-white disabled:opacity-60">
                    {ALL_PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                ) : (
                  <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${PRIORITY_STYLE[ticket.priority] || ''}`}>
                    {ticket.priority}
                  </span>
                )}
              </div>

              {/* Categoria */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Categoria</label>
                {canInteract() ? (
                  <select value={ticket.category || ''} onChange={e => handleUpdate('category', e.target.value)}
                    disabled={saving}
                    className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 bg-white disabled:opacity-60">
                    <option value="">— Sem categoria —</option>
                    {categories.map((c: any) => <option key={c.id} value={c.name}>{c.name}</option>)}
                  </select>
                ) : (
                  <span className="text-sm text-slate-600">{ticket.category || <span className="text-slate-400 italic">—</span>}</span>
                )}
              </div>

              {/* Previsão */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Previsão de Entrega</label>
                {canInteract() ? (
                  <input type="date" value={ticket.due_date?.split('T')[0] || ''}
                    onChange={e => handleUpdate('due_date', e.target.value)}
                    disabled={saving}
                    className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 bg-white disabled:opacity-60" />
                ) : (
                  <span className="text-sm text-slate-600">{ticket.due_date ? formatDateBR(ticket.due_date) : <span className="text-slate-400 italic">—</span>}</span>
                )}
              </div>
            </div>
          </div>

          {/* Partes */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="px-5 py-3 border-b border-slate-100">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Partes Envolvidas</h3>
            </div>
            <div className="px-5 py-4 space-y-3 text-sm">
              <div>
                <span className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Solicitante</span>
                <span className="text-slate-700 font-medium">{ticket.requester_name}</span>
                <span className="text-slate-400 text-xs ml-1.5">({ticket.requester_sector || '—'})</span>
              </div>
              <div>
                <span className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Destino</span>
                <span className="text-slate-700 font-medium">{ticket.target_sector}</span>
              </div>
              {ticket.involved_sectors?.length > 0 && (
                <div>
                  <span className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Setores Envolvidos</span>
                  <div className="flex flex-wrap gap-1.5">
                    {ticket.involved_sectors.map((s: string) => (
                      <span key={s} className="inline-flex items-center gap-1 text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-0.5 rounded-full font-medium">
                        <Layers className="w-3 h-3" />{s}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <span className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Abertura</span>
                <span className="text-slate-600 text-xs flex items-center gap-1">
                  <Calendar className="w-3 h-3" />{formatDateBR(ticket.created_at)}
                </span>
              </div>
              {ticket.updated_at && (
                <div>
                  <span className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Última Atualização</span>
                  <span className="text-slate-600 text-xs flex items-center gap-1">
                    <Clock className="w-3 h-3" />{formatDateBR(ticket.updated_at)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Reencaminhar */}
          {canInteract() && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
              <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Reencaminhar</h3>
                {!showForwardForm && (
                  <button onClick={() => setShowForwardForm(true)}
                    className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-semibold">
                    <Plus className="w-3.5 h-3.5" /> Adicionar setor
                  </button>
                )}
              </div>
              <div className="px-5 py-4">
                {showForwardForm ? (
                  <div className="space-y-2">
                    <select value={forwardSector} onChange={e => setForwardSector(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 bg-white">
                      <option value="">Selecione o setor...</option>
                      {allSectors.filter(s => s !== ticket.target_sector).map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                    <div className="flex gap-2">
                      <button onClick={handleForward} disabled={forwarding || !forwardSector}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors">
                        {forwarding ? <Loader className="w-3 h-3 animate-spin" /> : <Share2 className="w-3 h-3" />}
                        Reencaminhar
                      </button>
                      <button onClick={() => { setShowForwardForm(false); setForwardSector(''); }}
                        className="px-3 py-1.5 text-xs text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 italic">Nenhum reencaminhamento pendente.</p>
                )}
              </div>
            </div>
          )}

          {/* Participantes */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="px-5 py-3 border-b border-slate-100">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                <Users className="w-3.5 h-3.5 text-indigo-600" /> Participantes
              </h3>
            </div>
            <div className="px-5 py-4">
              {canInteract() && (
                <div className="relative mb-3">
                  <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden">
                    <UserPlus className="w-3.5 h-3.5 ml-3 text-slate-400 shrink-0" />
                    <input type="text" placeholder="Buscar usuário..."
                      className="w-full px-2 py-2 text-xs outline-none"
                      value={participantSearch}
                      onChange={e => { setParticipantSearch(e.target.value); setShowParticipantDropdown(true); }}
                      onFocus={() => setShowParticipantDropdown(true)} />
                  </div>
                  {showParticipantDropdown && participantSearch.length >= 2 && (
                    <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                      {allUsers
                        .filter(u => !participants.some(p => p.user_id === u.id))
                        .filter(u => u.name.toLowerCase().includes(participantSearch.toLowerCase()) || (u.sector || '').toLowerCase().includes(participantSearch.toLowerCase()))
                        .slice(0, 8)
                        .map(u => (
                          <button key={u.id}
                            className="w-full text-left px-3 py-2 text-xs hover:bg-indigo-50 flex items-center justify-between transition-colors"
                            onClick={async () => {
                              try {
                                const res = await api.addInterSectorParticipant(id!, u.id);
                                showToast(res.message, 'success');
                                setParticipantSearch(''); setShowParticipantDropdown(false);
                                setParticipants(await api.getInterSectorParticipants(id!));
                              } catch { showToast('Erro ao adicionar participante', 'error'); }
                            }}>
                            <span className="font-bold text-slate-700">{u.name}</span>
                            <span className="text-[9px] text-slate-400">{u.sector}</span>
                          </button>
                        ))}
                      {allUsers.filter(u => !participants.some(p => p.user_id === u.id) && u.name.toLowerCase().includes(participantSearch.toLowerCase())).length === 0 && (
                        <div className="px-3 py-2 text-[10px] text-slate-400 italic">Nenhum usuário encontrado</div>
                      )}
                    </div>
                  )}
                </div>
              )}
              <div className="space-y-2">
                {participants.length === 0 && <p className="text-xs text-slate-400 italic">Sem participantes adicionais.</p>}
                {participants.map(p => (
                  <div key={p.id} className="flex items-center justify-between p-2 bg-slate-50 rounded-lg border border-slate-100 group">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-[9px] font-black uppercase">
                        {p.name?.split(' ').map((n: string) => n[0]).slice(0, 2).join('')}
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-slate-700">{p.name}</p>
                        <p className="text-[8px] text-slate-400">{p.sector || p.email}</p>
                      </div>
                    </div>
                    {canInteract() && (
                      <button onClick={async () => {
                          try {
                            await api.removeInterSectorParticipant(id!, p.user_id);
                            showToast('Participante removido', 'success');
                            setParticipants(await api.getInterSectorParticipants(id!));
                          } catch { showToast('Erro ao remover', 'error'); }
                        }}
                        className="p-1 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                        title="Remover participante">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InterSectorTicketDetail;
