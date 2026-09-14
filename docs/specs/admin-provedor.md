# Spec: admin-provedor — método de entrada no painel admin

> Status: **implementada, na `develop` dos dois repos** (2026-09-10) — só leitura, sem schema, sem
> `db push`. Falta o teste manual no painel real e a promoção pra `main`.
> Plano/Checklist: **nenhum** — mudança pequena, foi direto ao código (mesmo precedente de
> `boas-vindas` e `prova-identidade`, registrados assim no INDEX).
> Frontend pareado: `oratio/docs/specs/admin-provedor.md` (ponteiro)

## Objetivo

No painel admin, **ver** e **filtrar** cada usuário pelo método de entrada — Oratio
(e-mail+senha), Google, ou os dois.

## Stack

Padrão da casa. **Sem mudança de schema** — `LinkedAccount` e `User.password` (nullable) já
existem desde o login-google. É só `select` + `where` novos em `getAllUsers`/`getUserDetail` e o
filtro/ícones no frontend. **Sem `db push`.**

## Comportamento esperado

### Três estados (não dois)

Uma conta pode ter os dois métodos ao mesmo tempo:

| Estado | Condição | Como chega aí |
|---|---|---|
| **só Oratio** | `password != null` **e** nenhum `LinkedAccount` | cadastro por e-mail+senha, nunca ligou o Google |
| **só Google** | `password == null` **e** tem `LinkedAccount` `google` | entrou por Google, nunca definiu senha |
| **ambos** | `password != null` **e** tem `LinkedAccount` | cadastrou por senha e depois ligou o Google (auto-ligação), **ou** entrou por Google e depois usou "Definir senha" |

> Conta com **nenhum** dos dois (`password == null` e sem `LinkedAccount`) é uma **anomalia de
> dados** — não deveria existir (todo cadastro cria ao menos um método). O frontend a mostra sob
> "Todos" sem ícone de provedor; nenhum filtro específico a captura. Vale um alerta visual
> discreto (ver "Requisitos de saída → Frontend").

### Filtro

- Um grupo de chips no `AdminFilterSheet`, no mesmo padrão de "Cargo" e "Verificação":
  **Todos · Só Oratio · Só Google · Ambos**.
- Query param novo em `GET /users/admin/users`: `provider` = `oratio` | `google` | `both`.
  Ausente ou valor desconhecido → sem filtro de provedor (mesmo tratamento tolerante que
  `isAdmin`/`emailVerified` já têm — string fora do esperado vira `undefined`, não 400).
- Combina com os filtros que já existem (`search`, `isAdmin`, `emailVerified`, `activeLastDays`)
  — AND entre eles.

### Sem autenticação / sem admin

- `GET /users/admin/users` já é `@UseGuards(JwtAuthGuard, AdminGuard)` + `assertAdmin(userId)` no
  service. **Nada muda aqui** — sem token → 401; token de não-admin → 403. O parâmetro `provider`
  não afrouxa nada.

### Timezone

Não se aplica — nenhuma fronteira de dia.

## Requisitos de saída

### `GET /users/admin/users` (alteração)

- **Método/path:** `GET /users/admin/users` (inalterado)
- **Guards:** `JwtAuthGuard`, `AdminGuard` (inalterado)
- **Query params:** os atuais (`search`, `isAdmin`, `emailVerified`, `activeLastDays`) **+
  `provider`** (`oratio` | `google` | `both`; outros valores → ignorado).
- **`getAllUsers` — `select` ganha:**
  - `password: true` (só para derivar o booleano — **nunca** vai no retorno)
  - `linkedAccounts: { select: { provider: true } }`
- **`getAllUsers` — retorno de cada usuário ganha:**
  | Campo | Tipo | Valor |
  |---|---|---|
  | `hasPassword` | boolean | `user.password != null` |
  | `authProviders` | `string[]` | `user.linkedAccounts.map(l => l.provider)` — ex. `["google"]` ou `[]` |
  - O hash de senha **não** aparece no corpo (mapear para `hasPassword` e descartar `password`,
    como `getProfile` já faz).
- **`where` do filtro `provider`:**
  | `provider` | cláusula Prisma |
  |---|---|
  | `oratio` | `{ password: { not: null }, linkedAccounts: { none: {} } }` |
  | `google` | `{ password: null, linkedAccounts: { some: { provider: 'google' } } }` |
  | `both` | `{ password: { not: null }, linkedAccounts: { some: {} } }` |
  - Entra no mesmo objeto `where` dos outros filtros (AND implícito).
- **Response:** array de usuários, cada um com os campos atuais **+** `hasPassword` +
  `authProviders`. Caso vazio: `[]` (inalterado).
- **Erros:** 401 (sem token), 403 (não-admin) — inalterados.

### `GET /users/admin/users/:id` (alteração menor)

- `getUserDetail` ganha o mesmo `select` (`password`, `linkedAccounts.provider`) e devolve
  `hasPassword` + `authProviders` no corpo do detalhe. Para o modal de detalhe do admin mostrar o
  método de entrada junto com "Verificado" / "Admin".

### Frontend (contrato consumido — detalhe em `oratio/docs/specs/admin-provedor.md`)

- `adminService.ts`:
  - `AdminFilters` ganha `provider?: "oratio" | "google" | "both"`.
  - `AdminUser` ganha `hasPassword: boolean` e `authProviders: string[]`.
  - `getAllUsers` serializa `provider` na query string quando definido.
- `AdminFilterSheet.tsx`: novo grupo "Entrada" com os chips **Todos / Só Oratio / Só Google /
  Ambos**; `AdminPanel.tsx` ganha o estado `filterProvider` e o mapeia para `filters.provider`
  (mesmo desenho de `filterRole`/`filterVerif`), conta no `activeFilterCount` e no
  `filterSummary`, e limpa em `clearAllFilters`.
- `renderCard` / `renderCompactRow`: ao lado dos indicadores de "verificado"/"admin", um ícone
  por método —
  - **Oratio:** ícone `Mail` (ou o "O" da marca) quando `hasPassword`.
  - **Google:** ícone/glifo do Google quando `authProviders.includes("google")`.
  - **ambos:** os dois ícones.
  - **anomalia** (nenhum): um `AlertTriangle` pequeno com `title="Sem método de entrada"`.
- Detalhe (modal): mesma dupla de ícones numa linha "Entrada: Oratio · Google".
- Visual segue o padrão do painel (`lucide-react`, sem asset novo).

> **Desvio implementado (2026-09-10):** `lucide-react` não tem um glifo do Google — só
> `Chrome` chega perto. O frontend usa `Chrome` + `title="Entra com o Google"` para desfazer a
> ambiguidade, em vez de adicionar um SVG novo (o painel é 100% lucide hoje, e "sem asset novo"
> valeu mais que o glifo exato). Isolado num só componente (`ProviderIcons` em `AdminPanel.tsx`),
> trocável depois sem tocar em mais nada.

## Modelo de dados

**Nada muda.** `User.password String?` e `model LinkedAccount` (com `provider`, `@@index([userId])`)
já existem (spec `login-google`). Esta feature só **lê** — novos `select` e `where`, zero
`ALTER TABLE`, zero `db push`.

## Critérios de aceite (testáveis, em BDD)

### Backend

- [x] **Dado** um `User` com `password != null` e sem `LinkedAccount`, **quando**
  `GET /users/admin/users` como admin, **então** esse usuário vem com `hasPassword: true` e
  `authProviders: []`, e o corpo **não** tem `password`.
- [x] **Dado** um `User` com `password == null` e um `LinkedAccount` `google`, **quando**
  `GET /users/admin/users` como admin, **então** `hasPassword: false`, `authProviders: ["google"]`.
- [x] **Dado** um `User` com `password != null` e um `LinkedAccount` `google`, **quando**
  `GET /users/admin/users` como admin, **então** `hasPassword: true`, `authProviders: ["google"]`.
- [x] **Dado** a base com contas dos três tipos, **quando** `GET /users/admin/users?provider=oratio`,
  **então** só as contas **com senha e sem `LinkedAccount`** voltam (o teste asserta o `where`
  passado ao `prisma.user.findMany`).
- [x] **Dado** o mesmo, **quando** `?provider=google`, **então** só contas **sem senha e com
  `LinkedAccount` google**; **quando** `?provider=both`, só contas **com senha e com
  `LinkedAccount`**.
- [x] **Dado** `?provider=banana` (valor inválido), **quando** `GET /users/admin/users`, **então**
  200 sem filtro de provedor aplicado (não 400).
- [x] **Dado** `?provider=google&emailVerified=true`, **quando** a query roda, **então** as duas
  cláusulas são combinadas (AND) no mesmo `where`.
- [x] **Dado** nenhuma credencial, **quando** `GET /users/admin/users?provider=google`, **então**
  401.
- [x] **Dado** um token de usuário **não-admin**, **quando** `GET /users/admin/users?provider=google`,
  **então** 403 e nenhum dado de usuário é devolvido.
- [x] **Dado** um `User` alvo com `password != null` e um `LinkedAccount`, **quando**
  `GET /users/admin/users/:id` como admin, **então** o detalhe traz `hasPassword: true` e
  `authProviders: ["google"]`, sem `password`.

### Frontend (resumo — critérios completos no par)

- [x] **Dado** a aba Usuários com o filtro "Só Google" ativo, **quando** a lista carrega,
  **então** `getAllUsers` é chamado com `provider: "google"` (`./api` mockado, query verificada).
- [x] **Dado** um usuário `hasPassword: true, authProviders: ["google"]` na lista, **então** o
  card mostra **os dois** ícones (Oratio + Google).
- [x] **Dado** um usuário `hasPassword: false, authProviders: []` (anomalia), **então** o card
  mostra o `AlertTriangle` com `title` explicativo.
- [x] **Dado** o filtro "Ambos" e mais nenhum, **então** `activeFilterCount` é 1 e "Ambos"
  aparece no `filterSummary`; **quando** "Limpar filtros", volta para "Todos".

## Plano de testes

- **Unitário (Jest — backend):** `users.service.spec.ts` — `getAllUsers` monta o `where` certo
  para cada valor de `provider` (incl. o inválido) e mapeia `hasPassword`/`authProviders` sem
  vazar `password`; `getUserDetail` idem. `users.controller.spec.ts` — o param `provider` chega
  ao service; 401 sem token, 403 sem admin (já cobertos, confirmar que o novo param não muda).
- **Contrato (`curl` contra `localhost:3000`):** com um token de admin, `GET /users/admin/users`
  (sem filtro) mostra `hasPassword`/`authProviders`; `?provider=google`, `?provider=oratio`,
  `?provider=both` retornam subconjuntos coerentes; `?provider=xxx` não dá 400; sem token → 401.
- **Unitário (Vitest — frontend):** `AdminFilterSheet.test.tsx` (novo grupo de chips),
  `AdminPanel.test.tsx` (estado `filterProvider` → `filters.provider`, contagem, limpar),
  `adminService.test.ts` (serialização da query), render dos ícones por combinação.
- **Manual (humano):** conferir no painel real, com contas de teste dos três tipos, que os
  ícones e o filtro batem.

Loop de verificação por tarefa:
`npm test -- <pattern>` → `npm test` → `npm run build` → `npm run lint` → commit.

## Fora de escopo

- **Editar o método de entrada de um usuário pelo admin** (forçar senha, desligar Google). Só
  leitura.
- **Coluna/estatística de "quantos entram por Google"** na aba Visão Geral ou nos gráficos —
  pode virar uma feature à parte depois.
- **`provider` como filtro múltiplo** (ex. "Google **ou** ambos" num clique) — os 4 chips
  cobrem os casos reais; um multi-select seria complexidade sem demanda.
- **Apple / outros provedores** — `authProviders` já é um array e comporta, mas hoje só existe
  `google`.
- **Processo (não é critério de aceite):** atualizar `docs/ARCHITECTURE.md` §9 (o que o painel
  admin expõe); criar o ponteiro `oratio/docs/specs/admin-provedor.md`; revisar o contrato com o
  frontend.

## Notas de ambiente

- **Sem** mudança de schema, **sem** `db push`, **sem** env var, **sem** custo externo, **sem**
  impacto no scheduler. É a spec mais barata das três — só leitura sobre tabelas que já existem.
- Depende do login-google estar na `develop` (o `model LinkedAccount` e o `password` nullable
  precisam existir no schema) — o que já é o caso.

## Questões em aberto

Nenhuma.

### Decidido (2026-09-09)

- **Ícone do "só Oratio": `Mail` (`lucide-react`).** A distinção mostrada é *método de login*, e o
  método Oratio é literalmente "e-mail + senha" — `Mail` lê como isso ao lado do glifo do Google.
  Um "O" da marca exigiria asset SVG novo (o painel é 100% lucide hoje). `Mail` é inequívoco a
  9–14px, que é o tamanho que esses indicadores de linha renderizam.
- **Método também no modal de detalhe: sim.** `getUserDetail` já seleciona quase o mesmo
  conjunto de campos; +2 linhas e 1 teste. Um admin investigando uma conta específica (chamado
  de suporte, "não consigo entrar") quer esse fato sem voltar à lista e casar ícones — e fica na
  mesma linha dos badges "Verificado"/"Admin" que o modal já mostra.
