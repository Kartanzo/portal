import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { User } from '../../types';
import { api } from '../../app_api';
import { useToast } from '../../contexts/ToastContext';
import { X, Send, Loader2, Image, Video, Search, Plus, Trash2, CheckCircle, AlertCircle, Paperclip, FileText } from 'lucide-react';

interface Props { user: User; }

interface ProdutoRow {
  selecionado: boolean;
  codigo_produto: string;
  descricao_produto: string;
  quantidade: number;
  quantidade_defeito: number | '';
  tipo_problema: string;
  arquivos: File[];
}

const EMPTY_PRODUTO = (): ProdutoRow => ({
  selecionado: true, codigo_produto: '', descricao_produto: '',
  quantidade: 1, quantidade_defeito: '', tipo_problema: '', arquivos: [],
});

const SacNewTicket: React.FC<Props> = ({ user }) => {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [meta, setMeta] = useState<{ tipos_problema: string[]; canais_compra: string[] }>({ tipos_problema: [], canais_compra: [] });
  const [loading, setLoading] = useState(false);
  const [buscandoNF, setBuscandoNF] = useState(false);
  const [nfStatus, setNfStatus] = useState<'idle' | 'found' | 'notfound'>('idle');
  const [origemDados, setOrigemDados] = useState<'base_dados' | 'manual'>('manual');
  const [produtos, setProdutos] = useState<ProdutoRow[]>([EMPTY_PRODUTO()]);
  const fileRefs = useRef<(HTMLInputElement | null)[]>([]);

  const [form, setForm] = useState({
    canal: 'Portal', cnpj_cpf: '', razao_social: '', publico: 'cliente',
    email_contato: '', tipo_problema: '', canal_compra: '',
    numero_nf: '', detalhamento: '', pedido: '', emissao: '', entrega: '',
    nota_fiscal_emissao: '', desc_tipodocumento: '', descricao_segmento: '',
  });

  useEffect(() => {
    api.get('/sac/metadata').then((d: any) => {
      const m = d?.data ?? d;
      if (m?.tipos_problema) setMeta(m);
    }).catch(() => {});
  }, []);

  const setField = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const [numeroPedido, setNumeroPedido] = useState('');

  const buscarPorResultado = async (data: any, fonteNF?: string) => {
    if (data?.found) {
      setForm(f => ({
        ...f,
        cnpj_cpf: data.cnpj_cpf || f.cnpj_cpf,
        razao_social: data.razao_social || f.razao_social,
        numero_nf: fonteNF || data.numero_nf || f.numero_nf,
        pedido: data.pedido || f.pedido,
        emissao: data.emissao?.slice(0, 10) || '',
        entrega: data.entrega?.slice(0, 10) || '',
        nota_fiscal_emissao: data.nota_fiscal_emissao?.slice(0, 10) || '',
        desc_tipodocumento: data.desc_tipodocumento || '',
        descricao_segmento: data.descricao_segmento || '',
      }));
      if (data.produtos?.length) {
        setProdutos(data.produtos.map((p: any) => ({
          selecionado: false,
          codigo_produto: p.codigo_produto || '',
          descricao_produto: p.descricao_produto || '',
          quantidade: p.quantidade || 1,
          quantidade_defeito: '',
          tipo_problema: '',
          arquivos: [],
        })));
      }
      setNfStatus('found');
      setOrigemDados('base_dados');
      showToast(`Encontrado — ${data.produtos?.length || 0} produto(s). Selecione os que deseja incluir.`, 'success');
    } else {
      setNfStatus('notfound');
      setOrigemDados('manual');
      showToast('Não encontrado — preencha os campos manualmente', 'info');
    }
  };

  const buscarNF = async () => {
    if (!form.numero_nf.trim()) return;
    setBuscandoNF(true); setNfStatus('idle');
    try {
      const resp: any = await api.get(`/sac/nota/${encodeURIComponent(form.numero_nf.trim())}`);
      const data = resp?.data ?? resp;
      await buscarPorResultado(resp?.data ?? resp);
    } catch { setNfStatus('notfound'); }
    finally { setBuscandoNF(false); }
  };

  const buscarPedido = async () => {
    if (!numeroPedido.trim()) return;
    setBuscandoNF(true); setNfStatus('idle');
    try {
      const resp: any = await api.get(`/sac/pedido/${encodeURIComponent(numeroPedido.trim())}`);
      await buscarPorResultado(resp?.data ?? resp);
    } catch { setNfStatus('notfound'); }
    finally { setBuscandoNF(false); }
  };

  const setProdutoField = <K extends keyof ProdutoRow>(i: number, k: K, v: ProdutoRow[K]) =>
    setProdutos(p => p.map((item, idx) => idx === i ? { ...item, [k]: v } : item));

  const addProdutoArquivos = (i: number, files: FileList | null) => {
    if (!files) return;
    const valid = Array.from(files).filter(f => f.size <= 50 * 1024 * 1024);
    setProdutos(p => p.map((item, idx) => idx === i ? { ...item, arquivos: [...item.arquivos, ...valid] } : item));
  };

  const removeProdutoArquivo = (pi: number, fi: number) =>
    setProdutos(p => p.map((item, idx) => idx === pi ? { ...item, arquivos: item.arquivos.filter((_, j) => j !== fi) } : item));

  const fileIcon = (f: File) => {
    if (f.type.startsWith('image/')) return <Image className="w-3.5 h-3.5 text-blue-500" />;
    if (f.type.startsWith('video/')) return <Video className="w-3.5 h-3.5 text-purple-500" />;
    return <FileText className="w-3.5 h-3.5 text-slate-400" />;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const selecionados = nfStatus === 'found'
      ? produtos.filter(p => p.selecionado)
      : produtos.filter(p => p.codigo_produto || p.descricao_produto);

    if (nfStatus === 'found' && selecionados.length === 0) {
      showToast('Selecione pelo menos um produto', 'error'); return;
    }
    if (!form.cnpj_cpf || !form.razao_social || !form.detalhamento) {
      showToast('Preencha todos os campos obrigatórios', 'error'); return;
    }
    const semTipo = selecionados.find(p => !p.tipo_problema);
    if (semTipo) {
      showToast('Selecione o tipo de problema para cada produto', 'error'); return;
    }
    const semDefeito = selecionados.find(p => p.quantidade_defeito === '' || Number(p.quantidade_defeito) <= 0);
    if (semDefeito) {
      showToast('Informe a quantidade de peças com defeito para cada produto', 'error'); return;
    }

    setLoading(true);
    try {
      const fd = new FormData();
      // Apenas campos permitidos — sem expor dados internos do usuário
      fd.append('user_id', user.id);
      fd.append('canal', form.canal);
      fd.append('cnpj_cpf', form.cnpj_cpf);
      fd.append('razao_social', form.razao_social);
      fd.append('email_contato', form.email_contato);
      fd.append('publico', form.publico);
      // tipo_problema do nivel do formulario OU do primeiro produto selecionado (UI coleta por produto)
      const tipoProblemaRoot = form.tipo_problema || (selecionados[0]?.tipo_problema) || '';
      fd.append('tipo_problema', tipoProblemaRoot);
      fd.append('detalhamento', form.detalhamento);
      fd.append('origem_dados', origemDados);
      if (form.numero_nf) fd.append('numero_nf', form.numero_nf);
      if (form.pedido) fd.append('pedido', form.pedido);
      if (form.emissao) fd.append('emissao', form.emissao);
      if (form.entrega) fd.append('entrega', form.entrega);
      if (form.nota_fiscal_emissao) fd.append('nota_fiscal_emissao', form.nota_fiscal_emissao);
      if (form.desc_tipodocumento) fd.append('desc_tipodocumento', form.desc_tipodocumento);
      if (form.descricao_segmento) fd.append('descricao_segmento', form.descricao_segmento);
      if (selecionados.length) {
        fd.append('produtos_json', JSON.stringify(selecionados.map(p => ({
          codigo_produto: p.codigo_produto,
          descricao_produto: p.descricao_produto,
          quantidade: p.quantidade,
          quantidade_defeito: p.quantidade_defeito === '' ? null : Number(p.quantidade_defeito),
          tipo_problema: p.tipo_problema,
        }))));
        // Anexos por produto com prefixo p{idx}_
        selecionados.forEach((p, pi) => {
          p.arquivos.forEach(f => {
            const blob = new Blob([f], { type: f.type });
            fd.append('files', blob, `p${pi}_${f.name}`);
          });
        });
      }
      if (form.canal_compra) fd.append('canal_compra', form.canal_compra);

      const resp = await fetch('/api/sac/tickets', { credentials: 'include',
        method: 'POST', headers: { 'user-id': user.id }, body: fd,
      });
      const result: any = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const msg = Array.isArray(result?.detail)
          ? result.detail.map((d: any) => `${d.loc?.slice(-1)[0] || ''}: ${d.msg}`).join('; ')
          : (result?.detail || 'Erro ao abrir chamado');
        showToast(msg, 'error');
        return;
      }
      showToast(`Chamado ${result.protocolo} aberto!`, 'success');
      navigate(`/sac/${result.id}`);
    } catch { showToast('Erro ao abrir chamado', 'error'); }
    finally { setLoading(false); }
  };

  const inputCls = "w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500";
  const labelCls = "block text-sm font-semibold text-slate-700 mb-1.5";
  const nfBuscou = nfStatus !== 'idle';

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Novo Chamado SAC</h1>
        <p className="text-slate-500 text-sm mt-1">Preencha os dados abaixo para abrir um chamado</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">

        {/* Nota Fiscal */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <h2 className="text-sm font-bold text-slate-600 uppercase tracking-wider mb-4">Nota Fiscal</h2>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className={labelCls}>Número da NF</label>
              <input type="text" value={form.numero_nf}
                onChange={e => { setField('numero_nf', e.target.value); setNfStatus('idle'); }}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), buscarNF())}
                placeholder="Ex: 123456" className={inputCls} />
            </div>
            <button type="button" onClick={buscarNF} disabled={buscandoNF || !form.numero_nf.trim()}
              className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
              {buscandoNF ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Buscar
            </button>
          </div>
          {/* Busca por Pedido */}
          <div className="flex gap-2 items-end mt-3">
            <div className="flex-1">
              <label className={labelCls}>
                Número do Pedido
                <span className="ml-2 text-[10px] font-normal text-slate-400">ex: MBK-0156 ou PVM-152 (use o traço)</span>
              </label>
              <input type="text" value={numeroPedido}
                onChange={e => { setNumeroPedido(e.target.value); setNfStatus('idle'); }}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), buscarPedido())}
                placeholder="Ex: MBK-0156" className={inputCls} />
            </div>
            <button type="button" onClick={buscarPedido} disabled={buscandoNF || !numeroPedido.trim()}
              className="flex items-center gap-2 px-4 py-2.5 bg-slate-700 text-white text-sm font-semibold rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors">
              {buscandoNF ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Buscar
            </button>
          </div>

          {nfStatus === 'found' && (
            <div className="mt-2 flex items-center gap-2 text-green-700 text-xs bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              <CheckCircle className="w-4 h-4 flex-shrink-0" />
              Encontrado — selecione os produtos que deseja incluir no chamado.
            </div>
          )}
          {nfStatus === 'notfound' && (
            <div className="mt-2 flex items-center gap-2 text-amber-700 text-xs bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              NF não encontrada — preencha os campos manualmente.
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
            <div>
              <label className={labelCls}>Pedido</label>
              <input type="text" value={form.pedido} onChange={e => setField('pedido', e.target.value)} placeholder="Nº pedido" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Data Emissão NF</label>
              <input type="date" value={form.nota_fiscal_emissao} onChange={e => setField('nota_fiscal_emissao', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Data Entrega</label>
              <input type="date" value={form.entrega} onChange={e => setField('entrega', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Tipo Documento</label>
              <input type="text" value={form.desc_tipodocumento} onChange={e => setField('desc_tipodocumento', e.target.value)} placeholder="Ex: Venda" className={inputCls} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Segmento</label>
              <input type="text" value={form.descricao_segmento} onChange={e => setField('descricao_segmento', e.target.value)} placeholder="Segmento do cliente" className={inputCls} />
            </div>
          </div>
        </div>

        {/* Dados do Cliente */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <h2 className="text-sm font-bold text-slate-600 uppercase tracking-wider mb-4">Dados do Cliente</h2>
          <div className="mb-4">
            <label className={labelCls}>Tipo de Solicitante</label>
            <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden">
              {([['cliente', 'Cliente'], ['consumidor_final', 'Consumidor final']] as const).map(([val, lbl]) => (
                <button key={val} type="button" onClick={() => setField('publico', val)}
                  className={`px-4 py-2 text-sm font-semibold transition-colors ${form.publico === val ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                  {lbl}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Consumidor final normalmente não tem NF/pedido. Usado para segmentar o público reclamante.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>CNPJ / CPF <span className="text-red-500">*</span></label>
              <input type="text" value={form.cnpj_cpf} onChange={e => setField('cnpj_cpf', e.target.value)} placeholder="00.000.000/0001-00" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Razão Social / Nome <span className="text-red-500">*</span></label>
              <input type="text" value={form.razao_social} onChange={e => setField('razao_social', e.target.value)} placeholder="Nome da empresa ou pessoa" className={inputCls} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Canal de Compra</label>
              <select value={form.canal_compra} onChange={e => setField('canal_compra', e.target.value)} className={inputCls}>
                <option value="">Selecione o canal...</option>
                {meta.canais_compra.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Produtos */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-slate-600 uppercase tracking-wider">Produtos</h2>
              {nfStatus === 'found' && <p className="text-xs text-amber-600 mt-0.5">Marque os produtos que deseja incluir no chamado <span className="font-bold">(obrigatório)</span></p>}
            </div>
            {!nfBuscou && (
              <button type="button" onClick={() => setProdutos(p => [...p, EMPTY_PRODUTO()])}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors">
                <Plus className="w-3.5 h-3.5" /> Adicionar produto
              </button>
            )}
          </div>

          <div className="space-y-3">
            {produtos.map((p, i) => (
              <div key={i} className={`border rounded-xl p-3 transition-all ${nfStatus === 'found' && !p.selecionado ? 'border-slate-200 bg-slate-50 opacity-60' : 'border-indigo-200 bg-white'}`}>
                <div className="flex items-start gap-3">
                  {/* Checkbox de seleção (só quando veio da NF) */}
                  {nfStatus === 'found' && (
                    <input type="checkbox" checked={p.selecionado}
                      onChange={e => setProdutoField(i, 'selecionado', e.target.checked)}
                      className="mt-2.5 w-4 h-4 accent-indigo-600 flex-shrink-0 cursor-pointer" />
                  )}
                  <div className="flex-1 space-y-2">
                    <div className="space-y-2">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div>
                          <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Código</label>
                          <input type="text" value={p.codigo_produto}
                            onChange={e => setProdutoField(i, 'codigo_produto', e.target.value)}
                            disabled={nfStatus === 'found' && !p.selecionado}
                            placeholder="Código" className="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-100" />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Descrição</label>
                          <input type="text" value={p.descricao_produto}
                            onChange={e => setProdutoField(i, 'descricao_produto', e.target.value)}
                            disabled={nfStatus === 'found' && !p.selecionado}
                            placeholder="Descrição" className="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-100" />
                        </div>
                        <div className="flex gap-2 items-end">
                          <div className="flex-1">
                            <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Qtd NF</label>
                            <input type="number" min={1} value={p.quantidade}
                              onChange={e => setProdutoField(i, 'quantidade', parseInt(e.target.value) || 1)}
                              disabled={nfStatus === 'found' && !p.selecionado}
                              className="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-100" />
                          </div>
                          <div className="flex-1">
                            <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Qtd c/ defeito <span className="text-red-500">*</span></label>
                            <input type="number" min={1} value={p.quantidade_defeito}
                              onChange={e => setProdutoField(i, 'quantidade_defeito', e.target.value === '' ? '' : (parseInt(e.target.value) || ''))}
                              disabled={nfStatus === 'found' && !p.selecionado}
                              placeholder="Informe"
                              className="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-100" />
                          </div>
                          {!nfBuscou && produtos.length > 1 && (
                            <button type="button" onClick={() => setProdutos(pr => pr.filter((_, idx) => idx !== i))}
                              className="p-2 text-slate-400 hover:text-red-500 transition-colors flex-shrink-0">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Tipo de problema por produto */}
                    {(!nfStatus || p.selecionado || nfStatus !== 'found') && (
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Tipo de Problema <span className="text-red-500">*</span></label>
                        <select value={p.tipo_problema}
                          onChange={e => setProdutoField(i, 'tipo_problema', e.target.value)}
                          disabled={nfStatus === 'found' && !p.selecionado}
                          className="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-100">
                          <option value="">Selecione o tipo...</option>
                          {meta.tipos_problema.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                    )}

                    {/* Anexos do produto */}
                    {(p.selecionado || nfStatus !== 'found') && (
                      <div>
                        <div className="flex items-center gap-2 mt-1">
                          <button type="button"
                            onClick={() => fileRefs.current[i]?.click()}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors">
                            <Paperclip className="w-3.5 h-3.5" /> Anexar fotos/vídeos
                          </button>
                          <input ref={el => { fileRefs.current[i] = el; }} type="file" multiple
                            accept="image/*,video/*" className="hidden"
                            onChange={e => addProdutoArquivos(i, e.target.files)} />
                          {p.arquivos.length > 0 && (
                            <span className="text-xs text-slate-500">{p.arquivos.length} arquivo(s)</span>
                          )}
                        </div>
                        {p.arquivos.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {p.arquivos.map((f, fi) => (
                              <div key={fi} className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs">
                                {fileIcon(f)}
                                <span className="max-w-[120px] truncate text-slate-600">{f.name}</span>
                                <button type="button" onClick={() => removeProdutoArquivo(i, fi)} className="text-slate-400 hover:text-red-500">
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {nfStatus === 'found' && (
            <button type="button" onClick={() => setProdutos(p => [...p, EMPTY_PRODUTO()])}
              className="mt-3 flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors">
              <Plus className="w-3.5 h-3.5" /> Adicionar produto manualmente
            </button>
          )}
        </div>

        {/* Detalhes */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
          <h2 className="text-sm font-bold text-slate-600 uppercase tracking-wider">Detalhamento</h2>
          <div>
            <label className={labelCls}>Descreva o problema <span className="text-red-500">*</span></label>
            <textarea value={form.detalhamento} onChange={e => setField('detalhamento', e.target.value)}
              rows={5} placeholder="Descreva detalhadamente o problema..."
              className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
          </div>
        </div>

        <div className="flex justify-end gap-3 pb-4">
          <button type="button" onClick={() => navigate('/sac')}
            className="px-4 py-2 text-sm font-semibold text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors">
            Cancelar
          </button>
          <button type="submit" disabled={loading}
            className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {loading ? 'Enviando...' : 'Abrir Chamado'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default SacNewTicket;
