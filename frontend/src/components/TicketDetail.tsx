
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { TicketStatus, TicketPriority, TicketCategory, UserRole, Ticket, User } from '../types';
import { api } from '../app_api';
import { ArrowLeft, MessageSquare, Paperclip, CheckCircle2, User as UserIcon, Clock, Tag, Calendar, LayoutList, ShieldCheck, HelpCircle, Send, Lock, FileText, Download, X, ThumbsUp, ThumbsDown, AlertTriangle, ArrowRightLeft, Layers, Loader, Info, Users, UserPlus, Trash2 } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';
import { MAX_FILE_SIZE_BYTES, MAX_FILE_SIZE_MB } from '../constants';
import FileSizeWarningModal from './FileSizeWarningModal';
import { formatDateBR } from './dateUtils';

interface TicketDetailProps {
  user: User;
}

const TicketDetail: React.FC<TicketDetailProps> = ({ user }) => {
  const { id } = useParams<{ id: string }>();
  const { showToast } = useToast();
  const userRole = user.role;
  const navigate = useNavigate();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [updates, setUpdates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [comment, setComment] = useState('');
  const [commentFiles, setCommentFiles] = useState<File[]>([]);
  const [showSizeWarning, setShowSizeWarning] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  const isSuperUser = userRole?.toLowerCase() === 'super_user';
  const isCEO = userRole?.toLowerCase() === 'ceo';
  const canEditOverride = user.permissions?.tickets?.can_edit === true;
  const isAdmin = userRole === 'admin' || isSuperUser || isCEO || canEditOverride;

  const [priority, setPriority] = useState<TicketPriority>(TicketPriority.LOW);
  const [currentStatus, setCurrentStatus] = useState<TicketStatus>(TicketStatus.IN_PROGRESS);
  const [forecast, setForecast] = useState('');

  // Forwarding / Reclassification States
  const isTIorGI = user.sector === 'T.I' || user.sector === 'Gestão de Informação';
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [forwardSector, setForwardSector] = useState<'T.I' | 'Gestão de Informação'>(user.sector as any || 'T.I');
  const [forwardCategories, setForwardCategories] = useState<any[]>([]);
  const [forwardSubcategories, setForwardSubcategories] = useState<any[]>([]);
  const [forwardCatId, setForwardCatId] = useState('');
  const [forwardSubId, setForwardSubId] = useState('');
  const [forwardReason, setForwardReason] = useState('');
  const [isForwarding, setIsForwarding] = useState(false);
  const [loadingForwardData, setLoadingForwardData] = useState(false);

  const [disapprovalMode, setDisapprovalMode] = useState(false);
  const [disapprovalReason, setDisapprovalReason] = useState('');
  const [showApproveModal, setShowApproveModal] = useState(false);

  // Participants
  const [participants, setParticipants] = useState<any[]>([]);
  const [allUsers, setAllUsers] = useState<{id: string, name: string, sector: string}[]>([]);
  const [participantSearch, setParticipantSearch] = useState('');
  const [showParticipantDropdown, setShowParticipantDropdown] = useState(false);

  const refreshData = async () => {
    if (!id) return;
    try {
      const data = await api.getTicket(id);
      setTicket({
        ...data,
        // @ts-ignore
        requesterName: data.requester_name,
        // @ts-ignore
        assignedName: data.assigned_name,
        // Map backend fields
        deliveryForecast: data.delivery_forecast || data.deliveryForecast
      });
      setCurrentStatus(data.status);
      setPriority(data.priority);

      const forecastVal = data.delivery_forecast || data.deliveryForecast;
      if (forecastVal) setForecast(forecastVal.split('T')[0]);
      else setForecast('');

      const chatHistory = await api.getTicketUpdates(data.id);
      setUpdates(chatHistory);

      try {
        const parts = await api.getTicketParticipants(data.id);
        setParticipants(parts);
      } catch { }
    } catch (e) {
      console.error("Failed to load ticket", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshData();
    api.getAllUsersSimple().then(setAllUsers).catch(() => {});
  }, [id]);

  useEffect(() => {
    if (showForwardModal) {
      setLoadingForwardData(true);
      api.getCategories(forwardSector).then(data => {
        setForwardCategories(data);
        setForwardCatId('');
        setForwardSubId('');
      }).catch(() => showToast('Erro ao carregar categorias.', 'error'))
        .finally(() => setLoadingForwardData(false));
    }
  }, [showForwardModal, forwardSector]);

  useEffect(() => {
    if (forwardCatId) {
      api.getSubcategories(forwardCatId).then(setForwardSubcategories).catch(() => setForwardSubcategories([]));
    } else {
      setForwardSubcategories([]);
    }
  }, [forwardCatId]);


  const handleForward = async () => {
    if (!ticket || !forwardCatId) return;
    setIsForwarding(true);
    try {
      await api.forwardTicket(ticket.id, {
        category_id: forwardCatId,
        subcategory_id: forwardSubId || undefined,
        reason: forwardReason.trim() || undefined
      });
      showToast('Chamado encaminhado/reclassificado com sucesso!', 'success');
      setShowForwardModal(false);
      setForwardReason('');
      refreshData();
    } catch (err: any) {
      showToast(err.message || 'Erro ao encaminhar chamado.', 'error');
    } finally {
      setIsForwarding(false);
    }
  };

  useEffect(() => {
    if (!ticket || ticket.status !== TicketStatus.IN_VALIDATION) return;
    const searchParams = new URLSearchParams(window.location.search);
    const action = searchParams.get('action');
    if (action === 'approve') {
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    } else if (action === 'disapprove') {
      setDisapprovalMode(true);
      setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 100);
    }
  }, [ticket]);

  const handleValidationAction = async (action: 'approve' | 'disapprove') => {
    if (!ticket) return;
    if (action === 'approve') {
      if (!forecast) {
        showToast("Por favor, informe a previsão de entrega antes de concluir o chamado.", 'error');
        return;
      }
      setLoading(true);
      try {
        await api.updateTicket(ticket.id, { status: TicketStatus.CLOSED, deliveryForecast: forecast });
        await api.sendTicketUpdate(ticket.id, user.id, `✅ Chamado aprovado e concluído por ${user.name}.`, null);
        showToast("Chamado aprovado e concluído!", 'success');
        refreshData();
      } catch (e) {
        showToast("Erro ao aprovar chamado.", 'error');
      } finally {
        setLoading(false);
      }
    } else {
      if (!disapprovalReason.trim()) {
        showToast("Por favor, informe o motivo da reprovação.", 'error');
        return;
      }
      setLoading(true);
      try {
        await api.updateTicket(ticket.id, { status: TicketStatus.WAITING_SUPPORT });
        await api.sendTicketUpdate(ticket.id, user.id, `❌ Chamado reprovado por ${user.name}.\nMotivo: ${disapprovalReason}`, null);
        showToast("Reprovação registrada. O suporte foi notificado.", 'success');
        setDisapprovalMode(false);
        setDisapprovalReason('');
        refreshData();
      } catch (e) {
        showToast("Erro ao registrar reprovação.", 'error');
      } finally {
        setLoading(false);
      }
    }
  };

  const handleUpdateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticket) return;

    const hasChanges =
      currentStatus !== ticket.status ||
      priority !== ticket.priority ||
      (forecast || '') !== (ticket.deliveryForecast ? ticket.deliveryForecast.split('T')[0] : '');

    const hasComment = comment.trim() || commentFiles.length > 0;

    if (isAdmin && currentStatus === TicketStatus.CLOSED && !forecast) {
      showToast("Por favor, informe a previsão de entrega antes de concluir o chamado.", 'error');
      return;
    }

    if (!hasChanges && !hasComment) {
      showToast("Nenhuma alteração detectada.", 'info');
      return;
    }

    setIsUpdating(true);
    try {
      if (hasChanges && isAdmin) {
        const skipNotif = hasComment ? true : false;
        await api.updateTicket(ticket.id, {
          status: currentStatus,
          priority: priority,
          deliveryForecast: forecast || undefined,
          skip_notification: skipNotif
        });
      }
      if (hasComment) {
        let finalMessage = comment;
        if (hasChanges && isAdmin && currentStatus !== ticket.status) {
          finalMessage = `📋 Status alterado para: ${currentStatus}\n\n${comment}`.trim();
        }
        const firstFile = commentFiles[0] || null;
        await api.sendTicketUpdate(ticket.id, user.id, finalMessage, firstFile);
        for (let i = 1; i < commentFiles.length; i++) {
          await api.sendTicketUpdate(ticket.id, user.id, '', commentFiles[i]);
        }
      }
      setComment('');
      setCommentFiles([]);
      showToast("Chamado atualizado com sucesso!", 'success');
      refreshData();
    } catch (err) {
      console.error('Erro ao atualizar chamado:', err);
      showToast("Erro ao atualizar chamado.", 'error');
    } finally {
      setIsUpdating(false);
    }
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'super_user': return 'Super Admin';
      case 'admin': return 'Analista';
      default: return 'Solicitante';
    }
  };

  const getRoleStyle = (role: string) => {
    if (role === 'admin' || role === 'super_user') return 'bg-slate-900 text-white';
    return 'bg-red-50 text-red-600';
  }

  const ticketAttachments = updates.filter(u => u.attachment_path);

  if (loading) return <div className="p-8 text-center text-gray-500 font-bold">Carregando detalhes do chamado...</div>;
  if (!ticket) return <div className="p-8 text-center text-red-600 font-bold">Chamado não encontrado ou ID inválido.</div>;

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12 px-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center space-x-4">
          <button onClick={() => navigate(-1)} className="p-2.5 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-all shadow-sm">
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div className="flex items-center space-x-3">
            <span className="text-2xl font-black text-gray-900 tracking-tighter">CH-{ticket.id.split('-')[0]}</span>
            <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${currentStatus === TicketStatus.CLOSED ? 'bg-green-100 text-green-700 border border-green-200' :
              currentStatus === TicketStatus.CANCELLED ? 'bg-gray-100 text-gray-500 border border-gray-200' : 'bg-red-50 text-red-700 border border-red-100'
              }`}>
              {ticket.status}
            </span>
          </div>
        </div>

        {isTIorGI && (
          <button
            onClick={() => setShowForwardModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-slate-800 transition-all shadow-lg shadow-slate-900/10 active:scale-95"
          >
            <ArrowRightLeft className="w-4 h-4 text-red-500" />
            Encaminhar / Reclassificar
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white p-6 md:p-8 rounded-2xl shadow-sm border border-gray-100 relative">
            <div className="flex justify-between items-start mb-6">
              <h1 className="text-2xl font-bold text-gray-900 leading-tight pr-12">{ticket.title}</h1>
              <div className="text-[9px] font-black text-gray-300 uppercase tracking-[0.2em] bg-gray-50 px-2 py-1 rounded">
                <Lock className="w-3 h-3 inline mr-1" /> Original
              </div>
            </div>
            <div className="bg-slate-50 p-6 rounded-xl border border-gray-100 text-sm text-gray-700 leading-relaxed font-medium italic whitespace-pre-wrap break-words">
              "{ticket.description}"
            </div>
            <div className="mt-8 grid grid-cols-1 md:grid-cols-4 gap-4 pt-6 border-t border-gray-50">
              <div className="flex items-center text-[10px] text-gray-500 font-bold uppercase tracking-wider min-w-0">
                <UserIcon className="w-3.5 h-3.5 mr-2 text-red-600 shrink-0" /> <span className="truncate">{ticket.requesterName || 'Solicitante'}</span>
              </div>
              <div className="flex items-center text-[10px] text-gray-500 font-bold uppercase tracking-wider min-w-0">
                <Clock className="w-3.5 h-3.5 mr-2 text-red-600 shrink-0" /> <span className="truncate">{formatDateBR(ticket.created_at || ticket.createdAt)}</span>
              </div>
              <div className="flex items-center text-[10px] text-gray-500 font-bold uppercase tracking-wider min-w-0">
                <ShieldCheck className="w-3.5 h-3.5 mr-2 text-red-600 shrink-0" /> <span className="truncate">{ticket.assignedName || 'Aguardando Analista'}</span>
              </div>
              <div className="flex items-center text-[10px] text-gray-500 font-bold uppercase tracking-wider min-w-0">
                <Tag className="w-3.5 h-3.5 mr-2 text-red-600 shrink-0" /> <span className="truncate">{ticket.category}{ticket.subcategory ? ` › ${ticket.subcategory}` : ''}</span>
              </div>
            </div>
          </div>

          {ticket?.status === TicketStatus.IN_VALIDATION && (isSuperUser || ticket.requesterId === user.id) && (
            <div className="bg-purple-50 p-6 rounded-2xl border border-purple-100 shadow-sm animate-in fade-in slide-in-from-bottom-4">
              <h3 className="text-sm font-black text-purple-900 uppercase tracking-widest flex items-center mb-4">
                <AlertTriangle className="w-5 h-5 mr-2 text-purple-600" /> Validação Necessária
              </h3>
              <p className="text-sm text-purple-800 mb-6 font-medium">
                Este chamado foi marcado como entregue. Por favor, valide a solução.
                <br />
                <span className="text-xs opacity-75">Caso não haja interação em 5 dias úteis, será aprovado automaticamente.</span>
              </p>

              {!disapprovalMode ? (
                <div className="flex gap-4">
                  <button
                    onClick={() => setShowApproveModal(true)}
                    className="flex-1 bg-green-600 hover:bg-green-700 text-white px-4 py-3 rounded-xl font-bold uppercase tracking-wider text-xs shadow-md transition-all flex items-center justify-center gap-2"
                  >
                    <ThumbsUp className="w-4 h-4" /> Aprovar e Concluir
                  </button>
                  <button
                    onClick={() => setDisapprovalMode(true)}
                    className="flex-1 bg-red-100 hover:bg-red-200 text-red-700 border border-red-200 px-4 py-3 rounded-xl font-bold uppercase tracking-wider text-xs shadow-sm transition-all flex items-center justify-center gap-2"
                  >
                    <ThumbsDown className="w-4 h-4" /> Reprovar
                  </button>
                </div>
              ) : (
                <div className="bg-white p-4 rounded-xl border border-purple-100">
                  <label className="text-xs font-bold text-gray-500 uppercase mb-2 block">Motivo da Reprovação / O que falta ajustar?</label>
                  <textarea
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-red-500 outline-none transition-all mb-3"
                    rows={3}
                    placeholder="Descreva o que ainda não está de acordo..."
                    value={disapprovalReason}
                    onChange={(e) => setDisapprovalReason(e.target.value)}
                  ></textarea>
                  <div className="flex gap-3 justify-end">
                    <button onClick={() => setDisapprovalMode(false)} className="px-4 py-2 text-xs font-bold text-gray-500 hover:text-gray-700 uppercase">Cancelar</button>
                    <button
                      onClick={() => handleValidationAction('disapprove')}
                      className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold uppercase shadow-md transition-colors"
                    >
                      Confirmar Reprovação
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {(['Concluído', 'Cancelado'].includes(currentStatus) && !isSuperUser && ticket?.status === currentStatus) ? (
            <div className="bg-gray-50 p-6 rounded-2xl border border-gray-200 text-center">
              <Lock className="w-8 h-8 text-gray-400 mx-auto mb-2" />
              <h3 className="text-sm font-bold text-gray-700">Atendimento Encerrado</h3>
              <p className="text-xs text-gray-500 mt-1">Este chamado foi concluído ou cancelado. Somente administradores podem reabrir ou inserir novas observações.</p>
            </div>
          ) : (
            <form onSubmit={handleUpdateTicket} className="bg-white p-5 rounded-2xl shadow-xl border border-gray-100">
              <FileSizeWarningModal
                isOpen={showSizeWarning}
                onClose={() => setShowSizeWarning(false)}
              />
              <textarea
                rows={3}
                className="w-full px-4 py-4 bg-gray-50 border border-gray-100 rounded-xl focus:bg-white focus:ring-2 focus:ring-red-500 outline-none text-sm transition-all font-medium"
                placeholder="Digite sua resposta ou atualização..."
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              ></textarea>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between mt-4 gap-4">
                <div className="flex items-center space-x-4">
                  <div className="flex flex-col gap-1">
                    <label className="flex items-center text-[10px] text-gray-500 font-black uppercase tracking-widest cursor-pointer hover:text-red-600 transition-colors group">
                      <Paperclip className="w-4 h-4 mr-1.5 group-hover:rotate-12 transition-transform" />
                      <span className="mr-2">Anexar Documento(s)</span>
                      <span className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">(Máx {MAX_FILE_SIZE_MB}MB cada)</span>
                      <input type="file" multiple className="hidden" onChange={(e) => {
                        const selected = Array.from(e.target.files || []);
                        const oversized = selected.filter(f => f.size > MAX_FILE_SIZE_BYTES);
                        if (oversized.length > 0) { setShowSizeWarning(true); e.target.value = ''; return; }
                        setCommentFiles(prev => [...prev, ...selected]);
                        e.target.value = '';
                      }} />
                    </label>
                    {commentFiles.map((f, i) => (
                      <div key={i} className="flex items-center gap-1 text-[10px] text-gray-600">
                        <Paperclip className="w-3 h-3 text-gray-400" />
                        <span className="truncate max-w-[180px]">{f.name}</span>
                        <button type="button" onClick={() => setCommentFiles(prev => prev.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600"><X className="w-3 h-3" /></button>
                      </div>
                    ))}
                  </div>
                </div>
                <button type="submit" disabled={isUpdating} className={`px-8 py-3 text-white rounded-xl font-black uppercase tracking-widest text-[10px] shadow-lg transition-all flex items-center gap-2 ${isUpdating ? 'bg-gray-400 cursor-not-allowed' : 'bg-red-600 hover:bg-red-700 active:scale-95'}`}>
                  <Send className="w-3 h-3" /> {isUpdating ? 'Salvando...' : 'Atualizar Chamado'}
                </button>
              </div>
            </form>
          )}

          <div className="space-y-4">
            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] px-2 flex items-center">
              <MessageSquare className="w-4 h-4 mr-2" /> Histórico de Diálogo
            </h3>
            <div className="space-y-4">
              {updates.length === 0 && <p className="text-gray-400 text-xs px-2 italic">Nenhuma mensagem ainda.</p>}
              {[...updates].reverse().map((update) => (
                <div key={update.id} className="flex items-start">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-sm ${getRoleStyle(update.user_role)}`}>
                    <span className="text-xs font-black">{update.user_name.charAt(0)}</span>
                  </div>
                  <div className="ml-4 flex-1 bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-black text-gray-900 uppercase tracking-widest">
                        {update.user_name}
                      </span>
                      <span className="text-[9px] text-gray-400 font-bold">{formatDateBR(update.created_at)}</span>
                    </div>
                    <p className="text-sm text-gray-700 leading-relaxed font-medium whitespace-pre-wrap">{update.message}</p>
                    {update.attachment_path && (
                      <div className="mt-3 flex items-center p-2 bg-gray-50 border border-gray-100 rounded-lg w-fit group cursor-pointer hover:border-red-200 transition-colors"
                        onClick={() => window.open(`${api.API_PREFIX}/ticket-updates/${update.id}/attachment`, '_blank')}
                      >
                        <Paperclip className="w-3 h-3 mr-2 text-gray-400" />
                        <span className="text-[10px] font-bold text-gray-600 mr-4">{update.attachment_name}</span>
                        <Download className="w-3 h-3 text-gray-300 group-hover:text-red-600" />
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-6">
            <h3 className="font-black text-gray-900 uppercase text-[10px] tracking-[0.2em] border-b border-gray-50 pb-4">Gestão do Atendimento</h3>
            <div className="space-y-5">
              <div>
                <label className="text-[10px] text-gray-400 uppercase font-black tracking-widest flex items-center mb-2">
                  <Calendar className="w-3.5 h-3.5 mr-2 text-red-600" /> Previsão de Entrega
                </label>
                {(isSuperUser || user.sector === 'T.I') ? (
                  <input
                    type="date"
                    className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm font-bold focus:ring-2 focus:ring-red-500 outline-none shadow-sm"
                    value={forecast}
                    onChange={(e) => setForecast(e.target.value)}
                  />
                ) : (
                  <div className="px-4 py-3 bg-gray-50 rounded-lg text-sm font-bold text-gray-700 border border-gray-100 flex items-center justify-between">
                    <span>{forecast ? forecast.split('-').reverse().join('/') : 'Não informada'}</span>
                    <Lock className="w-3 h-3 text-gray-300" />
                  </div>
                )}
              </div>

              <div>
                <label className="text-[10px] text-gray-400 uppercase font-black tracking-widest flex items-center mb-2">
                  <ShieldCheck className="w-3.5 h-3.5 mr-2 text-red-600" /> Prioridade
                </label>
                {isAdmin ? (
                  <select
                    className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm font-bold focus:ring-2 focus:ring-red-500 outline-none shadow-sm"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as TicketPriority)}
                  >
                    <option value="Baixa">Baixa</option>
                    <option value="Média">Média</option>
                    <option value="Alta">Alta</option>
                    <option value="Urgente">Urgente</option>
                  </select>
                ) : (
                  <div className="px-4 py-3 bg-gray-50 rounded-lg text-sm font-bold text-gray-700 border border-gray-100 flex items-center justify-between">
                    <span>{priority}</span>
                    <Lock className="w-3 h-3 text-gray-300" />
                  </div>
                )}
              </div>

              <div>
                <label className="text-[10px] text-gray-400 uppercase font-black tracking-widest flex items-center mb-2">
                  <LayoutList className="w-3.5 h-3.5 mr-2 text-red-600" /> Status Operacional
                </label>
                {isAdmin ? (
                  <select
                    className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm font-bold focus:ring-2 focus:ring-red-500 outline-none shadow-sm"
                    value={currentStatus}
                    onChange={(e) => setCurrentStatus(e.target.value as TicketStatus)}
                  >
                    {Object.values(TicketStatus).map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                ) : (
                  <div className="px-4 py-3 bg-red-50 text-red-700 rounded-lg text-xs font-black uppercase tracking-widest border border-red-100 text-center">
                    {currentStatus}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <h3 className="font-black text-gray-900 uppercase text-[10px] tracking-[0.2em] border-b border-gray-50 pb-4 mb-4">
              <FileText className="w-3.5 h-3.5 inline mr-2 text-red-600" /> Documentos do Chamado
            </h3>
            <div className="space-y-2">
              {ticketAttachments.length === 0 && <p className="text-xs text-gray-400 italic">Sem documentos.</p>}
              {ticketAttachments.map((file, idx) => (
                <div key={idx}
                  onClick={() => window.open(`${api.API_PREFIX}/ticket-updates/${file.id}/attachment`, '_blank')}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-50 hover:border-red-100 transition-colors group cursor-pointer"
                >
                  <div className="flex items-center min-w-0">
                    <div className="p-2 bg-white rounded-lg shadow-sm mr-3">
                      <FileText className="w-4 h-4 text-gray-400 group-hover:text-red-500 transition-colors" />
                    </div>
                    <div className="truncate">
                      <p className="text-[10px] font-bold text-slate-700 truncate">{file.attachment_name}</p>
                      <p className="text-[8px] text-slate-400 font-bold uppercase">{formatDateBR(file.created_at)}</p>
                    </div>
                  </div>
                  <Download className="w-4 h-4 text-gray-300 group-hover:text-red-600 transition-colors shrink-0 ml-2" />
                </div>
              ))}
            </div>
          </div>

          {/* Participantes */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <h3 className="font-black text-gray-900 uppercase text-[10px] tracking-[0.2em] border-b border-gray-50 pb-4 mb-4">
              <Users className="w-3.5 h-3.5 inline mr-2 text-red-600" /> Participantes
            </h3>
            {isAdmin && (
              <div className="relative mb-3">
                <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
                  <UserPlus className="w-3.5 h-3.5 ml-3 text-gray-400 shrink-0" />
                  <input
                    type="text"
                    placeholder="Buscar usuário..."
                    className="w-full px-2 py-2 text-xs outline-none"
                    value={participantSearch}
                    onChange={(e) => { setParticipantSearch(e.target.value); setShowParticipantDropdown(true); }}
                    onFocus={() => setShowParticipantDropdown(true)}
                  />
                </div>
                {showParticipantDropdown && participantSearch.length >= 2 && (
                  <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                    {allUsers
                      .filter(u => !participants.some(p => p.user_id === u.id) && u.id !== (ticket?.assigned_to || ''))
                      .filter(u => u.name.toLowerCase().includes(participantSearch.toLowerCase()) || (u.sector || '').toLowerCase().includes(participantSearch.toLowerCase()))
                      .slice(0, 8)
                      .map(u => (
                        <button
                          key={u.id}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-red-50 flex items-center justify-between transition-colors"
                          onClick={async () => {
                            try {
                              const res = await api.addTicketParticipant(ticket!.id!, u.id);
                              showToast(res.message, 'success');
                              setParticipantSearch('');
                              setShowParticipantDropdown(false);
                              const parts = await api.getTicketParticipants(ticket!.id!);
                              setParticipants(parts);
                            } catch { showToast('Erro ao adicionar participante', 'error'); }
                          }}
                        >
                          <span className="font-bold text-gray-700">{u.name}</span>
                          <span className="text-[9px] text-gray-400">{u.sector}</span>
                        </button>
                      ))}
                    {allUsers.filter(u => !participants.some(p => p.user_id === u.id) && u.name.toLowerCase().includes(participantSearch.toLowerCase())).length === 0 && (
                      <div className="px-3 py-2 text-[10px] text-gray-400 italic">Nenhum usuário encontrado</div>
                    )}
                  </div>
                )}
              </div>
            )}
            <div className="space-y-2">
              {participants.length === 0 && <p className="text-xs text-gray-400 italic">Sem participantes adicionais.</p>}
              {participants.map(p => (
                <div key={p.id} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg border border-gray-50 group">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-red-100 text-red-600 flex items-center justify-center text-[9px] font-black uppercase">
                      {p.name?.split(' ').map((n: string) => n[0]).slice(0, 2).join('')}
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-gray-700">{p.name}</p>
                      <p className="text-[8px] text-gray-400">{p.sector || p.email}</p>
                    </div>
                  </div>
                  {isAdmin && (
                    <button
                      onClick={async () => {
                        try {
                          await api.removeTicketParticipant(ticket!.id!, p.user_id);
                          showToast('Participante removido', 'success');
                          const parts = await api.getTicketParticipants(ticket!.id!);
                          setParticipants(parts);
                        } catch { showToast('Erro ao remover', 'error'); }
                      }}
                      className="p-1 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                      title="Remover participante"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <ConfirmationModal
        isOpen={showApproveModal}
        onClose={() => setShowApproveModal(false)}
        onConfirm={() => { setShowApproveModal(false); handleValidationAction('approve'); }}
        title="Aprovar Chamado?"
        message="Ao confirmar, o chamado será marcado como Concluído e o processo será finalizado."
      />

      <ForwardModal
        isOpen={showForwardModal}
        onClose={() => setShowForwardModal(false)}
        onConfirm={handleForward}
        sector={forwardSector}
        setSector={setForwardSector}
        categories={forwardCategories}
        catId={forwardCatId}
        setCatId={setForwardCatId}
        subcategories={forwardSubcategories}
        subId={forwardSubId}
        setSubId={setForwardSubId}
        reason={forwardReason}
        setReason={setForwardReason}
        isLoading={isForwarding}
        loadingData={loadingForwardData}
      />
    </div>
  );
};

const ConfirmationModal: React.FC<{ isOpen: boolean; onClose: () => void; onConfirm: () => void; title: string; message: string }> = ({ isOpen, onClose, onConfirm, title, message }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 animate-in zoom-in-95 duration-200">
        <div className="flex flex-col items-center text-center">
          <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mb-4">
            <CheckCircle2 className="w-6 h-6 text-green-600" />
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-2">{title}</h3>
          <p className="text-gray-500 text-sm mb-6">{message}</p>
          <div className="flex w-full gap-3">
            <button onClick={onClose} className="flex-1 px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold text-sm transition-colors">Cancelar</button>
            <button onClick={onConfirm} className="flex-1 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold text-sm shadow-md transition-all">Confirmar</button>
          </div>
        </div>
      </div>
    </div>
  );
};

const ForwardModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  sector: string;
  setSector: (s: any) => void;
  categories: any[];
  catId: string;
  setCatId: (id: string) => void;
  subcategories: any[];
  subId: string;
  setSubId: (id: string) => void;
  reason: string;
  setReason: (r: string) => void;
  isLoading: boolean;
  loadingData: boolean;
}> = ({ isOpen, onClose, onConfirm, sector, setSector, categories, catId, setCatId, subcategories, subId, setSubId, reason, setReason, isLoading, loadingData }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="p-6 border-b border-slate-50 bg-slate-50/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center text-red-600">
              <ArrowRightLeft className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">Encaminhar / Reclassificar</h3>
              <p className="text-xs text-slate-500 font-medium">Transfira a responsabilidade ou altere o tipo</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-lg transition-colors">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>
        <div className="p-8 space-y-6">
          <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button onClick={() => setSector('T.I')} className={`py-2 rounded-lg text-xs font-black transition-all ${sector === 'T.I' ? 'bg-red-600 text-white shadow-lg shadow-red-600/20' : 'text-slate-500 hover:text-slate-700'}`}>T.I</button>
            <button onClick={() => setSector('Gestão de Informação')} className={`py-2 rounded-lg text-xs font-black transition-all ${sector === 'Gestão de Informação' ? 'bg-red-600 text-white shadow-lg shadow-red-600/20' : 'text-slate-500 hover:text-slate-700'}`}>GI</button>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Nova Categoria</label>
              <div className="relative">
                <select value={catId} onChange={(e) => setCatId(e.target.value)} disabled={loadingData} className="w-full pl-4 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:ring-2 focus:ring-red-500 outline-none transition-all appearance-none disabled:opacity-50">
                  <option value="">{loadingData ? 'Carregando...' : 'Selecione uma categoria...'}</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <Tag className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              </div>
            </div>
            {subcategories.length > 0 && (
              <div className="animate-in slide-in-from-top-2 duration-300">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Subcategoria</label>
                <div className="relative">
                  <select required value={subId} onChange={(e) => setSubId(e.target.value)} className="w-full pl-4 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:ring-2 focus:ring-red-500 outline-none transition-all appearance-none">
                    <option value="">Selecione...</option>
                    {subcategories.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <Layers className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                </div>
              </div>
            )}
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Motivo (Opcional)</label>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Explique por que está reclassificando ou encaminhando..." className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-red-500 outline-none transition-all resize-none"></textarea>
            </div>
          </div>
        </div>
        <div className="p-6 bg-slate-50 flex gap-3 border-t border-slate-100">
          <button onClick={onClose} className="flex-1 py-3 text-xs font-black text-slate-400 uppercase tracking-widest hover:text-slate-600 transition-colors">Cancelar</button>
          <button onClick={onConfirm} disabled={isLoading || !catId || (subcategories.length > 0 && !subId)} className="flex-[2] py-3 bg-red-600 text-white rounded-xl text-xs font-black uppercase tracking-widest shadow-lg shadow-red-600/20 hover:bg-red-700 disabled:bg-slate-300 disabled:shadow-none transition-all flex items-center justify-center gap-2 active:scale-95">
            {isLoading ? <Loader className="w-4 h-4 animate-spin" /> : <ArrowRightLeft className="w-4 h-4" />}
            {isLoading ? 'Encaminhando...' : 'Confirmar Envio'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TicketDetail;
