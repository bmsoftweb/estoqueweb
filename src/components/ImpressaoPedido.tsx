import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, Loader2, X } from 'lucide-react';
import { ImpressaoPedido } from '../types';
import { fetchImpressao } from '../services/api';
import { formatCNPJ, formatDateBR, formatDecimal, formatQtd, STATUS_PEDIDO } from '../utils/formatters';
import { MensagemErro, BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from './Modal';

/**
 * Impressão do pedido (relat\pedido.fr3 do Delphi): folha A4 em HTML, impressa ou
 * salva em PDF pelo próprio navegador. Só a folha aparece na impressão (index.css).
 */
export const ImpressaoPedidoModal: React.FC<{ idPedido: number; onClose: () => void }> = ({ idPedido, onClose }) => {
  const [dados, setDados] = useState<ImpressaoPedido | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    fetchImpressao(idPedido)
      .then(setDados)
      .catch((e) => setErro(e.message));
  }, [idPedido]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-stone-900/80 backdrop-blur-xs impressao-overlay">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-white dark:bg-stone-900 border-b border-stone-200 dark:border-stone-800 nao-imprimir">
        <span className="text-sm font-bold text-stone-800 dark:text-stone-100">Impressão do pedido #{idPedido}</span>
        <div className="flex items-center gap-2">
          <button onClick={() => window.print()} disabled={!dados} className={BOTAO_PRIMARIO}>
            <Printer className="w-3.5 h-3.5" /> Imprimir / salvar PDF
          </button>
          <button onClick={onClose} className={BOTAO_SECUNDARIO}>
            <X className="w-3.5 h-3.5" /> Fechar
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 sm:p-8">
        {erro && <MensagemErro texto={erro} className="max-w-3xl mx-auto nao-imprimir" />}
        {!dados && !erro && (
          <div className="py-24 flex items-center justify-center gap-2 text-stone-200 nao-imprimir">
            <Loader2 className="w-5 h-5 animate-spin" /> Montando a impressão…
          </div>
        )}
        {dados && <FolhaPedido dados={dados} />}
      </div>
    </div>,
    document.body,
  );
};

const FolhaPedido: React.FC<{ dados: ImpressaoPedido }> = ({ dados }) => {
  const { pedido, itens, cliente, empresa, plano, parcelas } = dados;
  const pesoTotal = itens.reduce((s, i) => s + i.pesoBrutoTotal, 0);
  const qtdTotal = itens.reduce((s, i) => s + i.qtdade, 0);

  return (
    <div className="folha-impressao mx-auto bg-white text-stone-900 shadow-2xl w-full max-w-[210mm] min-h-[297mm] p-[12mm] text-[11px] leading-snug font-sans">
      {/* Cabeçalho */}
      <div className="flex items-start justify-between gap-6 border-b-2 border-stone-800 pb-3">
        <div>
          {empresa?.logo ? (
            <img src={empresa.logo} alt={empresa.fantasia || empresa.nome} className="max-h-[22mm] max-w-[70mm] object-contain mb-1" />
          ) : (
            <div className="text-lg font-bold">{empresa?.fantasia || empresa?.nome}</div>
          )}
          <div>{empresa?.nome}</div>
          <div>
            CNPJ {formatCNPJ(empresa?.cnpj || '')}
            {empresa?.ie && ` • IE ${empresa.ie}`}
          </div>
          <div>
            {[empresa?.logradouro, empresa?.numero, empresa?.bairro].filter(Boolean).join(', ')}
            {empresa?.cidade && ` • ${empresa.cidade}/${empresa.uf}`}
          </div>
          <div>{[empresa?.fone, empresa?.email].filter(Boolean).join(' • ')}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xl font-bold">PEDIDO Nº {pedido.id}</div>
          <div>Data: {formatDateBR(pedido.data)}</div>
          <div>Situação: {STATUS_PEDIDO[pedido.status]?.label ?? pedido.status}</div>
          {pedido.numeroPedido && <div>DAV nº {pedido.numeroPedido}</div>}
          {pedido.numeroNf && <div>NF {pedido.numeroNf}</div>}
        </div>
      </div>

      {/* Cliente */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 py-3 border-b border-stone-300">
        <div className="col-span-2">
          <span className="font-semibold">Cliente: </span>
          {cliente?.id} - {cliente?.nome}
        </div>
        {pedido.usuarioNome && (
          <div className="col-span-2">
            <span className="font-semibold">Pedido feito por: </span>
            {pedido.usuarioNome}
          </div>
        )}
        <div>
          <span className="font-semibold">CPF/CNPJ: </span>
          {formatCNPJ(cliente?.cpfcnpj || '')}
        </div>
        <div>
          <span className="font-semibold">Fone: </span>
          {cliente?.fone}
        </div>
        <div className="col-span-2">
          <span className="font-semibold">Endereço: </span>
          {[cliente?.endereco, cliente?.numero, cliente?.bairro].filter(Boolean).join(', ')}
          {cliente?.cidade && ` • ${cliente.cidade}/${cliente.uf}`}
          {cliente?.cep && ` • CEP ${cliente.cep}`}
        </div>
        {pedido.descricao && (
          <div className="col-span-2">
            <span className="font-semibold">Descrição: </span>
            {pedido.descricao}
          </div>
        )}
        {pedido.entregaData && (
          <div className="col-span-2">
            <span className="font-semibold">Entrega: </span>
            {formatDateBR(pedido.entregaData)}
            {pedido.entregaObs && ` • ${pedido.entregaObs}`}
          </div>
        )}
      </div>

      {/* Itens */}
      <table className="w-full mt-3 border-collapse">
        <thead>
          <tr className="border-b border-stone-800 text-left">
            <th className="py-1 pr-2">Código</th>
            <th className="py-1 pr-2">Descrição</th>
            <th className="py-1 pr-2">Marca</th>
            <th className="py-1 pr-2">UN</th>
            <th className="py-1 pr-2 text-right">Qtdade</th>
            <th className="py-1 pr-2 text-right">Unitário</th>
            <th className="py-1 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((i) => (
            <tr key={i.id} className="border-b border-stone-200 align-top">
              <td className="py-1 pr-2 font-mono">{i.idProduto}</td>
              <td className="py-1 pr-2">
                {i.descricao}
                {i.obs && <div className="text-[10px] italic">{i.obs}</div>}
              </td>
              <td className="py-1 pr-2">{i.marca}</td>
              <td className="py-1 pr-2">{i.un}</td>
              <td className="py-1 pr-2 text-right font-mono">{formatQtd(i.qtdade)}</td>
              <td className="py-1 pr-2 text-right font-mono">{formatDecimal(i.precoUnit)}</td>
              <td className="py-1 text-right font-mono">{formatDecimal(i.precoTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totais e parcelas */}
      <div className="flex items-start justify-between gap-6 mt-4">
        <div className="space-y-0.5">
          <div>
            <span className="font-semibold">Itens: </span>
            {itens.length} • <span className="font-semibold">Quantidade: </span>
            {formatQtd(qtdTotal)} • <span className="font-semibold">Peso bruto: </span>
            {formatQtd(pesoTotal)} kg
          </div>
          <div>
            <span className="font-semibold">Plano de pagamento: </span>
            {plano?.descricao ?? '—'}
          </div>
          {parcelas.length > 0 && (
            <table className="mt-1 border-collapse">
              <thead>
                <tr className="border-b border-stone-400 text-left">
                  <th className="pr-4">Parcela</th>
                  <th className="pr-4">Vencimento</th>
                  <th className="text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {parcelas.map((p) => (
                  <tr key={p.seq}>
                    <td className="pr-4">
                      {p.seq}/{parcelas.length}
                    </td>
                    <td className="pr-4">{formatDateBR(p.vencimento)}</td>
                    <td className="text-right font-mono">{formatDecimal(p.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <table className="shrink-0 border-collapse">
          <tbody>
            <tr>
              <td className="pr-4">Total dos produtos</td>
              <td className="text-right font-mono">{formatDecimal(pedido.totalProdutos)}</td>
            </tr>
            <tr>
              <td className="pr-4">Descontos{pedido.percDescontos ? ` (${formatDecimal(pedido.percDescontos)}%)` : ''}</td>
              <td className="text-right font-mono">{formatDecimal(pedido.totalDescontos)}</td>
            </tr>
            <tr className="border-t border-stone-800 text-sm font-bold">
              <td className="pr-4 pt-1">Total do pedido</td>
              <td className="text-right font-mono pt-1">{formatDecimal(pedido.totalPedido)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {pedido.obs && (
        <div className="mt-4 border-t border-stone-300 pt-2 whitespace-pre-line">
          <span className="font-semibold">Observações: </span>
          {pedido.obs}
        </div>
      )}
    </div>
  );
};
