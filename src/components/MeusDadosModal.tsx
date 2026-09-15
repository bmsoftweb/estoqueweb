import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Usuario } from '../types';
import { salvarMeusDados } from '../services/api';
import { INPUT_CLASS, LABEL_CLASS, FIELD_CLASS, HINT_CLASS } from '../utils/formStyles';
import { MensagemErro, Modal, BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from './Modal';

/** Meus dados (frmUsuariosDados): e-mail de acesso, página inicial e troca de senha */
export const MeusDadosModal: React.FC<{
  usuario: Usuario;
  onClose: () => void;
  onSalvo: (usuario: Usuario) => void;
}> = ({ usuario, onClose, onSalvo }) => {
  const [email, setEmail] = useState(usuario.email);
  const [paginaInicial, setPaginaInicial] = useState(usuario.paginaInicial);
  const [senha, setSenha] = useState('');
  const [senhaConfirma, setSenhaConfirma] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (senha && senha !== senhaConfirma) {
      setErro('As senhas não conferem!');
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      const r = await salvarMeusDados({ email, paginaInicial, senha, senhaConfirma });
      onSalvo(r.usuario);
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal titulo="Meus dados" subtitulo={`${usuario.nome} • ${usuario.nivelDescricao}`} onClose={onClose} largura="sm" bloqueado={salvando}>
      <form onSubmit={salvar} className="p-5 space-y-4">
        {erro && <MensagemErro texto={erro} />}
        <div className={FIELD_CLASS}>
          <label className={LABEL_CLASS}>
            E-mail de acesso <span className="text-rose-500">*</span>
          </label>
          <input value={email} required maxLength={80} onChange={(e) => setEmail(e.target.value)} className={`${INPUT_CLASS} w-full`} />
        </div>
        <div className={FIELD_CLASS}>
          <label className={LABEL_CLASS}>Página inicial</label>
          <input
            value={paginaInicial}
            maxLength={80}
            placeholder="https://…"
            onChange={(e) => setPaginaInicial(e.target.value)}
            className={`${INPUT_CLASS} w-full`}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className={FIELD_CLASS}>
            <label className={LABEL_CLASS}>Nova senha</label>
            <input
              type="password"
              value={senha}
              maxLength={15}
              autoComplete="new-password"
              onChange={(e) => setSenha(e.target.value)}
              className={`${INPUT_CLASS} w-full`}
            />
          </div>
          <div className={FIELD_CLASS}>
            <label className={LABEL_CLASS}>Repita a senha</label>
            <input
              type="password"
              value={senhaConfirma}
              maxLength={15}
              autoComplete="new-password"
              required={Boolean(senha)}
              onChange={(e) => setSenhaConfirma(e.target.value)}
              className={`${INPUT_CLASS} w-full`}
            />
          </div>
          <p className={`${HINT_CLASS} col-span-2`}>Deixe a senha em branco para manter a atual.</p>
        </div>
        <div className="flex justify-end gap-2.5">
          <button type="button" onClick={onClose} disabled={salvando} className={BOTAO_SECUNDARIO}>
            Cancelar
          </button>
          <button type="submit" disabled={salvando} className={BOTAO_PRIMARIO}>
            {salvando && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Salvar
          </button>
        </div>
      </form>
    </Modal>
  );
};
