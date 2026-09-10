# Spec: boas-vindas — guia de primeira entrada

> Status: **implementada, na `develop` dos dois repos** (2026-09-10) — falta o `db push` +
> backfill de produção (execução humana, `prisma/db-scripts/2026-09-10-boas-vindas.sql`), o teste
> manual na tela pelos dois métodos, e a promoção pra `main`.
> Plano/Checklist: **nenhum** — mudança pequena, foi direto ao código (decisão do humano, 2026-09-10).
> Frontend pareado: `oratio/docs/specs/boas-vindas.md` (ponteiro) — **o grosso desta feature é frontend**

> **Desvio de conteúdo (2026-09-10, decisão do humano no prompt de implementação):** os títulos e
> textos das 3 páginas foram substituídos pelos da seção "Conteúdo do guia" abaixo (versão
> final, mais curta). Os ícones passaram a `Sunrise` / `Cross` / `BookOpen`. A estrutura (3
> páginas, sem pular, progresso, `Começar` na última) e todo o resto da spec valem como escrito.

## Objetivo

Mostrar, **uma única vez** e **na primeira entrada** de qualquer conta (cadastro por senha ou
por Google), um guia curto de boas-vindas que apresenta o que o Oratio oferece — e nunca mais
depois disso.

## Stack

Quase tudo é frontend (React/Vite PWA — `oratio`). O backend entra com o **mínimo** para que o
"mostrar uma vez só" seja resolvido do lado do servidor, **seguindo um precedente que já existe
no schema**:

- **Campo novo em `User`: `welcomeSeenAt DateTime?`** — idêntico em forma e propósito a
  `User.voxOnboardingSeenAt` (`prisma/schema.prisma:55`), que já resolve exatamente este
  problema ("mostrar introdução uma vez") para o onboarding do Vox. Aditivo, nullable, sem
  default.
- **`GET /users/me` passa a devolver `showWelcome: boolean`** (= `welcomeSeenAt == null`) — o
  mesmo desenho de `showVoxIntro` em `VoxAiService.getBootstrap` (`voxai.service.ts:232`).
- **Rota nova `POST /users/me/welcome-seen`** — espelha `POST oratio/voxai/profile/intro-seen`
  (`voxai.controller.ts:88` → `markIntroSeen`): sem corpo, idempotente, carimba a data.

Resto: padrão da casa (`docs/ARCHITECTURE.md` §1; testes com `PrismaService` mockado).

### Por que backend, e não `localStorage` (opção descartada)

Uma flag local (`localStorage`) parece mais barata, mas quebra **neste app específico**:

1. **O cleanup de versão do `App.tsx` varreria a flag a cada release.** `App.tsx` (por volta da
   L79–105) compara `APP_VERSION` (hoje `"v10"`) com o valor salvo e, quando muda, remove de
   `localStorage` **toda** chave que contém `"oratio"`, `"stage_"` ou `"consecration"`. Uma flag
   de boas-vindas seria apagada em **todo deploy que bump o `APP_VERSION`** → o guia voltaria
   para a base inteira, **todos ao mesmo tempo**.
2. **Escapar disso custa duas decisões, e a flag continua ruim.** Seria preciso uma exceção
   `startsWith` no cleanup do `App.tsx` **e** uma entrada em `KEEP_ON_LOGOUT` (`api.ts:84`) — e,
   mesmo assim, a flag continuaria **por aparelho**: novo celular, outro navegador, ou "limpar
   dados" → guia de novo.
3. **PWA no iOS descarta armazenamento local por inatividade** — e é onde boa parte dos usuários
   do Oratio está.
4. **"Ver o guia de novo" não é falha cosmética.** É o app **parecendo quebrado** para quem já
   usa, e acontece com todo mundo de uma vez num release.

E **criaria dois padrões** para a mesma coisa: `voxOnboardingSeenAt` já faz "mostrar uma vez" do
lado do servidor. Seguir a precedência.

### Por que um campo novo, e não inferir no login (opção descartada)

Inferir "primeira entrada" no backend sem campo novo (ex.: "não há `UserActivity` de `LOGIN`
anterior") é **retroativo**: **todo usuário que já existe** — que nunca teve como registrar
"guia visto" — cairia no guia no próximo login. O campo nullable começa `null` para todos, mas a
migração pode (e vai — ver "Modelo de dados") **backfillar `welcomeSeenAt = now()` para contas
já existentes**, de modo que só contas **criadas depois** vejam o guia.

## Comportamento esperado

### Gatilho

- O app shell já busca `GET /users/me` ao carregar autenticado. Quando a resposta traz
  `showWelcome: true` **e** a rota atual não é de auth nem o próprio guia, o shell **redireciona
  para `/oratio/boas-vindas`** (rota dedicada, tela cheia, **sem** a bottom nav do app).
- Vale para **qualquer** método de primeira entrada — senha (após verificar o e-mail e logar) e
  Google (`isNewUser` da spec `login-google` E2 pode levar direto ao guia sem esperar o
  `/users/me`, mas a **visibilidade e a unicidade** são governadas por `showWelcome`, não por
  `isNewUser`).
- **Visitante sem conta** ("Continuar sem conta") nunca vê o guia — não há `showWelcome`. Cai na
  Home direto.
- **Sem token**: o shell não busca `/users/me`; o guia não aparece.

### O guia

- **No máximo 3 páginas.** Cada uma legível em ~5 segundos. Quem acabou de se cadastrar pode ter
  aberto o app num momento de necessidade — 3 páginas curtas não prendem; 6 prendem, e a reação
  a um guia longo é fechar o app.
- **Sem pular.** Navegação só para a frente ("Continuar"); a última página tem "Começar". A
  pessoa só sai do guia ao concluí-lo.
- **Indicador de progresso visível** (pontinhos ou "1 de 3") — sem um botão de saída, a pessoa
  precisa **ver que aquilo acaba**.
- **Sem ilustrações novas.** Ícones grandes de `lucide-react` (que o app já usa em todo lugar) no
  **vermelho da marca**, com a **tipografia serifada do Oratio**. Nada de asset gerado por IA —
  quase sempre destoa da identidade.
- A implementação **aplica a skill `frontend-ui-engineering`** (bonito, temático, acessível — não
  template genérico).

### Conclusão e persistência

- `welcomeSeenAt` só é carimbado **ao concluir a última página** (tap em "Começar") →
  `POST /users/me/welcome-seen`. Aí o guia nunca mais aparece.
- **Se a pessoa fechar o app no meio**, `welcomeSeenAt` continua `null` → **o guia recomeça da
  página 1 no próximo login**. É o comportamento **correto** para um guia sem pular — mas precisa
  estar escrito aqui para ninguém tratar como bug depois.
- "Começar" navega para `/oratio/home`. **Nenhuma outra ação é pedida** (ver "Fora de escopo"
  para por que não pedir permissão de notificação nem sugerir um primeiro passo).

### Erros / rede

- `POST /users/me/welcome-seen` falha (rede): o frontend **navega para a Home mesmo assim** e
  tenta de novo na próxima vez que `showWelcome` vier `true`. Pior caso: o guia aparece mais uma
  vez. Não bloquear a entrada por causa disso.

### Timezone

Sem fronteira de dia. `welcomeSeenAt` é `DateTime` (instante UTC), só comparado a `null`.

## Requisitos de saída

### `GET /users/me` (alteração)

- `UsersService.getProfile` (`users.service.ts:101`) já seleciona `password`; passa a
  selecionar também `welcomeSeenAt` e a retornar **`showWelcome: user.welcomeSeenAt == null`**.
- O hash de senha continua **nunca** aparecendo no corpo (garantido pela lista branca atual).
- Resto do shape inalterado.

### `POST /users/me/welcome-seen` (rota nova)

- **Método/path:** `POST /users/me/welcome-seen`
- **Guards:** `JwtAuthGuard` (mesma pilha do `GET /users/me`). Sem `ThrottlerGuard` dedicado —
  é uma chamada única por conta; segue `POST oratio/voxai/profile/intro-seen`, que também não
  tem throttle próprio.
- **Headers:** `Content-Type: application/json`. `X-App` **não** exigido (o `intro-seen` do Vox
  não exige).
- **Request:** sem corpo.
- **`userId`:** de `req.user.userId`, **nunca** do corpo (`RULES.md` §5).
- **`UsersService.markWelcomeSeen(userId)`:** `user.update({ where: { id, welcomeSeenAt: null },
  data: { welcomeSeenAt: new Date() } })` **ou** um `findUnique` + `if (!user.welcomeSeenAt)` antes
  do update — **idempotente**: chamar de novo numa conta que já tem a data **não altera** o
  timestamp.
- **Response 200:** `{ "ok": true }` (mesmo shape de `markIntroSeen`).
- **Erros:** 401 (sem token / token inválido — `JwtAuthGuard`).

### Frontend (contrato consumido — detalhe em `oratio/docs/specs/boas-vindas.md`)

- Rota `/oratio/boas-vindas` — tela cheia, **fora** do layout com bottom nav.
- Componente `WelcomeGuide` — até 3 páginas, indicador de progresso, sem "pular".
- `welcomeService.markWelcomeSeen()` → `POST /users/me/welcome-seen`.
- Shell: ao carregar autenticado com `showWelcome === true` e fora de rota de auth/guia →
  `navigate("/oratio/boas-vindas")`.

## Modelo de dados

### Nome do campo — **decidido**

`welcomeSeenAt` (fica ao lado de `voxOnboardingSeenAt`; a simetria se lê sozinha).

### O que é aditivo e o que **não é** — leia com atenção

```prisma
model User {
  // ...
  // Carimbado quando a pessoa CONCLUI o guia de boas-vindas (última página).
  // O guia só aparece enquanto isto é null. Paralelo a voxOnboardingSeenAt,
  // que faz o mesmo para o onboarding do Vox.
  welcomeSeenAt DateTime?
}
```

Tem **duas mudanças**, e elas são de natureza diferente:

1. **`ALTER TABLE "User" ADD COLUMN "welcomeSeenAt" TIMESTAMP(3);`** — **aditivo**,
   não-destrutivo, não-bloqueante (coluna nova nullable, sem default).
2. **`UPDATE "User" SET "welcomeSeenAt" = now() WHERE "welcomeSeenAt" IS NULL;`** — o backfill.
   **Isto escreve em TODA linha da tabela `User`.** Não é "aditivo" no sentido do item 1 — é uma
   escrita de dados em massa. Precisa de tratamento à parte no script.

> **Premissa corrigida (2026-09-09):** versões anteriores desta spec diziam que o `db push`
> pegaria carona no do `login-google`. **Não pega** — o `db push` de produção do login-google já
> foi rodado nesta sessão (`LinkedAccount` + `password` nullable já em produção no Supabase).
> A coluna `welcomeSeenAt` **precisa do próprio push**: ela não existe no schema de produção, e
> o `GET /users/me`/`markWelcomeSeen` dão 500 sem ela.

**Por que o backfill:** sem ele, o guia apareceria **retroativamente para toda a base** no
próximo login de cada um. Com `welcomeSeenAt = now()` em quem já existe, o guia aparece **só
para contas criadas depois** do deploy.

### Requisitos do script `/db-change` (`prisma/db-scripts/2026-09-09-boas-vindas.sql`)

O `.sql` para revisão humana precisa ter, **em passos numerados e separados**:

- **Passo 0 — contagem antes:** `SELECT count(*) FROM "User";` — para o humano saber quantas
  linhas o Passo 2 deve afetar.
- **Passo 1 — `ALTER TABLE ... ADD COLUMN`** (sozinho, não misturado com o UPDATE).
- **Passo 2 — o `UPDATE` do backfill** (sozinho), seguido de um `SELECT count(*) FROM "User"
  WHERE "welcomeSeenAt" IS NOT NULL;` para confirmar que bateu a contagem do Passo 0.
- **Rollback:** documentado assim —
  - **A coluna:** rollback **livre** — `ALTER TABLE "User" DROP COLUMN "welcomeSeenAt";`.
    Ninguém perde a conta.
  - **O backfill:** **não tem volta útil.** Depois de aplicado, **não dá para distinguir** quem
    foi backfillado (conta antiga) de quem concluiu o guia de verdade — os dois têm
    `welcomeSeenAt` preenchido. Se precisar reverter o *comportamento*, a única saída é
    `DROP COLUMN` (item acima) e recomeçar; não há como "des-backfillar" seletivamente.

### `db push` — **próprio desta feature**

- **Schema (Passo 1):** quando `docs/spec-boas-vindas` chegar na `develop`, `schema.prisma`
  ganha `welcomeSeenAt`, e é preciso **um `npx prisma db push` de produção só para isso** — o do
  login-google já foi (2026-09-09) e não sincroniza o que ainda não estava no schema naquele
  momento. `push` é aditivo aqui (coluna nova nullable), então não é destrutivo, mas **tem que
  acontecer** antes de o backend novo subir.
- **Backfill (Passo 2):** o `prisma db push` **não** roda o `UPDATE` — só sincroniza estrutura.
  O backfill é um passo SQL manual, do mesmo `.sql`, **imediatamente depois** do push, na mesma
  janela. Sem o backfill, a base inteira vê o guia no próximo login.
- Registrado em `docs/specs/INDEX.md` → "Pendências de execução humana".

## Critérios de aceite (testáveis, em BDD)

> **Escopo de teste automatizado reduzido a pedido do humano (prompt de implementação
> 2026-09-10): apenas DOIS testes**, os dois no `WelcomeGate` do frontend — (1) redireciona
> com `showWelcome: true`; (2) não redireciona depois (`showWelcome: false`). Os demais
> critérios abaixo estão implementados no código e cobertos por contrato / teste manual, **não**
> por teste automatizado dedicado. A suíte inteira dos dois repos segue verde.

### Backend

- [x] **Dado** um `User` com `welcomeSeenAt: null`, **quando** `GET /users/me`, **então** o corpo
  traz `showWelcome: true` — *implementado (`user.welcomeSeenAt == null`); contrato.*
- [x] **Dado** um `User` com `welcomeSeenAt` preenchido, **quando** `GET /users/me`, **então**
  `showWelcome: false`; e o corpo **não** tem `password` (lista branca atual garante) —
  *implementado; os testes de `getProfile` já provam `not.toHaveProperty('password')`.*
- [x] **Dado** nenhuma credencial, **quando** `GET /users/me`, **então** 401 — *inalterado
  (`JwtAuthGuard`), coberto pelo teste existente.*
- [x] **Dado** nenhuma credencial, **quando** `POST /users/me/welcome-seen`, **então** 401 —
  *rota sob `JwtAuthGuard` (mesma pilha do `GET /users/me`); contrato.*
- [x] **Dado** um `User` autenticado com `welcomeSeenAt: null`, **quando**
  `POST /users/me/welcome-seen`, **então** 200 `{ ok: true }` e `user.update` com
  `data: { welcomeSeenAt: <Date> }` — *implementado em `markWelcomeSeen`; contrato/manual.*
- [x] **Dado** um `User` autenticado que **já** tem `welcomeSeenAt`, **quando**
  `POST /users/me/welcome-seen` de novo, **então** 200 e o timestamp **não muda** — *implementado
  com a guarda `if (user && !user.welcomeSeenAt)` antes do `update`; contrato/manual.*
- [x] **Dado** um token de **outro** usuário, **quando** `POST /users/me/welcome-seen`, **então**
  só o `welcomeSeenAt` do usuário do token é afetado — *`userId` vem de `req.user.userId`,
  nunca do corpo (`users.controller.ts`).*

### Frontend

- [x] **Dado** `GET /users/me` responde `showWelcome: true`, **quando** o app carrega
  autenticado, **então** a rota `/oratio/boas-vindas` é renderizada — **teste automatizado**
  (`WelcomeGate.test.tsx`). A bottom nav não aparece porque a página não a renderiza (não há
  layout compartilhado).
- [x] **Dado** `GET /users/me` responde `showWelcome: false`, **quando** o app carrega,
  **então** **nenhum** redirect — **teste automatizado** (`WelcomeGate.test.tsx`).
- [x] **Dado** o guia aberto, **então** há um indicador de progresso (pontinhos + `aria-label`
  "Página X de 3") e **nenhum** controle de "pular" — *implementado; manual.*
- [x] **Dado** a última página, **quando** toca "Começar", **então** `markWelcomeSeen()` é
  chamado e a navegação vai para `/oratio/home` — *implementado; manual.*
- [x] **Dado** o guia fechado na página 2 e um novo login (`showWelcome` ainda `true`), **então**
  reabre na página 1 — *`WelcomeGuide` começa sempre em `index = 0`, e `welcomeSeenAt` só é
  carimbado no "Começar"; manual.*
- [x] **Dado** `POST /users/me/welcome-seen` erro de rede, **quando** toca "Começar", **então** a
  navegação para a Home acontece mesmo assim — *`try/catch` em volta do `markWelcomeSeen`,
  `navigate` fora do `try`; manual.*

## Plano de testes

- **Unitário (Jest — backend):**
  - `users.service.spec.ts`: `getProfile` devolve `showWelcome` nos dois estados e nunca
    `password`; `markWelcomeSeen` carimba quando `null` e é idempotente quando já preenchido.
  - `users.controller.spec.ts`: `POST /users/me/welcome-seen` sem token → 401; `userId` vem do
    `req.user`.
- **Unitário (Vitest — frontend):** `WelcomeGuide.test.tsx` (3 páginas, progresso, sem pular,
  "Começar" → `markWelcomeSeen` + navegação); teste do redirect do shell por `showWelcome`;
  `welcomeService` com `./api` mockado.
- **Contrato (`curl` contra `localhost:3000`):** login numa conta de teste →
  `GET /users/me` mostra `showWelcome: true` → `POST /users/me/welcome-seen` → `GET /users/me`
  agora mostra `false` → `POST` de novo → segue `false`, timestamp intacto.
- **Manual (humano):** primeira entrada real no navegador pelos **dois** métodos (senha e
  Google); confirmar que fechar o app na página 2 reabre o guia na página 1; confirmar que uma
  conta antiga (pós-backfill) **não** vê o guia.

Loop de verificação por tarefa:
`npm test -- <pattern>` → `npm test` → `npm run build` → `npm run lint` → commit.

## Fora de escopo

- **Re-exibir o guia** ("ver a introdução de novo" num menu). Uma vez, nunca mais.
- **Versionar o guia por release.** Se o conteúdo do guia mudar no futuro, quem já concluiu
  **não** vê de novo — decisão consciente (o guia é boas-vindas, não changelog; o app já tem o
  card de novidade do Vox para "o que mudou").
- **Pedir permissão de notificação no guia.** Permissão no navegador é **tiro único**: negou, só
  volta se a pessoa mexer nas configurações do navegador. Quem acabou de chegar e ainda não
  entendeu o app nega por reflexo, e o recurso queima no pior momento. O Oratio **já tem** o
  `NotificationNudge`, que pede isso **depois**, quando a pessoa já viu valor — pedir aqui
  atropelaria o mecanismo que existe para fazer isso melhor.
- **CTA de "primeiro passo" no fim do guia.** A Home **já é** o primeiro passo — abre com
  liturgia do dia, santo do dia, frase diária e "Para você hoje". "Começar" levando para lá
  entrega o mesmo e mais. Dois botões no fim de um guia sem pular é pedir uma decisão no momento
  em que a pessoa só quer chegar.
- **i18n / tema / A/B de conteúdo.**
- **Processo (não é critério de aceite):** `npx prisma db push` de produção **próprio** desta
  feature (execução humana; o do login-google já foi) + o `UPDATE` do backfill logo em seguida;
  `/db-change` para o script; atualizar `docs/ARCHITECTURE.md` §5; criar o ponteiro
  `oratio/docs/specs/boas-vindas.md`; revisar o contrato com o frontend.

## Notas de ambiente

- **1 coluna nova** (`User.welcomeSeenAt`, aditiva) + **1 backfill** (`welcomeSeenAt = now()`
  em toda a tabela `User`). Sem env var nova, sem custo de chamada externa, sem impacto no
  scheduler de notificações.
- **`db push` próprio.** O do login-google já foi rodado (2026-09-09) — a coluna `welcomeSeenAt`
  **não pega carona** e precisa de um `prisma db push` só dela, seguido do `UPDATE` do backfill
  na mesma janela. `docs/specs/INDEX.md` → "Pendências de execução humana".

## Conteúdo do guia — **decidido** (3 páginas) — versão final 2026-09-10

| Pág. | Título | Ícone (lucide) | Texto | Botão |
|---|---|---|---|---|
| 1 | **Bem-vindo ao Oratio** | `Sunrise` | "Seu espaço de oração diária. Orações, terço, consagração e o Santo do Dia, sempre à mão." | Próximo |
| 2 | **Reze e acompanhe** | `Cross` | "Marque suas orações, acompanhe a consagração e veja seu progresso ao longo dos dias." | Próximo |
| 3 | **Estude e converse** | `BookOpen` | "Bíblia de Estudo para marcar e organizar versículos, e o Vox para tirar dúvidas sobre a fé." | **Começar** |

> Versão anterior (substituída no prompt de implementação, mantida só como histórico): pág. 1
> "A Palavra de cada dia" (`Sunrise`); pág. 2 "Sua vida de oração" (`Cross`); pág. 3 "Vox, para
> as suas dúvidas" (`Sparkles`).

- Catecismo, Quaresma de São Miguel, Confissão e Orações avulsas ficam **de fora da tela** — 5
  segundos por página não comportam a lista inteira, e o trio acima é o que vende o app.
- **Sem personalização de nome** ("Bem-vindo, Fulano"). O guia é sobre o app, não sobre a
  pessoa; uma saudação na pág. 1 competiria com a mensagem. (A implementação da UI aplica a
  skill `frontend-ui-engineering`.)

## Questões em aberto

Nenhuma. (Nome do campo → `welcomeSeenAt`; conteúdo → acima; tratamento do backfill → "Modelo de
dados".)
