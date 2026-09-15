import React from 'react';
import {
  PackageSearch,
  ClipboardList,
  ShoppingBasket,
  Loader2,
  ArrowRight,
  CheckCircle2,
  XCircle,
  Receipt,
  Lock,
  Unlock,
  Ban,
  ExternalLink,
} from 'lucide-react';
import { DashboardData, DbConnectionStatus, Empresa, Usuario } from '../types';
import { formatCNPJ, formatCurrencyBRL, formatDateBR, formatNumberBR, formatQtd } from '../utils/formatters';
import { BadgeStatus } from './PedidosView';

interface DashboardProps {
  usuario: Usuario;
  empresa: Empresa;
  data: DashboardData | null;
  dbStatus: DbConnectionStatus | null;
  isLoading: boolean;
  error: string | null;
  onNavigate: (tab: string) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ usuario, empresa, data, dbStatus, isLoading, error, onNavigate }) => {
  const podePedidos = usuario.nivel === 'A' || usuario.nivel === 'G';

  if (isLoading && !data) {
    return (
      <div className="flex items-center justify-center py-24 text-stone-500 dark:text-stone-400 gap-2">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm">Carregando indicadores…</span>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 text-sm text-rose-700 dark:text-rose-300">
        {error}
      </div>
    );
  }

  if (!data) return null;

  const porStatus = (s: string) => data.pedidosPorStatus.find((p) => p.status === s) ?? { quantidade: 0, valor: 0 };
  const abertos = porStatus('A');
  const fechados = porStatus('F');
  const cancelados = porStatus('X');

  const kpis = [
    {
      tab: 'estoque',
      label: 'Pré-pedido',
      value: formatNumberBR(data.prePedido.itens),
      detail: `${formatQtd(data.prePedido.qtdade)} unidade(s) reservada(s)`,
      icon: ShoppingBasket,
      color: 'text-amber-600 dark:text-amber-400',
      bg: 'bg-amber-50 dark:bg-amber-950/40',
      border: 'border-amber-200 dark:border-amber-900',
      show: true,
    },
    {
      tab: 'pedidos',
      label: 'Pedidos abertos',
      value: formatNumberBR(abertos.quantidade),
      detail: formatCurrencyBRL(abertos.valor),
      icon: Unlock,
      color: 'text-blue-600 dark:text-blue-400',
      bg: 'bg-blue-50 dark:bg-blue-950/40',
      border: 'border-blue-200 dark:border-blue-900',
      show: podePedidos,
    },
    {
      tab: 'pedidos',
      label: 'Pedidos fechados',
      value: formatNumberBR(fechados.quantidade),
      detail: `${formatNumberBR(data.faturados)} faturado(s) • ${formatCurrencyBRL(fechados.valor)}`,
      icon: Lock,
      color: 'text-emerald-600 dark:text-emerald-400',
      bg: 'bg-emerald-50 dark:bg-emerald-950/40',
      border: 'border-emerald-200 dark:border-emerald-900',
      show: podePedidos,
    },
    {
      tab: 'pedidos',
      label: 'Cancelados no ERP',
      value: formatNumberBR(cancelados.quantidade),
      detail: 'Pedidos com DAV cancelado',
      icon: Ban,
      color: 'text-rose-600 dark:text-rose-400',
      bg: 'bg-rose-50 dark:bg-rose-950/40',
      border: 'border-rose-200 dark:border-rose-900',
      show: podePedidos,
    },
  ].filter((k) => k.show);

  return (
    <div className="space-y-5">
      {/* Identificação */}
      <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-5 shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 mb-1">
              {usuario.idPessoa > 0 ? 'Loja ativa' : 'Central'}
            </div>
            <h2 className="text-lg font-bold text-stone-900 dark:text-stone-100 truncate">
              {usuario.idPessoa > 0 ? `${usuario.idPessoa} - ${usuario.nomePessoa || usuario.nome}` : empresa.nome}
            </h2>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-stone-500 dark:text-stone-400">
              <span>
                {usuario.nome} • {usuario.nivelDescricao}
              </span>
              <span className="text-stone-300 dark:text-stone-700">•</span>
              <span>Lista de preço {usuario.listaPreco}</span>
              <span className="text-stone-300 dark:text-stone-700">•</span>
              <span>
                Distribuidor: {empresa.apelido} <span className="font-mono">{formatCNPJ(empresa.cnpj)}</span>
              </span>
            </div>
          </div>

          <div
            className={`flex items-center gap-2.5 px-3.5 py-2 rounded-xl border text-xs ${
              dbStatus?.connected
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/40 dark:border-emerald-900 dark:text-emerald-300'
                : 'bg-rose-50 border-rose-200 text-rose-800 dark:bg-rose-950/40 dark:border-rose-900 dark:text-rose-300'
            }`}
          >
            {dbStatus?.connected ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
            <div>
              <div className="font-semibold">{dbStatus?.connected ? 'Base DBISAM conectada (bmAPI)' : 'bmAPI indisponível'}</div>
              <div className="text-[10px] opacity-80 font-mono">
                {dbStatus?.connected
                  ? `Servidor ${dbStatus.servidor} • ${dbStatus.identificacao} • ${dbStatus.latencyMs}ms`
                  : dbStatus?.error || 'Verificando…'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Indicadores */}
      <div className={`grid grid-cols-1 sm:grid-cols-2 ${kpis.length > 2 ? 'xl:grid-cols-4' : ''} gap-4`}>
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <button
              key={kpi.label}
              onClick={() => onNavigate(kpi.tab)}
              className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-4 shadow-xs text-left hover:border-blue-300 dark:hover:border-blue-800 hover:shadow-md transition-all cursor-pointer group"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-wide">{kpi.label}</div>
                  <div className="text-2xl font-bold text-stone-900 dark:text-stone-100 mt-1 font-mono">{kpi.value}</div>
                  <div className="text-[11px] text-stone-500 dark:text-stone-400 mt-0.5 truncate">{kpi.detail}</div>
                </div>
                <div className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${kpi.bg} ${kpi.border}`}>
                  <Icon className={`w-5 h-5 ${kpi.color}`} />
                </div>
              </div>
              <div className="mt-3 text-[11px] font-semibold text-blue-600 dark:text-blue-400 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <span>Abrir</span>
                <ArrowRight className="w-3 h-3" />
              </div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Atalhos */}
        <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-5 shadow-xs space-y-3">
          <h3 className="text-sm font-bold text-stone-900 dark:text-stone-100">Atalhos</h3>
          <button
            onClick={() => onNavigate('estoque')}
            className="w-full flex items-center gap-3 p-3 rounded-xl border border-stone-200 dark:border-stone-700 hover:border-blue-300 dark:hover:border-blue-800 hover:bg-blue-50/50 dark:hover:bg-blue-950/20 transition-colors cursor-pointer text-left"
          >
            <PackageSearch className="w-5 h-5 text-blue-600" />
            <div>
              <div className="text-xs font-semibold text-stone-800 dark:text-stone-100">Consultar estoque</div>
              <div className="text-[11px] text-stone-500">Pesquise produtos e monte o pré-pedido</div>
            </div>
          </button>
          {podePedidos && (
            <button
              onClick={() => onNavigate('pedidos')}
              className="w-full flex items-center gap-3 p-3 rounded-xl border border-stone-200 dark:border-stone-700 hover:border-blue-300 dark:hover:border-blue-800 hover:bg-blue-50/50 dark:hover:bg-blue-950/20 transition-colors cursor-pointer text-left"
            >
              <ClipboardList className="w-5 h-5 text-emerald-600" />
              <div>
                <div className="text-xs font-semibold text-stone-800 dark:text-stone-100">Pedidos</div>
                <div className="text-[11px] text-stone-500">Capture o pré-pedido, feche e acompanhe o faturamento</div>
              </div>
            </button>
          )}
          {usuario.paginaInicial && (
            <a
              href={/^https?:\/\//i.test(usuario.paginaInicial) ? usuario.paginaInicial : `https://${usuario.paginaInicial}`}
              target="_blank"
              rel="noreferrer"
              className="w-full flex items-center gap-3 p-3 rounded-xl border border-stone-200 dark:border-stone-700 hover:border-blue-300 dark:hover:border-blue-800 transition-colors text-left"
            >
              <ExternalLink className="w-5 h-5 text-stone-500" />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-stone-800 dark:text-stone-100">Página inicial</div>
                <div className="text-[11px] text-stone-500 truncate">{usuario.paginaInicial}</div>
              </div>
            </a>
          )}
        </div>

        {/* Últimos pedidos */}
        {podePedidos && (
          <div className="xl:col-span-2 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl shadow-xs overflow-hidden">
            <div className="px-5 py-3 border-b border-stone-200 dark:border-stone-800 flex items-center justify-between">
              <h3 className="text-sm font-bold text-stone-900 dark:text-stone-100 flex items-center gap-2">
                <Receipt className="w-4 h-4 text-stone-400" /> Últimos pedidos
              </h3>
              <button onClick={() => onNavigate('pedidos')} className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer">
                Ver todos
              </button>
            </div>
            {data.ultimosPedidos.length === 0 ? (
              <div className="py-10 text-center text-xs text-stone-400">Nenhum pedido lançado ainda.</div>
            ) : (
              <table className="w-full text-xs">
                <tbody>
                  {data.ultimosPedidos.map((p) => (
                    <tr key={p.id} className="border-b border-stone-100 dark:border-stone-800/60 last:border-0">
                      <td className="px-5 py-2 font-mono font-bold text-stone-700 dark:text-stone-200">#{p.id}</td>
                      <td className="px-2 py-2 text-stone-500">{formatDateBR(p.data)}</td>
                      <td className="px-2 py-2 text-stone-700 dark:text-stone-300 truncate max-w-[220px]">
                        {usuario.idPessoa === 0 ? p.clienteNome : p.descricao || '—'}
                      </td>
                      <td className="px-2 py-2">
                        <BadgeStatus status={p.status} faturado={p.faturado} />
                      </td>
                      <td className="px-5 py-2 text-right font-mono font-semibold">{formatCurrencyBRL(p.totalPedido)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
