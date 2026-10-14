import React, { useEffect, useState } from 'react';
import { Lock, ArrowRight, AlertCircle, Eye, EyeOff, Mail, Server, Loader2, CheckCircle2, XCircle, Package } from 'lucide-react';
import { Empresa, ServidorInfo, Usuario } from '../types';
import { ThemeMode } from '../utils/theme';
import { ThemeToggle } from './ThemeToggle';
import { Toggle } from './Toggle';
import { login, consultarServidor } from '../services/api';
import { INPUT_CLASS_LG } from '../utils/formStyles';
import {
  lerLembrete,
  salvarLembrete,
  limparLembrete,
  lerUltimoServidor,
  salvarUltimoServidor,
} from '../utils/session';

interface LoginViewProps {
  avisoInicial?: string | null;
  theme?: ThemeMode;
  onToggleTheme?: () => void;
  onLoginSuccess: (token: string, usuario: Usuario, empresa: Empresa, servidor: ServidorInfo, lembrar: boolean) => void;
}

type EstadoServidor =
  | { tipo: 'vazio' }
  | { tipo: 'consultando' }
  | { tipo: 'ok'; connected: boolean }
  | { tipo: 'erro'; mensagem: string };

const LABEL = 'block text-[10px] font-bold uppercase tracking-widest ml-1 mb-1.5 text-stone-400 dark:text-stone-500';
const ICONE = 'absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 dark:text-stone-500 pointer-events-none';

/** Login no mesmo modelo do crmWeb: identidade à esquerda, formulário à direita */
export const LoginView: React.FC<LoginViewProps> = ({ avisoInicial, theme = 'light', onToggleTheme, onLoginSuccess }) => {
  const [lembrete] = useState(() => lerLembrete());
  const [servidor, setServidor] = useState(() => lerUltimoServidor());
  const [email, setEmail] = useState(() => lembrete ?? '');
  const [lembrar, setLembrar] = useState(() => Boolean(lembrete));
  const [senha, setSenha] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(avisoInicial ?? null);
  const [estadoServidor, setEstadoServidor] = useState<EstadoServidor>({ tipo: 'vazio' });

  const numeroServidor = Number(servidor);
  const servidorValido = Number.isInteger(numeroServidor) && numeroServidor >= 1 && numeroServidor <= 999;

  // Mostra se o servidor está on-line enquanto o número é digitado
  useEffect(() => {
    if (!servidorValido) {
      setEstadoServidor({ tipo: 'vazio' });
      return;
    }
    let vivo = true;
    setEstadoServidor({ tipo: 'consultando' });
    const t = setTimeout(() => {
      consultarServidor(numeroServidor)
        .then((s) => vivo && setEstadoServidor({ tipo: 'ok', connected: s.connected }))
        .catch((e) => vivo && setEstadoServidor({ tipo: 'erro', mensagem: e.message }));
    }, 400);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [numeroServidor, servidorValido]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const emailLimpo = email.trim();
    if (!servidorValido) {
      setErrorMessage('Informe o número do servidor (1 a 999).');
      return;
    }
    if (!emailLimpo || !senha) {
      setErrorMessage('Informe o e-mail e a senha.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    try {
      const data = await login(numeroServidor, emailLimpo, senha);
      salvarUltimoServidor(numeroServidor);
      if (lembrar) salvarLembrete(emailLimpo);
      else limparLembrete();
      onLoginSuccess(data.token, data.usuario, data.empresa, data.servidor, lembrar);
    } catch (err: any) {
      setErrorMessage(err.message || 'Não foi possível validar o acesso. Tente novamente.');
    } finally {
      setIsLoading(false);
    }
  };

  /** Marca: ícone + nome, usada no painel esquerdo e, no celular, acima do formulário */
  const marca = (
    <div className="flex items-center gap-2.5">
      <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-200/50 dark:shadow-none shrink-0">
        <Package className="w-5 h-5 text-white" />
      </div>
      <span className="text-sm font-black tracking-wider uppercase text-stone-800 dark:text-stone-100">EstoqueWEB</span>
    </div>
  );

  return (
    <div className="min-h-screen flex relative bg-white dark:bg-stone-900 text-stone-900 dark:text-white">
      {/* Painel esquerdo: identidade visual (oculto em telas pequenas) */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden flex-col p-12 bg-white dark:bg-stone-950 isolate">
        {/* Pano de fundo: prateleira com caixas (o estoque) */}
        <div className="absolute inset-0 -z-10 pointer-events-none overflow-hidden">
          <svg
            viewBox="0 0 380 440"
            aria-hidden="true"
            className="absolute top-1/2 right-[6%] -translate-y-1/2 w-[min(440px,70%)] text-blue-200 dark:text-blue-400/25"
          >
            <g fill="currentColor">
              {/* Montantes e prateleiras */}
              <rect x="10" y="10" width="12" height="420" rx="3" opacity=".7" />
              <rect x="358" y="10" width="12" height="420" rx="3" opacity=".7" />
              <rect x="10" y="140" width="360" height="10" rx="3" opacity=".8" />
              <rect x="10" y="280" width="360" height="10" rx="3" opacity=".8" />
              <rect x="10" y="420" width="360" height="10" rx="3" opacity=".8" />
              {/* Caixas */}
              <rect x="40" y="62" width="88" height="78" rx="6" opacity=".55" />
              <rect x="140" y="88" width="64" height="52" rx="6" opacity=".4" />
              <rect x="216" y="50" width="120" height="90" rx="6" opacity=".7" />
              <rect x="40" y="200" width="110" height="80" rx="6" opacity=".75" />
              <rect x="162" y="224" width="70" height="56" rx="6" opacity=".45" />
              <rect x="244" y="190" width="92" height="90" rx="6" opacity=".6" />
              <rect x="40" y="350" width="74" height="70" rx="6" opacity=".5" />
              <rect x="126" y="330" width="120" height="90" rx="6" opacity=".9" />
              <rect x="258" y="364" width="78" height="56" rx="6" opacity=".55" />
            </g>
          </svg>
          <div className="absolute top-[15%] left-[10%] w-[280px] h-[280px] rounded-[40%] rotate-12 blur-3xl bg-blue-100/70 dark:bg-blue-500/10" />
          <div className="absolute bottom-[10%] right-[5%] w-[220px] h-[220px] rounded-[45%] -rotate-12 blur-2xl bg-sky-100/60 dark:bg-sky-500/10" />
        </div>

        {marca}

        <div className="flex-1 flex flex-col justify-center">
          <h1 className="text-6xl font-black leading-[0.95] tracking-tight text-stone-900 dark:text-white">Estoque</h1>
          <p className="mt-4 text-sm font-medium max-w-xs text-stone-500 dark:text-stone-400">
            Consulta de estoque, pré-pedido e pedidos das lojas em um só lugar.
          </p>
        </div>
      </div>

      {/* Painel direito: formulário de login */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 relative bg-stone-50 dark:bg-stone-900">
        {onToggleTheme && (
          <div className="absolute top-6 right-6 z-20">
            <ThemeToggle theme={theme} onToggle={onToggleTheme} variant="login" />
          </div>
        )}

        <div className="w-full max-w-md">
          {/* Marca no celular (o painel esquerdo fica oculto) */}
          <div className="flex lg:hidden mb-8">{marca}</div>

          <h2 className="text-3xl font-black tracking-tight text-stone-900 dark:text-white">Login</h2>
          <p className="text-sm font-medium mt-1.5 text-stone-500 dark:text-stone-400">
            Informe o número do servidor, o e-mail e a senha cadastrados para a sua loja.
          </p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-5 mt-8">
            {errorMessage && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 flex items-start gap-2.5 text-xs font-bold text-rose-700 dark:text-rose-300">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* 1. Servidor */}
            <div>
              <label htmlFor="input-login-servidor" className={LABEL}>
                Servidor
              </label>
              <div className="relative">
                <Server className={ICONE} />
                <input
                  id="input-login-servidor"
                  type="text"
                  inputMode="numeric"
                  value={servidor}
                  onChange={(e) => {
                    setServidor(e.target.value.replace(/\D/g, '').slice(0, 3));
                    setErrorMessage(null);
                  }}
                  onFocus={(e) => e.target.select()}
                  placeholder="Nº do servidor (1 a 999)"
                  required
                  autoFocus={!servidor}
                  className={`${INPUT_CLASS_LG} w-full font-mono pl-11`}
                />
              </div>
              <div className="min-h-[18px] mt-1 ml-1 text-[11px]">
                {estadoServidor.tipo === 'consultando' && (
                  <span className="text-stone-500 inline-flex items-center gap-1.5">
                    <Loader2 className="w-3 h-3 animate-spin" /> Localizando o servidor…
                  </span>
                )}
                {estadoServidor.tipo === 'erro' && (
                  <span className="text-rose-600 dark:text-rose-400 inline-flex items-center gap-1.5">
                    <XCircle className="w-3 h-3" /> {estadoServidor.mensagem}
                  </span>
                )}
                {estadoServidor.tipo === 'ok' && (
                  <span
                    className={`inline-flex items-center gap-1.5 ${
                      estadoServidor.connected ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'
                    }`}
                  >
                    {estadoServidor.connected ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                    <strong>{estadoServidor.connected ? 'On-line' : 'Off-line'}</strong>
                  </span>
                )}
              </div>
            </div>

            {/* 2. E-mail */}
            <div>
              <label htmlFor="input-login-email" className={LABEL}>
                E-mail
              </label>
              <div className="relative">
                <Mail className={ICONE} />
                <input
                  id="input-login-email"
                  type="text"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setErrorMessage(null);
                  }}
                  onFocus={(e) => e.target.select()}
                  placeholder="compras@sualoja.com.br"
                  autoComplete="username"
                  required
                  autoFocus={Boolean(servidor) && !lembrete}
                  className={`${INPUT_CLASS_LG} w-full pl-11`}
                />
              </div>
            </div>

            {/* 3. Senha */}
            <div>
              <label htmlFor="input-login-senha" className={LABEL}>
                Senha
              </label>
              <div className="relative">
                <Lock className={ICONE} />
                <input
                  id="input-login-senha"
                  type={showPassword ? 'text' : 'password'}
                  value={senha}
                  onChange={(e) => {
                    setSenha(e.target.value);
                    setErrorMessage(null);
                  }}
                  onFocus={(e) => e.target.select()}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                  autoFocus={Boolean(servidor) && Boolean(lembrete)}
                  className={`${INPUT_CLASS_LG} w-full pl-11 pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 cursor-pointer"
                  tabIndex={-1}
                  title={showPassword ? 'Esconder a senha' : 'Mostrar a senha'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="py-1">
              <Toggle
                id="input-login-lembrar"
                checked={lembrar}
                onChange={setLembrar}
                size="sm"
                label={<span className="text-xs font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400">Lembrar neste dispositivo</span>}
                title="Mantém a sessão ao fechar o navegador e preenche o e-mail no próximo acesso. A senha nunca é guardada."
              />
            </div>

            <button
              id="btn-login-submit"
              type="submit"
              disabled={isLoading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 rounded-xl shadow-lg shadow-blue-200 dark:shadow-none transition-all flex items-center justify-center gap-2 mt-2 group disabled:opacity-70 cursor-pointer"
            >
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <span className="uppercase tracking-wide">Entrar</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </button>
          </form>

          <div className="flex items-center justify-between mt-8 pt-4 border-t border-stone-200 dark:border-stone-800 text-[10px] font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">
            <span>EstoqueWEB by BMsoft Sistemas</span>
            <span className="normal-case">v{__APP_VERSION__} • © {new Date().getFullYear()}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
