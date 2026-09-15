import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ConfigPublica, DashboardData, DbConnectionStatus, Empresa, ResourceDef, ServidorInfo, Usuario } from './types';
import {
  setTokenSessao,
  onSessaoExpirada,
  fetchResources,
  fetchDbStatus,
  fetchDashboard,
  fetchConfig,
  fetchPrePedido,
  validarSessao,
} from './services/api';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { LoginView } from './components/LoginView';
import { Dashboard } from './components/Dashboard';
import { CrudView } from './components/CrudView';
import { UsuariosView } from './components/UsuariosView';
import { EstoqueView } from './components/EstoqueView';
import { PedidosView } from './components/PedidosView';
import { MeusDadosModal } from './components/MeusDadosModal';
import { ThemeMode, getInitialTheme, applyTheme } from './utils/theme';
import { lerSessao, salvarSessao, limparSessao, atualizarSessao } from './utils/session';

const TITULOS: Record<string, { titulo: string; subtitulo: string }> = {
  dashboard: { titulo: 'Painel', subtitulo: 'Resumo da loja, pré-pedido e últimos pedidos' },
  estoque: { titulo: 'Estoque', subtitulo: 'Consulta de produtos, disponível e pré-pedido com reserva' },
  pedidos: { titulo: 'Pedidos', subtitulo: 'Pedidos da loja: itens, entrega, fechamento no ERP e faturamento' },
};

export default function App() {
  // ----------------------------------------------------------
  // Tema claro / escuro
  // ----------------------------------------------------------
  const [theme, setTheme] = useState<ThemeMode>(() => getInitialTheme());
  useEffect(() => applyTheme(theme), [theme]);
  const handleToggleTheme = useCallback(() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark')), []);

  // ----------------------------------------------------------
  // Sessão (token assinado pelo servidor, guardado no navegador)
  // ----------------------------------------------------------
  const [sessaoInicial] = useState(() => lerSessao());
  const [token, setToken] = useState<string | null>(sessaoInicial?.token ?? null);
  const [usuario, setUsuario] = useState<Usuario | null>(sessaoInicial?.usuario ?? null);
  const [empresa, setEmpresa] = useState<Empresa | null>(sessaoInicial?.empresa ?? null);
  const [servidor, setServidor] = useState<ServidorInfo | null>(sessaoInicial?.servidor ?? null);
  const [avisoLogin, setAvisoLogin] = useState<string | null>(null);

  // O token precisa estar no cliente HTTP antes da primeira chamada autenticada
  setTokenSessao(token);

  // ----------------------------------------------------------
  // Navegação e estado geral
  // ----------------------------------------------------------
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [resources, setResources] = useState<ResourceDef[]>([]);
  const [config, setConfig] = useState<ConfigPublica | null>(null);
  const [dbStatus, setDbStatus] = useState<DbConnectionStatus | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [isDashboardLoading, setIsDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [prePedidoItens, setPrePedidoItens] = useState(0);
  const [meusDadosAberto, setMeusDadosAberto] = useState(false);
  /** Depois de aberta, a tela de Estoque não é desmontada ao trocar de tela */
  const [estoqueVisitado, setEstoqueVisitado] = useState(false);
  /** Idem para Pedidos: mantém lista, filtros e pedido selecionado */
  const [pedidosVisitado, setPedidosVisitado] = useState(false);

  useEffect(() => {
    if (activeTab === 'estoque') setEstoqueVisitado(true);
    if (activeTab === 'pedidos') setPedidosVisitado(true);
  }, [activeTab]);

  const [refreshToken, setRefreshToken] = useState(0);
  const [createToken, setCreateToken] = useState(0);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage((atual) => (atual === msg ? null : atual)), 5000);
  }, []);

  const handleLogout = useCallback(() => {
    setToken(null);
    setUsuario(null);
    setEmpresa(null);
    setServidor(null);
    setDbStatus(null);
    setResources([]);
    setDashboard(null);
    setActiveTab('dashboard');
    setEstoqueVisitado(false);
    setPedidosVisitado(false);
    setTokenSessao(null);
    limparSessao();
  }, []);

  // 401 em qualquer chamada devolve para o login com o motivo
  useEffect(() => {
    onSessaoExpirada((motivo) => {
      handleLogout();
      setAvisoLogin(motivo);
    });
  }, [handleLogout]);

  // Sessão guardada é conferida ao abrir: nível ou e-mail podem ter mudado
  useEffect(() => {
    if (!token) return;
    let vivo = true;
    validarSessao().then((r) => {
      if (!vivo) return;
      if (r === false) {
        handleLogout();
        setAvisoLogin('Sua sessão expirou. Entre novamente.');
      } else if (r) {
        setUsuario(r.usuario);
        setEmpresa(r.empresa);
        setServidor(r.servidor);
        atualizarSessao({ usuario: r.usuario, empresa: r.empresa, servidor: r.servidor });
      }
    });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const atualizarPrePedido = useCallback(() => {
    fetchPrePedido()
      .then((itens) => setPrePedidoItens(itens.length))
      .catch(() => {});
  }, []);

  // Metadados, configuração e saúde da bmAPI
  useEffect(() => {
    if (!token) return;
    let vivo = true;
    fetchResources()
      .then((r) => vivo && setResources(r))
      .catch(() => {});
    fetchConfig()
      .then((c) => vivo && setConfig(c))
      .catch(() => {});
    fetchDbStatus().then((s) => vivo && setDbStatus(s));
    atualizarPrePedido();
    return () => {
      vivo = false;
    };
  }, [token, usuario?.nivel, atualizarPrePedido]);

  const loadDashboard = useCallback(async () => {
    if (!token) return;
    setIsDashboardLoading(true);
    setDashboardError(null);
    try {
      const data = await fetchDashboard();
      setDashboard(data);
      setPrePedidoItens(data.prePedido.itens);
    } catch (err: any) {
      setDashboardError(err.message || 'Falha ao carregar os indicadores.');
    } finally {
      setIsDashboardLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (activeTab === 'dashboard') {
      loadDashboard();
      fetchDbStatus().then(setDbStatus);
    }
  }, [activeTab, loadDashboard, refreshToken]);

  const activeResource = useMemo(() => resources.find((r) => r.name === activeTab) || null, [resources, activeTab]);

  // ----------------------------------------------------------
  // 1. Tela de login
  // ----------------------------------------------------------
  if (!token || !usuario || !empresa || !servidor) {
    return (
      <LoginView
        avisoInicial={avisoLogin}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        onLoginSuccess={(novoToken, novoUsuario, novaEmpresa, novoServidor, lembrar) => {
          setTokenSessao(novoToken);
          setToken(novoToken);
          setUsuario(novoUsuario);
          setEmpresa(novaEmpresa);
          setServidor(novoServidor);
          setActiveTab('dashboard');
          salvarSessao({ token: novoToken, usuario: novoUsuario, empresa: novaEmpresa, servidor: novoServidor }, lembrar);
          setAvisoLogin(null);
          showToast(`Bem-vindo, ${novoUsuario.nome}!`);
        }}
      />
    );
  }

  // ----------------------------------------------------------
  // 2. Área de trabalho
  // ----------------------------------------------------------
  const podePedidos = usuario.nivel === 'A' || usuario.nivel === 'G';
  const tabValida = activeTab === 'pedidos' && !podePedidos ? 'dashboard' : activeTab;
  const estoqueAtivo = tabValida === 'estoque';
  const pedidosAtivo = tabValida === 'pedidos';
  const titulo = activeResource
    ? { titulo: activeResource.label, subtitulo: activeResource.description }
    : TITULOS[tabValida] ?? TITULOS.dashboard;

  const criarNoHeader =
    activeResource?.canCreate
      ? { acao: () => setCreateToken((t) => t + 1), label: `Novo ${activeResource.labelSingular}` }
      : tabValida === 'pedidos' && usuario.idPessoa > 0
      ? { acao: () => setCreateToken((t) => t + 1), label: 'Novo pedido' }
      : null;

  const trocarTela = (tab: string) => {
    setCreateToken(0);
    setActiveTab(tab);
  };

  return (
    <div className="h-screen overflow-hidden bg-stone-100/70 dark:bg-stone-950 text-stone-900 dark:text-stone-100 flex font-sans antialiased selection:bg-blue-600 selection:text-white">
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-[60] max-w-md bg-stone-900 text-white text-xs font-semibold py-3 px-4 rounded-xl shadow-2xl border border-stone-800 flex items-center gap-2.5">
          <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      <Sidebar
        activeTab={tabValida}
        setActiveTab={trocarTela}
        resources={resources}
        usuario={usuario}
        empresa={empresa}
        prePedidoItens={prePedidoItens}
        onLogout={handleLogout}
        onMeusDados={() => setMeusDadosAberto(true)}
        isOpenMobile={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <Header
          title={titulo.titulo}
          subtitle={titulo.subtitulo}
          empresa={empresa}
          usuario={usuario}
          servidor={servidor}
          dbStatus={dbStatus}
          onOpenMobileSidebar={() => setIsMobileSidebarOpen(true)}
          onRefresh={() => setRefreshToken((t) => t + 1)}
          onCreate={criarNoHeader?.acao}
          createLabel={criarNoHeader?.label}
          theme={theme}
          onToggleTheme={handleToggleTheme}
        />

        {/* O Estoque fica montado (só escondido) depois da primeira visita: ao voltar,
            a última consulta está lá, sem rodar o SQL de novo */}
        {estoqueVisitado && (
          <main className={estoqueAtivo ? 'flex-1 flex flex-col min-h-0 w-full' : 'hidden'}>
            <EstoqueView
              usuario={usuario}
              config={config}
              ativo={estoqueAtivo}
              refreshToken={refreshToken}
              onToast={showToast}
              onPrePedidoAlterado={atualizarPrePedido}
            />
          </main>
        )}

        {pedidosVisitado && podePedidos && (
          <main className={pedidosAtivo ? 'flex-1 flex flex-col min-h-0 w-full' : 'hidden'}>
            <PedidosView
              usuario={usuario}
              ativo={pedidosAtivo}
              refreshToken={refreshToken}
              createToken={createToken}
              onToast={showToast}
              onPrePedidoAlterado={atualizarPrePedido}
            />
          </main>
        )}

        {estoqueAtivo || pedidosAtivo ? null : activeResource ? (
          <main className="flex-1 flex flex-col min-h-0 w-full">
            {activeResource.name === 'usuarios' ? (
              <UsuariosView
                key={activeResource.name}
                resource={activeResource}
                refreshToken={refreshToken}
                createToken={createToken}
                onToast={showToast}
              />
            ) : (
              <CrudView
                key={activeResource.name}
                resource={activeResource}
                refreshToken={refreshToken}
                createToken={createToken}
                onToast={showToast}
              />
            )}
          </main>
        ) : (
          <main className="flex-1 overflow-y-auto min-h-0 w-full">
            <div className="px-4 sm:px-6 lg:px-8 py-6">
              <Dashboard
                usuario={usuario}
                empresa={empresa}
                data={dashboard}
                dbStatus={dbStatus}
                isLoading={isDashboardLoading}
                error={dashboardError}
                onNavigate={trocarTela}
              />
            </div>

            <footer className="bg-white dark:bg-stone-900 border-t border-stone-200 dark:border-stone-800 text-stone-500 text-xs py-4 px-4">
              <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
                <div>
                  <strong>EstoqueWEB</strong> • Consulta de Estoque e Pedidos
                </div>
              </div>
            </footer>
          </main>
        )}
      </div>

      {meusDadosAberto && (
        <MeusDadosModal
          usuario={usuario}
          onClose={() => setMeusDadosAberto(false)}
          onSalvo={(u) => {
            setUsuario(u);
            atualizarSessao({ usuario: u });
            setMeusDadosAberto(false);
            showToast('Seus dados foram atualizados.');
          }}
        />
      )}
    </div>
  );
}
