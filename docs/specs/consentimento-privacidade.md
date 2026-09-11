# Spec: consentimento-privacidade — mecanismo de consentimento LGPD

> Status: rascunho
> Plano: — *(a decidir na aprovação — é maior que "mudança pequena": 4 fluxos de UI + 2 campos
> de schema + 1 rota nova + 1 DTO alterado, nos dois repos)* · Checklist: —
> Frontend pareado: `oratio/docs/specs/consentimento-privacidade.md`

## Objetivo

O Oratio guarda dado pessoal **sensível** (LGPD art. 5º, II: convicção religiosa) e hoje não
pede consentimento nenhum para isso. Esta spec entrega o **mecanismo**: onde e quando o
consentimento aos **dois documentos legais do app** — Termos de Uso e Política de Privacidade —
é pedido, como é registrado, e o que acontece se a pessoa recusa.

**Correção factual (2026-09-11): "convicção religiosa" aqui não quer dizer "intenções de
oração".** `Prayer` e `GeneralPrayer` não têm `userId` — são o catálogo do app, sem nenhum dado
pessoal. O que de fato é sensível é: o texto livre que a pessoa escreve (`Message.content` —
mensagens ao Vox; `BibleMark.note` — anotações em versículos; `QuaresmaMichaelPenance.content` —
penitência da Quaresma), os registros de prática devocional (`RosarySession`,
`ConsecrationProgress`/`ConsecrationCompletedDay`, `ReadingProgress`, `SpiritualStats`/
`UserActivity`), e o próprio fato de a conta existir (nome, e-mail). O texto jurídico das duas
telas (`oratio/docs/legal/2026-09-11-*.md`) já foi escrito e **já é o texto real, aprovado** —
não é placeholder e não faz parte desta entrega (ver "Fora de escopo"), mas deixou de ser uma
incógnita: dá pra citar o que ele promete, e citamos onde for relevante.

## Stack

Padrão da casa, com uma peça nova: `LEGAL_TERMS_VERSION` — uma constante de versão (string, tipo
`"2026-09-11"`), não um booleano.

**Por que o nome não é `PRIVACY_POLICY_VERSION` (decisão desta revisão):** o pedido original
tratava de um documento só; esta revisão soma um segundo, os **Termos de Uso**, aceito
**junto**, na mesma tela, no mesmo clique — nunca "aceitei só um dos dois". Um único par de
campos (`legalTermsAcceptedAt` + `legalTermsVersion`) cobre os dois aceites — a versão passa a
identificar **o par de documentos**, não um documento isolado — e por isso o nome deixa de
sugerir "só a Política". Ver "Decisões".

Justificativa do formato data+versão (decisão do humano, ver "Decisões" abaixo): o art. 8º §2 da
LGPD põe o ônus da prova no controlador, e um timestamp+versão prova "a pessoa aceitou ESTE par
de documentos, nesta versão, nesta data"; um booleano sozinho não prova nada disso. Quando o
texto de qualquer um dos dois documentos mudar (o frontend versiona isso com um novo arquivo
`docs/legal/<data>-*.md` — ver par frontend), bumpar `LEGAL_TERMS_VERSION` no código já faz
**todo mundo** (inclusive quem já tinha aceitado a versão anterior) precisar aceitar de novo —
sem `db push`, sem migração, sem script de backfill. É o mesmo mecanismo do `APP_VERSION` do
frontend, mas para consentimento em vez de cache.

## Comportamento esperado

### O dado

- `User.legalTermsAcceptedAt DateTime?` (nullable, aditivo — espelha `welcomeSeenAt`) e
  `User.legalTermsVersion String?` (nullable, aditivo) — **dois campos, não um**. Ver "Stack".
- `legalTermsAccepted` (computado, nunca persistido como booleano) =
  `legalTermsAcceptedAt != null && legalTermsVersion === LEGAL_TERMS_VERSION`.
- **`LEGAL_TERMS_VERSION` vive em código** (`src/modules/users/legal-terms-version.ts`), não no
  banco — é a mesma peça que decide, sozinha, se a base inteira precisa reconsentir.

### ⚠️ SEM BACKFILL — é o oposto do `welcomeSeenAt`

O script do `welcomeSeenAt` (`boas-vindas`) carimbou a base toda com `now()` para **ninguém** ver
o guia de estreia de novo. Aqui é o **oposto**: **todo mundo** (toda conta que existe hoje) deve
ver a tela de consentimento pelo menos uma vez, porque nenhuma delas jamais deu esse consentimento
formalmente. Se o script de `db push` desta feature incluir um `UPDATE ... SET
legalTermsAcceptedAt = now()`, a feature inteira vira letra morta — ninguém nunca vê a tela.
**Isto precisa estar em destaque, em maiúsculas, no cabeçalho do script `prisma/db-scripts/<data>-
consentimento-privacidade.sql`**: só `ADD COLUMN`, os dois nullable, sem `DEFAULT`, sem `UPDATE`.

### As quatro portas (mecanismo completo — detalhe de UI no par frontend)

Numeração igual à do pedido original, para rastreabilidade.

**1 — Cadastro por senha.** O frontend segura o `POST /users` até a pessoa marcar as duas caixas
obrigatórias (Termos de Uso + Política de Privacidade) e aceitar numa tela intercalada.
`CreateUserDto` ganha `legalTermsAccepted` **obrigatório**, e só `true` passa —
`false`/ausente → **400**, conta não é criada. `UsersService.create()` grava
`legalTermsAcceptedAt: new Date()` e `legalTermsVersion: LEGAL_TERMS_VERSION` na **mesma**
escrita do `prisma.user.create()` — não uma chamada separada depois (a conta nasce sem sessão;
cadastro por senha exige verificar o email antes do primeiro login, então não haveria token para
chamar uma rota autenticada logo em seguida).

**2 — Cadastro por Google (via `/register`).** `auth.service.ts:272` cria o `User` **dentro** do
`POST /auth/google` — gatear depois seria tarde. O frontend mostra a tela **antes** de abrir o
popup do Google (impossível interceptar o clique do botão nativo do GIS — ver o par frontend para
o mecanismo exato). Aqui, diferente da porta 1, **a sessão já existe** quando a conta é criada
(Google não exige verificação de email), então **nenhuma mudança no backend do Google**: o
frontend chama o `POST /users/me/legal-terms-accepted` (porta comum, abaixo) logo depois que os
tokens chegam, antes de navegar para dentro do app. `auth.service.ts` permanece **intocado** —
nem a criação de conta nova nem a auto-ligação gravam nada em `legalTermsAcceptedAt`.

**3 — Login com Google (conta existente ou nova, via `/login`).** Sem mudança nenhuma além da
porta comum abaixo. O popup precisa completar primeiro (o backend só sabe quem é a pessoa depois
do credential verificado) — gatear antes não é possível, e não é necessário: a MESMA porta 4
intercepta automaticamente na navegação seguinte.

**4 — Porta comum: já autenticado (login por senha, login por Google, ou reabertura do PWA).**
`GET /users/me` expõe `legalTermsAccepted: boolean`. Uma vez autenticada, **toda** navegação com
`legalTermsAccepted !== true` é interceptada pelo `LegalTermsGate` do frontend, que redireciona
para a tela de consentimento **antes** de qualquer outra coisa (inclusive antes do
`WelcomeGate`/guia de boas-vindas). Ao aceitar, o frontend chama **`POST /users/me/legal-terms-
accepted`** (`JwtAuthGuard`, sem `X-App`, sem throttle — mesmo padrão de `POST /users/me/welcome-
seen`).

**Por que só duas rotas cobrem quatro portas:** as portas 3 e 4 são o **mesmo mecanismo** —
o login com Google não precisa de nenhum código dedicado no backend nem no
`Login.tsx`/`handleGoogleCredential`, porque a porta 4 (`LegalTermsGate`, universal, reavalia a
cada troca de rota autenticada) já pega o caso na navegação que acontece logo depois do login,
exatamente como o `WelcomeGate` já faz hoje para "cadastro por senha caía na Home" (mesma classe
de bug, mesma correção — reavaliar por `location.pathname`, não só no boot). Só as portas 1 e 2
precisam de tratamento dedicado, porque **não existe sessão ainda** quando a decisão de consentir
precisa ser tomada.

**Nunca stampar sem a tela ter sido mostrada.** O `auth.service.ts` **não** grava
`legalTermsAcceptedAt` na criação de conta via Google, em **nenhum** dos dois fluxos que passam
por ele (registro OU login) — se gravasse incondicionalmente, uma conta criada pelo botão do
Google na tela de **login** (o mesmo endpoint cria conta nova ali também, silenciosamente, se o
email não existir) nasceria com consentimento registrado **sem a pessoa nunca ter visto a
tela**. É por isso que a porta 2 registra o aceite **pelo frontend**, depois dos tokens — nunca
dentro da transação do backend.

### Sem autenticação / sem permissão

`POST /users/me/legal-terms-accepted`: `JwtAuthGuard`, `userId` de `req.user.userId` (nunca do
corpo). `GET /users/me`: guard inalterado. `POST /users` (create): público, como hoje — o campo
novo é validação de corpo, não de autenticação.

### Erros

- `POST /users` sem `legalTermsAccepted: true` → **400**, corpo com a mensagem do
  `class-validator`, conta **não** criada (mesmo padrão de `password !== confirmPassword`).
- `POST /users/me/legal-terms-accepted` sem token → **401** (guard padrão).
- Falha de rede ao buscar `GET /users/me` no `LegalTermsGate` (frontend): não intercepta,
  reavalia na próxima navegação — mesma política do `WelcomeGate`. Nunca prende ninguém na porta
  do app por causa de uma falha de rede.

### Timezone

Não se aplica — `legalTermsAcceptedAt` é um carimbo de instante (`new Date()`), sem lógica de
fronteira de dia.

## Requisitos de saída

### `POST /users` (alteração de contrato — campo novo obrigatório)

- **Request** ganha `legalTermsAccepted: boolean`, obrigatório, só `true` passa
  (`@Equals(true)` em `CreateUserDto`). `false`, ausente, ou qualquer valor que não seja o
  booleano `true` → **400** e a conta **não** é criada.
- **Response**: inalterada (a lista branca de `create()` já existe — `id`, `name`, `email`,
  `createdAt`, `updatedAt`, `emailVerified`, `isAdmin`, `emailSent`; não ganha
  `legalTermsAccepted` aqui, porque o consumidor imediato é o formulário de cadastro, que já sabe
  que aceitou).

### `GET /users/me` (campo aditivo)

- Resposta ganha `legalTermsAccepted: boolean` — `true` somente quando `legalTermsAcceptedAt !=
  null` **e** `legalTermsVersion === LEGAL_TERMS_VERSION` (a versão atual, em código). Uma conta
  que aceitou uma versão **antiga** do par de documentos tem `legalTermsAccepted: false`, igual
  a quem nunca aceitou nada. Nenhum campo existente é removido ou renomeado.

### `POST /users/me/legal-terms-accepted` (rota nova)

- Guards: `JwtAuthGuard`. Sem `X-App`, sem throttle (mesmo padrão de `POST /users/me/welcome-
  seen` — chamada de baixo risco, idempotente na prática).
- Sem corpo.
- **Não é idempotente do mesmo jeito que `markWelcomeSeen`** (que só carimba se ainda `null`,
  porque "visto o guia" não tem versão). Este endpoint **sempre regrava**
  `legalTermsAcceptedAt: new Date()` e `legalTermsVersion: LEGAL_TERMS_VERSION` — chamar de
  novo com a mesma versão atual é um no-op observável (o resultado final é o mesmo), mas chamar
  depois de um bump de versão precisa **conseguir** regravar, para registrar o reaceite.
- Resposta: `{ ok: true }` (espelha `markWelcomeSeen`).

## Modelo de dados

```prisma
model User {
  // ...campos existentes...
  legalTermsAcceptedAt DateTime?
  legalTermsVersion    String?
}
```

**Aditivo**, sem `@@unique`, sem `@@index` — mesma forma de `welcomeSeenAt`. **Sem `db push` de
produção incluído nesta spec** (fica pendente de execução humana, registrado em
`docs/specs/INDEX.md`, com o script pronto em `prisma/db-scripts/`).

`src/modules/users/legal-terms-version.ts` (novo arquivo, não é schema):

```ts
// Versão do PAR Termos de Uso + Política de Privacidade que o app exige
// aceite (os dois são aceitos juntos, um par, não dois pares — ver spec
// consentimento-privacidade.md, seção "Stack"). Bumpar esta string invalida
// o consentimento de TODA a base (legalTermsAccepted recomputa para false
// até reaceitar) — sem migração, sem db push. Deve espelhar a data do
// arquivo mais recente em oratio/docs/legal/<data>-termos-de-uso.md e
// oratio/docs/legal/<data>-politica-de-privacidade.md (os dois nascem com a
// mesma data — repos diferentes, sem CI compartilhado: bump manual).
export const LEGAL_TERMS_VERSION = "2026-09-11";
```

*(A data acima **já é a real** — é a mesma versão de `oratio/docs/legal/2026-09-11-termos-de-
uso.md` e `oratio/docs/legal/2026-09-11-politica-de-privacidade.md`, texto real e aprovado por
Lucas, não placeholder — ver "Fora de escopo".)*

## Critérios de aceite (testáveis, em BDD)

### Backend

- [ ] **Dado** um payload de `POST /users` válido em tudo **exceto** `legalTermsAccepted`
  (ausente, `false`, ou `"true"` string), **quando** a requisição é feita, **então** 400, e
  `prisma.user.create` **não** é chamado.
- [ ] **Dado** um payload de `POST /users` válido com `legalTermsAccepted: true`, **quando** a
  conta é criada, **então** o `prisma.user.create` recebe `legalTermsAcceptedAt` (um `Date`) e
  `legalTermsVersion` igual a `LEGAL_TERMS_VERSION` na mesma chamada — nunca uma segunda escrita.
- [ ] **Dado** um `User` com `legalTermsAcceptedAt` preenchido mas `legalTermsVersion`
  **diferente** da constante atual, **quando** `GET /users/me`, **então**
  `legalTermsAccepted: false` no corpo.
- [ ] **Dado** um `User` com `legalTermsAcceptedAt` **e** `legalTermsVersion` batendo com a
  constante atual, **quando** `GET /users/me`, **então** `legalTermsAccepted: true`.
- [ ] **Dado** um `User` com `legalTermsAcceptedAt: null` (conta pré-existente, sem backfill),
  **quando** `GET /users/me`, **então** `legalTermsAccepted: false`.
- [ ] **Dado** um token válido, **quando** `POST /users/me/legal-terms-accepted`, **então** 200,
  `{ ok: true }`, e o `User` passa a ter `legalTermsAcceptedAt` recente **e**
  `legalTermsVersion === LEGAL_TERMS_VERSION`.
- [ ] **Dado** nenhum token, **quando** `POST /users/me/legal-terms-accepted`, **então** 401 e
  nada é gravado.
- [ ] **Dado** um token de um usuário, **quando** `POST /users/me/legal-terms-accepted`,
  **então** só a conta **do token** é alterada (`userId` de `req.user.userId`, nunca do corpo —
  não há corpo).
- [ ] **Dado** `loginWithGoogle` criando uma conta nova (registro **ou** login — o mesmo código),
  **quando** a transação de criação roda, **então** `legalTermsAcceptedAt` e `legalTermsVersion`
  continuam `null` — `auth.service.ts` nunca grava esses campos, em nenhum dos dois fluxos.

## Plano de testes

- **Unitário (Jest):**
  - `create-user.dto.spec.ts` (novo, no padrão de `update-profile.dto.spec.ts`): aceita
    `legalTermsAccepted: true`; rejeita ausente, `false`, `"true"` (string), `1`.
  - `users.service.spec.ts`: `create()` grava os dois campos na mesma chamada; `getProfile()`
    computa `legalTermsAccepted` nos três casos (nunca aceitou / versão antiga / versão atual);
    `acceptLegalTerms()` sempre regrava (chamar 2x com a mesma versão atual não quebra nada;
    simula um "reaceite" mudando a constante entre as duas chamadas no teste, se viável).
  - `users.controller.spec.ts`: `updateProfile`-style teste de delegação para a rota nova
    (rejeita sem `userId`, delega com o `userId` certo).
  - `auth.service.spec.ts`: regressão — nenhum teste existente de `loginWithGoogle` deve passar a
    esperar `legalTermsAcceptedAt` preenchido; adicionar uma asserção explícita de que continua
    `null`/ausente do mock de criação.
- **Contrato:** `curl -X POST localhost:3000/users -d '{...sem legalTermsAccepted}'` → 400;
  com `legalTermsAccepted: true` → 201; `curl -X POST localhost:3000/users/me/legal-terms-
  accepted -H "Authorization: Bearer <token>"` → 200 `{ ok: true }`, seguido de `GET /users/me`
  confirmando `legalTermsAccepted: true`.
- **Manual:** nenhum (sem custo externo, sem serviço de terceiro envolvido).

Loop de verificação por tarefa: `npm test -- <pattern>` → `npm test` → `npm run build` →
`npm run lint` → commit.

## Fora de escopo

- **O texto jurídico dos dois documentos.** Já está feito: `oratio/docs/legal/2026-09-11-termos-
  de-uso.md` e `oratio/docs/legal/2026-09-11-politica-de-privacidade.md`, texto real, aprovado
  por Lucas — não placeholder. Esta spec só cobre o mecanismo de consentimento (schema, rotas,
  validação); a exibição do conteúdo é responsabilidade do componente de conteúdo no par
  frontend. Qualquer revisão futura do texto exige bump de `LEGAL_TERMS_VERSION` (ver "Stack").
- **O protocolo de crise do Vox.** Os Termos de Uso **já aprovados** (`§4`) prometem que o Vox
  "não é atendimento de saúde" e encaminha quem estiver em crise/ideação suicida para CVV 188 /
  `cvv.org.br` / SAMU 192 / alguém de confiança. O `vox.prompt.ts` **não tem nenhuma instrução
  correspondente hoje** (zero ocorrências de suic/crise/depress/CVV/188/profissional, confirmado
  por busca em `src/`). **Não faz parte desta entrega** — item próprio, registrado como
  **bloqueante da publicação dos Termos de Uso** em `docs/specs/INDEX.md` → ver spec
  `docs/specs/vox-protocolo-crise.md`.
- **Exportar dados pessoais** (outro direito da LGPD, feature separada).
- **`db push` de produção** — script fica pronto, execução é humana (`RULES.md` §2).
- **Bump de `APP_VERSION`/`CACHE_NAME`** — processo de release (`/bump-version`), não critério
  de aceite.
- **Corrigir a menção a `guestAllowedPrefixes`** — checado nesta revisão: o `oratio-api/docs/
  ARCHITECTURE.md` **não** menciona esse símbolo (busca sem resultado). A imprecisão existe só
  no `oratio/docs/ARCHITECTURE.md` (§3/§7/quirks) — a spec anterior generalizava "os dois repos"
  por engano; corrigido aqui e no `docs/specs/INDEX.md`. `RULES.md` dos dois repos já foi
  corrigido (pedido explícito, sessão anterior).
- **Rota admin para ver quem aceitou/recusou.** Ninguém pediu; se vier, é spec própria.

## Notas de ambiente

- Sem env var nova, sem custo externo, sem impacto no scheduler de notificações.
- `db push` de produção **pendente de execução humana** (script em
  `prisma/db-scripts/<data>-consentimento-privacidade.sql`, só `ADD COLUMN` — **sem** `UPDATE`
  de backfill, ver "⚠️ SEM BACKFILL" acima). Registrar em `docs/specs/INDEX.md` →
  "Pendências de execução humana" quando a implementação chegar lá.
- `LEGAL_TERMS_VERSION` é a env var *de fato* desta feature, só que vive em código, não em
  `.env` — decisão deliberada (ver "Decisões"): uma env var poderia ser trocada em produção sem
  passar por revisão de código, e uma mudança que invalida o consentimento da base inteira merece
  o mesmo rigor de revisão que qualquer outra mudança de comportamento.
- **A Política de Privacidade já aprovada faz promessas que o código de hoje não cumpre** — ver
  `docs/specs/INDEX.md` → "Dívidas conhecidas": remoção de `RefreshSession.location`, job de
  limpeza de sessões expiradas, e exclusão de contas inativas por 24 meses com aviso por e-mail.
  Nenhuma delas é desta spec, mas o texto (`oratio/docs/legal/2026-09-11-politica-de-
  privacidade.md` §8) já as declara como fato — precisam virar verdade antes (ou logo depois)
  de publicar.

## Decisões (fechadas na criação/revisão desta spec)

- **Um único par de campos cobre os dois aceites** (decisão do humano, nesta revisão): os dois
  documentos são obrigatórios e sempre aceitos juntos, no mesmo clique — não existe "aceitei só
  os Termos". A versão passa a identificar o **par**. Por isso os campos e a constante saem do
  nome `privacy*`/`PRIVACY_POLICY_VERSION` e passam a `legalTerms*`/`LEGAL_TERMS_VERSION` — ver
  "Stack".
- **`legalTermsVersion` além de `legalTermsAcceptedAt`** (decisão original, mantida): ônus da
  prova (LGPD art. 8º §2) e necessidade de re-consentimento quando qualquer um dos dois textos
  mudar, sem precisar retroagir com um script novo a cada mudança de política.
- **`CreateUserDto.legalTermsAccepted` é obrigatório, não opcional** (decisão do humano,
  explícita): se fosse opcional, um esquecimento futuro no frontend criaria contas sem
  consentimento em silêncio — a garantia tem que estar no backend, não na confiança de que a
  tela sempre manda o campo.
- **`auth.service.ts` nunca grava `legalTermsAcceptedAt`, nem na porta 2.** Decisão derivada do
  raciocínio acima ("nunca stampar sem a tela ter sido mostrada") — o mesmo código de criação de
  conta via Google atende tanto `/register` (que gateia antes do popup) quanto `/login` (que não
  gateia, e não precisa). Gravar incondicionalmente ali abriria uma conta "consentida" sem tela
  nenhuma mostrada, pelo caminho do login.
- **Portas 3 e 4 são o mesmo mecanismo, sem código dedicado a Google no `Login.tsx`.** O
  `LegalTermsGate` universal (mesma forma do `WelcomeGate`, reavaliando a cada troca de rota) já
  cobre o caso "acabou de logar com Google" na navegação seguinte — replicar a lição já aprendida
  com o bug do `WelcomeGate` ("cadastro por senha caía na Home porque o efeito só rodava no
  boot", `docs/specs/boas-vindas.md`).
- **O protocolo de crise do Vox fica fora desta spec, mas bloqueia a publicação dos Termos.**
  Decisão desta revisão: o texto jurídico já promete um comportamento que o código não tem;
  misturar essa correção de prompt (conteúdo devocional, sob `doutrina-guardrail` e aprovação
  humana explícita de texto — `RULES.md` §3) dentro do mecanismo de consentimento (código de
  schema/rota) confundiria dois tipos de mudança com processos de revisão diferentes. Registrado
  como item próprio, bloqueante.
- **`guestAllowedPrefixes` não existe no código** (achado ao pesquisar para a versão original
  desta spec): tanto `RULES.md` quanto `ARCHITECTURE.md` citavam esse símbolo como se fosse uma
  lista real. Checado de novo nesta revisão: `oratio-api/docs/ARCHITECTURE.md` **não** tem essa
  menção — só `oratio/docs/ARCHITECTURE.md` ainda tem. Corrigido no `RULES.md` dos dois repos
  (pedido explícito); `oratio/docs/ARCHITECTURE.md` fica como dívida pequena, registrada no
  `docs/specs/INDEX.md`.

## Questões em aberto

Nenhuma.
