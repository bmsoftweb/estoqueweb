import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, ShieldAlert, AlertCircle, Loader2 } from 'lucide-react';

interface ModalProps {
  titulo: React.ReactNode;
  subtitulo?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  rodape?: React.ReactNode;
  largura?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  /** Impede fechar pelo fundo e pelo Esc (ex.: gravação em andamento) */
  bloqueado?: boolean;
}

const LARGURAS: Record<string, string> = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-3xl',
  xl: 'max-w-5xl',
  full: 'max-w-[calc(100vw-2rem)]',
};

/** Janela modal no padrão visual do painel */
export const Modal: React.FC<ModalProps> = ({
  titulo,
  subtitulo,
  onClose,
  children,
  rodape,
  largura = 'md',
  bloqueado,
}) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !bloqueado) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, bloqueado]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-stone-950/70 backdrop-blur-xs"
        onClick={bloqueado ? undefined : onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        className={`relative w-full ${LARGURAS[largura]} max-h-[calc(100vh-2rem)] flex flex-col bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl shadow-2xl z-10`}
      >
        <div className="px-5 py-3.5 border-b border-stone-200 dark:border-stone-800 flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-stone-900 dark:text-stone-100 truncate">{titulo}</h3>
            {subtitulo && <p className="text-[11px] text-stone-500 dark:text-stone-400 mt-0.5 truncate">{subtitulo}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={bloqueado}
            title="Fechar"
            className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer disabled:opacity-40 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-auto min-h-0">{children}</div>
        {rodape && (
          <div className="px-5 py-3 border-t border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950/40 flex items-center justify-end gap-2.5 shrink-0 rounded-b-2xl">
            {rodape}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};

interface ConfirmDialogProps {
  titulo: string;
  mensagem: React.ReactNode;
  textoConfirmar: string;
  perigo?: boolean;
  ocupado?: boolean;
  erro?: string | null;
  onConfirmar: () => void;
  onCancelar: () => void;
}

/** Confirmação de ação (Confirma() do Delphi) */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  titulo,
  mensagem,
  textoConfirmar,
  perigo,
  ocupado,
  erro,
  onConfirmar,
  onCancelar,
}) => (
  <Modal
    titulo={titulo}
    onClose={onCancelar}
    largura="sm"
    bloqueado={ocupado}
    rodape={
      <>
        <button type="button" onClick={onCancelar} disabled={ocupado} className={BOTAO_SECUNDARIO}>
          Cancelar
        </button>
        <button
          type="button"
          onClick={onConfirmar}
          disabled={ocupado}
          className={perigo ? BOTAO_PERIGO : BOTAO_PRIMARIO}
        >
          {ocupado && <Loader2 className="w-4 h-4 animate-spin" />}
          <span>{textoConfirmar}</span>
        </button>
      </>
    }
  >
    <div className="p-5">
      <div className="flex items-start gap-3">
        <div
          className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${
            perigo
              ? 'bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-900'
              : 'bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-900'
          }`}
        >
          <ShieldAlert className={`w-5 h-5 ${perigo ? 'text-rose-600' : 'text-blue-600'}`} />
        </div>
        <div className="text-xs text-stone-600 dark:text-stone-300 leading-relaxed">{mensagem}</div>
      </div>
      {erro && <MensagemErro texto={erro} className="mt-4" />}
    </div>
  </Modal>
);

export const MensagemErro: React.FC<{ texto: string; className?: string }> = ({ texto, className = '' }) => (
  <div
    className={`p-3 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 flex items-start gap-2.5 text-xs text-rose-700 dark:text-rose-300 ${className}`}
  >
    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
    <span className="whitespace-pre-line">{texto}</span>
  </div>
);

export const BOTAO_PRIMARIO =
  'inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white shadow-xs transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap';

export const BOTAO_SECUNDARIO =
  'inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-stone-600 dark:text-stone-300 border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap';

export const BOTAO_PERIGO =
  'inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white shadow-xs transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap';

export const BOTAO_SUCESSO =
  'inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white shadow-xs transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap';
