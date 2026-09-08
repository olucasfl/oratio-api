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
- [ ] `model LinkedAccount` conforme o plano: `@@unique([provider, providerAccountId])`,
      `@@index([userId])`, `onDelete: Cascade` a partir de `User`, campo `linkedAt`, comentário
      explicando a restrição não óbvia (`ARCHITECTURE.md` §10)
- [ ] `User.password` agora é `String?`; `User.linkedAccounts LinkedAccount[]` adicionado
- [ ] `prisma/db-scripts/2026-09-08-login-google.sql` existe com apply + rollback comentado
- [ ] Nenhum `db push` rodado pelo agente

**Verificação:**
- [ ] `npx prisma generate` sem erro; `import { LinkedAccount } from '@prisma/client'` compila
- [ ] `npm run build` limpo

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
- [ ] `credential` com assinatura inválida (`verifyIdToken` lança) → 401
      `{ message: "Não foi possível validar seu login com o Google. Tente de novo." }`
- [ ] `credential` expirado (`exp` no passado) → 401
- [ ] `credential` com `aud` de outro client ID → 401
- [ ] payload com `email_verified: false` (ou ausente) → 401
      `{ message: "Seu e-mail no Google não está verificado. ..." }`, **nada** criado/alterado
- [ ] corpo `{}` (sem `credential`) → 400
- [ ] `GOOGLE_CLIENT_ID` ausente do ambiente → 503
      `{ message: "Login com Google indisponível no momento." }`
- [ ] header `X-App` ausente → mesma resposta que `/auth/login` sem `X-App`

**Verificação:**
- [ ] `npm test -- auth` verde; specs novos com `jest.mock('google-auth-library')`,
      `verifyIdToken` mockado por caso (payload sintético ou `throw`)
- [ ] `npm run build` limpo
- [ ] `curl` (sem `db push`): `-d '{}'` → 400; `-d '{"credential":"abc"}'` → 401

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
- [ ] sem `User` com o e-mail → 200 `{ access_token, refresh_token }`; `User` novo
      (`password` nulo, `emailVerified: true`, `name` == Google) + `LinkedAccount`
      (`provider: "google"`, `providerAccountId` == `sub`)
- [ ] `LinkedAccount` já existe para o `sub` → 200 com tokens do dono; **nenhuma** linha nova
- [ ] `User` e-mail+senha existe, sem `LinkedAccount` → 200 com tokens **desse** user;
      `LinkedAccount` nova ligada a ele; `password` e `name` **inalterados**
- [ ] resposta é **200** (não 201)

**Verificação:**
- [ ] `npm test -- auth` verde — asserta args de `user.create` / `linkedAccount.create` e que
      `user.update` **não** foi chamado no caminho de auto-ligação
- [ ] `npm run build` limpo

**Dependências:** A2 · **Arquivos:** `auth.service.ts`, `auth.service.spec.ts` · **Escopo:** M

---

### A4 — `login()` com conta só-Google (`password: null`)

**Descrição:** Em `AuthService.login`, antes do `bcrypt.compare`, se `user.password == null`
lançar `UnauthorizedException('Invalid credentials')` — **idêntico** ao "usuário não existe" e
"senha errada". Comentário no ponto de uso explicando o porquê (não vazar tipo de conta;
`bcrypt.compare(x, null)` quebra).

**Critérios de aceite (BDD da spec):**
- [ ] `User` com `password: null` + `POST /auth/login` com qualquer senha → 401
      `{ message: "Invalid credentials" }`
- [ ] `bcrypt.compare` não é chamado com `null` (teste asserta o mock de `bcrypt`)

**Verificação:** [ ] `npm test -- auth` verde · `npm run build` limpo
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
- [ ] conta com `password: null` + corpo válido e senhas iguais → 200 `{ message: "Senha definida." }`;
      `user.update` com hash bcrypt; `refreshSession.deleteMany` **não** chamado (teste asserta)
- [ ] conta que **já tem** senha → 409, mensagem aponta p/ "Trocar senha", `password` não muda
      *(teste obrigatório — controle de segurança da rota)*
- [ ] sem `Authorization` → 401
- [ ] `password != confirmPassword` → 400

**Verificação:**
- [ ] `npm test -- users` verde · `npm run build` limpo
- [ ] `curl` (após `db push`): autenticado numa conta só-Google → 200; repetir → 409

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
- [ ] `User` com `password: null` → `forgot-password` grava `passwordResetToken`; `reset-password`
      com esse token + senha nova → `login` com a senha nova depois devolve 200; todas as
      `RefreshSession` do user foram apagadas (comportamento existente do `resetPassword`)

**Verificação:** [ ] `npm test -- auth` verde
**Dependências:** A1 · **Arquivos:** `auth.service.spec.ts` (+ `auth.service.ts` só se quebrar)
**Escopo:** XS

---

### A7 — Docs + fechamento da Fase A

**Critérios de aceite:**
- [ ] `docs/ARCHITECTURE.md` §5 descreve: `POST /auth/google` (verificação do `id_token`,
      auto-ligação condicionada a `email_verified`), `User.password` opcional, `LinkedAccount`,
      `POST /users/me/set-password` (só quando `password` null; não revoga sessão)
- [ ] `docs/ARCHITECTURE.md` §8 ganha o bullet do quirk 200/201 (texto exato na spec)
- [ ] `docs/ARCHITECTURE.md` §9 ganha `GOOGLE_CLIENT_ID`
- [ ] `docs/ARCHITECTURE.md` §4 (modelo de domínio) menciona `LinkedAccount`
- [ ] `CLAUDE.md` (raiz) — tabela `docs/tasks/` ganha a linha da feature
- [ ] `docs/specs/INDEX.md` — status da feature para 🚧/implementada conforme o momento;
      pendências humanas conferidas
- [ ] `docs/specs/login-google.md` — checkboxes de AC do backend marcados

**Verificação:** [ ] `npm test` inteiro verde · `npm run build` limpo · `npm run lint` sem
regressão vs. `develop`
**Dependências:** A2–A6 · **Arquivos:** `docs/ARCHITECTURE.md`, `CLAUDE.md`,
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
        conta só-Google tentando login por senha · 409 do `set-password`
- [ ] **Não iniciar a Fase B sem retorno do humano**

---

## Fase B — Frontend, botão e fluxo  *(detalhar quando chegar — checklist em `oratio/`)*
## Fase C — Bordas + definir senha (UI)  *(idem)*
## Fase D — CSP, deploy, PWA  *(idem)*

Ver `docs/tasks/login-google-plan.md` → "Fases B / C / D" e `oratio/docs/tasks/login-google-todo.md`.
