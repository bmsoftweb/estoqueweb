import 'dotenv/config';
import express, { Request, Response } from 'express';
import { config, configPublica } from './config.js';
import { consultar, consultarUm, verificarBmapi, sqlInteiro } from './bmapi.js';
import { createAuthRouter, exigirSessao, nivelGerente } from './auth.js';
import { createEstoqueRouter } from './estoque.js';
import { createPedidosRouter } from './pedidos.js';
import { createCrudRouter } from './crud.js';

/**
 * Monta o app Express com todas as rotas /api, sem listen e sem Vite:
 *   local     -> server.ts adiciona o Vite e dá listen numa porta
 *   produção  -> api/index.ts exporta este app como função serverless da Vercel
 */
export function createApp() {
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

  return app;
}
