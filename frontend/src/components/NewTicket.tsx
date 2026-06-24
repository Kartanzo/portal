
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { TicketCategory, TicketPriority, TicketStatus } from '../types';
import { ArrowLeft, Send, Paperclip, Info, AlertCircle } from 'lucide-react';
import { api } from '../app_api';
import { useToast } from '../contexts/ToastContext';
import { MAX_FILE_SIZE_BYTES, MAX_FILE_SIZE_MB } from '../constants';
import FileSizeWarningModal from './FileSizeWarningModal';

interface NewTicketProps {
  user: any; // Using any for now to match current types usage or can use User from types
}

const NewTicket: React.FC<NewTicketProps> = ({ user: loggedUser }) => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [loading, setLoading] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [showSizeWarning, setShowSizeWarning] = useState(false);
  const [uploadError, setUploadError] = useState(false);
  const [userRole, setUserRole] = useState<string>('');
  const [allUsers, setAllUsers] = useState<Array<{ id: string, name: string, sector: string }>>([]);
  const [selectedRequesterId, setSelectedRequesterId] = useState('');

  // New Category System States
  const [categories, setCategories] = useState<any[]>([]);
  const [subcategories, setSubcategories] = useState<any[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [subcategoryId, setSubcategoryId] = useState('');

  // Form States
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<string>(''); // For legacy/display
  const [priority, setPriority] = useState<TicketPriority>(TicketPriority.MEDIUM);
  const [description, setDescription] = useState('');
  const [deliveryForecast, setDeliveryForecast] = useState('');
  const [descriptionFormatErrors, setDescriptionFormatErrors] = useState<{ message: string; count: number }[]>([]);

  const minChars = 200;

  useEffect(() => {
    if (loggedUser) {
      setUserRole(loggedUser.role);

      // Fetch all users if super user
      if (loggedUser.role === 'super_user') {
        api.getAllUsersSimple().then(users => {
          setAllUsers(users);
        }).catch(err => {
          console.error('Failed to fetch users:', err);
        });
      }

      // Fetch categories from both sectors (T.I and Gestão de Informação)
      Promise.all([
        api.getCategories('T.I'),
        api.getCategories('Gestão de Informação')
      ]).then(([tiCats, giCats]) => {
        setCategories([...tiCats, ...giCats]);
      }).catch(err => console.error('Failed to fetch categories:', err));
    }
  }, []);

  // Fetch subcategories when categoryId changes
  useEffect(() => {
    if (categoryId) {
      api.getSubcategories(categoryId).then(setSubcategories).catch(err => {
        console.error('Failed to fetch subcategories:', err);
        setSubcategories([]);
      });
    } else {
      setSubcategories([]);
      setSubcategoryId('');
    }
  }, [categoryId]);

  const isSuperUser = userRole === 'super_user';

  interface FormatMatch { start: number; end: number; }

  const validateFormatting = (text: string): { summary: { message: string; count: number }[]; firstStart: number; lastEnd: number } | null => {
    const spaceMatches: FormatMatch[] = [];
    const dotMatches: FormatMatch[] = [];
    const enterMatches: FormatMatch[] = [];

    let m: RegExpExecArray | null;
    const spaceRe = /[^\S\n]{2,}/g;
    while ((m = spaceRe.exec(text)) !== null) spaceMatches.push({ start: m.index, end: m.index + m[0].length });
    const dotRe = /\.{2,}/g;
    while ((m = dotRe.exec(text)) !== null) dotMatches.push({ start: m.index, end: m.index + m[0].length });
    const enterRe = /[\n\r]{3,}/g;
    while ((m = enterRe.exec(text)) !== null) enterMatches.push({ start: m.index, end: m.index + m[0].length });

    const repeatMatches: FormatMatch[] = [];
    // 3+ identical consecutive letters (allows "rr", "ss", blocks "rrr", "aaaa", etc.)
    const repeatRe = /([a-zA-ZÀ-ÿ])\1{2,}/g;
    while ((m = repeatRe.exec(text)) !== null) repeatMatches.push({ start: m.index, end: m.index + m[0].length });

    const summary: { message: string; count: number }[] = [];
    if (spaceMatches.length) summary.push({ message: 'Espaços extras', count: spaceMatches.length });
    if (dotMatches.length) summary.push({ message: 'Pontos consecutivos', count: dotMatches.length });
    if (enterMatches.length) summary.push({ message: 'Enters consecutivos', count: enterMatches.length });
    if (repeatMatches.length) summary.push({ message: 'Letras repetidas (3 ou mais iguais seguidas)', count: repeatMatches.length });

    if (!summary.length) return null;

    const all = [...spaceMatches, ...dotMatches, ...enterMatches, ...repeatMatches];
    const firstStart = Math.min(...all.map(x => x.start));
    const lastEnd = Math.max(...all.map(x => x.end));
    return { summary, firstStart, lastEnd };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedDescription = description.trim();

    if (trimmedDescription.length < minChars) {
      showToast(`A descrição deve ter pelo menos ${minChars} caracteres de texto real.`, 'error');
      return;
    }

    const formatResult = validateFormatting(description);
    if (formatResult) {
      setDescriptionFormatErrors(formatResult.summary);
      const total = formatResult.summary.reduce((acc, e) => acc + e.count, 0);
      showToast(`Chamado fora do padrão: ${total} problema(s) de formatação encontrado(s).`, 'error');
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(formatResult.firstStart, formatResult.lastEnd);
      }
      return;
    }

    // Validation: Mandatory attachment for ERROR_FIX (legacy name check or new ID check)
    const isErrorFix = category === 'Ajuste de erro ou problema' || categories.find(c => c.id === categoryId)?.name === 'Ajuste de erro ou problema';
    if (isErrorFix && attachments.length === 0) {
      showToast("Para 'Ajuste de erro ou problema', é obrigatório anexar pelo menos um arquivo de evidência.", 'error');
      return;
    }

    setLoading(true);

    try {
      const userFromStorage = JSON.parse(sessionStorage.getItem('empresa_user') || '{}');
      const user = loggedUser || userFromStorage;

      if (!user || !user.id) {
        showToast("Erro: Usuário não identificado. Por favor, faça login novamente.", 'error');
        setLoading(false);
        return;
      }

      const ticketData: any = {
        title: title,
        description: description,
        category: category,
        category_id: categoryId,
        subcategory_id: subcategoryId,
        priority: priority,
        status: TicketStatus.OPEN,
        requester_id: selectedRequesterId || user.id,
        authenticated_user_id: user.id,
        delivery_forecast: (isSuperUser && deliveryForecast) ? deliveryForecast : undefined
      };

      console.log('Sending payload:', ticketData); // Debug log

      const newTicket = await api.createTicket(ticketData, attachments);
      navigate(`/tickets/${newTicket.id}`);
      showToast('Chamado criado com sucesso!', 'success');
    } catch (error) {
      console.error('Error creating ticket:', error);
      showToast('Falha ao criar chamado. Tente novamente.', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <FileSizeWarningModal
        isOpen={showSizeWarning}
        onClose={() => setShowSizeWarning(false)}
      />
      <div className="flex items-center space-x-4">
        <button onClick={() => navigate(-1)} className="p-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Novo Chamado</h1>
          <p className="text-gray-500 text-sm">Descreva sua necessidade detalhadamente para o time de dados.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <form onSubmit={handleSubmit} className="bg-white p-6 md:p-8 rounded-xl shadow-sm border border-gray-100 space-y-6">
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Título do Assunto</label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ex: Correção de discrepância no relatório de faturamento"
                  className="w-full px-4 py-3 bg-white border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-red-500 outline-none transition-all shadow-sm"
                />
              </div>

              {isSuperUser && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Solicitante (Abrir para outro usuário)</label>
                  <select
                    value={selectedRequesterId}
                    onChange={(e) => setSelectedRequesterId(e.target.value)}
                    className="w-full px-5 py-3 bg-white border border-gray-300 rounded-lg text-gray-900 font-medium focus:ring-2 focus:ring-red-500 outline-none shadow-sm min-h-[50px]"
                  >
                    <option value="">Eu mesmo (padrão)</option>
                    {allUsers.map(u => (
                      <option key={u.id} value={u.id}>{u.name} - {u.sector}</option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">Deixe em branco para criar o chamado em seu nome</p>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Categoria</label>
                  <select
                    required
                    value={categoryId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setCategoryId(id);
                      const cat = categories.find(c => c.id === id);
                      if (cat) setCategory(cat.name);
                      setSubcategoryId(''); // Reset subcat
                    }}
                    className="w-full px-5 py-3 bg-white border border-gray-300 rounded-lg text-gray-900 font-medium focus:ring-2 focus:ring-red-500 outline-none shadow-sm min-h-[50px]"
                  >
                    <option value="">Selecione uma categoria...</option>
                    {categories.map(cat => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                </div>

                {subcategories.length > 0 && (
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Subcategoria</label>
                    <select
                      required
                      value={subcategoryId}
                      onChange={(e) => setSubcategoryId(e.target.value)}
                      className="w-full px-5 py-3 bg-white border border-gray-300 rounded-lg text-gray-900 font-medium focus:ring-2 focus:ring-red-500 outline-none shadow-sm min-h-[50px]"
                    >
                      <option value="">Selecione uma subcategoria...</option>
                      {subcategories.map(sub => (
                        <option key={sub.id} value={sub.id}>{sub.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Prioridade</label>
                  <select
                    required
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as TicketPriority)}
                    className="w-full px-5 py-3 bg-white border border-gray-300 rounded-lg text-gray-900 font-medium focus:ring-2 focus:ring-red-500 outline-none shadow-sm min-h-[50px]"
                  >
                    {Object.values(TicketPriority).map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>

                {isSuperUser && (
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Previsão de Entrega (Agenda)</label>
                    <input
                      type="date"
                      className="w-full px-4 py-3 bg-white border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-red-500 outline-none transition-all shadow-sm"
                      value={deliveryForecast}
                      onChange={e => setDeliveryForecast(e.target.value)}
                    />
                  </div>
                )}
              </div>

              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="block text-sm font-semibold text-gray-700">Descrição Detalhada</label>
                  <span className={`text-[10px] font-black uppercase tracking-widest ${description.trim().length < minChars ? 'text-red-500' : 'text-green-600'}`}>
                    {description.trim().length} / {minChars} caracteres
                  </span>
                </div>
                <textarea
                  ref={textareaRef}
                  required
                  rows={10}
                  value={description}
                  onChange={(e) => { setDescription(e.target.value); setDescriptionFormatErrors([]); }}
                  placeholder="Seja específico. Informe filtros, nomes de tabelas, campos do SAP e a regra de negócio. O preenchimento detalhado acelera o desenvolvimento."
                  className={`w-full px-4 py-3 bg-white border rounded-lg text-gray-900 focus:ring-2 focus:ring-red-500 outline-none transition-all resize-none shadow-sm leading-relaxed ${descriptionFormatErrors.length > 0 ? 'border-orange-400 bg-orange-50/20' : description.trim().length > 0 && description.trim().length < minChars ? 'border-red-300 bg-red-50/20' : 'border-gray-300'}`}
                ></textarea>
                {descriptionFormatErrors.length > 0 && (
                  <div className="mt-2 text-orange-600 text-[11px] font-bold uppercase tracking-tight">
                    <div className="flex items-center mb-1">
                      <AlertCircle className="w-3.5 h-3.5 mr-1.5 flex-shrink-0" />
                      {descriptionFormatErrors.reduce((acc, e) => acc + e.count, 0)} problema(s) de formatação encontrado(s):
                    </div>
                    <ul className="ml-5 list-disc space-y-0.5">
                      {descriptionFormatErrors.map((e) => (
                        <li key={e.message}>{e.message}: {e.count} ocorrência(s)</li>
                      ))}
                    </ul>
                  </div>
                )}
                {descriptionFormatErrors.length === 0 && description.trim().length > 0 && description.trim().length < minChars && (
                  <div className="flex items-center mt-2 text-red-600 text-[11px] font-bold uppercase tracking-tight">
                    <AlertCircle className="w-3.5 h-3.5 mr-1.5" />
                    Faltam {minChars - description.trim().length} caracteres de texto real para atingir o mínimo obrigatório.
                  </div>
                )}
              </div>



              <div
                className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center transition-all cursor-pointer ${uploadError
                  ? 'border-red-500 bg-red-50/10'
                  : attachments.length > 0
                    ? 'border-green-500 bg-green-50/10'
                    : 'border-gray-200 hover:border-green-200 hover:bg-green-50/10'
                  }`}
                onClick={() => {
                  setUploadError(false);
                  fileInputRef.current?.click();
                }}
              >
                <input
                  type="file"
                  multiple
                  className="hidden"
                  ref={fileInputRef}
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      const newFiles: File[] = Array.from(e.target.files);

                      // Calculate current total size
                      const currentTotalSize = attachments.reduce((acc, file) => acc + file.size, 0);

                      const validFiles: File[] = [];
                      let tempTotalSize = currentTotalSize;
                      let hasOversized = false;

                      newFiles.forEach(file => {
                        if (tempTotalSize + file.size > MAX_FILE_SIZE_BYTES) {
                          hasOversized = true;
                        } else {
                          validFiles.push(file);
                          tempTotalSize += file.size;
                        }
                      });

                      if (hasOversized) {
                        setShowSizeWarning(true);
                        setUploadError(true);
                      } else {
                        setUploadError(false);
                      }

                      if (validFiles.length > 0) {
                        setAttachments(prev => [...prev, ...validFiles]);
                      }
                    }
                    // Reset value to allow selecting the same file again if needed
                    if (e.target) e.target.value = '';
                  }}
                />

                {attachments.length > 0 ? (
                  <div className="w-full space-y-2">
                    {attachments.map((file, index) => (
                      <div key={index} className="flex items-center justify-between p-3 bg-white rounded-lg border border-green-100 shadow-sm">
                        <div className="flex items-center space-x-3 overflow-hidden">
                          <Paperclip className="w-4 h-4 text-green-500 flex-shrink-0" />
                          <span className="text-xs font-bold text-gray-700 truncate">{file.name}</span>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setAttachments(prev => prev.filter((_, i) => i !== index));
                          }}
                          className="text-red-400 hover:text-red-600 p-1 transition-colors"
                        >
                          <span className="text-xs font-black">✕</span>
                        </button>
                      </div>
                    ))}
                    <div className="pt-2">
                      <span className="text-[10px] font-black uppercase tracking-widest text-green-500 hover:text-green-700">
                        + Adicionar mais arquivos
                      </span>
                    </div>
                  </div>
                ) : (
                  <>
                    <Paperclip className="w-8 h-8 mb-2 text-gray-400" />
                    <span className="text-xs font-black uppercase tracking-[0.2em] text-gray-400">
                      Anexar Evidências (Print/Excel)
                    </span>
                    <span className="text-[10px] text-gray-300 mt-2 font-bold">
                      Peso máximo: {MAX_FILE_SIZE_MB}MB
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="flex justify-end pt-4">
              <button
                type="submit"
                disabled={loading || description.trim().length < minChars}
                className="inline-flex items-center px-10 py-4 bg-red-600 text-white rounded-lg font-black uppercase tracking-widest text-xs hover:bg-red-700 transition-all shadow-lg disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none transform active:scale-95"
              >
                {loading ? 'Processando...' : (
                  <>
                    Enviar Chamado <Send className="w-4 h-4 ml-2" />
                  </>
                )}
              </button>
            </div>
          </form>
        </div>

        <div className="space-y-6">
          <div className="bg-slate-900 p-8 rounded-2xl text-white shadow-xl">
            <div className="flex items-center space-x-2 text-red-500 mb-6">
              <Info className="w-5 h-5" />
              <h3 className="font-black text-xs uppercase tracking-widest">Guia de Preenchimento</h3>
            </div>
            <p className="text-sm text-slate-300 leading-relaxed mb-6 font-medium">
              Chamados com descrições curtas aumentam o SLA de entrega em até 40% devido à necessidade de reuniões de alinhamento.
            </p>
            <ul className="space-y-4">
              <li className="flex items-start">
                <span className="w-1.5 h-1.5 bg-red-500 rounded-full mt-2 mr-3 flex-shrink-0"></span>
                <span className="text-xs text-slate-400">Informe o ID do relatório se já existir</span>
              </li>
              <li className="flex items-start">
                <span className="w-1.5 h-1.5 bg-red-500 rounded-full mt-2 mr-3 flex-shrink-0"></span>
                <span className="text-xs text-slate-400">Anexe prints da tela de erro</span>
              </li>
              <li className="flex items-start">
                <span className="w-1.5 h-1.5 bg-red-500 rounded-full mt-2 mr-3 flex-shrink-0"></span>
                <span className="text-xs text-slate-400">Descreva o comportamento esperado vs atual</span>
              </li>
            </ul>
          </div>
        </div>
      </div >
    </div >
  );
};

export default NewTicket;
