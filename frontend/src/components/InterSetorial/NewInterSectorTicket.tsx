import React, { useState, useEffect, useRef } from 'react';
import { User } from '../../types';
import { useNavigate } from 'react-router-dom';
import { api } from '../../app_api';
import { useToast } from '../../contexts/ToastContext';
import { ArrowLeft, Loader, Paperclip, AlertCircle } from 'lucide-react';
import { MAX_FILE_SIZE_BYTES, MAX_FILE_SIZE_MB } from '../../constants';
import FileSizeWarningModal from '../FileSizeWarningModal';

interface Props { user: User; }

const ALL_PRIORITIES = ['Baixa', 'Média', 'Alta', 'Urgente'];

interface FormatMatch { start: number; end: number; }

const validateFormatting = (text: string): { summary: { message: string; count: number }[]; firstStart: number; lastEnd: number } | null => {
  const spaceMatches: FormatMatch[] = [];
  const dotMatches: FormatMatch[] = [];
  const enterMatches: FormatMatch[] = [];
  const repeatMatches: FormatMatch[] = [];

  let m: RegExpExecArray | null;
  const spaceRe = /[^\S\n]{2,}/g;
  while ((m = spaceRe.exec(text)) !== null) spaceMatches.push({ start: m.index, end: m.index + m[0].length });
  const dotRe = /\.{2,}/g;
  while ((m = dotRe.exec(text)) !== null) dotMatches.push({ start: m.index, end: m.index + m[0].length });
  const enterRe = /[\n\r]{3,}/g;
  while ((m = enterRe.exec(text)) !== null) enterMatches.push({ start: m.index, end: m.index + m[0].length });
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

const NewInterSectorTicket: React.FC<Props> = ({ user }) => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [sectors, setSectors] = useState<string[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [subcategories, setSubcategories] = useState<any[]>([]);
  const [loadingCats, setLoadingCats] = useState(false);
  const [loadingSubs, setLoadingSubs] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [showSizeWarning, setShowSizeWarning] = useState(false);
  const [uploadError, setUploadError] = useState(false);
  const [descriptionFormatErrors, setDescriptionFormatErrors] = useState<{ message: string; count: number }[]>([]);

  const [form, setForm] = useState({
    title: '',
    description: '',
    category: '',
    subcategory: '',
    priority: 'Média',
    target_sector: '',
  });

  // Load permitted sectors from role_permissions
  useEffect(() => {
    api.getInterSectorSectors().then(data => {
      setSectors(data.allowed_sectors);
    }).catch(() => {});
  }, []);

  // Load categories when target sector changes
  useEffect(() => {
    if (!form.target_sector) {
      setCategories([]);
      setSubcategories([]);
      setForm(prev => ({ ...prev, category: '', subcategory: '' }));
      return;
    }
    setLoadingCats(true);
    api.getSectorCategories(form.target_sector)
      .then(data => {
        setCategories(data);
        setSubcategories([]);
        setForm(prev => ({ ...prev, category: '', subcategory: '' }));
      })
      .catch(() => setCategories([]))
      .finally(() => setLoadingCats(false));
  }, [form.target_sector]);

  // Load subcategories when category changes
  useEffect(() => {
    if (!form.category) {
      setSubcategories([]);
      setForm(prev => ({ ...prev, subcategory: '' }));
      return;
    }
    const selectedCat = categories.find(c => c.name === form.category);
    if (!selectedCat) return;
    setLoadingSubs(true);
    api.getSectorSubcategories(selectedCat.id)
      .then(data => {
        setSubcategories(data);
        setForm(prev => ({ ...prev, subcategory: '' }));
      })
      .catch(() => setSubcategories([]))
      .finally(() => setLoadingSubs(false));
  }, [form.category]);

  // Regras dinâmicas baseadas na subcategoria selecionada
  const selectedSubObj = subcategories.find((s: any) => s.name === form.subcategory);
  const minDescChars = selectedSubObj?.min_chars || 0;
  const requireAttachment = selectedSubObj?.require_attachment || false;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === 'description') setDescriptionFormatErrors([]);
    setForm(prev => ({ ...prev, [name]: value }));
  };


  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const newFiles = Array.from(e.target.files);
    const currentTotal = attachments.reduce((acc, f) => acc + f.size, 0);
    const valid: File[] = [];
    let tempTotal = currentTotal;
    let hasOversized = false;
    newFiles.forEach(file => {
      if (tempTotal + file.size > MAX_FILE_SIZE_BYTES) {
        hasOversized = true;
      } else {
        valid.push(file);
        tempTotal += file.size;
      }
    });
    if (hasOversized) { setShowSizeWarning(true); setUploadError(true); } else { setUploadError(false); }
    if (valid.length > 0) setAttachments(prev => [...prev, ...valid]);
    if (e.target) e.target.value = '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.description.trim() || !form.target_sector || !form.category) {
      showToast('Preencha todos os campos obrigatórios.', 'error');
      return;
    }
    if (subcategories.length > 0 && !form.subcategory) {
      showToast('Selecione uma subcategoria.', 'error');
      return;
    }

    // Limpa formatação automaticamente antes de validar
    let cleanedDesc = form.description;
    cleanedDesc = cleanedDesc.replace(/[^\S\n]{2,}/g, ' ');
    cleanedDesc = cleanedDesc.replace(/\.{2,}/g, '.');
    cleanedDesc = cleanedDesc.replace(/(\r?\n\s*){3,}/g, '\n\n');
    cleanedDesc = cleanedDesc.replace(/([a-zA-ZÀ-ÿ])\1{2,}/g, '$1$1');
    cleanedDesc = cleanedDesc.trim();

    // Validação de min_chars usando a subcategoria selecionada
    const subObj = subcategories.find((s: any) => s.name === form.subcategory);
    const minChars = subObj?.min_chars || 0;
    const reqAttach = subObj?.require_attachment || false;

    if (minChars > 0 && cleanedDesc.length < minChars) {
      showToast(`A descrição deve ter pelo menos ${minChars} caracteres (atual: ${cleanedDesc.length}).`, 'error');
      return;
    }
    if (reqAttach && attachments.length === 0) {
      showToast('Esta subcategoria exige pelo menos um anexo.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const result = await api.createInterSectorTicket({
        title: form.title.trim(),
        description: cleanedDesc,
        category: form.category,
        subcategory: form.subcategory || '',
        priority: form.priority,
        target_sector: form.target_sector,
        requester_id: user.id,
      }, attachments);
      showToast('Chamado criado com sucesso!', 'success');
      navigate(`/inter-sector-tickets/${result.id}`);
    } catch (err: any) {
      showToast(err.message || 'Erro ao criar chamado.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const descLen = form.description.trim().length;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <FileSizeWarningModal isOpen={showSizeWarning} onClose={() => setShowSizeWarning(false)} />

      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/inter-sector-tickets')} className="text-gray-400 hover:text-gray-600 transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Novo Chamado Entre Setores</h1>
          <p className="text-gray-500 text-sm">Abra uma solicitação para outro departamento.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-5">
        {/* Título */}
        <div>
          <label className="block text-xs font-bold text-gray-600 uppercase tracking-wider mb-1.5">Título *</label>
          <input
            name="title"
            type="text"
            value={form.title}
            onChange={handleChange}
            placeholder="Resumo da solicitação"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            required
          />
        </div>

        {/* Setor de Destino */}
        <div>
          <label className="block text-xs font-bold text-gray-600 uppercase tracking-wider mb-1.5">Setor de Destino *</label>
          <select
            name="target_sector"
            value={form.target_sector}
            onChange={handleChange}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 bg-white"
            required
          >
            <option value="">Selecione o setor...</option>
            {sectors.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {/* Categoria (dinâmica por setor) */}
        <div>
          <label className="block text-xs font-bold text-gray-600 uppercase tracking-wider mb-1.5">
            Categoria *
            {!form.target_sector && <span className="ml-2 text-gray-400 font-normal normal-case">(selecione um setor primeiro)</span>}
          </label>
          {loadingCats ? (
            <div className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-400">
              <Loader className="w-4 h-4 animate-spin" /> Carregando categorias...
            </div>
          ) : (
            <select
              name="category"
              value={form.category}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 bg-white disabled:opacity-50"
              disabled={!form.target_sector || categories.length === 0}
              required
            >
              <option value="">
                {!form.target_sector
                  ? 'Selecione um setor primeiro'
                  : categories.length === 0
                  ? 'Nenhuma categoria cadastrada para este setor'
                  : 'Selecione a categoria...'}
              </option>
              {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          )}
          {form.target_sector && categories.length === 0 && !loadingCats && (
            <p className="text-xs text-yellow-600 mt-1">
              O setor <strong>{form.target_sector}</strong> ainda não cadastrou categorias. Entre em contato com o responsável.
            </p>
          )}
        </div>

        {/* Subcategoria (aparece se a categoria selecionada tiver subcategorias) */}
        {form.category && (loadingSubs || subcategories.length > 0) && (
          <div>
            <label className="block text-xs font-bold text-gray-600 uppercase tracking-wider mb-1.5">
              Subcategoria *
            </label>
            {loadingSubs ? (
              <div className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-400">
                <Loader className="w-4 h-4 animate-spin" /> Carregando subcategorias...
              </div>
            ) : (
              <select
                name="subcategory"
                value={form.subcategory}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 bg-white"
                required
              >
                <option value="">Selecione a subcategoria...</option>
                {subcategories.map((s: any) => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            )}
          </div>
        )}

        {/* Prioridade */}
        <div>
          <label className="block text-xs font-bold text-gray-600 uppercase tracking-wider mb-1.5">Prioridade *</label>
          <select
            name="priority"
            value={form.priority}
            onChange={handleChange}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 bg-white"
          >
            {ALL_PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        {/* Descrição */}
        <div>
          <div className="flex justify-between items-center mb-1.5">
            <label className="block text-xs font-bold text-gray-600 uppercase tracking-wider">
              Descrição *
              {minDescChars > 0 && (
                <span className="font-normal text-gray-400 normal-case"> (mínimo {minDescChars} caracteres)</span>
              )}
            </label>
            {minDescChars > 0 && (
              <span className={`text-[10px] font-black uppercase tracking-widest ${descLen < minDescChars ? 'text-red-500' : 'text-green-600'}`}>
                {descLen} / {minDescChars}
              </span>
            )}
          </div>
          <textarea
            ref={textareaRef}
            name="description"
            value={form.description}
            onChange={handleChange}
            rows={8}
            placeholder="Descreva detalhadamente a solicitação. Seja específico sobre o que precisa, contexto e prazo esperado."
            className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none leading-relaxed ${
              minDescChars > 0 && descLen > 0 && descLen < minDescChars
                ? 'border-red-300 bg-red-50/20'
                : 'border-gray-200'
            }`}
            required
          />
          {minDescChars > 0 && descLen > 0 && descLen < minDescChars && (
            <div className="flex items-center mt-2 text-red-600 text-[11px] font-bold uppercase tracking-tight">
              <AlertCircle className="w-3.5 h-3.5 mr-1.5" />
              Faltam {minDescChars - descLen} caracteres para atingir o mínimo obrigatório.
            </div>
          )}
        </div>

        {/* Anexos */}
        <div>
          {requireAttachment && (
            <div className="flex items-center gap-1.5 mb-2 text-orange-600 text-[11px] font-bold uppercase tracking-tight">
              <AlertCircle className="w-3.5 h-3.5" />
              Anexo obrigatório para esta subcategoria
            </div>
          )}
        </div>
        <div
          className={`border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center transition-all cursor-pointer ${
            uploadError || (requireAttachment && attachments.length === 0)
              ? 'border-red-500 bg-red-50/10'
              : attachments.length > 0
              ? 'border-green-500 bg-green-50/10'
              : 'border-gray-200 hover:border-green-200 hover:bg-green-50/10'
          }`}
          onClick={() => setUploadError(false)} style={{ position: 'relative' }}
        >
          <input
            type="file"
            multiple
            style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%', zIndex: 1 }}
            onChange={handleFileChange}
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
                    onClick={e => { e.stopPropagation(); setAttachments(prev => prev.filter((_, i) => i !== index)); }}
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
              <Paperclip className="w-7 h-7 mb-2 text-gray-400" />
              <span className="text-xs font-black uppercase tracking-[0.2em] text-gray-400">Anexar Arquivos (opcional)</span>
              <span className="text-[10px] text-gray-300 mt-1 font-bold">Peso máximo: {MAX_FILE_SIZE_MB}MB</span>
            </>
          )}
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={() => navigate('/inter-sector-tickets')}
            className="px-4 py-2 text-sm font-bold text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={submitting || (minDescChars > 0 && descLen < minDescChars)}
            className="flex items-center gap-2 px-6 py-2 bg-red-600 text-white text-sm font-bold rounded-lg hover:bg-red-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting && <Loader className="w-4 h-4 animate-spin" />}
            Abrir Chamado
          </button>
        </div>
      </form>
    </div>
  );
};

export default NewInterSectorTicket;
