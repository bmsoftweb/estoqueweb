import 'dotenv/config';
import express, { Request, Response } from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { config, configPublica } from './server/config';
import { consultar, consultarUm, verificarBmapi, sqlInteiro } from './server/bmapi';
import { createAuthRouter, exigirSessao, nivelGerente } from './server/auth';
import { createEstoqueRouter } from './server/estoque';
import { createPedidosRouter, iniciarAgendador } from './server/pedidos';
import { createCrudRouter } from './server/crud';

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // ==========================================================
  // 0. Autenticação (login é público; o resto exige sessão)
  // ==========================================================
  app.use('/api', createAuthRouter());

  app.use('/api', exigirSessao);

  // ==========================================================
  // 1. Saúde da bmAPI do servidor da sessão (header e painel)
  // ==========================================================
  app.get('/api/db/status', async (_req: Request, res: Response) => {
    res.json(await verificarBmapi());
  });

  app.get('/api/config', (_req: Request, res: Response) => {
    res.json(configPublica());
  });

  // ==========================================================
  // 2. Painel: indicadores da loja (ou de todas, para a central)
  // ==========================================================
  app.get('/api/dashboard', async (req: Request, res: Response) => {
    try {
      const u = req.usuario!;
      const filtroLoja = u.idPessoa > 0 ? `WHERE ID_EMPRESA = ${sqlInteiro(u.idPessoa)}` : '';

      const preparo = await consultarUm(
        `SELECT COUNT(*) itens, SUM(QTDADE) qtdade FROM WEB_PEDIDOS_PRO_PREPARA WHERE ID_USUARIO = :u AND QTDADE > 0`,
        { u: u.id },
      );

      let pedidosPorStatus: { status: string; quantidade: number; valor: number }[] = [];
      let ultimosPedidos: any[] = [];
      let faturados = 0;

      if (nivelGerente(u)) {
        const porStatus = await consultar(
          `SELECT STATUS status, COUNT(*) quantidade, SUM(TOTAL_PEDIDO) valor FROM WEB_PEDIDOS ${filtroLoja} GROUP BY STATUS`,
        );
        pedidosPorStatus = porStatus.map((r) => ({
          status: String(r.status ?? '').trim() || 'A',
          quantidade: Number(r.quantidade || 0),
          valor: Number(r.valor || 0),
        }));

        const fat = await consultarUm(
          `SELECT COUNT(*) n FROM WEB_PEDIDOS ${filtroLoja ? `${filtroLoja} AND` : 'WHERE'} FATURADO = 'S'`,
        );
        faturados = Number(fat?.n || 0);

        const ultimos = await consultar(
          `SELECT W.ID id, W.DATA data, W.DESCRICAO descricao, W.STATUS status, W.FATURADO faturado,
                  W.TOTAL_PEDIDO total_pedido, W.NUMERO_PEDIDO numero_pedido, P.NOME cliente_nome
             FROM WEB_PEDIDOS W
             LEFT JOIN PESSOAS P ON P.ID = W.ID_EMPRESA
             ${filtroLoja.replace('ID_EMPRESA', 'W.ID_EMPRESA')}
            ORDER BY W.ID DESC TOP 8`,
        );
        ultimosPedidos = ultimos.map((r) => ({
          id: Number(r.id),
          data: r.data,
          descricao: String(r.descricao ?? '').trim(),
          status: String(r.status ?? '').trim(),
          faturado: String(r.faturado ?? '').trim() === 'S',
          totalPedido: Number(r.total_pedido || 0),
          numeroPedido: String(r.numero_pedido ?? '').trim(),
          clienteNome: String(r.cliente_nome ?? '').trim(),
        }));
      }

      res.json({
        prePedido: { itens: Number(preparo?.itens || 0), qtdade: Number(preparo?.qtdade || 0) },
        pedidosPorStatus,
        faturados,
        ultimosPedidos,
      });
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  // ==========================================================
  // 3. Módulos
  // ==========================================================
  app.use('/api', createEstoqueRouter());
  app.use('/api', createPedidosRouter());
  app.use('/api', createCrudRouter());

  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'Rota não encontrada.' });
  });

  // ==========================================================
  // VITE / SPA
  // ==========================================================
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(config.port, '0.0.0.0', () => {
    console.log(`EstoqueWEB rodando em http://0.0.0.0:${config.port}`);
    console.log(`Servidores da bmAPI: MySQL ${config.mysql.host}/${config.mysql.database} • empresa ${config.idEmpresa}`);
    if (!config.sessionSecret) console.warn('ATENÇÃO: SESSION_SECRET não configurado no .env');
  });

  iniciarAgendador();
}

startServer().catch((err) => {
  console.error('Falha crítica ao iniciar o EstoqueWEB:', err);
  process.exit(1);
});
