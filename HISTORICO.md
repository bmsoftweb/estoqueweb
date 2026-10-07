# Histórico de versões

Mais recente primeiro. PATCH a cada envio ao GitHub; MAJOR/MINOR só quando pedido.

## 0.0.4 — 2026-10-07

- Consulta de estoque: saiu a coluna Aplicação da grade (a pesquisa por `+aplicação` continua).
- Impressão do pedido: logomarca no lugar do nome da empresa quando `LOGO_URL` estiver no `servidores.config`; linha "Pedido feito por" com o usuário que criou o pedido; nº do DAV lido do `ORCAMENTOM` na hora de imprimir (corrige o pedido web quando o ERP renumerou o DAV).

## 0.0.3 — 2026-10-05

- Teste: Cron da rotina da meia-noite movido para 15:00 UTC (12:00 de Brasília). Voltar para `0 3 * * *` depois do teste.

## 0.0.2 — 2026-10-05

- Login: ao digitar o número do servidor aparece só "On-line" ou "Off-line"; a rota pública `/api/servidores/:numero` não devolve mais o nome do servidor nem o erro técnico.
- Regras de cada empresa (`ID_EMPRESA`, `CONSISTIR_FINANCEIRO`, `DIAS_EM_ATRASO`, `CONSISTIR_BLOQUEIO`, `APRESENTAR_ESTOQUE`, `APRESENTAR_SIMILARES`, `PLANO_PADRAO_AGENDADOR`) ficam só no `config` da tabela `servidores`; saíram do `.env.example` e da Vercel.

## 0.0.1 — 2026-10-05

- Rotina da meia-noite (fechamento dos pedidos abertos e exclusão das pré-reservas, como o `estoqueWeb_backend.exe`) também na Vercel: Cron do `vercel.json` às 03:00 UTC (00:00 de Brasília) em `/api/cron/meia-noite`, autenticado por `CRON_SECRET`.
- `AGENDADOR_SERVIDOR` aceita vários servidores (ex.: `1,3`); a falha de um não impede os outros.
- `PLANO_PADRAO_AGENDADOR` pode ser definido por cliente no `servidores.config`.
- Fechamento automático: pega todo pedido que não está F nem X (status vazio conta como aberto, igual ao Delphi); grava o desconto do plano no DAV igual ao fechamento manual; pedido sem plano recebe o plano padrão antes do recálculo, para o desconto dele entrar.
