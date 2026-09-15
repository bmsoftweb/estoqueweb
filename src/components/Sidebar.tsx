import React from 'react';
import {
  LayoutDashboard,
  PackageSearch,
  ClipboardList,
  Users,
  History,
  Database,
  LogOut,
  X,
  User,
  UserCog,
  type LucideIcon,
} from 'lucide-react';
import { Empresa, ResourceDef, ResourceGroup, Usuario } from '../types';
import { GROUP_LABELS } from '../utils/formatters';

const ICONS: Record<string, LucideIcon> = { Users, History, Database };
const GROUP_ORDER: ResourceGroup[] = ['acesso', 'auditoria'];

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  resources: ResourceDef[];
  usuario: Usuario;
  empresa: Empresa;
  prePedidoItens: number;
  onLogout: () => void;
  onMeusDados: () => void;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  resources,
  usuario,
  empresa,
  prePedidoItens,
  onLogout,
  onMeusDados,
  isOpenMobile,
  onCloseMobile,
}) => {
  const podePedidos = usuario.nivel === 'A' || usuario.nivel === 'G';

  const handleNavClick = (tabId: string) => {
    setActiveTab(tabId);
    onCloseMobile();
  };

  const renderNavButton = (id: string, label: string, description: string, Icon: LucideIcon, badge?: number) => {
    const isActive = activeTab === id;
    return (
      <button
        key={id}
        id={`sidebar-nav-${id}`}
        onClick={() => handleNavClick(id)}
        className={`w-full flex items-center justify-between px-5 py-2.5 text-left transition-colors cursor-pointer group ${
          isActive
            ? 'bg-blue-100 text-blue-800 font-semibold dark:bg-blue-950 dark:text-blue-200'
            : 'text-stone-600 hover:bg-stone-50 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-white'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <Icon
            className={`w-4 h-4 shrink-0 ${
              isActive
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-stone-400 group-hover:text-blue-600 dark:text-stone-400 dark:group-hover:text-blue-400'
            }`}
          />
          <div className="min-w-0 text-xs leading-none truncate" title={description}>
            {label}
          </div>
        </div>

        {badge !== undefined && badge > 0 && (
          <span
            title="Itens no pré-pedido"
            className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${
              isActive
                ? 'bg-blue-600 text-white'
                : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
            }`}
          >
            {badge > 999 ? '999+' : badge}
          </span>
        )}
      </button>
    );
  };

  const sidebarContent = (
    <div className="flex flex-col h-full bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 border-r border-stone-200 dark:border-stone-800 select-none">
      {/* Marca — mesma altura do header da área de trabalho */}
      <div className="h-[var(--altura-topo)] shrink-0 px-4 border-b border-stone-200 dark:border-stone-800/80 flex items-center justify-between gap-3 bg-stone-50/50 dark:bg-transparent">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 px-3 min-w-11 rounded-xl bg-blue-600 text-white flex items-center justify-center font-black text-[11px] tracking-widest shadow-md shrink-0">
            EST
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-bold text-stone-900 dark:text-white leading-tight truncate">EstoqueWEB</h1>
            <p className="text-[11px] text-stone-500 dark:text-stone-400 truncate">{empresa.apelido}</p>
          </div>
        </div>

        <button
          onClick={onCloseMobile}
          id="btn-close-sidebar-mobile"
          title="Fechar menu lateral"
          className="lg:hidden p-1.5 rounded-lg text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Navegação */}
      <div className="flex-1 overflow-y-auto py-4">
        <div className="px-5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-stone-400">Visão Geral</div>
        {renderNavButton('dashboard', 'Painel', 'Resumo da loja e pedidos', LayoutDashboard)}

        <div className="pt-3">
          <div className="px-5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-stone-400">Operação</div>
          <div>
            {renderNavButton('estoque', 'Estoque', 'Consulta e pré-pedido', PackageSearch, prePedidoItens)}
            {podePedidos && renderNavButton('pedidos', 'Pedidos', 'Pedidos da loja e fechamento', ClipboardList)}
          </div>
        </div>

        {GROUP_ORDER.map((group) => {
          const doGrupo = resources.filter((r) => r.group === group);
          if (!doGrupo.length) return null;
          return (
            <div key={group} className="pt-3">
              <div className="px-5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-stone-400">
                {GROUP_LABELS[group] || group}
              </div>
              <div>
                {doGrupo.map((r) => renderNavButton(r.name, r.label, r.description, ICONS[r.icon] || Database))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Usuário, meus dados & sair */}
      <div className="p-3 border-t border-stone-200 dark:border-stone-800/80 flex items-center justify-between gap-2 bg-stone-50 dark:bg-stone-950/60">
        <button
          onClick={onMeusDados}
          title="Meus dados: e-mail, senha e página inicial"
          className="flex items-center gap-2.5 min-w-0 text-left rounded-lg p-1 -m-1 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer"
        >
          <div className="w-8 h-8 rounded-lg bg-stone-100 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-700 dark:text-stone-300 flex items-center justify-center font-semibold text-xs shrink-0">
            {usuario.nome ? usuario.nome.charAt(0).toUpperCase() : <User className="w-4 h-4" />}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-stone-900 dark:text-white truncate leading-tight flex items-center gap-1">
              {usuario.nome}
              <UserCog className="w-3 h-3 text-stone-400 shrink-0" />
            </div>
            <div className="text-[10px] text-stone-500 dark:text-stone-400 truncate mt-0.5">
              {usuario.nivelDescricao} • Lista {usuario.listaPreco}
            </div>
          </div>
        </button>

        <button
          id="sidebar-btn-logout"
          onClick={onLogout}
          title="Sair do sistema"
          className="p-1.5 rounded-lg text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:text-rose-400 dark:hover:bg-rose-950/50 transition-colors cursor-pointer shrink-0"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:flex flex-col w-64 shrink-0 h-screen sticky top-0 z-30">{sidebarContent}</aside>

      {isOpenMobile && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="fixed inset-0 bg-stone-950/70 backdrop-blur-xs transition-opacity" onClick={onCloseMobile} aria-hidden="true" />
          <div className="relative flex-1 flex flex-col max-w-xs w-full h-full shadow-2xl z-10">{sidebarContent}</div>
        </div>
      )}
    </>
  );
};
