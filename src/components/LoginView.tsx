import React, { useEffect, useState } from 'react';
import { Lock, ArrowRight, Eye, EyeOff, Mail, Server, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { Empresa, ServidorInfo, Usuario } from '../types';
import { ThemeMode } from '../utils/theme';
import { ThemeToggle } from './ThemeToggle';
import { Toggle } from './Toggle';
import { MensagemErro } from './Modal';
import { login, consultarServidor } from '../services/api';
import { INPUT_CLASS_LG, LABEL_CLASS } from '../utils/formStyles';
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

  return (
    <div className="min-h-screen bg-stone-100 dark:bg-stone-950 flex flex-col items-center p-4 sm:p-6 select-none relative">
      {onToggleTheme && (
        <div className="absolute top-4 right-4 z-20">
          <ThemeToggle theme={theme} onToggle={onToggleTheme} variant="login" />
        </div>
      )}

      <div className="w-full max-w-md my-auto">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center h-14 px-6 min-w-20 rounded-2xl bg-blue-700 text-white font-black text-xl tracking-widest shadow-lg shadow-blue-700/20 mb-3 border border-blue-600">
            ESTOQUE
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">EstoqueWEB</h1>
          <p className="text-sm text-stone-600 dark:text-stone-400 mt-1">Consulta de estoque, pré-pedido e pedidos das lojas</p>
        </div>

        <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl shadow-xl p-6 sm:p-8">
          <div className="mb-5">
            <h2 className="text-lg font-bold text-stone-900 dark:text-stone-100">Acesso Restrito</h2>
            <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
              Informe o número do servidor, o e-mail e a senha cadastrados para a sua loja
            </p>
          </div>

          {errorMessage && <MensagemErro texto={errorMessage} className="mb-4" />}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* 1. Servidor */}
            <div>
              <label htmlFor="input-login-servidor" className={`block ${LABEL_CLASS} mb-1.5`}>
                Servidor
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-stone-400">
                  <Server className="w-4 h-4" />
                </div>
                <input
                  id="input-login-servidor"
                  type="text"
                  inputMode="numeric"
                  value={servidor}
                  onChange={(e) => {
                    setServidor(e.target.value.replace(/\D/g, '').slice(0, 3));
                    setErrorMessage(null);
                  }}
                  placeholder="Nº do servidor (1 a 999)"
                  required
                  autoFocus={!servidor}
                  className={`${INPUT_CLASS_LG} w-full font-mono pl-10`}
                />
              </div>
              <div className="min-h-[18px] mt-1 text-[11px]">
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
              <label htmlFor="input-login-email" className={`block ${LABEL_CLASS} mb-1.5`}>
                E-mail
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-stone-400">
                  <Mail className="w-4 h-4" />
                </div>
                <input
                  id="input-login-email"
                  type="text"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setErrorMessage(null);
                  }}
                  placeholder="ex: compras@sualoja.com.br"
                  autoComplete="username"
                  required
                  autoFocus={Boolean(servidor) && !lembrete}
                  className={`${INPUT_CLASS_LG} w-full pl-10`}
                />
              </div>
            </div>

            {/* 3. Senha */}
            <div>
              <label htmlFor="input-login-senha" className={`block ${LABEL_CLASS} mb-1.5`}>
                Senha
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-stone-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  id="input-login-senha"
                  type={showPassword ? 'text' : 'password'}
                  value={senha}
                  onChange={(e) => {
                    setSenha(e.target.value);
                    setErrorMessage(null);
                  }}
                  placeholder="Digite sua senha de acesso"
                  autoComplete="current-password"
                  required
                  autoFocus={Boolean(servidor) && Boolean(lembrete)}
                  className={`${INPUT_CLASS_LG} w-full pl-10 pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 cursor-pointer"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <Toggle
              id="input-login-lembrar"
              checked={lembrar}
              onChange={setLembrar}
              size="sm"
              label="Lembrar neste dispositivo"
              title="Mantém a sessão ao fechar o navegador e preenche o e-mail no próximo acesso. A senha nunca é guardada."
            />

            <button
              id="btn-login-submit"
              type="submit"
              disabled={isLoading}
              className="w-full mt-2 flex items-center justify-center gap-2 bg-blue-700 hover:bg-blue-800 active:bg-blue-900 text-white font-semibold py-3 px-4 rounded-xl text-sm transition-all shadow-md shadow-blue-700/20 disabled:opacity-50 cursor-pointer"
            >
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <span>Entrar</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
