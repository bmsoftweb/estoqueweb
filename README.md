# EstoqueWEB

Conversão do app Delphi/uniGUI `..\EstoqueWEBdelphi` para o mesmo stack e padrão visual do
**b2b admin** (`D:\bmsoftx\b2bweb\admin\code`): Express + Vite + React 19 + Tailwind 4 + lucide.

A diferença central: em vez de MySQL, todo acesso a dados passa pela **bmAPI**
(`D:\bmsoft\BMapi`), que expõe a base **DBISAM** do ERP por HTTP. A API key da bmAPI fica só
no servidor Node; o navegador nunca a recebe.

## Como rodar

1. A bmAPI de cada cliente precisa estar no ar, com a base no `config.ini` e `allowWrite=true`
   (pré-pedido, pedidos e reservas gravam na base).
2. Cada bmAPI é cadastrada no MySQL `bmapi`, tabela `servidores` (`id`, `url`, `port`, `token`,
   `identificacao`). O `token` é a `apiKey` da seção da base no `config.ini` da bmAPI.
3. Copie `.env.example` para `.env` e preencha `MYSQL_*` e `SESSION_SECRET`.

No login o usuário digita o **número do servidor** (o `id` da tabela). A tela mostra a
identificação do servidor enquanto o número é digitado; URL, porta e token ficam só no
servidor Node. O número vai assinado no token de sessão e toda requisição usa a bmAPI dele.

```bash
npm install
npm run dev
```

Sobe em <http://localhost:3003> (3000 = portal B2B, 3001 = admin B2B, 3002 = comprasWeb).

Produção:

```bash
npm run build
npm start
```

## Telas (equivalência com o Delphi)

| EstoqueWEB | Delphi | Quem acessa |
| --- | --- | --- |
| Login (e-mail + senha, registra `WEB_LOG`) | `frmLogin` | todos |
| Painel | aba inicial (`Main`) | todos |
| Estoque: pesquisa, pré-pedido com reserva, similares, reservas por loja, classes | `frmPesquisa`, `frmPesquisaClasses` | todos (preço e pré-pedido: supervisor+) |
| Pedidos: itens, capturar pré-pedido, entrega, fechar (gera DAV), sincronizar status, imprimir | `frmPedidos`, `relat\pedido.fr3` | gerente e administrador |
| Usuários + planos liberados por loja + recalcular reservas | `frmUsuarios`, `frmUsuariosPlanos` | administrador |
| Log de acessos (`WEB_LOG`) | — | administrador |
| Meus dados | `frmUsuariosDados` | todos |
| Rotina da meia-noite (opcional, `AGENDADOR_MEIA_NOITE=S`) | `estoqueWeb_backend.exe` | — |

Níveis (`WEB_USUARIOS.NIVEL`, vale a primeira letra): **A**dministrador, **G**erente,
**S**upervisor, **V**endedor, **C**onsulta. As telas `frmProducao`, `frmSetores`,
`frmCaracPro`, `frmReclass` e `frmConsultaEstoque` não estavam no menu do Delphi e não foram
convertidas.

### Pesquisa de estoque

Prefixos do texto, como no Delphi: `.01.02` (classe), `+SOJA` (aplicação), `*` (produtos no
pré-pedido); um número também busca pelo código. Disponível = `ESTOQUE - RESV_DAV - RESV_EF`.
Digitar a quantidade na coluna **Pedido** grava `WEB_PEDIDOS_PRO_PREPARA` e soma na reserva
(`PRODUTOSREFEMPRESA.RESV_DAV`). Ao abrir a tela as reservas são recalculadas (no máximo uma
vez por minuto).

### Fechamento do pedido

Consistências: limite de crédito (`DPRPRINCIPAL` x `PESSOAS.LIMITECREDITO`), plano de
pagamento e estoque negativo. Grava `ORCAMENTOCONTROL` (numeração) → `ORCAMENTOM` →
`ORCAMENTOP` → `RESERVACARDEX` e marca o pedido web como `F`. Se algo falhar depois do
cabeçalho, o DAV parcial é removido. `ORCAMENTOM.PEDIDO_VENDEDOR` guarda o id do pedido web com
6 dígitos; a sincronização usa esse elo para trazer número do DAV, faturamento (NF) e
cancelamento (pedidos fechados dos últimos 180 dias).

## Arquitetura

```
server.ts              painel, montagem das rotas, Vite/SPA
server/servidores.ts   cadastro dos servidores da bmAPI (MySQL bmapi.servidores)
server/bmapi.ts        cliente da bmAPI (servidor da requisição via AsyncLocalStorage) e literais SQL
server/auth.ts         login, token de sessão assinado (HMAC), níveis, meus dados
server/estoqueComum.ts reserva, preço por lista, recálculo de reservas
server/estoque.ts      pesquisa, pré-pedido, similares, reservas, classes
server/pedidos.ts      pedidos, fechamento no ERP, sincronização, impressão, agendador
server/schema.ts       metadados do CRUD genérico (usuários, log) — mesmo padrão do b2b admin
server/crud.ts         CRUD genérico + planos liberados por loja
src/App.tsx            sessão, navegação e layout
src/components/        Sidebar, Header, LoginView, Dashboard, EstoqueView, PedidosView,
                       CrudView, RecordForm, UsuariosView, ImpressaoPedido, Modal…
src/services/api.ts    cliente HTTP (injeta o token)
```

### Particularidades do DBISAM via bmAPI

- Sem `LIMIT/OFFSET`: usa-se `... ORDER BY ... TOP n` e a página é recortada no Node.
- Campos Memo chegam como `[blob]`; lê-se com `CAST(campo AS VARCHAR(n))`, `n <= 512`.
- Parâmetros `:nome` só valem no primeiro comando de um script e em uma ocorrência cada; em
  scripts os valores entram como literais escapados (`sqlTexto`, `sqlInteiro`…).
- Script que começa com `SELECT` é aberto pela bmAPI e devolve o último `SELECT` — é o truque
  usado para inserir e obter o id no mesmo pedido HTTP.
- Tabelas `MEMORY\` são compartilhadas entre conexões: cada uso gera nome exclusivo.
- Comparação de texto é sensível a maiúsculas: as buscas usam `UPPER()`.

## Senhas

`WEB_USUARIOS.SENHA` continua em texto puro (campo de 15 caracteres), para o Delphi e o
EstoqueWEB poderem usar a mesma base ao mesmo tempo.

## Fotos dos produtos

As fotos ficam em `PROFOTOS.FOTO` (campo Graphic). Como `POST /sql` devolve blobs como
`"[blob]"`, a bmAPI ganhou a rota **`POST /blob`** (`D:\bmsoft\BMapi\uBlobRoutes.pas`): recebe
`{ sql, params }` de um SELECT e responde os bytes do primeiro campo blob da primeira linha,
já sem o cabeçalho de 8 bytes do `TGraphicField` e com o `Content-Type` detectado (JPEG, PNG,
GIF, BMP). Cada servidor precisa estar com o `BMapi.exe` atualizado para as fotos aparecerem.

Na pesquisa de estoque, produtos com foto mostram um ícone de câmera ao lado da descrição; o
clique abre as fotos do produto (setas ou teclado para navegar).

## Deploy na Vercel

- `api/index.ts` exporta o app Express (`server/app.ts`) como função serverless; o `vercel.json` manda todo `/api/*` para ela. O front é o build do Vite (`dist`).
- Variáveis de ambiente (Settings → Environment Variables): `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`, `SESSION_SECRET`.
- Regras de negócio por cliente ficam em `servidores.config` (uma `CHAVE=VALOR` por linha: `ID_EMPRESA`, `CONSISTIR_FINANCEIRO`, `DIAS_EM_ATRASO`, `CONSISTIR_BLOQUEIO`, `APRESENTAR_ESTOQUE`, `APRESENTAR_SIMILARES`, `PLANO_PADRAO_AGENDADOR`). Não são mais cadastradas no `.env` nem na Vercel; chave ausente usa o padrão do código (ver `.env.example`). Alterações valem em até 1 minuto (cache).
- Na tabela `servidores`, a `url` precisa ser pública (IP/domínio acessível da internet); `localhost` só funciona rodando local.
- O MySQL precisa aceitar conexões externas (a Vercel não tem IP fixo).
- A rotina da meia-noite (`AGENDADOR_MEIA_NOITE=S`) roda na Vercel pelo Cron do `vercel.json` (`/api/cron/meia-noite`, 03:00 UTC = 00:00 de Brasília), exigindo `CRON_SECRET` e `AGENDADOR_SERVIDOR` nas variáveis do projeto. Localmente roda pelo timer do `npm run dev`/`npm start`; não ligue nos dois lugares.
