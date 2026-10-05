# Histórico de versões

Mais recente primeiro. PATCH a cada envio ao GitHub; MAJOR/MINOR só quando pedido.

## 0.0.1 — 2026-10-05

- Rotina da meia-noite (fechamento dos pedidos abertos e exclusão das pré-reservas, como o `estoqueWeb_backend.exe`) também na Vercel: Cron do `vercel.json` às 03:00 UTC (00:00 de Brasília) em `/api/cron/meia-noite`, autenticado por `CRON_SECRET`.
- `AGENDADOR_SERVIDOR` aceita vários servidores (ex.: `1,3`); a falha de um não impede os outros.
- `PLANO_PADRAO_AGENDADOR` pode ser definido por cliente no `servidores.config`.
- Fechamento automático: pega todo pedido que não está F nem X (status vazio conta como aberto, igual ao Delphi); grava o desconto do plano no DAV igual ao fechamento manual; pedido sem plano recebe o plano padrão antes do recálculo, para o desconto dele entrar.
