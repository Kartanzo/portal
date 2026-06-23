import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../app_api';
import { User as UserIcon, Eye, EyeOff, Mail, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';

// Galeria: imagens colocadas em frontend/public/login-gallery/
// Para reverter ao layout antigo: renomear Login.original.tsx -> Login.tsx
const gallery = [
  { src: '/login-gallery/2.jpg', alt: '3LACKD — Detalhes que fazem a diferenca' },
  { src: '/login-gallery/1.jpg', alt: '3LACKD — Yiwu, China' },
  { src: '/login-gallery/4.jpg', alt: '3LACKD — Equipe Nova Era' },
  { src: '/login-gallery/5.jpg', alt: '3LACKD — Reconhecimento internacional' },
  { src: '/login-gallery/3.jpg', alt: '3LACKD — Nosso proposito' },
];

const Login: React.FC<{ onLogin: (user: any) => void }> = ({ onLogin }) => {
  // Login sempre em modo claro — remove a classe 'dark' enquanto a tela esta montada
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

  // Frases mantidas da versao anterior
  const historySlides = [
    {
      title: 'Trabalho Constante',
      text: 'Ao longo de mais de 40 anos inaugurando um novo Centro de Distribuição e ampliando a capacidade fabril. Hoje somamos mais de 10.000m² de área produtiva.',
      year: 'SINCE 1981',
    },
    {
      title: 'Inovação Agrícola',
      text: 'Fundada por Shiro Uemura, a 3LACKD nasceu com a missão de inovar no segmento agrícola, criando equipamentos manuais que otimizavam a lavoura.',
      year: 'NOSSA ORIGEM',
    },
    {
      title: 'Atenção aos Detalhes',
      text: '"Detalhes que fazem a diferença" — Representamos a essência 3LACKD através de precisão e evolução tecnológica constante.',
      year: 'FILOSOFIA',
    },
  ];

  const [activeImg, setActiveImg] = useState(0);
  const [paused, setPaused] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  // Slide da frase (cicla entre as 3 — independente da imagem)
  const [activePhrase, setActivePhrase] = useState(0);

  // Auto-avanco das imagens
  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setActiveImg((p) => (p + 1) % gallery.length), 5000);
    return () => clearInterval(t);
  }, [paused]);

  // Auto-avanco das frases (mais lento)
  useEffect(() => {
    const t = setInterval(() => setActivePhrase((p) => (p + 1) % historySlides.length), 8000);
    return () => clearInterval(t);
  }, []);

  // Parallax / tilt com o mouse
  const handleMouseMove = (e: React.MouseEvent) => {
    const el = stageRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = (e.clientX - r.left) / r.width - 0.5;
    const cy = (e.clientY - r.top) / r.height - 0.5;
    setTilt({ x: cx * 12, y: cy * -12 });
  };

  const resetTilt = () => setTilt({ x: 0, y: 0 });

  const next = () => setActiveImg((p) => (p + 1) % gallery.length);
  const prev = () => setActiveImg((p) => (p - 1 + gallery.length) % gallery.length);

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

  return (
    <div className="relative flex flex-col lg:flex-row h-screen w-full overflow-hidden font-sans bg-gray-50">
      <style>{`
        @keyframes kenburns {
          0%   { transform: scale(1) translate(0%, 0%); }
          50%  { transform: scale(1.04) translate(-0.5%, -0.5%); }
          100% { transform: scale(1) translate(0%, 0%); }
        }
        .kenburns { animation: kenburns 20s ease-in-out infinite; }
        @keyframes float-slow {
          0%,100% { transform: translateY(0); }
          50%     { transform: translateY(-10px); }
        }
        .float-slow { animation: float-slow 6s ease-in-out infinite; }
        @keyframes shimmer {
          0%   { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        .shimmer {
          background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.08) 50%, transparent 100%);
          background-size: 200% 100%;
          animation: shimmer 3s linear infinite;
        }
      `}</style>

      {/* Galeria interativa (esquerda) */}
      <div
        ref={stageRef}
        className="hidden lg:flex lg:w-3/5 relative overflow-hidden bg-black select-none"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => { resetTilt(); setPaused(false); }}
        onMouseEnter={() => setPaused(true)}
        style={{ perspective: '1400px' }}
      >
        {/* Stack de imagens com transicao tipo card */}
        <div
          className="absolute inset-0 transition-transform duration-500 ease-out"
          style={{
            transformStyle: 'preserve-3d',
            transform: `rotateY(${tilt.x}deg) rotateX(${tilt.y}deg)`,
          }}
        >
          {gallery.map((g, i) => {
            const isActive = i === activeImg;
            const delta = i - activeImg;
            const absD = Math.abs(delta);
            return (
              <div
                key={g.src}
                className="absolute inset-0 transition-all duration-[1200ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform"
                style={{
                  opacity: isActive ? 1 : absD === 1 ? 0.15 : 0,
                  transform: `translate3d(${delta * 10}%, 0, ${isActive ? 0 : -400}px) scale(${isActive ? 1 : 0.92})`,
                  filter: isActive ? 'none' : 'blur(8px) brightness(0.6)',
                  pointerEvents: isActive ? 'auto' : 'none',
                  zIndex: isActive ? 2 : 1,
                }}
              >
                {/* Backdrop borrado (mesma imagem, grande e desfocada para preencher) */}
                <img
                  src={g.src}
                  alt=""
                  aria-hidden="true"
                  className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-70"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                />
                {/* Imagem principal em object-contain (nao corta) */}
                <img
                  src={g.src}
                  alt={g.alt}
                  className={`relative w-full h-full object-contain ${isActive ? 'kenburns' : ''}`}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                />
                {/* Vignette / gradient overlay para legibilidade do texto */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/15 to-black/30 pointer-events-none" />
                <div className="absolute inset-0 bg-gradient-to-r from-black/50 via-transparent to-transparent pointer-events-none" />
              </div>
            );
          })}
        </div>

        {/* Fallback se imagens ainda nao foram adicionadas */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#08233F] via-[#1E73C8] to-[#04111F] -z-10" />

        {/* Shimmer overlay sutil */}
        <div className="absolute inset-0 shimmer pointer-events-none" />

        {/* Header: logo */}
        <div className="absolute top-10 left-12 z-20 flex items-center gap-3">
          <img src="/Logo-3LACKD.png" alt="3LACKD" className="h-10 brightness-0 invert" />
          <div className="h-8 w-px bg-white/30" />
          <span className="text-[10px] font-black text-white/70 tracking-[0.4em] uppercase">Portal Corporativo</span>
        </div>

        {/* Texto / frase atual */}
        <div className="absolute inset-0 z-10 flex flex-col justify-end p-14 pb-32 text-white pointer-events-none">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 mb-5 bg-white/15 backdrop-blur-xl px-4 py-1.5 rounded-full border border-white/20 shadow-xl float-slow">
              <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
              <span className="text-[11px] font-black uppercase tracking-[0.3em]">{historySlides[activePhrase].year}</span>
            </div>
            <h1
              key={activePhrase}
              className="text-7xl font-black mb-6 leading-[0.9] tracking-tighter uppercase italic drop-shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-700"
            >
              {historySlides[activePhrase].title.split(' ').map((w, i, arr) => (
                <span key={i} className={i === arr.length - 1 ? 'text-white block' : 'text-white/40 block'}>
                  {w}
                </span>
              ))}
            </h1>
            <div className="h-1 w-20 bg-white mb-5 rounded-full" />
            <p
              key={`p-${activePhrase}`}
              className="text-lg text-white/90 font-medium leading-relaxed max-w-lg drop-shadow-lg animate-in fade-in duration-700"
            >
              {historySlides[activePhrase].text}
            </p>
          </div>
        </div>

        {/* Controles: setas + thumbnails */}
        <div className="absolute bottom-10 left-14 right-14 z-20 flex items-center gap-4">
          <button
            onClick={prev}
            className="h-11 w-11 rounded-full bg-white/10 hover:bg-white/25 border border-white/20 backdrop-blur-md flex items-center justify-center text-white transition-all hover:scale-110"
            aria-label="Imagem anterior"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          <div className="flex gap-2.5 flex-1 overflow-hidden">
            {gallery.map((g, i) => (
              <button
                key={i}
                onClick={() => setActiveImg(i)}
                onMouseEnter={() => setPaused(true)}
                className={`group relative h-14 transition-all duration-500 overflow-hidden rounded-xl border-2 ${
                  activeImg === i
                    ? 'flex-[2] border-white shadow-[0_10px_30px_-10px_rgba(255,255,255,0.5)]'
                    : 'flex-1 border-white/20 hover:border-white/50'
                }`}
                aria-label={`Imagem ${i + 1}`}
              >
                <img
                  src={g.src}
                  alt=""
                  className="w-full h-full object-cover"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                />
                <div
                  className={`absolute inset-0 transition-opacity ${
                    activeImg === i ? 'bg-transparent' : 'bg-black/50 group-hover:bg-black/20'
                  }`}
                />
                {activeImg === i && (
                  <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-white/20">
                    <div
                      key={activeImg}
                      className="h-full bg-red-500"
                      style={{
                        animation: paused ? 'none' : 'progress-bar 5s linear forwards',
                      }}
                    />
                  </div>
                )}
              </button>
            ))}
          </div>

          <button
            onClick={next}
            className="h-11 w-11 rounded-full bg-white/10 hover:bg-white/25 border border-white/20 backdrop-blur-md flex items-center justify-center text-white transition-all hover:scale-110"
            aria-label="Proxima imagem"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        <style>{`
          @keyframes progress-bar {
            from { width: 0%; }
            to { width: 100%; }
          }
        `}</style>

        {/* Rodape sutil */}
        <div className="absolute top-6 right-10 z-20 text-[10px] font-black text-white/60 tracking-[0.3em] uppercase">
          Detalhes que fazem a diferenca
        </div>
      </div>

      {/* Mobile: hero com galeria no topo (h-[42vh]) */}
      <div className="lg:hidden relative w-full h-[42vh] min-h-[260px] overflow-hidden bg-black">
        {gallery.map((g, i) => (
          <div
            key={g.src}
            className="absolute inset-0 transition-opacity duration-[1500ms] ease-in-out"
            style={{ opacity: i === activeImg ? 1 : 0 }}
          >
            <img
              src={g.src}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-70"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            />
            <img
              src={g.src}
              alt={g.alt}
              className={`relative w-full h-full object-contain ${i === activeImg ? 'kenburns' : ''}`}
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            />
          </div>
        ))}
        {/* Fallback */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#08233F] via-[#1E73C8] to-[#04111F] -z-10" />
        {/* Gradiente de fade pra branco (transicao suave pro form) */}
        <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-b from-transparent to-white pointer-events-none" />
        {/* Logo sobreposto */}
        <div className="absolute top-4 left-4 right-4 flex items-center justify-between z-10">
          <img src="/Logo-3LACKD.png" alt="3LACKD" className="h-7 brightness-0 invert drop-shadow-lg" />
          <span className="text-[9px] font-black text-white/80 tracking-[0.3em] uppercase drop-shadow">Portal Corporativo</span>
        </div>
        {/* Indicadores minimalistas */}
        <div className="absolute bottom-6 left-0 right-0 flex justify-center gap-1.5 z-10">
          {gallery.map((_, i) => (
            <button
              key={i}
              onClick={() => setActiveImg(i)}
              className={`h-1 rounded-full transition-all ${activeImg === i ? 'w-6 bg-white' : 'w-1.5 bg-white/50'}`}
              aria-label={`Imagem ${i + 1}`}
            />
          ))}
        </div>
      </div>

      {/* Form de login (direita desktop, abaixo do hero mobile) */}
      <div className="flex-1 w-full lg:w-2/5 flex items-center justify-center bg-white p-6 lg:p-12 relative lg:shadow-[-20px_0_50px_rgba(0,0,0,0.1)] z-10 overflow-y-auto">
        <div className="w-full max-w-md space-y-6 lg:space-y-12">
          <div className="space-y-2 lg:space-y-4">
            <h2 className="text-3xl lg:text-5xl font-black text-slate-900 tracking-tighter uppercase leading-none">
              Acesso <span className="text-[#1E73C8] lg:block">Restrito</span>
            </h2>
            <p className="text-slate-400 text-xs lg:text-sm font-bold tracking-tight">Portal Corporativo de Gestão e Dados 3LACKD.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-8">
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Identificação</label>
                <div className="relative group">
                  <input
                    type="text"
                    required
                    className="appearance-none block w-full px-5 py-5 bg-slate-50 border border-slate-100 rounded-3xl focus:ring-4 focus:ring-red-500/10 focus:bg-white focus:border-[#1E73C8] text-sm text-slate-900 placeholder-slate-300 outline-none transition-all"
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
                  <button type="button" onClick={() => setShowForgot(true)} className="text-[10px] font-black text-[#1E73C8] hover:text-red-700 uppercase tracking-widest transition-colors">
                    Recuperar
                  </button>
                </div>
                <div className="relative group">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    className="appearance-none block w-full px-5 py-5 bg-slate-50 border border-slate-100 rounded-3xl focus:ring-4 focus:ring-red-500/10 focus:bg-white focus:border-[#1E73C8] text-sm text-slate-900 placeholder-slate-300 outline-none transition-all"
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
              className="w-full h-16 flex items-center justify-center border border-transparent text-xs font-black rounded-3xl text-white bg-[#1E73C8] hover:bg-red-700 disabled:bg-slate-100 disabled:text-slate-300 transition-all uppercase tracking-[0.3em] shadow-[0_15px_30px_-10px_rgba(217,35,35,0.4)] active:scale-[0.98]"
            >
              {isLoading ? 'Autenticando...' : 'Entrar no Sistema'}
            </button>
          </form>

          <div className="pt-4 flex justify-center">
            <span className="text-[9px] font-black text-slate-300 uppercase tracking-[0.3em]">Versão 4.1 — Novo Layout</span>
          </div>
        </div>

        {showForgot && (
          <div className="absolute inset-0 bg-white/98 backdrop-blur-xl z-50 flex items-center justify-center p-8 animate-in fade-in duration-300">
            <div className="w-full max-w-md space-y-8 animate-in zoom-in-95 duration-500">
              <div className="flex justify-between items-center mb-4">
                <div className="h-12 w-12 bg-red-50 rounded-2xl flex items-center justify-center">
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
                    className="block w-full px-6 py-5 bg-slate-50 border border-slate-100 rounded-3xl focus:ring-4 focus:ring-red-500/10 focus:bg-white text-sm text-slate-900 outline-none transition-all"
                    placeholder="email@blackd.com.br"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                  />
                </div>
                <button
                  type="submit"
                  disabled={forgotLoading}
                  className="w-full h-16 bg-[#1E73C8] text-white rounded-3xl font-black uppercase text-[11px] tracking-[0.3em] hover:bg-red-700 disabled:bg-slate-100 disabled:text-slate-300 transition-all shadow-xl shadow-red-500/20"
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
