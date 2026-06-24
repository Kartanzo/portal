import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../app_api';
import { User as UserIcon, Eye, EyeOff, Mail, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';
import Home3D from './Home3D';

const Login: React.FC<{ onLogin: (user: any) => void }> = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { showToast } = useToast();
  const navigate = useNavigate();

  // Forgot password state
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);

  // History Slides
  const historySlides = [
    {
      title: "Trabalho Constante",
      text: "Ao longo de mais de 40 anos inaugurando um novo Centro de Distribuição e ampliando a capacidade fabril. Hoje somamos mais de 10.000m² de área produtiva.",
      year: "SINCE 1981"
    },
    {
      title: "Inovação Agrícola",
      text: "Fundada por Shiro Uemura, a EMPRESA nasceu com a missão de inovar no segmento agrícola, criando equipamentos manuais que otimizavam a lavoura.",
      year: "NOSSA ORIGEM"
    },
    {
      title: "Atenção aos Detalhes",
      text: "\"Detalhes que fazem a diferença\" — Representamos a essência EMPRESA através de precisão e evolução tecnológica constante.",
      year: "FILOSOFIA"
    }
  ];

  const [currentSlide, setCurrentSlide] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % historySlides.length);
    }, 8000);
    return () => clearInterval(timer);
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

  return (
    <div className="flex h-screen w-full overflow-hidden font-sans bg-gray-50">
      <style>
        {`
          @keyframes falling-particles {
            from { background-position-y: 0; }
            to { background-position-y: 1000px; }
          }
          .animate-falling {
            animation: falling-particles 80s linear infinite;
          }
        `}
      </style>
      {/* 3D Visual Section (Harmonious Red/White Background) */}
      <div className="hidden lg:flex lg:w-3/5 relative overflow-hidden bg-white">
        {/* Modern corporate background mix */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#1E73C8] via-[#1E73C8] to-red-800"
          style={{ clipPath: 'polygon(0 0, 100% 0, 100% 100%, 0 100%)' }} />

        {/* Subtle texture for character */}
        <div className="absolute inset-0 opacity-[0.1] pointer-events-none animate-falling"
          style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'100\' height=\'100\' viewBox=\'0 0 100 100\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M11 18c3.866 0 7-3.134 7-7s-3.134-7-7-7-7 3.134-7 7 3.134 7 7 7zm48 25c3.866 0 7-3.134 7-7s-3.134-7-7-7-7 3.134-7 7 3.134 7 7 7zm-43-7c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zm63 31c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zM34 90c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zm56-76c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2zM12 86c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2zm66-3c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2zm-40-39c.552 0 1-.448 1-1s-.448-1-1-1-1 .448-1 1 .448 1 1 1zm50 38c.552 0 1-.448 1-1s-.448-1-1-1-1 .448-1 1 .448 1 1 1zM75 43c.552 0 1-.448 1-1s-.448-1-1-1-1 .448-1 1 .448 1 1 1zM20 51c.552 0 1-.448 1-1s-.448-1-1-1-1 .448-1 1 .448 1 1 1z\' fill=\'%23ffffff\' fill-opacity=\'1\' fill-rule=\'evenodd\'/%3E%3C/svg%3E")' }} />

        {/* Corporate Header */}
        <div className="absolute top-12 left-12 z-20">
          <img src="/Logo-EMPRESA.png" alt="EMPRESA" className="h-10 brightness-0 invert" />
        </div>

        {/* 3D Centerpiece */}
        <div className="absolute inset-0 z-0 flex items-center justify-center">
          <div className="w-[100%] h-[100%]">
            <Home3D />
          </div>
        </div>

        {/* Text Content Elevated */}
        <div className="relative z-10 flex flex-col justify-center p-16 w-full h-full text-white pointer-events-none bg-gradient-to-r from-black/20 to-transparent">
          <div className="max-w-xl animate-in slide-in-from-left duration-1000 mt-[-10%]">
            <div className="flex items-center gap-2 mb-6 bg-white/20 backdrop-blur-xl px-4 py-1.5 rounded-full w-fit border border-white/30 shadow-xl">
              <span className="text-[11px] font-black uppercase tracking-[0.3em]">{historySlides[currentSlide].year}</span>
            </div>
            <h1 className="text-7xl font-black mb-8 leading-[0.85] tracking-tighter uppercase italic drop-shadow-2xl">
              {historySlides[currentSlide].title.split(' ').map((word, i) => (
                <span key={i} className={i === historySlides[currentSlide].title.split(' ').length - 1 ? "text-white block" : "text-white/30 block"}>
                  {word}
                </span>
              ))}
            </h1>
            <div className="h-1 w-24 bg-white mb-8 rounded-full shadow-lg" />
            <p className="text-xl text-white/90 font-medium leading-relaxed max-w-md drop-shadow-lg">
              {historySlides[currentSlide].text}
            </p>
          </div>

          {/* Navigation Dots */}
          <div className="mt-16 flex gap-3 pointer-events-auto">
            {historySlides.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrentSlide(i)}
                className={`h-2 transition-all duration-500 rounded-full shadow-md ${currentSlide === i ? 'w-12 bg-white' : 'w-3 bg-white/30 hover:bg-white/50'}`}
                aria-label={`Ir para slide ${i + 1}`}
              />
            ))}
          </div>
        </div>

        {/* Bottom Footer Detail */}
        <div className="absolute bottom-12 left-12 right-12 flex justify-between items-center z-10 pointer-events-none">
          <div className="flex items-center gap-4 text-[10px] font-black text-white/40 tracking-[0.4em] uppercase">
            <span>EMPRESA Industrial</span>
            <div className="w-8 h-px bg-white/20" />
            <span>Since 1981</span>
          </div>
          <span className="text-[10px] font-black text-white/40 tracking-[0.2em] uppercase">Detalhes que fazem a diferença</span>
        </div>
      </div>

      {/* Login Form Section (Clean White Side) */}
      <div className="w-full lg:w-2/5 flex items-center justify-center bg-white p-12 relative shadow-[-20px_0_50px_rgba(0,0,0,0.1)] z-10">
        <div className="w-full max-w-md space-y-12">
          <div className="space-y-4">
            <h2 className="text-5xl font-black text-slate-900 tracking-tighter uppercase leading-none">Acesso<br /><span className="text-[#1E73C8]">Restrito</span></h2>
            <p className="text-slate-400 text-sm font-bold tracking-tight">Portal Corporativo de Gestão e Dados EMPRESA.</p>
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
                  <button type="button" onClick={() => setShowForgot(true)} className="text-[10px] font-black text-[#1E73C8] hover:text-red-700 uppercase tracking-widest transition-colors">Recuperar</button>
                </div>
                <div className="relative group">
                  <input
                    type={showPassword ? "text" : "password"}
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
            <span className="text-[9px] font-black text-slate-300 uppercase tracking-[0.3em]">Versão 4.0.1 PRO</span>
          </div>
        </div>

        {/* Improved Forgot Password Modal */}
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
                <h3 className="text-4xl font-black text-slate-900 tracking-tight uppercase">Recuperar<br />Senha</h3>
                <p className="text-sm text-slate-500 font-medium leading-relaxed">Você receberá um link de redefinição no seu email corporativo cadastrado.</p>
              </div>

              <form onSubmit={handleForgotSubmit} className="space-y-8">
                <div className="space-y-2">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">E-mail Cadastrado</label>
                  <input
                    type="email"
                    required
                    className="block w-full px-6 py-5 bg-slate-50 border border-slate-100 rounded-3xl focus:ring-4 focus:ring-red-500/10 focus:bg-white text-sm text-slate-900 outline-none transition-all"
                    placeholder="email@empresa.com.br"
                    value={forgotEmail}
                    onChange={e => setForgotEmail(e.target.value)}
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
