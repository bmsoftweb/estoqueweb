import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { createApp } from './server/app.js';
import { config } from './server/config.js';
import { iniciarAgendador } from './server/pedidos.js';

/** Entrada para execução local. Na Vercel quem serve as rotas é api/index.ts. */
async function startServer() {
  const app = createApp();

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
