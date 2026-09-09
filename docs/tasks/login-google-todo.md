# TODO — "Entrar com Google" (Backend / oratio-api)

Plano completo: `docs/tasks/login-google-plan.md`. Spec: `docs/specs/login-google.md`.
Frontend: `oratio/docs/tasks/login-google-todo.md`. Ler `docs/ARCHITECTURE.md` §3/§5/§10.

Comandos: `npm run start:dev` · `npm run build` · `npm test -- <pattern>` · `npm run lint`
Prisma: **não rodar `db push`** — `/db-change` escreve o `.sql`, o humano executa (`RULES.md` §2).
`npx prisma generate` (só codegen, não conecta no banco) pode rodar localmente.

Convenção de teste (`ARCHITECTURE.md` §10): `PrismaService` mockado como objeto de `jest.fn()`s;
`google-auth-library` mockada com `jest.mock('google-auth-library')`; asserção por estado
(retorno + args com que o mock foi chamado); nada de rede real.

Branch: `feat/login-google` (já existe, tem a spec). Commits nunca em `main`/`develop`
(`git rev-parse --abbrev-ref HEAD` antes de cada commit). Rodapé de commit conforme a sessão.

---

## Fase A — Backend, núcleo

### A1 — Schema: `LinkedAccount` + `User.password` opcional

**Descrição:** Adicionar o model `LinkedAccount` e a relação inversa em `User`; trocar
`password String` por `password String?`. Rodar `npx prisma generate`. Invocar `/db-change`
para gerar `prisma/db-scripts/2026-09-08-login-google.sql` (aplicação + rollback comentado,
com a nota de que o rollback do `NOT NULL` é condicional).

**Critérios de aceite:**
- [x] `model LinkedAccount` conforme o plano: `@@unique([provider, providerAccountId])`,
      `@@index([userId])`, `onDelete: Cascade` a partir de `User`, campo `linkedAt`, comentário
      explicando a restrição não óbvia (`ARCHITECTURE.md` §10)
- [x] `User.password` agora é `String?`; `User.linkedAccounts LinkedAccount[]` adicionado
- [x] `prisma/db-scripts/2026-09-08-login-google.sql` existe com apply + rollback comentado
- [x] Nenhum `db push` rodado pelo agente

**Verificação:**
- [x] `npx prisma generate` sem erro; `import { LinkedAccount } from '@prisma/client'` compila
- [x] `npm run build` limpo

**Dependências:** nenhuma · **Arquivos:** `prisma/schema.prisma`, `prisma/db-scripts/*.sql`
**Escopo:** S

---

### A2 — `POST /auth/google`: verificação do `id_token`

**Descrição:** `GoogleLoginDto` (`credential: string`, `@IsString`+`@IsNotEmpty`). Rota no
`AuthController` (`@HttpCode(200)`, `@Throttle({ default: { limit: 5, ttl: 60_000 } })`, header
`x-app` como `/auth/login`). `AuthService.loginWithGoogle(credential, deviceInfo)` — parte de
verificação: instancia `OAuth2Client(process.env.GOOGLE_CLIENT_ID)` (ausente →
`ServiceUnavailableException`), `verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID })`,
`getPayload()`, assere `iss ∈ {accounts.google.com, https://accounts.google.com}`, exige
`payload.email_verified === true`. Qualquer falha de verificação → `UnauthorizedException` com
a mensagem da spec; `email_verified` falso → mensagem própria da spec.

**Critérios de aceite (BDD da spec):**
- [x] `credential` com assinatura inválida (`verifyIdToken` lança) → 401
      `{ message: "Não foi possível validar seu login com o Google. Tente de novo." }`
- [x] `credential` expirado (`exp` no passado) → 401
- [x] `credential` com `aud` de outro client ID → 401
- [x] payload com `email_verified: false` (ou ausente) → 401
      `{ message: "Seu e-mail no Google não está verificado. ..." }`, **nada** criado/alterado
- [x] corpo `{}` (sem `credential`) → 400
- [x] `GOOGLE_CLIENT_ID` ausente do ambiente → 503
      `{ message: "Login com Google indisponível no momento." }`
- [x] **X-App não é conferido** (nem o `/auth/login` confere hoje) — spec corrigida; nada a implementar

**Verificação:**
- [x] `npm test -- auth` verde; specs novos com `jest.mock('google-auth-library')`,
      `verifyIdToken` mockado por caso (payload sintético ou `throw`)
- [x] `npm run build` limpo
- [ ] `curl` (sem `db push`): `-d '{}'` → 400; `-d '{"credential":"abc"}'` → 401 *(checkpoint)*

**Dependências:** A1 · **Arquivos:** `src/modules/auth/dto/google-login.dto.ts`,
`src/modules/auth/auth.controller.ts`, `src/modules/auth/auth.service.ts`,
`src/modules/auth/auth.service.spec.ts` (+ `auth.controller.spec.ts` se houver)
**Escopo:** M

---

### A3 — `POST /auth/google`: resolução e criação de conta

**Descrição:** Segunda metade de `loginWithGoogle`. Com o payload já verificado
(`sub`, `email`, `name`, `email_verified: true`):

1. `linkedAccount.findUnique({ where: { provider_providerAccountId: { provider: 'google', providerAccountId: sub } } })` → achou: `generateTokens(user.id, user.email, deviceInfo)`.
2. Senão `user.findUnique({ where: { email: email.toLowerCase() } })`:
   - não existe → `user.create({ data: { name, email, emailVerified: true, password: null } })` + `linkedAccount.create({ data: { userId, provider: 'google', providerAccountId: sub, emailSnapshot: email } })` → `generateTokens`.
   - existe → `linkedAccount.create(...)` ligado a esse `user` → `generateTokens`. **Não** tocar `password`/`name`.

Colisão de e-mail nunca deve vazar erro de constraint — o passo 2 já cobre.

**Critérios de aceite (BDD da spec):**
- [x] sem `User` com o e-mail → 200 `{ access_token, refresh_token }`; `User` novo
      (`password` nulo, `emailVerified: true`, `name` == Google) + `LinkedAccount`
      (`provider: "google"`, `providerAccountId` == `sub`)
- [x] `LinkedAccount` já existe para o `sub` → 200 com tokens do dono; **nenhuma** linha nova
- [x] `User` e-mail+senha existe, sem `LinkedAccount` → 200 com tokens **desse** user;
      `LinkedAccount` nova ligada a ele; `password` e `name` **inalterados**
- [x] resposta é **200** (não 201)
- [x] **A9** — auto-ligação num `User` com `emailVerified: false` → grava `emailVerified: true`
      (teste asserta o `data` do `user.update`); `password`/`name` intactos
- [x] **A10** — `user.create` + `linkedAccount.create` do caminho novo dentro de
      `prisma.$transaction` (callback); `PrismaClientKnownRequestError` `P2002` (em `user.create`
      **e** `linkedAccount.create`) é capturado e o fluxo **re-resolve** (LinkedAccount por `sub`
      → senão User por e-mail → auto-liga) → 200, não 500

**Verificação:**
- [x] `npm test -- auth` verde — asserta args de `user.create` / `linkedAccount.create`; que
      `user.update` só é chamado no caminho `emailVerified: false`; e o caminho `P2002` (mock
      de `create` lançando `{ code: 'P2002' }` na 1ª, sucesso na re-resolução)
- [x] `npm run build` limpo

**Dependências:** A2 · **Arquivos:** `auth.service.ts`, `auth.service.spec.ts` · **Escopo:** M
**Absorve:** A9 (`emailVerified` na auto-ligação) e A10 (corrida `P2002`) — do pedido do humano.

---

### A4 — `login()` com conta só-Google (`password: null`)

**Descrição:** Em `AuthService.login`, antes do `bcrypt.compare`, se `user.password == null`
lançar `UnauthorizedException('Invalid credentials')` — **idêntico** ao "usuário não existe" e
"senha errada". Comentário no ponto de uso explicando o porquê (não vazar tipo de conta;
`bcrypt.compare(x, null)` quebra).

**Critérios de aceite (BDD da spec):**
- [x] `User` com `password: null` + `POST /auth/login` com qualquer senha → 401
      `{ message: "Invalid credentials" }`
- [x] `bcrypt.compare` não é chamado com `null` (teste asserta o mock de `bcrypt`)

**Verificação:** [x] `npm test -- auth` verde · `npm run build` limpo
**Dependências:** A1 · **Arquivos:** `auth.service.ts`, `auth.service.spec.ts` · **Escopo:** XS

---

### A5 — `POST /users/me/set-password`

**Descrição:** `SetPasswordDto` (`password` com `@MinLength(8)` + `@Matches` igual ao
`ChangePasswordDto`; `confirmPassword: string`). Rota no `UsersController`:
`@Throttle({ default: { limit: 5, ttl: 60_000 } })` + `@UseGuards(JwtAuthGuard, ThrottlerGuard)`,
`userId` de `req.user.userId`. `UsersService.setPassword(userId, password, confirmPassword)`:
- `password !== confirmPassword` → `BadRequestException`
- `user.password != null` → `ConflictException` com a mensagem da spec (aponta p/ "Trocar senha")
- senão `user.update({ data: { password: await bcrypt.hash(password, 10) } })`, retorna
  `{ message: 'Senha definida.' }`
- **NÃO** chamar `refreshSession.deleteMany` — comentário explicando a diferença p/ `changePassword`

**Critérios de aceite (BDD da spec):**
- [x] conta com `password: null` + corpo válido e senhas iguais → 200 `{ message: "Senha definida." }`;
      `user.update` com hash bcrypt; `refreshSession.deleteMany` **não** chamado (teste asserta)
- [x] conta que **já tem** senha → 409, mensagem aponta p/ "Trocar senha", `password` não muda
      *(teste obrigatório — controle de segurança da rota)*
- [x] sem `Authorization` → 401
- [x] `password != confirmPassword` → 400

**Verificação:**
- [x] `npm test -- users` verde · `npm run build` limpo
- [ ] `curl` (após `db push`): autenticado numa conta só-Google → 200; repetir → 409 *(checkpoint)*

**Dependências:** A1 · **Arquivos:** `src/modules/users/dto/set-password.dto.ts`,
`src/modules/users/users.controller.ts`, `src/modules/users/users.service.ts`,
`src/modules/users/users.service.spec.ts` (+ controller spec) · **Escopo:** S

---

### A6 — Recuperação de conta só-Google via `forgot`→`reset`

**Descrição:** Conferir que `requestPasswordReset` + `resetPassword` já funcionam quando
`user.password` é `null` (o `resetPassword` faz `bcrypt.hash` + `user.update`, não lê a senha
antiga — deve funcionar). Adicionar teste de regressão. Se algum caminho quebrar no `null`,
corrigir com escopo mínimo.

**Critérios de aceite (BDD da spec):**
- [x] `User` com `password: null` → `forgot-password` grava `passwordResetToken`; `reset-password`
      com esse token + senha nova → `login` com a senha nova depois devolve 200; todas as
      `RefreshSession` do user foram apagadas (comportamento existente do `resetPassword`)

**Verificação:** [x] `npm test -- auth` verde
**Dependências:** A1 · **Arquivos:** `auth.service.spec.ts` (+ `auth.service.ts` só se quebrar)
**Escopo:** XS

---

### A8 — `changePassword` / `deleteAccount` com `password: null`

**Descrição:** `UsersService.changePassword` (`users.service.ts:175`) e `deleteAccount` (`:355`)
fazem `bcrypt.compare(x, user.password)` — com `null` lançam → 500 numa conta só-Google.

- **`changePassword`**: antes do `bcrypt.compare`, se `user.password == null` →
  `ConflictException('Esta conta não tem senha. Use "Definir senha" para criar uma.')`.
  Comentário explicando que não pode depender do frontend esconder o botão.
- **`deleteAccount`**: **DECIDIDO (2026-09-09 — re-auth Google, proposta recomendada).**
  `DeleteAccountDto` → `{ password?: string; googleCredential?: string }` (nenhum obrigatório no
  DTO); `user.password != null` → `password` obrigatório + `bcrypt.compare` (inalterado; sem
  `password` → 400 no service, não mais no pipe); `user.password == null` → `googleCredential`
  obrigatório, verificado por `AuthService.verifyGoogleIdentity` (wrapper público do helper da
  A2; `AuthModule` passa a exportar `AuthService`, `UsersModule` a importar `AuthModule`), com
  `payload.sub` batendo num `LinkedAccount` (`provider: 'google'`) deste user. Prova ausente ou
  de outra conta Google → `BadRequestException` (não 500); `googleCredential` inválido → o 401
  do helper propaga.

**Critérios de aceite (BDD da spec):**
- [x] `change-password` autenticado numa conta `password: null` → 409, mensagem aponta p/
      "Definir senha"; `bcrypt.compare` **não** chamado com `null` (teste asserta o mock)
- [x] `delete` autenticado numa conta `password: null` sem `googleCredential` → 400 (não 500),
      `user.delete` não chamado
- [x] `delete` autenticado numa conta `password: null` com `googleCredential` cujo `sub` bate um
      `LinkedAccount` desse user → 200, conta apagada (teste asserta args de
      `verifyGoogleIdentity` / `linkedAccount.findUnique` / `user.delete`)
- [x] `delete` autenticado numa conta `password: null` com `googleCredential` cujo `sub` **não**
      bate → 400, `user.delete` não chamado
- [x] `delete`/`change-password` numa conta **com** senha → comportamento atual inalterado
      (senha certa → 200; errada → 401; ausente → 400)

**Verificação:** [x] `npm test` inteiro verde (842) · `npm run build` limpo
**Dependências:** A1, A2 (helper de verificação) ·
**Arquivos:** `users.service.ts`, `users.controller.ts`, `dto/delete-account.dto.ts`,
`users.service.spec.ts`, `users.controller.spec.ts`, `auth.service.ts`, `auth.module.ts`,
`users.module.ts` · **Escopo:** S

---

### A7 — Docs + fechamento da Fase A

**Critérios de aceite:**
- [x] `docs/ARCHITECTURE.md` §5 descreve: `POST /auth/google` (verificação do `id_token`,
      auto-ligação condicionada a `email_verified`, `emailVerified: true` na auto-ligação),
      `User.password` opcional, `LinkedAccount`, `POST /users/me/set-password` (só quando
      `password` null; não revoga sessão), `change-password` em conta só-Google → 409
- [x] `docs/ARCHITECTURE.md` §7 — o que mudou em `deleteAccount` (conta só-Google)
- [x] `docs/ARCHITECTURE.md` §8 ganha o bullet do quirk 200/201 (texto exato na spec)
- [x] `docs/ARCHITECTURE.md` §9 ganha `GOOGLE_CLIENT_ID`
- [x] `docs/ARCHITECTURE.md` §4 (modelo de domínio) menciona `LinkedAccount`
- [x] `CLAUDE.md` (raiz) — tabela `docs/tasks/` ganha a linha da feature
- [x] `docs/specs/INDEX.md` — status da feature para 🚧/implementada conforme o momento;
      pendências humanas conferidas
- [x] `docs/specs/login-google.md` — checkboxes de AC do backend marcados

**Verificação:** [x] `npm test` inteiro verde · `npm run build` limpo · `npm run lint` sem
regressão vs. `develop`
**Dependências:** A2–A6, A8 · **Arquivos:** `docs/ARCHITECTURE.md`, `CLAUDE.md`,
`docs/specs/INDEX.md`, `docs/specs/login-google.md` · **Escopo:** S

---

## ⛳ Checkpoint A — revisão humana (PARAR)

- [ ] `npm test` verde · `npm run build` limpo · `npm run lint` sem regressão
- [ ] `feat/login-google` mergeada na `develop` com `--no-ff` + `git push origin develop`
- [ ] Entregue ao humano:
  - [ ] comando exato do `db push` local (`npx prisma db push && npx prisma generate`) + aviso
        de que os caminhos "SIM" da tabela do plano dão 500 sem ele
  - [ ] sequência de `curl` dos caminhos ruins, com o esperado de cada:
        assinatura inválida · `email_verified:false` · e-mail já existente com senha ·
        conta só-Google tentando login por senha · 409 do `set-password` ·
        409 do `change-password` em conta só-Google
- [ ] **Não iniciar a Fase B sem retorno do humano**

---

## Fase B — Frontend, botão e fluxo  *(✅ concluída — código na `develop` do `oratio`, branch `feat/login-google-fase-b`; falta o teste manual no navegador, que é humano)*

## Fase C — Bordas + definir senha (UI)

O grosso é frontend (checklist em `oratio/docs/tasks/login-google-todo.md`). A **única** tarefa
de backend:

### C1 — `GET /users/me` devolve `hasPassword`

**Descrição:** `UsersService.getProfile` passa a selecionar `password` e retornar
`hasPassword: user.password != null` (o hash **nunca** vai no corpo). É o sinal que o frontend
usa pra mostrar "Definir senha" **ou** "Trocar senha".

**Critérios de aceite:**
- [x] `User` sem senha → `hasPassword: false`; `User` com senha → `hasPassword: true`
- [x] o retorno não tem a propriedade `password` (teste asserta `not.toHaveProperty('password')`)

**Verificação:** [x] `npm test -- users.service` verde · `npm run build` limpo
**Arquivos:** `users.service.ts`, `users.service.spec.ts`, `docs/ARCHITECTURE.md` §5 ·
**Escopo:** XS · **Entregue na branch** `feat/login-google-c`

## Fase D — CSP, deploy, PWA

Sem código de backend. O que este repo precisa conferir/entregar:

- [x] **`ALLOWED_ORIGINS` (`main.ts`) não muda** — o `POST /auth/google` sai da mesma origem de
      frontend (`oratio-phi.vercel.app` / `localhost:5173`) que já está na allowlist. Nenhuma
      origem nova. *(Conferido 2026-09-09.)*
- [ ] **Humano:** `GOOGLE_CLIENT_ID` nas env vars do Render (= `VITE_GOOGLE_CLIENT_ID` da Vercel).
- [x] **Humano:** `npx prisma db push` em **produção** — **feito em 2026-09-09** (Supabase;
      "Your database is now in sync with your Prisma schema"). `LinkedAccount` + `password`
      nullable em produção. Script `prisma/db-scripts/2026-09-08-login-google.sql`.
- [ ] **Humano:** cliente OAuth "Web application" + tela de consentimento no Google Cloud Console
      (ver "Notas de ambiente" na spec).

O código da Fase D (a CSP do GIS no `vercel.json`) está no `oratio`, branch
`feat/login-google-fase-d`, com o **plano de verificação pós-deploy** em
`oratio/docs/tasks/login-google-todo.md` → "Fase D — CSP".

Ver `docs/tasks/login-google-plan.md` → "Fases B / C / D" e `oratio/docs/tasks/login-google-todo.md`.

---

## Fase E — mensageria, sinais de resultado, correções do frontend

Spec: `docs/specs/login-google.md` → "## Fase E". Aprovada 2026-09-09 (E2 = dois booleanos;
E3 = logout antes de descartar). Backend nas branches `feat/login-google-fase-e` (este repo) e
`oratio:feat/login-google-fase-e`. Sem schema, sem `db push`. Commit por tarefa.

### Backend (`oratio-api`)

- [x] **E1** — `auth.service.ts` ramo `!user.password` do `login()`: mensagem específica
      *"Esta conta entra com o Google. Use o botão \"Continuar com o Google\" abaixo."* (401,
      antes do `bcrypt`). Comentário com o raciocínio da reversão. `auth.service.spec.ts`
      atualizado (55 verdes) · `npm run build` limpo. **Substitui a A4.**
      - AC: login por senha em conta `password: null` → 401 com a mensagem nova; `bcrypt` não
        roda antes (a mensagem exata prova o caminho). ✓
- [x] **E2** — `auth.service.ts`: interface `GoogleLoginResult` + helper `withGoogleFlags`;
      `loginWithGoogle` / `linkGoogleAndIssue` / caminho de criação / `resolveGoogleAfterRace`
      compõem `{ ...tokens, isNewUser, googleLinkedNow }`. `auth.controller.ts` já repassa o
      objeto inteiro (sem mudança). `auth.service.spec.ts`: os 4 testes cobrem os 4 desfechos.
      `ARCHITECTURE.md` §5 (novo shape + a reversão do E1). 842 testes verdes · build limpo.
      - AC: sem `User` → `true/false` ✓; `User` sem link → `false/true` ✓; `sub` com link →
        `false/false` ✓; corrida `P2002` → `isNewUser:false` ✓.
- [x] **E7-backend** — A8 já implementou o service. `users.service.spec.ts`: o caso "`sub` sem
      `LinkedAccount`" já existia; **adicionado** o caso "`sub` casa um `LinkedAccount` de OUTRO
      user" → 400, `user.delete` não roda. 76 testes de `users.service` verdes.

### Frontend (`oratio`)

- [x] **E1a** — `Login.tsx`: `<p className={styles.googleHint}>` + CSS removidos.
      `Login.test.tsx`: texto ausente **+** login por senha 401 com a mensagem nova → exibida.
      `oratio` commit `dae6cc3`.
- [x] **E2-consumo + E3** — `authService.loginWithGoogle` retorna
      `{ tokens, isNewUser, googleLinkedNow }` **sem persistir** (comentário sobre a assimetria;
      `login()` intacto). `api.ts`: `persistSession` / `clearAuthHeader`.
      `authService.discardGoogleSession` (POST /auth/logout, timeout 3s, best-effort).
      `Login.tsx` persiste nos 3 desfechos; `Register.tsx` `isNewUser:false` → descarta +
      `discardGoogleSession` + `AlertModal` → `/login`; `isNewUser:true` → persiste + Home.
      `oratio` commit `b66ae11`.
- [x] **E4** — `utils/flash.ts` + `<FlashToast/>` (montado no App). `googleLinkedNow` → toast
      "Sua conta Google foi conectada à sua conta Oratio." (na `/register`, vira a mensagem do
      `AlertModal`). `oratio` commit `cf1c55b`.
- [x] **E1b** — aviso "Defina uma senha" **no Perfil**, de vez em quando (cooldown 7 dias,
      `localStorage`) quando `hasPassword: false`: engrenagem de Configurações pulsa + balão
      apontando; em `AccountSettings` com `?senha=1` o botão "Definir senha" rola e pulsa. Nunca
      modal. `oratio` commits `1f0c449` (1ª versão) → `89500ea` (redesenho com ponteiro).
- [x] **E5 + E6** — `GoogleSignInButton` prop `disabled` (camada + spinner); `Login.tsx` /
      `Register.tsx` removem `text=` e passam `disabled={loading}`. `oratio` commit `969920c`.
- [x] **E7-frontend** — `DeleteAccountModal` ramo `hasPassword`;
      `profileService.deleteAccount({ password?, googleCredential? })`; `Profile.tsx` passa
      `hasPassword`. Testes: 2 caminhos + 2 falhas. `oratio` commit `c646bd6`.
- [x] **Docs** — ponteiro `oratio/docs/specs/login-google.md`, `oratio/docs/tasks/login-google-todo.md`
      (Fase E + premissa do `db push` corrigida), `oratio/docs/ARCHITECTURE.md`. `oratio` commit `298d3e7`.

### Checkpoint E — revisão humana (PARAR)

- [ ] `npm test` verde nos dois repos · `build` · `lint` sem regressão
- [ ] Humano testa no navegador: `/register` repetido; exclusão de conta só-Google (2 caminhos
      + 2 falhas); toast de auto-ligação; login por senha numa conta só-Google.
