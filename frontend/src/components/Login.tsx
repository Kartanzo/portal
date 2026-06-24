import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../app_api';
import {
  User as UserIcon, Eye, EyeOff, Mail, X,
  LifeBuoy, Wallet, Users, Factory, Headphones, Package, Ship, BarChart3,
} from 'lucide-react';
import { useToast } from '../contexts/ToastContext';

// Landing genérica sobre o PROJETO (portal corporativo). Sem imagens de empresa —
// tudo via gradientes + ícones. Para reverter ao layout antigo: Login.original.tsx.
const slides = [
  {
    tag: 'GESTÃO INTEGRADA',
    title: 'Tudo em um só lugar',
    text: 'Chamados, financeiro, fábrica, RH e SAC reunidos em um único portal corporativo.',
  },
  {
    tag: 'DADOS EM TEMPO REAL',
    title: 'Decisões com clareza',
    text: 'Indicadores, dashboards e relatórios atualizados para acompanhar o negócio mês a mês.',
  },
  {
    tag: 'PRODUTIVIDADE',
    title: 'Fluxos sem atrito',
    text: 'Automatize processos entre setores e acompanhe cada etapa, do início ao fim.',
  },
];

const modules = [
  { icon: LifeBuoy, label: 'Chamados' },
  { icon: Wallet, label: 'Financeiro' },
  { icon: Users, label: 'RH' },
  { icon: Factory, label: 'Fábrica' },
  { icon: Headphones, label: 'SAC' },
  { icon: Package, label: 'Catálogo' },
  { icon: Ship, label: 'Comex' },
  { icon: BarChart3, label: 'Indicadores' },
];

const Login: React.FC<{ onLogin: (user: any) => void }> = ({ onLogin }) => {
  // Login sempre em modo claro
  useEffect(() => {
    const html = document.documentElement;
    const wasDark = html.classList.contains('dark');
    if (wasDark) html.classList.remove('dark');
    return () => {
      if (wasDark) html.classList.add('dark');
    };
  }, []);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);

  const [activePhrase, setActivePhrase] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setActivePhrase((p) => (p + 1) % slides.length), 6000);
    return () => clearInterval(t);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const user = await api.login(username, password);
      onLogin(user);
      navigate('/overview');
    } catch (error: any) {
      showToast(error.message || 'Erro ao realizar login', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotLoading(true);
    try {
      await api.forgotPassword(forgotEmail);
      showToast('Email de recuperação enviado com sucesso!', 'success');
      setShowForgot(false);
    } catch (error: any) {
      showToast(error.message || 'Erro ao solicitar recuperação', 'error');
    } finally {
      setForgotLoading(false);
    }
  };

  const HeroContent = ({ compact = false }: { compact?: boolean }) => (
    <>
      {/* Logo */}
      <div className={`flex items-center gap-3 ${compact ? '' : 'mb-auto'}`}>
        <img
          src="/Logo-Empresa.png"
          alt="Portal"
          className={`${compact ? 'h-7' : 'h-9'} brightness-0 invert drop-shadow`}
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
        <div className="h-7 w-px bg-white/25" />
        <span className="text-[10px] font-black text-white/70 tracking-[0.35em] uppercase">
          Portal Corporativo
        </span>
      </div>

      {/* Hero text */}
      {!compact && (
        <div className="max-w-xl">
          <div className="inline-flex items-center gap-2 mb-5 bg-white/10 backdrop-blur-xl px-4 py-1.5 rounded-full border border-white/15 shadow-xl float-slow">
            <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
            <span className="text-[11px] font-black uppercase tracking-[0.3em] text-white/90">
              {slides[activePhrase].tag}
            </span>
          </div>
          <h1
            key={activePhrase}
            className="text-6xl font-black mb-6 leading-[0.95] tracking-tighter uppercase italic drop-shadow-2xl text-white animate-in fade-in slide-in-from-bottom-4 duration-700"
          >
            {slides[activePhrase].title}
          </h1>
          <div className="h-1 w-20 bg-sky-400 mb-5 rounded-full" />
          <p
            key={`p-${activePhrase}`}
            className="text-lg text-white/80 font-medium leading-relaxed max-w-lg drop-shadow animate-in fade-in duration-700"
          >
            {slides[activePhrase].text}
          </p>
        </div>
      )}

      {/* Módulos do portal */}
      {!compact && (
        <div className="grid grid-cols-4 gap-3 max-w-xl">
          {modules.map((m) => {
            const Icon = m.icon;
            return (
              <div
                key={m.label}
                className="group flex flex-col items-center justify-center gap-2 py-4 rounded-2xl bg-white/[0.06] border border-white/10 backdrop-blur-md hover:bg-white/[0.12] hover:border-white/25 transition-all"
              >
                <Icon className="w-5 h-5 text-sky-300 group-hover:text-white transition-colors" />
                <span className="text-[10px] font-bold text-white/70 group-hover:text-white uppercase tracking-wider transition-colors">
                  {m.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );

  return (
    <div className="relative flex flex-col lg:flex-row h-screen w-full overflow-hidden font-sans bg-gray-50">
      <style>{`
        @keyframes float-slow { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
        .float-slow { animation: float-slow 6s ease-in-out infinite; }
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        .shimmer { background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.06) 50%, transparent 100%); background-size: 200% 100%; animation: shimmer 4s linear infinite; }
        @keyframes drift { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(4%, -4%) scale(1.1); } }
        .drift { animation: drift 18s ease-in-out infinite; }
      `}</style>

      {/* Painel esquerdo — landing do portal (desktop) */}
      <div className="hidden lg:flex lg:w-3/5 relative overflow-hidden select-none bg-[#0A1A2F]">
        {/* Fundo: gradiente + glows */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#0A2742] via-[#0E3A66] to-[#06101D]" />
        <div className="absolute -top-1/4 -left-1/4 w-[60%] h-[60%] rounded-full bg-sky-500/20 blur-[120px] drift" />
        <div className="absolute -bottom-1/4 right-0 w-[55%] h-[55%] rounded-full bg-indigo-600/20 blur-[120px] drift" style={{ animationDelay: '6s' }} />
        {/* Grid sutil */}
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)',
            backgroundSize: '46px 46px',
          }}
        />
        <div className="absolute inset-0 shimmer pointer-events-none" />

        {/* Conteúdo */}
        <div className="relative z-10 flex flex-col justify-between p-14 w-full">
          <HeroContent />
        </div>

        <div className="absolute top-6 right-10 z-20 text-[10px] font-black text-white/50 tracking-[0.3em] uppercase">
          Gestão • Indicadores • Operação
        </div>
      </div>

      {/* Mobile: hero compacto no topo */}
      <div className="lg:hidden relative w-full h-[26vh] min-h-[180px] overflow-hidden bg-[#0A1A2F]">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0A2742] via-[#0E3A66] to-[#06101D]" />
        <div className="absolute -top-10 -left-10 w-48 h-48 rounded-full bg-sky-500/25 blur-3xl drift" />
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent to-white pointer-events-none" />
        <div className="relative z-10 flex flex-col justify-center h-full px-6 gap-3">
          <HeroContent compact />
          <p className="text-white/80 text-sm font-bold max-w-xs">{slides[activePhrase].title}</p>
        </div>
      </div>

      {/* Form de login */}
      <div className="flex-1 w-full lg:w-2/5 flex items-center justify-center bg-white p-6 lg:p-12 relative lg:shadow-[-20px_0_50px_rgba(0,0,0,0.1)] z-10 overflow-y-auto">
        <div className="w-full max-w-md space-y-6 lg:space-y-12">
          <div className="space-y-2 lg:space-y-4">
            <h2 className="text-3xl lg:text-5xl font-black text-slate-900 tracking-tighter uppercase leading-none">
              Acesso <span className="text-[#1E73C8] lg:block">Restrito</span>
            </h2>
            <p className="text-slate-400 text-xs lg:text-sm font-bold tracking-tight">
              Portal Corporativo de Gestão e Indicadores.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-8">
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Identificação</label>
                <div className="relative group">
                  <input
                    type="text"
                    required
                    className="appearance-none block w-full px-5 py-5 bg-slate-50 border border-slate-100 rounded-3xl focus:ring-4 focus:ring-sky-500/10 focus:bg-white focus:border-[#1E73C8] text-sm text-slate-900 placeholder-slate-300 outline-none transition-all"
                    placeholder="E-mail ou Usuário"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                  <div className="absolute right-5 top-1/2 -translate-y-1/2 h-8 w-8 bg-slate-200 rounded-2xl flex items-center justify-center group-focus-within:bg-[#1E73C8] transition-all duration-300">
                    <UserIcon className="h-3 w-3 text-white" />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center ml-1">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Senha de Acesso</label>
                  <button type="button" onClick={() => setShowForgot(true)} className="text-[10px] font-black text-[#1E73C8] hover:text-sky-700 uppercase tracking-widest transition-colors">
                    Recuperar
                  </button>
                </div>
                <div className="relative group">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    className="appearance-none block w-full px-5 py-5 bg-slate-50 border border-slate-100 rounded-3xl focus:ring-4 focus:ring-sky-500/10 focus:bg-white focus:border-[#1E73C8] text-sm text-slate-900 placeholder-slate-300 outline-none transition-all"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button type="button" className="absolute right-5 top-1/2 -translate-y-1/2 p-2 text-slate-300 hover:text-slate-600 transition-colors" onClick={() => setShowPassword(!showPassword)}>
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full h-16 flex items-center justify-center border border-transparent text-xs font-black rounded-3xl text-white bg-[#1E73C8] hover:bg-sky-700 disabled:bg-slate-100 disabled:text-slate-300 transition-all uppercase tracking-[0.3em] shadow-[0_15px_30px_-10px_rgba(30,115,200,0.5)] active:scale-[0.98]"
            >
              {isLoading ? 'Autenticando...' : 'Entrar no Sistema'}
            </button>
          </form>

          <div className="pt-4 flex justify-center">
            <span className="text-[9px] font-black text-slate-300 uppercase tracking-[0.3em]">Portal Corporativo</span>
          </div>
        </div>

        {showForgot && (
          <div className="absolute inset-0 bg-white/98 backdrop-blur-xl z-50 flex items-center justify-center p-8 animate-in fade-in duration-300">
            <div className="w-full max-w-md space-y-8 animate-in zoom-in-95 duration-500">
              <div className="flex justify-between items-center mb-4">
                <div className="h-12 w-12 bg-sky-50 rounded-2xl flex items-center justify-center">
                  <Mail className="w-6 h-6 text-[#1E73C8]" />
                </div>
                <button onClick={() => setShowForgot(false)} className="p-3 hover:bg-slate-100 rounded-2xl transition-colors">
                  <X className="w-6 h-6 text-slate-400 hover:text-slate-900" />
                </button>
              </div>

              <div className="space-y-2">
                <h3 className="text-4xl font-black text-slate-900 tracking-tight uppercase">
                  Recuperar
                  <br />
                  Senha
                </h3>
                <p className="text-sm text-slate-500 font-medium leading-relaxed">Você receberá um link de redefinição no seu email corporativo cadastrado.</p>
              </div>

              <form onSubmit={handleForgotSubmit} className="space-y-8">
                <div className="space-y-2">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">E-mail Cadastrado</label>
                  <input
                    type="email"
                    required
                    className="block w-full px-6 py-5 bg-slate-50 border border-slate-100 rounded-3xl focus:ring-4 focus:ring-sky-500/10 focus:bg-white text-sm text-slate-900 outline-none transition-all"
                    placeholder="email@empresa.com.br"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                  />
                </div>
                <button
                  type="submit"
                  disabled={forgotLoading}
                  className="w-full h-16 bg-[#1E73C8] text-white rounded-3xl font-black uppercase text-[11px] tracking-[0.3em] hover:bg-sky-700 disabled:bg-slate-100 disabled:text-slate-300 transition-all shadow-xl shadow-sky-500/20"
                >
                  {forgotLoading ? 'Processando...' : 'Enviar Redefinição'}
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Login;
