# Plano de Implementação — "Entrar com Google" (Backend / oratio-api)

> Plano **mestre cross-repo**. A spec é `docs/specs/login-google.md` (aprovada 2026-09-08). O
> frontend tem só um checklist pareado em `oratio/docs/tasks/login-google-todo.md` que aponta
> para cá. Checklist executável do backend: `docs/tasks/login-google-todo.md`.
>
> Ler antes de codar: `.claude/rules/RULES.md` (§2 banco, §3 comunicação real, §5 segurança,
> §7 git, §8 dependências), `docs/ARCHITECTURE.md` §3 (lifecycle), §5 (auth), §10 (convenções),
> e a spec inteira.

## Visão geral

Login social com Google. O frontend obtém um `id_token` (JWT) pelo botão do Google Identity
Services e manda para `POST /auth/google`; o backend verifica o token, resolve/cria a conta e
devolve o mesmo par `{ access_token, refresh_token }` do login normal.

Duas mudanças estruturais fora da rota nova:

1. **`User.password` vira opcional** — contas criadas via Google não têm senha.
2. **Nova tabela `LinkedAccount`** — o vínculo `(provider, sub)` → `User`. Formato comporta
   Apple no futuro sem tocar em `User` (Apple está **fora de escopo** aqui).

Entrega em 4 fases que fecham sozinhas, cada uma mergeada na `develop` com `--no-ff` e testada
manualmente pelo humano antes da próxima. **Este plano detalha a Fase A** (backend); B/C/D têm
esqueleto aqui e ganham detalhe quando chegarem.

## Decisões de arquitetura

1. **Verificação do `id_token` com `google-auth-library`** (`OAuth2Client.verifyIdToken`),
   aprovada pelo humano (`RULES.md` §8). A lib valida assinatura, `aud`, `iss` e `exp`
   automaticamente; o nosso código **assere explicitamente** `iss` e **exige
   `email_verified === true`** (a lib não faz essa checagem). Fonte:
   [verify-google-id-token](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).
2. **Tudo em `AuthService`**, não um módulo novo. O `AuthService` já concentra login, refresh,
   logout, verificação de e-mail e reset de senha — login com Google é a mesma família. Um
   `OAuth2Client` é instanciado no método (lazy), com `GOOGLE_CLIENT_ID` do ambiente; ausente →
   `ServiceUnavailableException` (503).
3. **Emissão de token reaproveita `AuthService.generateTokens`** — cria uma `RefreshSession`
   nova com `userAgent`/`ipAddress`, exatamente como o `login()`. Nenhuma lógica de sessão nova.
4. **Resolução de conta em ordem fixa:** `LinkedAccount` por `sub` → senão `User` por `email`
   (cria ou auto-liga). A auto-ligação a uma conta e-mail+senha existente **só** acontece depois
   de `email_verified === true` já ter sido confirmado (passo 3). É a decisão central da spec.
5. **`POST /auth/google` responde `200`** (`@HttpCode(200)`), diferente do `/auth/login` que
   responde `201` (default do Nest). Quirk consciente — vai um bullet no `ARCHITECTURE.md` §8
   (texto na spec, seção "Decisões tomadas na aprovação").
6. **`login()` trata `password: null` como credencial inválida** *antes* de chamar
   `bcrypt.compare` (que quebra com `null`). Resposta idêntica à de senha errada
   (`401 "Invalid credentials"`) — não vaza que a conta é só-Google.
7. **`POST /users/me/set-password`** mora no `UsersController`/`UsersService`, ao lado do
   `change-password`, com a **mesma pilha**: `@UseGuards(JwtAuthGuard, ThrottlerGuard)` +
   `@Throttle({ default: { limit: 5, ttl: 60_000 } })`. **Confirmado:** `change-password` **não**
   checa `X-App` — `set-password` também não (resolve a única questão em aberto da spec).
8. **`set-password` NÃO revoga `RefreshSession`** — decisão consciente, oposta ao
   `changePassword`. Não existia senha antiga, nada foi invalidado. Comentário no ponto de uso
   para ninguém copiar o `deleteMany`.
9. **`America/Sao_Paulo`**: não se aplica. Nenhuma fronteira de dia nesta feature. `exp` do JWT é
   epoch UTC, tratado pela lib.

## Modelo de dados (`prisma/schema.prisma`)

### Aditivo — nova tabela

```prisma
// Vínculo entre um User e uma identidade de um provedor social (Google hoje;
// o formato comporta Apple depois SEM mexer em User). Uma linha por
// (provider, conta no provider). `providerAccountId` é o `sub` do id_token —
// id opaco e estável do provedor, NUNCA o e-mail. `emailSnapshot` é o e-mail
// que o provedor afirmou (com email_verified=true) no momento da ligação:
// registro para auditar uma contestação futura, não fonte de login. A linha
// só é criada quando o provedor confirma email_verified=true.
model LinkedAccount {
  id                String   @id @default(uuid())
  userId            String
  user              User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  provider          String   // "google"
  providerAccountId String
  emailSnapshot     String
  linkedAt          DateTime @default(now())

  @@unique([provider, providerAccountId])
  @@index([userId])
}
```

Relação inversa em `User`: `linkedAccounts LinkedAccount[]`.

### Não-destrutivo, mas altera coluna existente

`User.password String` → `User.password String?` (`ALTER COLUMN "password" DROP NOT NULL`).

Sem perda de dados. **Rollback não é livre:** re-adicionar `NOT NULL` só funciona enquanto
nenhuma conta só-Google existir. O script de rollback (`/db-change`) diz isso.

### Como isso vai pro banco

`/db-change` gera `prisma/db-scripts/2026-09-08-login-google.sql` (SQL de aplicação +
rollback comentado). O `npx prisma db push && npx prisma generate` é **execução humana**
(`RULES.md` §2). Pendência registrada em `docs/specs/INDEX.md`.

## Superfície de API

| Método | Rota | Guards | Corpo | Retorno |
|---|---|---|---|---|
| `POST` | `/auth/google` | — (pública) + `ThrottlerGuard` 5/60s + header `X-App: oratio` | `{ credential: string }` | `200 { access_token, refresh_token }` |
| `POST` | `/users/me/set-password` | `JwtAuthGuard` + `ThrottlerGuard` 5/60s | `{ password, confirmPassword }` | `200 { message: "Senha definida." }` |

Erros: ver tabela "Erros" da spec (linha a linha). Resumo: `/auth/google` → 400 (DTO), 401
(token ruim ou `email_verified:false`), 503 (`GOOGLE_CLIENT_ID` ausente), 429. `set-password` →
400 (DTO / senhas diferentes), 401 (sem token), 409 (conta já tem senha), 429.

## ⚠️ db push × testes × curl — leia antes de fechar a Fase A

**Os testes unitários da Fase A ficam verdes SEM o `db push` ter rodado.** O `PrismaService` é
mockado como objeto de `jest.fn()`s (`ARCHITECTURE.md` §2/§10) — nenhum teste toca banco. O
`import { LinkedAccount } from '@prisma/client'` compila depois de `npx prisma generate` (que lê
só o `schema.prisma`, **não** conecta no banco). Então `npm test` / `npm run build` passam com
as tabelas novas **não existindo**.

**O curl contra `localhost:3000` é outra história** — o `start:dev` usa o `DATABASE_URL` real:

| Caminho de curl | Precisa do `db push`? | Por quê |
|---|---|---|
| assinatura inválida → 401 | **não** | rejeita antes de qualquer query |
| `credential` ausente → 400 | **não** | barra no `ValidationPipe` |
| `email_verified: false` → 401 | **não** | rejeita antes de tocar `LinkedAccount` |
| `GOOGLE_CLIENT_ID` ausente → 503 | **não** | rejeita na entrada |
| e-mail já existente **com senha** → auto-liga | **SIM** | faz `linkedAccount.findUnique` + `create` |
| conta só-Google → `login` por senha → 401 | **SIM** | `password` precisa estar nullable no banco |
| `set-password` → 200 / 409 | **SIM** | depende de existir conta com `password: null` |
| `change-password` em conta só-Google → 409 | **SIM** | idem |
| `delete` em conta só-Google | **SIM** | idem |
| cadastro novo via Google | **SIM** | `user.create` com `password: null` + `linkedAccount.create` |
| corrida `P2002` no cadastro | **SIM** | precisa das tabelas para reproduzir a corrida |

**Conclusão:** o humano roda `npx prisma db push && npx prisma generate` (contra o Postgres
local dele) **depois** do merge na `develop` e **antes** de rodar a sequência de curl completa.
Sem isso, os caminhos "SIM" respondem **500** (`P2021 table does not exist` / violação de
`NOT NULL`), não o status esperado. A entrega da Fase A vem com o comando exato e esse aviso.

## Lista de tarefas — Fase A (backend, núcleo)

Fatias verticais (model → service → controller → DTO → teste), uma AC fechada por fatia. Detalhe
item a item em `docs/tasks/login-google-todo.md`.

- **A1 — Schema.** `LinkedAccount` + `User.password` opcional + relação inversa. `prisma generate`
  local. `/db-change` gera o `.sql`. *(Enabler — sem AC própria.)*
- **A2 — `POST /auth/google`: verificação do token.** `GoogleLoginDto`, `AuthService`
  verifica com `google-auth-library` (mockada no spec), assere `iss`, exige `email_verified`.
  Fecha: assinatura inválida→401, expirado→401, `aud` errado→401, `email_verified:false`→401,
  `credential` ausente→400, `GOOGLE_CLIENT_ID` ausente→503.
- **A3 — `POST /auth/google`: resolução de conta.** `LinkedAccount` hit → tokens; sem match +
  user novo → cria `User` (`password:null`, `emailVerified:true`, `name` do Google) +
  `LinkedAccount`; sem match + user existe → auto-liga. `@HttpCode(200)`, reusa `generateTokens`.
  Fecha: cadastro novo, retorno com `LinkedAccount`, auto-ligação (`password`/`name` intactos).
- **A4 — `login()` com `password: null`.** Trata como credencial inválida antes do `bcrypt`.
  Fecha: login por senha em conta só-Google → `401 "Invalid credentials"`.
- **A5 — `POST /users/me/set-password`.** `SetPasswordDto`, aceita só com `password === null`
  (senão 409), sem revogar sessão, checa `confirmPassword`. Fecha: set-password feliz, 409,
  sem token→401, senhas diferentes→400.
- **A6 — `forgot`→`reset` em conta só-Google.** Confirmar que define senha do zero sem quebrar
  no `null`; teste de regressão. Fecha: recuperação de conta só-Google.
- **A8 — `changePassword` / `deleteAccount` com `password: null`.** Ambos fazem `bcrypt.compare`
  contra `user.password` → 500 em conta só-Google. `changePassword` → **409** com mensagem
  mandando usar "Definir senha", checado antes do `bcrypt`. `deleteAccount` → **decidido
  (2026-09-09): re-auth Google.** `DeleteAccountDto` aceita `{ password?, googleCredential? }`;
  sem senha exige `googleCredential` fresco verificado por `AuthService.verifyGoogleIdentity`
  (wrapper do helper da A2; `AuthModule` exporta `AuthService`, `UsersModule` importa
  `AuthModule`) com `sub` batendo num `LinkedAccount` do user. Fecha: `change-password` em conta
  só-Google → 409; `delete` em conta só-Google → 400 sem prova / 400 com prova de outra conta /
  200 com prova válida. **(Entregue na branch `feat/login-google-a8-delete`.)**
- **A9 — `emailVerified: true` na auto-ligação** *(dentro da A3)*. Quando a auto-ligação encontra
  `User` com `emailVerified: false`, gravar `true` — o Google verificou a mesma caixa. Sem isso a
  pessoa fica barrada pra sempre no `login()`. `password`/`name` continuam intactos. Fecha: AC de
  `emailVerified` na auto-ligação (spec atualizada).
- **A10 — Corrida no cadastro novo (`P2002`)** *(dentro da A3)*. Dois `POST /auth/google`
  concorrentes p/ o mesmo e-mail inédito: o 2º bate no `@@unique` → capturar
  `PrismaClientKnownRequestError` code `P2002` (em `user.create` **e** em `linkedAccount.create`)
  e **re-resolver** (LinkedAccount por `sub` → senão User por e-mail → auto-liga). `user.create` +
  `linkedAccount.create` do caminho novo dentro de `prisma.$transaction` (callback) para não
  deixar `User` órfão. Fecha: AC de corrida (200, não 500).
- **A7 — Docs + fechamento.** `ARCHITECTURE.md` §4 (`LinkedAccount`), §5 (auth: rota nova,
  `password` opcional, `set-password`, `emailVerified` na auto-ligação, `change-password`/`delete`
  em conta só-Google), §7 (`deleteAccount` — o que mudou), §8 (quirk 200/201 — texto na spec),
  §9 (`GOOGLE_CLIENT_ID`). Suite inteira verde + `lint`. Marcar `[x]` no todo. Atualizar
  status/pendências no `INDEX.md`.

### ⛳ Checkpoint A (revisão humana — **parar aqui**)

- [ ] `npm test` inteiro verde · `npm run build` limpo · `npm run lint` sem regressão
- [ ] Merge `feat/login-google` → `develop` com `--no-ff` + push
- [ ] Entregar ao humano: comando do `db push` local + a sequência de curl dos caminhos ruins
      (assinatura inválida · `email_verified:false` · e-mail já existente com senha · conta
      só-Google tentando login por senha · 409 do set-password · 409 do change-password em conta
      só-Google) com o resultado esperado de cada
- [ ] **Não seguir para a Fase B sem retorno do humano**

## Fases B / C / D

- **Fase B — Frontend, botão e fluxo** (`oratio`). ✅ **na `develop` do `oratio`.** Script GIS,
  `initialize`/`renderButton` em `/login` e `/register`, `ux_mode: "popup"`,
  `use_fedcm_for_button: true`, `authService.loginWithGoogle(credential)`, texto fixo de ajuda.
  Testes Vitest com `./api` mockado. Falta o teste real no navegador (humano, precisa do cliente
  OAuth + `VITE_GOOGLE_CLIENT_ID`).
- **Fase C — Bordas + definir senha.** ✅ **na `develop` dos dois repos.** Backend: `GET /users/me`
  devolve `hasPassword` (C1). Frontend: `profileService.setPassword` → `POST /users/me/set-password`,
  `SetPasswordModal`, `AccountSettings` mostra "Definir senha" **ou** "Trocar senha" conforme
  `hasPassword`. `forgot`→`reset` para conta só-Google já acessível pela `/login` (Fase B).
- **Fase D — CSP, deploy, PWA.** 🚧 **CSP na branch `oratio:feat/login-google-fase-d`.** Quatro
  fontes do GIS na CSP do `oratio/vercel.json` (`script-src`/`style-src`/`connect-src`/`frame-src`,
  valores da doc do Google) + plano de verificação pós-deploy escrito em
  `oratio/docs/tasks/login-google-todo.md`. `ALLOWED_ORIGINS` **conferido, inalterado**.
  **Humano:** `GOOGLE_CLIENT_ID` (Render) + `VITE_GOOGLE_CLIENT_ID` (Vercel) + publicar o app
  OAuth (Política de Privacidade); ~~`npx prisma db push` de produção~~ (feito 2026-09-09,
  Supabase); ~~cliente OAuth no Google Cloud Console~~ (feito 2026-09-09 — cliente "Oratio Web",
  consent screen, usuários de teste); smoke no iPhone com PWA; rodar a verificação pós-deploy da
  CSP.

## Riscos e mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| `db push` não rodado antes do curl | Alto (parece bug, é infra) | Seção dedicada acima + aviso na entrega da Fase A |
| Sem migrations — `password` de `NOT NULL` p/ nullable | Médio | Aditivo/não-destrutivo; rollback documentado como condicional no `.sql` |
| Exceção de constraint `@unique(email)` vazando como 500 | Médio | O código trata colisão de e-mail como o fluxo de auto-ligação (passo 4), nunca deixa o Prisma lançar |
| `bcrypt.compare(x, null)` quebra | Médio | A4 trata `password == null` antes do `bcrypt`; teste explícito |
| `google-auth-library` batendo rede em teste | Alto (viola `RULES.md` §3) | `jest.mock('google-auth-library')` no nível do módulo; `verifyIdToken` mockado por teste |
| Sessão de acesso roubada usando `set-password` | Médio | Só aceita com `password === null`; conta com dono+senha → 409 (o controle) |
| Contrato desalinhado com o frontend | Médio | Fase B revisa `authService`/`api.ts` lado a lado; rota/DTO mudam junto nos dois repos |

## Questões em aberto

Nenhuma.

Resolvidas:
- `X-App` no `set-password` — `change-password` não exige, `set-password` também não.
- **`DELETE /users/me` numa conta só-Google** (A8, parte `deleteAccount`) — 2026-09-09: escolhida
  a re-auth Google (proposta recomendada). `DeleteAccountDto` → `{ password?, googleCredential? }`;
  sem senha exige `googleCredential` fresco verificado por `AuthService.verifyGoogleIdentity`,
  `sub` casando um `LinkedAccount` do user. Entregue na branch `feat/login-google-a8-delete`.
