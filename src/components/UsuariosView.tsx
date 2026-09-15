import React, { useEffect, useState } from 'react';
import { CreditCard, Loader2, RotateCcw, Store } from 'lucide-react';
import { PlanoLoja, RegistroCrud, ResourceDef } from '../types';
import { fetchPessoa, fetchPlanosLoja, recalcularReservas, salvarPlanoLoja } from '../services/api';
import { CrudView } from './CrudView';
import { ConfirmDialog, MensagemErro, Modal, BOTAO_SECUNDARIO } from './Modal';
import { Toggle } from './Toggle';
import { formatCNPJ, formatDecimal } from '../utils/formatters';

interface UsuariosViewProps {
  resource: ResourceDef;
  refreshToken: number;
  createToken: number;
  onToast: (msg: string) => void;
}

/** Usuários (frmUsuarios): CRUD genérico + planos liberados por loja + recálculo de reservas */
export const UsuariosView: React.FC<UsuariosViewProps> = ({ resource, refreshToken, createToken, onToast }) => {
  const [planosDe, setPlanosDe] = useState<RegistroCrud | null>(null);
  const [confirmarRecalculo, setConfirmarRecalculo] = useState(false);
  const [recalculando, setRecalculando] = useState(false);
  const [erroRecalculo, setErroRecalculo] = useState<string | null>(null);

  const recalcular = async () => {
    setRecalculando(true);
    setErroRecalculo(null);
    try {
      await recalcularReservas();
      onToast('Reservas recalculadas com sucesso.');
      setConfirmarRecalculo(false);
    } catch (err: any) {
      setErroRecalculo(err.message);
    } finally {
      setRecalculando(false);
    }
  };

  return (
    <>
      <CrudView
        resource={resource}
        refreshToken={refreshToken}
        createToken={createToken}
        onToast={onToast}
        toolbarExtra={
          <button
            onClick={() => {
              setErroRecalculo(null);
              setConfirmarRecalculo(true);
            }}
            title="Refaz a reserva (RESV_DAV) de todos os produtos a partir dos DAVs, pedidos web e pré-pedidos"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-stone-300 text-stone-600 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800 transition-colors cursor-pointer shrink-0 whitespace-nowrap"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Recalcular reservas</span>
          </button>
        }
        extraRowActions={(row) =>
          Number(row.id_pessoa) > 0 ? (
            <button
              onClick={() => setPlanosDe(row)}
              title="Planos de pagamento liberados para a loja"
              className="p-1.5 rounded text-stone-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:text-emerald-400 dark:hover:bg-emerald-950/40 transition-colors cursor-pointer"
            >
              <CreditCard className="w-3.5 h-3.5" />
            </button>
          ) : null
        }
        renderFormExtra={(values) => <ConferenciaLoja idPessoa={Number(values.id_pessoa) || 0} />}
      />

      {planosDe && (
        <PlanosLojaModal
          idPessoa={Number(planosDe.id_pessoa)}
          nome={String(planosDe.nome_pessoa || planosDe.nome_usuario || '')}
          onClose={() => setPlanosDe(null)}
        />
      )}

      {confirmarRecalculo && (
        <ConfirmDialog
          titulo="Recalcular reservas?"
          mensagem="A reserva de todos os produtos será refeita a partir dos DAVs do ERP, dos pedidos web abertos e dos pré-pedidos em digitação. Pode levar alguns segundos."
          textoConfirmar={recalculando ? 'Recalculando…' : 'Recalcular'}
          ocupado={recalculando}
          erro={erroRecalculo}
          onConfirmar={recalcular}
          onCancelar={() => setConfirmarRecalculo(false)}
        />
      )}
    </>
  );
};

/** Mostra o nome da loja do ID_PESSOA digitado, para conferência */
const ConferenciaLoja: React.FC<{ idPessoa: number }> = ({ idPessoa }) => {
  const [pessoa, setPessoa] = useState<Record<string, any> | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setPessoa(null);
    setErro(null);
    if (!idPessoa) return;
    const t = setTimeout(() => {
      fetchPessoa(idPessoa)
        .then(setPessoa)
        .catch((e) => setErro(e.message));
    }, 400);
    return () => clearTimeout(t);
  }, [idPessoa]);

  if (!idPessoa) {
    return (
      <div className="text-[11px] text-stone-500 dark:text-stone-400 flex items-center gap-2">
        <Store className="w-3.5 h-3.5" /> Sem loja vinculada: usuário da central, enxerga os pedidos de todas as lojas e não lança
        pedidos.
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800/50 px-3 py-2">
      <Store className="w-4 h-4 text-blue-500 shrink-0" />
      {erro ? (
        <span className="text-rose-600 dark:text-rose-400">{erro}</span>
      ) : pessoa ? (
        <span className="text-stone-700 dark:text-stone-200">
          <strong>{pessoa.nome}</strong>
          {pessoa.cpfcnpj && <span className="font-mono text-stone-500"> • {formatCNPJ(pessoa.cpfcnpj)}</span>}
          {pessoa.cidade && (
            <span className="text-stone-500">
              {' '}
              • {pessoa.cidade}/{pessoa.uf}
            </span>
          )}
        </span>
      ) : (
        <span className="text-stone-400 flex items-center gap-1.5">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Conferindo a loja…
        </span>
      )}
    </div>
  );
};

/** Planos liberados para a loja (frmUsuariosPlanos) */
const PlanosLojaModal: React.FC<{ idPessoa: number; nome: string; onClose: () => void }> = ({ idPessoa, nome, onClose }) => {
  const [planos, setPlanos] = useState<PlanoLoja[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState<number | null>(null);

  useEffect(() => {
    fetchPlanosLoja(idPessoa)
      .then(setPlanos)
      .catch((e) => setErro(e.message));
  }, [idPessoa]);

  const alternar = async (plano: PlanoLoja, liberado: boolean) => {
    setGravando(plano.id);
    setErro(null);
    try {
      await salvarPlanoLoja(idPessoa, plano.id, liberado);
      setPlanos((prev) => prev?.map((p) => (p.id === plano.id ? { ...p, liberado } : p)) ?? null);
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setGravando(null);
    }
  };

  return (
    <Modal
      titulo="Planos de pagamento liberados"
      subtitulo={`Loja #${idPessoa} • ${nome}`}
      onClose={onClose}
      largura="md"
      rodape={
        <button onClick={onClose} className={BOTAO_SECUNDARIO}>
          Fechar
        </button>
      }
    >
      {erro && <MensagemErro texto={erro} className="m-4" />}
      {!planos && !erro && (
        <div className="py-12 flex items-center justify-center gap-2 text-xs text-stone-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando planos…
        </div>
      )}
      {planos && (
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-stone-50 dark:bg-stone-950">
            <tr className="text-left text-stone-600 dark:text-stone-300">
              <th className="px-4 py-2 font-semibold">Plano</th>
              <th className="px-4 py-2 font-semibold text-right">Parcelas</th>
              <th className="px-4 py-2 font-semibold text-right">Juros %</th>
              <th className="px-4 py-2 font-semibold">Liberado</th>
            </tr>
          </thead>
          <tbody>
            {planos.map((p) => (
              <tr key={p.id} className="border-t border-stone-100 dark:border-stone-800">
                <td className="px-4 py-2 text-stone-800 dark:text-stone-200">
                  {p.descricao}
                  {!p.ativo && <span className="ml-2 text-[10px] text-stone-400">(inativo)</span>}
                </td>
                <td className="px-4 py-2 text-right font-mono">{p.parcelas}</td>
                <td className="px-4 py-2 text-right font-mono">{formatDecimal(p.juros)}</td>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    <Toggle checked={p.liberado} onChange={(v) => alternar(p, v)} disabled={gravando !== null} size="sm" />
                    {gravando === p.id && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
};
