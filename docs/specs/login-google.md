# Spec: login-google — "Entrar com Google"

> Status: em andamento (Fases A–D entregues; **Fase E na `develop` dos dois repos desde 2026-09-09, verificada no navegador no Checkpoint E 2026-09-10 (7 cenários OK) e com o BUG-E1 corrigido — sem bloqueio de código pra `main`; falta só pendência humana: env vars de prod + publicar o app OAuth**)
> Plano: `docs/tasks/login-google-plan.md` · Checklist: `docs/tasks/login-google-todo.md`
> Frontend pareado: `oratio/docs/specs/login-google.md` (ponteiro — precisa herdar a Fase E depois do "ok")

## Objetivo

Permitir criar conta e entrar no Oratio com um clique via "Entrar com Google", ligando
automaticamente a uma conta e-mail+senha já existente quando — e só quando — o Google atesta
`email_verified: true`.

## Stack

Diverge do padrão da casa em três pontos, todos justificados:

- **Nova dependência backend: `google-auth-library`** (Google, oficial) para verificar o
  `id_token` — **aprovada pelo humano em 2026-09-08** (`RULES.md` §8). É o caminho da
  [documentação oficial](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).
  A adição ao `package.json` acontece na Fase A.
- **Cliente web GIS no frontend** — `https://accounts.google.com/gsi/client`, carregado via
  `<script>`. É a lib atual do Google ([overview](https://developers.google.com/identity/gsi/web/guides/overview));
  a antiga *Google Sign-In platform library* / `gapi.auth2` está descontinuada e **não** deve ser
  usada.
- **`User.password` deixa de ser obrigatório** no schema (ver "Modelo de dados").

Todo o resto segue `docs/ARCHITECTURE.md` §1 (NestJS, Prisma, JWT access+refresh, `PrismaService`
mockado nos testes, HTTP externo mockado no nível do módulo).

## Comportamento esperado

### Fluxo feliz — `POST /auth/google`

1. Frontend obtém um `credential` (o `id_token` JWT do Google) pelo callback do botão GIS e o
   envia no corpo.
2. Backend verifica o `credential` com `google-auth-library` (`OAuth2Client.verifyIdToken`), que
   já valida **assinatura** (chaves públicas do Google), **`aud`** (== `GOOGLE_CLIENT_ID`),
   **`iss`** e **`exp`**. O código **também assere explicitamente** `iss ∈ { "accounts.google.com",
   "https://accounts.google.com" }`.
3. Backend exige `email_verified === true` no payload. Se for `false` (ou ausente) → **401**, e
   **nenhuma** conta é criada ou alterada.
4. Backend resolve a conta, nesta ordem:
   - **`LinkedAccount` com `provider: "google"` e `providerAccountId` == `sub`?** → carrega o
     `User` dono e emite tokens. Fim. Nenhuma linha nova.
   - **Senão, `User` com `email` == `email` do token (minúsculo)?**
     - **Não existe** → cria `User` (`name` = `name` do Google, `email`, `emailVerified: true`,
       `password: null`) **e** um `LinkedAccount`. Emite tokens. *(Cadastro novo.)*
     - **Existe** → cria um `LinkedAccount` ligado a esse `User` (auto-ligação — decisão da spec,
       só chega aqui com `email_verified: true` já confirmado). Emite tokens.
       - `User.emailVerified: true` → `User.password` e `User.name` **não são tocados**.
       - `User.emailVerified: false` → na **mesma transação** do vínculo: `emailVerified: true`,
         **`password: null`**, tokens pendentes limpos e todas as `RefreshSession` antigas
         revogadas (ver "E-mail verificado na auto-ligação" — pré-sequestro de conta).
         `User.name` não é tocado.
5. Emissão de tokens: idêntica a `POST /auth/login` — reaproveita `AuthService.generateTokens`,
   que cria uma `RefreshSession` nova (com `userAgent`/`ipAddress` dos headers) e devolve
   `{ access_token, refresh_token }`.

### E-mail verificado na auto-ligação

Quando a auto-ligação (passo 4, "Existe") encontra um `User` com `emailVerified: false`, o
backend **grava `emailVerified: true`**. O Google acabou de comprovar a posse da **mesma caixa
de e-mail** que o nosso link de verificação comprovaria — a prova é equivalente. Sem isso, a
pessoa entra por Google mas fica barrada **para sempre** no `login()` (que exige
`emailVerified`), inclusive depois de definir uma senha por `set-password` ou pelo
`forgot`→`reset`. Cadastro novo via Google (passo 4, "Não existe") já nasce com
`emailVerified: true` — esta regra só estende o mesmo princípio ao `User` pré-existente.

**E a senha desse cadastro não verificado é apagada** (decisão do dono, 2026-09-14, revisão
pré-produção — substitui a regra anterior de "manter a senha"). O motivo é **pré-sequestro de
conta**: qualquer pessoa pode cadastrar por senha o e-mail de outra e nunca verificar. Se a
auto-ligação mantivesse `User.password`, no dia em que a dona do e-mail entrasse pelo Google a
conta ficaria com `emailVerified: true` **e** a senha do atacante — que passaria a logar na conta
da vítima. Um cadastro não verificado não comprovou nada, então nada dele merece confiança. Na
mesma `$transaction` do `LinkedAccount`:

- `password: null` e `emailVerified: true` (a conta vira só-Google; a pessoa define a própria
  senha depois por `set-password` — que exige login Google recente, spec `prova-identidade` — ou
  pelo `forgot`→`reset`);
- limpa os tokens pendentes nascidos do cadastro não comprovado: `emailVerificationToken`/
  `emailVerificationTokenExpires`, `passwordResetToken`/`passwordResetExpires`,
  `pendingEmail`/`pendingEmailToken`/`pendingEmailExpires`;
- apaga todas as `RefreshSession` desse usuário **antes** de emitir a sessão nova.

Conta **já verificada** (`emailVerified: true`) mantém tudo como antes: a senha foi comprovada
pelo dono do e-mail. O caminho de corrida (`P2002` → re-resolução) passa pela mesma função e tem o
mesmo resultado; se a própria transação de limpeza perder a corrida no `@@unique` do vínculo, ela
é desfeita inteira e a requisição vencedora é quem fez a limpeza. `User.name` continua intocado
nos dois casos.

### Nome e foto

- O `name` do Google é usado **só na criação** da conta. Logins seguintes **nunca** sobrescrevem
  `User.name` — quem manda é o que a pessoa editou dentro do app.
- A `picture` chega junto no escopo `profile` (que pedimos por causa do `name`), então **não é
  questão de escopo e sim de não persistir**. Não é gravada em lugar nenhum. Nota: URLs de foto
  do Google não são estáveis a longo prazo, o que reforça não guardá-las.

### Conta só-Google (sem senha)

- **Login por senha** (`POST /auth/login`) numa conta com `password: null`: **~~responde o mesmo
  401 `{ message: "Invalid credentials" }` genérico~~ — revisto na Fase E (E1): agora é
  401 com mensagem específica *"Esta conta entra com o Google…"*.** O
  `bcrypt.compare(password, user.password)` **não pode** receber `null` como hash — o código
  trata `password == null` como "credencial inválida" antes de chamar o `bcrypt` (isso não muda).
- **Recuperação de quem perdeu o acesso à conta Google**: `POST /auth/forgot-password` →
  `POST /auth/reset-password` funciona normalmente e **define** senha mesmo quando não havia
  nenhuma. É o caminho oficial de recuperação (o Google já nos deu `email_verified: true`, o
  e-mail é comprovadamente entregável). A resposta continua genérica — nenhum vazamento novo.
  `resetPassword` já revoga todas as `RefreshSession`; isso se mantém.
- **Definir senha autenticado** (`POST /users/me/set-password`): aceita **só** quando
  `user.password` é `null` **e**, desde 2026-09-14, com `googleCredential` de um login Google
  recente deste usuário (spec `prova-identidade`, "Definir a primeira senha"). Se a conta já tem senha → **409**, com mensagem mandando usar
  "Trocar senha" (que exige a senha atual). O **409 é o que protege** contra uma sessão de acesso
  roubada: sem senha antiga, não há como "roubar" uma troca, e o único risco real — alguém com
  sessão roubada de uma conta que **já tem** dono com senha — é justamente o que o 409 barra.
- **`set-password` NÃO revoga nenhuma `RefreshSession`** — decisão consciente, diferente de
  `UsersService.changePassword` / `AuthService.resetPassword`. Aquelas revogam porque **uma senha
  mudou** (uma credencial que existia deixou de valer, e um `refresh_token` vazado precisa parar).
  Aqui não existia senha nenhuma: nada foi invalidado, não há credencial antiga para expirar, e
  revogar só deslogaria a própria pessoa sem ganho de segurança. Registrar essa diferença no
  código (comentário no ponto de uso) para ninguém "consertar" copiando o `deleteMany` do
  `changePassword`.
- **`POST /users/me/change-password` numa conta só-Google** (`password: null`): hoje faz
  `bcrypt.compare(currentPassword, user.password)` — com `null` isso **lança** e vira 500.
  Passa a responder **409** com `{ message: "Esta conta não tem senha. Use \"Definir senha\"
  para criar uma." }`, checado no service **antes** do `bcrypt` (não pode depender de o frontend
  esconder o botão).
- **`DELETE /users/me` numa conta só-Google**: mesmo problema (`bcrypt.compare` com `null` → 500).
  O check de senha existe de propósito (`ARCHITECTURE.md` §7: token roubado não pode, sozinho,
  destruir a conta). **Decidido (2026-09-09):** `DeleteAccountDto` aceita
  `{ password?, googleCredential? }` (nenhum obrigatório no DTO — qual exigir depende da conta);
  conta com senha → `password` obrigatório (inalterado, `bcrypt.compare`); conta sem senha →
  `googleCredential` fresco obrigatório, verificado pelo **mesmo** helper do `POST /auth/google`
  (`AuthService.verifyGoogleIdentity`), com `payload.sub` batendo num `LinkedAccount`
  (`provider: "google"`) **deste** user. Prova ausente ou de outra conta Google → **400**, nunca
  500. Não conseguir excluir a conta seria problema de LGPD, então **algum** caminho sem senha
  precisa existir.

### Desvincular

Fora de escopo no v1 (ver "Fora de escopo"). Uma conta ligada continua ligada. Não há rota para
remover um `LinkedAccount`.

### Erros

| Situação | Status | Corpo | Loga? |
|---|---|---|---|
| `credential` ausente/não-string no corpo | 400 | `{ message: [...], error: "Bad Request" }` (ValidationPipe) | não |
| Header `X-App` ausente | **sem efeito** — `POST /auth/login` também não confere `x-app` hoje (só `POST /users` confere). O frontend manda `x-app: oratio` em toda request de qualquer forma. | — | — |
| `credential` com assinatura inválida / `exp` no passado / `aud` de outro client | 401 | `{ message: "Não foi possível validar seu login com o Google. Tente de novo." }` | não (é erro de cliente, não incidente) |
| `email_verified: false` no payload | 401 | `{ message: "Seu e-mail no Google não está verificado. Confirme seu e-mail na sua Conta Google e tente de novo — ou crie sua conta do Oratio com e-mail e senha." }` | não |
| `GOOGLE_CLIENT_ID` não configurada no ambiente | 503 | `{ message: "Login com Google indisponível no momento." }` | sim (erro de config) |
| `set-password` numa conta que já tem senha | 409 | `{ message: "Esta conta já tem uma senha. Use \"Trocar senha\" nas configurações (é preciso informar a senha atual)." }` | não |
| `set-password` sem `Authorization` / token inválido | 401 | padrão do `JwtAuthGuard` | não |
| `set-password` com `password` != `confirmPassword` | 400 | `{ message: "As senhas não conferem" }` | não |
| `set-password` sem `googleCredential` (2026-09-14) | 400 | `{ message: [...] }` (ValidationPipe) | não |
| `set-password` com `googleCredential` inválido/expirado | 401 | `{ message: "Não foi possível validar seu login com o Google. Tente de novo." }` | não |
| `set-password` com `googleCredential` cujo `sub` não é um `LinkedAccount` do user | 400 | `{ message: "Não foi possível confirmar sua identidade." }` | não |
| `change-password` numa conta só-Google (`password: null`) | 409 | `{ message: "Esta conta não tem senha. Use \"Definir senha\" para criar uma." }` | não |
| `DELETE /users/me` numa conta só-Google **sem** `googleCredential` (ou com um cujo `sub` não bate um `LinkedAccount` do user) | 400 | `{ message: "Não foi possível confirmar sua identidade." }` | não |
| `DELETE /users/me` numa conta só-Google com `googleCredential` inválido/expirado | 401 | `{ message: "Não foi possível validar seu login com o Google. Tente de novo." }` (helper do `POST /auth/google`) | não |
| Corrida: 2º `POST /auth/google` concorrente para o mesmo e-mail inédito | 200 (não 500) | par de tokens normal | não — o `P2002` do Prisma é capturado e o fluxo re-resolve |

Nenhum caminho de erro cria uma segunda conta com o mesmo e-mail — o `@unique` em `User.email`
garante no banco, e o código trata a colisão como o fluxo de auto-ligação (passo 4), nunca deixa
vazar uma exceção de constraint.

### Timezone

Sem fronteira de dia nova. Expiração do `id_token` é `exp` (epoch UTC), verificada pela lib.
`linkedAt` é `DateTime @default(now())` como o resto do schema.

## Requisitos de saída

### `POST /auth/google`

- **Método/path:** `POST /auth/google`
- **Guards:** nenhum (rota pública, como `/auth/login`). `ThrottlerGuard` com
  `@Throttle({ default: { limit: 5, ttl: 60_000 } })`. **O propósito aqui é conter abuso genérico**
  (spam de requisições, alguém varrendo a rota) — **não** é defesa de força bruta: não há senha
  para adivinhar, o `credential` só é aceito se o Google o assinou. É o mesmo número do login por
  paridade, não porque o modelo de ameaça seja o mesmo.
- **Headers exigidos:** `Content-Type: application/json`. `X-App` **não** é conferido (nem o
  `/auth/login` confere hoje) — o frontend manda `x-app: oratio` em tudo, mas a rota não depende
  disso.
- **Request DTO — `GoogleLoginDto`:**
  | Campo | Tipo | Validação |
  |---|---|---|
  | `credential` | string | `@IsString`, `@IsNotEmpty` — o `id_token` JWT do Google |
  - `ValidationPipe` global: `whitelist`/`forbidNonWhitelisted` — qualquer campo extra derruba a request.
- **Response 200** (`@HttpCode(200)`):
  ```json
  { "access_token": "<jwt>", "refresh_token": "<jwt>" }
  ```
  Mesmo shape de `POST /auth/login`. Vale para conta nova, conta ligada agora, e conta que já
  tinha `LinkedAccount`.
- **Erros:** 400 (DTO inválido), 401 (token inválido/expirado/`aud` errado/assinatura inválida;
  ou `email_verified: false`), 503 (`GOOGLE_CLIENT_ID` ausente), 429 (throttle).

### `POST /users/me/set-password`

- **Método/path:** `POST /users/me/set-password`
- **Guards:** `JwtAuthGuard` + `ThrottlerGuard` (`@Throttle({ default: { limit: 5, ttl: 60_000 } })`).
  Mesma pilha de guards/headers da rota irmã `POST /users/change-password` (incl. `X-App` se ela exigir — **a confirmar**).
- **Request DTO — `SetPasswordDto`:**
  | Campo | Tipo | Validação |
  |---|---|---|
  | `password` | string | `@IsString`, `@MinLength(8)` (alinhar com o DTO de reset atual) |
  | `confirmPassword` | string | `@IsString`; igualdade checada no service (como `create` de `UsersService` já faz para registro) |
  | `googleCredential` | string | `@IsString` + `@IsNotEmpty` (2026-09-14). id_token de um login Google recente; verificado por `assertFreshProof` (spec `prova-identidade`) |
- **`userId`:** de `req.user.userId`, **nunca** do corpo (`RULES.md` §5).
- **Response 200:** `{ "message": "Senha definida." }`
- **Efeito colateral:** grava `bcrypt.hash(password, 10)` em `User.password`. **Nada além disso** —
  nenhuma `RefreshSession` é tocada (ver "Comportamento esperado → Conta só-Google" para o porquê
  da diferença em relação a `changePassword`).
- **Erros:** 400 (DTO inválido, sem `googleCredential`, senhas diferentes, ou `sub` que não é
  deste user), 401 (sem token, ou id_token inválido/expirado), 409 (conta já tem senha, checado
  antes do Google), 429.

### Frontend (contrato consumido — detalhe em `oratio/docs/specs/login-google.md`)

- `authService.loginWithGoogle(credential: string, nonce?: string)` → `POST /auth/google` pelo
  `api` compartilhado (mesmo host/baseURL, header `x-app: oratio` já embutido). No 200: grava
  `access_token`/`refresh_token` no `localStorage` e navega para `/oratio/home`.
- Botão "Entrar com Google" renderizado (`google.accounts.id.renderButton`) em `/login` e
  `/register`. `google.accounts.id.initialize({ client_id: VITE_GOOGLE_CLIENT_ID, callback,
  use_fedcm_for_button: true, itp_support: true, ux_mode: "popup", nonce })`.
  **Nunca** `ux_mode: "redirect"` nem `login_uri` (ver "Notas de ambiente" — PWA no iOS).
- Texto **fixo e incondicional** abaixo da área de erro da tela de login:
  *"Já entrou com Google antes? Experimente o botão Entrar com Google."* — aparece em todo erro
  de senha, não é condicional ao tipo de conta (senão vaza que a conta é só-Google).
- `GET /users/me` passa a devolver **`hasPassword: boolean`**. Em "Configurações da conta" o
  frontend mostra **"Definir senha"** (chama `POST /users/me/set-password`) quando
  `hasPassword === false` e **"Trocar senha"** (chama `POST /users/me/change-password`) quando
  `true` — nunca os dois. `SetPasswordModal` é o `ChangePasswordModal` sem o campo "senha atual"
  e sem a mensagem de sessões revogadas.

## Modelo de dados

### Aditivo

**Novo model `LinkedAccount`:**

```prisma
// Vínculo entre um User e uma identidade de um provedor social (Google
// hoje; o formato comporta Apple depois SEM mexer em User). Uma linha por
// (provider, conta no provider). `providerAccountId` é o `sub` do id_token
// — id opaco e estável do provedor, NUNCA o e-mail. `emailSnapshot` é o
// e-mail que o provedor afirmou (com email_verified=true) no momento da
// ligação: registro para auditar uma contestação futura, não fonte de
// login. A linha só é criada quando o provedor confirma email_verified=true.
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

E no `User`: `linkedAccounts LinkedAccount[]`.

Tudo aditivo: `CREATE TABLE` + índices. Nenhum dado existente é tocado.

### Não-destrutivo, mas alterando coluna existente de `User`

`User.password String` → `User.password String?` (`ALTER COLUMN "password" DROP NOT NULL`).

Não há perda de dados. **Mas o rollback não é livre:** re-adicionar `NOT NULL` só funciona
enquanto nenhuma conta só-Google (com `password` nulo) existir. Depois do primeiro cadastro via
Google, o rollback dessa linha específica falha até esses registros ganharem senha ou serem
removidos. O script de rollback precisa dizer isso.

### `db push` — **aplicado em produção (2026-09-09)**

`/db-change` escreveu `prisma/db-scripts/2026-09-08-login-google.sql` (aplicação + rollback
comentado). O humano rodou `npx prisma db push` contra o Supabase de produção nesta sessão —
saída "Your database is now in sync with your Prisma schema", datasource
`aws-1-us-east-1.pooler.supabase.com`. **`LinkedAccount` e `User.password` nullable já estão em
produção.** Fase E não muda o schema; a spec `boas-vindas` precisa do **próprio** push (a coluna
`welcomeSeenAt` não pega carona neste, que já foi).

## Critérios de aceite (testáveis, em BDD)

### Backend — `POST /auth/google`

- [x] **Dado** que não existe `User` com o e-mail do token, **quando** `POST /auth/google` com
  `credential` válido e `email_verified: true`, **então** 200 com `{ access_token, refresh_token }`,
  um `User` novo existe (`password` nulo, `emailVerified: true`, `name` == `name` do Google) e uma
  linha `LinkedAccount` (`provider: "google"`, `providerAccountId` == `sub` do token).
- [x] **Dado** um `LinkedAccount` google já existente para o `sub` do token, **quando**
  `POST /auth/google` com `credential` válido, **então** 200 com par de tokens do usuário dono e
  **nenhuma** linha `User` ou `LinkedAccount` nova é criada.
- [x] **Dado** um `User` e-mail+senha **verificado** já cadastrado com o mesmo e-mail do token e
  **sem** `LinkedAccount`, **quando** `POST /auth/google` com `credential` válido e
  `email_verified: true`, **então** 200 com par de tokens **desse** usuário, uma linha
  `LinkedAccount` nova ligada a ele, e `User.password` + `User.name` **inalterados**.
- [x] ~~**Dado** um `User` e-mail+senha com `emailVerified: false` e sem `LinkedAccount`, **quando**
  `POST /auth/google` auto-liga esse user, **então** `User.emailVerified` passa a `true`;
  `password`/`name` continuam intactos.~~ **Substituído (2026-09-14, pré-sequestro de conta)** pelo
  critério abaixo.
- [x] **Dado** um `User` e-mail+senha com `emailVerified: false` e sem `LinkedAccount`, **quando**
  `POST /auth/google` auto-liga esse user, **então**, numa `$transaction`: `emailVerified: true`,
  `password: null`, tokens pendentes (verificação, reset, troca de e-mail) nulos, todas as
  `RefreshSession` antigas apagadas antes da emissão da nova, e a resposta traz
  `googleLinkedNow: true`; `name` intacto. O mesmo vale quando se chega aqui pelo caminho de
  corrida (`P2002` no cadastro). *(`auth.service.spec.ts` — "A9 — auto-linking an UNVERIFIED
  account…" e "A9/A10 — race path…")*
- [x] **Dado** a auto-ligação acima, **quando** `POST /auth/login` com a senha antiga do cadastro,
  **então** 401 — a conta tem `password: null` (`auth.service.spec.ts` — "login — conta só-Google").
- [x] **Dado** que dois `POST /auth/google` concorrentes chegam para o mesmo e-mail inédito (o
  2º encontra o `@@unique` já preenchido — `P2002`), **quando** o 2º é processado, **então**
  responde 200 com o par de tokens do `User` recém-criado, não 500.
- [x] **Dado** um `credential` cujo payload traz `email_verified: false`, **quando**
  `POST /auth/google`, **então** 401 com `{ message: "Seu e-mail no Google não está verificado. ..." }`
  e **nenhum** `User`/`LinkedAccount` é criado ou alterado.
- [x] **Dado** um `credential` com assinatura inválida (`verifyIdToken` lança), **quando**
  `POST /auth/google`, **então** 401 com `{ message: "Não foi possível validar seu login com o Google. Tente de novo." }`.
- [x] **Dado** um `credential` expirado (`exp` no passado), **quando** `POST /auth/google`,
  **então** 401.
- [x] **Dado** um `credential` válido mas com `aud` de outro client ID, **quando**
  `POST /auth/google`, **então** 401.
- [x] **Dado** um corpo `{}` (sem `credential`), **quando** `POST /auth/google`, **então** 400.
- [ ] **Dado** 6 requisições em 60s do mesmo IP, **quando** a 6ª chega em `POST /auth/google`,
  **então** 429.

### Backend — senha / recuperação

- [x] ~~**Dado** um `User` com `password: null`, **quando** `POST /auth/login` com o e-mail dele e
  qualquer senha, **então** 401 com `{ message: "Invalid credentials" }` (idêntico ao de senha
  errada — sem revelar que é conta Google).~~ **Substituído pelo 1º critério da Fase E** (mensagem
  específica). O 401 e a checagem antes do `bcrypt` permanecem.
- [x] **Dado** um `User` com `password: null`, **quando** `POST /auth/forgot-password` com o
  e-mail dele e depois `POST /auth/reset-password` com o token gerado e uma senha nova, **então**
  `POST /auth/login` com essa senha passa a devolver 200, e todas as `RefreshSession` anteriores
  desse usuário foram apagadas.
- [x] **Dado** um usuário autenticado cuja conta tem `password: null`, **quando**
  `POST /users/me/set-password` com `password`/`confirmPassword` iguais e válidos, **então** 200
  `{ message: "Senha definida." }`, `User.password` passa a ter um hash bcrypt, e **nenhuma**
  `RefreshSession` do usuário é apagada (o teste asserta que o mock de `refreshSession.deleteMany`
  não foi chamado).
- [x] **Dado** um usuário autenticado cuja conta **já tem** senha (`password` não-nulo), **quando**
  `POST /users/me/set-password`, **então** 409 com a mensagem que aponta para "Trocar senha", e
  `User.password` não muda. *(Teste obrigatório — é o controle de segurança da rota.)*
- [x] **Dado** nenhuma credencial (`Authorization` ausente), **quando**
  `POST /users/me/set-password`, **então** 401.
- [x] **Dado** `password` != `confirmPassword`, **quando** `POST /users/me/set-password`, **então** 400.
- [x] **Dado** um `User` com `password: null`, **quando** `GET /users/me`, **então** o corpo traz
  `hasPassword: false`; **dado** um `User` com senha, `hasPassword: true` — e o hash **nunca**
  aparece no corpo (o teste asserta `expect(result).not.toHaveProperty('password')`).
- [x] **Dado** um usuário autenticado cuja conta tem `password: null`, **quando**
  `POST /users/me/change-password`, **então** 409 `{ message: "Esta conta não tem senha. ..." }`
  e o `bcrypt.compare` **não** é chamado com `null` (o teste asserta o mock).
- [x] **Dado** um usuário autenticado cuja conta tem `password: null`, **quando**
  `DELETE /users/me` **sem** `googleCredential`, **então** 400 (não 500) e `user.delete` não é
  chamado; **quando** com um `googleCredential` cujo `sub` **não** bate um `LinkedAccount` desse
  user, **então** 400 e `user.delete` não é chamado; **quando** com um `googleCredential` fresco
  cujo `sub` bate um `LinkedAccount` desse user, **então** 200 e a conta é apagada (o teste
  asserta os args de `verifyGoogleIdentity`, `linkedAccount.findUnique` e `user.delete`).
- [x] **Dado** um usuário autenticado cuja conta **tem** senha, **quando** `DELETE /users/me`
  com a senha certa → 200; com a senha errada → 401; **sem** `password` → 400 (comportamento
  anterior preservado).

### Frontend (resumo — critérios completos no par)

- [ ] **Dado** a tela `/login` carregada, **então** o botão "Entrar com Google" é renderizado e o
  texto fixo *"Já entrou com Google antes? Experimente o botão Entrar com Google."* aparece abaixo
  da área de erro — sempre, independente de ter havido erro.
- [ ] **Dado** o callback do GIS entrega um `credential`, **quando** o fluxo conclui, **então**
  `authService.loginWithGoogle` faz `POST /auth/google` com `{ credential }` (`./api` mockado,
  com asserção do corpo), e no 200 os tokens são gravados e a navegação vai para `/oratio/home`.
- [ ] **Dado** `POST /auth/google` responde 401, **quando** o usuário tenta, **então** uma
  mensagem legível aparece e **nenhum** token é gravado.

## Plano de testes

- **Unitário (Jest):**
  - `auth.service.spec.ts` (ou novo `auth-google.spec.ts`): `jest.mock('google-auth-library')` —
    `OAuth2Client.prototype.verifyIdToken` mockado por teste para devolver um payload sintético
    ou lançar. `PrismaService` mockado. Cobre: cadastro novo, retorno com `LinkedAccount`,
    auto-ligação a conta existente, `email_verified: false`, assinatura inválida, expirado, `aud`
    errado, `nonce` divergente, `GOOGLE_CLIENT_ID` ausente.
  - `auth.controller.spec.ts` / DTO: `credential` ausente → 400; throttle.
  - `auth.service.spec.ts` (login): `password: null` → 401 sem chamar `bcrypt.compare` com `null`.
  - `users.service.spec.ts`: `set-password` feliz (hash gravado + sessões revogadas), 409 quando
    já tem senha, senhas diferentes → erro.
  - `auth.service.spec.ts` (reset): `forgot`→`reset` numa conta `password: null` define a senha.
  - **Nenhum teste bate rede** — `google-auth-library` mockado no nível do módulo, igual OpenAI/Brevo (`ARCHITECTURE.md` §2/§10).
- **Contrato (`curl` contra `http://localhost:3000`):**
  - Fase A isolada: só dá para exercitar os caminhos de **falha** por curl (JWT malformado →
    401, corpo sem `credential` → 400), porque um `credential` válido exige o fluxo real do
    Google. Documentar como capturar um `id_token` real (botão GIS no navegador na Fase B, ou a
    [OAuth 2.0 Playground](https://developers.google.com/oauthplayground)) para rodar os caminhos
    felizes via curl.
  - Sequência ponta a ponta (após Fase B): botão no navegador → copiar o `credential` do
    payload da chamada → `curl -X POST localhost:3000/auth/google -H 'X-App: oratio' -H 'Content-Type: application/json' -d '{"credential":"..."}'`
    → 200 → usar o `access_token` em `GET /oratio/voxai/bootstrap` para provar que a sessão vale.
  - `set-password`: login por senha (conta de teste) → `POST /users/me/set-password` autenticado
    → 409 na segunda tentativa.
- **Manual (serviço real — quem executa: humano):**
  - Login Google ponta a ponta no navegador (`localhost:5173` → `localhost:3000`), Fase B.
  - Smoke no iPhone com o PWA instalado (Fase D) — botão abre o popup e volta pro app sem jogar
    pro Safari.
  - ~~`npx prisma db push` em produção~~ — **feito em 2026-09-09** (Supabase de produção).
  - ~~Criação do cliente OAuth + tela de consentimento no Google Cloud Console~~ — **feito em
    2026-09-09** (cliente "Oratio Web", consent screen, usuários de teste). Falta **publicar** o
    app + as env vars de produção.
  - Verificação de CSP no console do navegador após deploy na Vercel (Fase D).

Loop de verificação por tarefa:
`npm test -- <pattern>` → `npm test` → `npm run build` → `npm run lint` → commit.

## Entrega em fases (para o `-plan.md`)

Cada fase fecha sozinha, é mergeada na `develop` com `--no-ff` e testada manualmente antes da
próxima branch.

- **A — Backend, núcleo.** Schema (`LinkedAccount` + `password` nullable) via `/db-change`;
  `POST /auth/google` com verificação do `id_token`, auto-ligação, cadastro e login; tratamento
  de `password: null` no `login`. Testes de todos os caminhos ruins. Humano testa por curl (só
  caminhos de falha sem token real do Google).
- **B — Frontend, botão e fluxo.** Script GIS, botão em `/login` e `/register`, `ux_mode: popup`,
  `authService.loginWithGoogle`, texto fixo de ajuda. Humano testa no navegador (fluxo real
  ponta a ponta, incl. os caminhos felizes de curl da Fase A com um token de verdade).
- **C — Bordas + definir senha.** Backend: `POST /users/me/set-password` (feito na Fase A/A5) +
  `GET /users/me` passa a devolver `hasPassword`. Frontend: `authService`/`profileService`
  ganham `setPassword`; `SetPasswordModal`; "Configurações da conta" busca o perfil e mostra
  "Definir senha" **ou** "Trocar senha" conforme `hasPassword`; mensagens acionáveis do backend
  renderizadas. O fluxo `forgot`→`reset` para conta só-Google (esse **sim** revoga sessões, via
  `resetPassword` existente) já está acessível pela tela `/login`. Testes dos dois lados.
- **E — Mensageria, sinais de resultado, correções do frontend.** Reverte a anti-enumeração do
  login (E1), adiciona `isNewUser` / `googleLinkedNow` ao `POST /auth/google` (E2), bloqueio de
  cadastro repetido (E3), toast de auto-ligação (E4), rótulo do botão (E5), estado de
  carregamento (E6), e liga o frontend à exclusão de conta só-Google (E7). Ver "## Fase E".
  Aprovada 2026-09-09 (E2 = dois booleanos `isNewUser`/`googleLinkedNow`; E3 = logout antes de
  descartar).
- **D — CSP, deploy, PWA.** 🚧 CSP na branch `oratio:feat/login-google-fase-d`: `script-src`
  `https://accounts.google.com/gsi/client`, `style-src` `.../gsi/style`, `connect-src` e
  `frame-src` a URL-pai `https://accounts.google.com/gsi/` — mais o plano de verificação
  pós-deploy escrito em `oratio/docs/tasks/login-google-todo.md`. `ALLOWED_ORIGINS` conferido,
  inalterado. Humano: ~~`db push` de produção~~ (feito 2026-09-09); env vars (Vercel/Render);
  ~~origens de produção no Google Cloud Console~~ (feito 2026-09-09 — `oratio-phi.vercel.app` já
  está no cliente "Oratio Web"); **publicar o app OAuth** (Política de Privacidade); smoke no
  iPhone com PWA instalado; rodar a verificação pós-deploy.

## Fase E — mensageria, sinais de resultado, e correções do frontend

> **Aprovada em 2026-09-09** (E2 e E3 decididas — ver abaixo). Não muda a
> verificação do `id_token`, a resolução de conta nem o schema. É **contrato de
> resposta + mensagens + frontend**. Falta plano/checklist.

### Contexto

A Fase A escolheu **erro genérico** no login por senha de conta só-Google (o
mesmo `401 { message: "Invalid credentials" }` de senha errada) para não revelar
que a conta existe e usa Google. A Fase E **reverte essa escolha** e adiciona os
sinais que o frontend precisa para reagir ao desfecho do `POST /auth/google`
(conta nova × auto-ligação × login recorrente), hoje indistinguíveis. Também
corrige três defeitos que o teste manual expôs (E5, E6, E7).

### E1 — Login por senha em conta só-Google: 401 com mensagem específica

**Muda:** `AuthService.login`, o ramo `if (!user.password)` (`auth.service.ts:78`).

- **Antes:** `throw new UnauthorizedException('Invalid credentials')`
- **Depois:** `throw new UnauthorizedException('Esta conta entra com o Google. Use o botão "Continuar com o Google" abaixo.')`

Continua **401** e continua **antes** do `bcrypt.compare` (`compare(x, null)` quebra).

**Raciocínio — por que aceitar o vazamento de existência:**

1. **O app já vaza existência pela mesma rota.** `login()` responde
   `401 "Please verify your email before logging in"` (`auth.service.ts:89`), e
   essa mensagem só aparece para uma conta que **existe** e está com e-mail não
   verificado. Quem quer enumerar já distingue "não existe / senha errada" de
   "existe, não verificada". A mensagem de conta só-Google entra na **mesma
   categoria de sinal que já está aberta** — não abre porta nova, só troca ruído
   por precisão onde antes havia ruído.
2. **O `@Throttle(5/60s)` (`auth.controller.ts:29`) limita varredura em massa.**
   Não impede ataque dirigido a um alvo conhecido, mas "baixar a base de e-mails
   só-Google" fica inviável no ritmo permitido.
3. **Quem bate nessa mensagem é quase sempre o dono legítimo** que esqueceu qual
   método usou — voltou depois, digitou e-mail e senha por hábito, e hoje recebe
   um "Invalid credentials" que não ajuda. O custo de UX recai sobre o usuário
   real toda vez; o ganho de segurança é marginal dados (1) e (2).
4. **A recuperação por "Esqueci minha senha" continua genérica.** A superfície
   que *não* muda é a mais sensível: `forgot-password` (`auth.service.ts:639`)
   segue respondendo igual exista ou não a conta.

**Consequência (a) — remover o texto fixo de ajuda do `/login`.** O aviso *"Já
entrou com Google antes? Experimente o botão Entrar com Google."* (`Login.tsx`,
`styles.googleHint`) existia **por causa** do erro genérico: o backend não podia
dizer nada, então a tela dizia para todo mundo, o tempo todo. Com E1 o backend
diz para quem precisa, na hora certa. O texto fixo vira ruído permanente para os
~99% que entram por senha e não têm conta Google. **Remover** o `<p>` inteiro.

**Consequência (b) — aviso de "Definir senha" na tela de Perfil, com um ponteiro
para o botão.** A pessoa que vê o erro de E1 está **deslogada** — não alcança
Configurações. Depois que ela entra pelo Google, um aviso **de vez em quando**,
**na tela de Perfil**, sugere definir uma senha — **e mostra onde**.

- **Gatilho:** abriu o Perfil, `hasPassword === false` (do `GET /users/me`), e o
  cooldown já passou.
- **Cadência:** timestamp `set_password_hint_last` no `localStorage`, reaparece a
  cada **7 dias** (mesma cadência do `NotificationNudge`). Some **para sempre**
  quando a conta ganha uma senha.
- **Forma — o ponteiro é o ponto:** a **engrenagem de "Configurações da conta"**
  no header do Perfil **pulsa**, e um balão ancorado nela diz onde clicar
  ("Definir senha" leva a `/oratio/profile/settings?senha=1`; "Agora não" fecha).
  Ao chegar em `AccountSettings` com `?senha=1`, o botão **"Definir senha"** rola
  até a vista e pulsa. É o caminho inteiro, do Perfil até o botão. **Nunca** modal.
- Segue o padrão que o app já tem: o coach-mark da engrenagem do Vox
  (`settingsButtonPulse` + balão) e o realce `?notif=1` do Perfil.
- **Descartada:** a 1ª versão (`<SetPasswordNudge/>` app-level, barra fina no topo,
  1× por sessão) — não indicava **onde** definir a senha, que é o que a pessoa
  não sabe.

### E2 — `POST /auth/google` sinaliza o desfecho da resolução de conta

**Problema:** hoje os três desfechos de `loginWithGoogle` devolvem **exatamente**
`{ access_token, refresh_token }`. O frontend não sabe se mostra tela de
boas-vindas (conta nova), toast de "conta conectada" (auto-ligação) ou nada
(login recorrente).

**Contrato — decidido (2026-09-09):** a resposta 200 do `POST /auth/google` passa
a ser

```json
{
  "access_token": "<jwt>",
  "refresh_token": "<jwt>",
  "isNewUser": true,
  "googleLinkedNow": false
}
```

| Campo | `true` quando | Consumidor |
|---|---|---|
| `isNewUser` | um `User` foi **criado nesta requisição** (passo 3 de `loginWithGoogle`) | tela de boas-vindas (spec `boas-vindas`); redirecionamento do E3 |
| `googleLinkedNow` | um `LinkedAccount` foi criado nesta requisição para um `User` **que já existia** (passo 2, auto-ligação) | toast do E4 |

Os três desfechos: **conta nova** → `isNewUser:true, googleLinkedNow:false`;
**auto-ligação** → `false / true`; **login recorrente** (`LinkedAccount` já
existia) → `false / false`.

- **Por que dois booleanos e não um enum** (`"created" | "linked" | "recurring"`):
  cada consumidor testa **uma** condição (boas-vindas só olha `isNewUser`; o toast
  só olha `googleLinkedNow`). Um par de flags evita o frontend ter que conhecer o
  conjunto fechado de valores, e é aditivo — um provider novo no futuro não muda
  o shape.
- **Por que não é vazamento:** o campo só chega **junto com um par de tokens
  válido**, ou seja, para quem **acabou de provar** que controla aquela conta
  Google. Não há requisição não autenticada que devolva `isNewUser`.
- **`POST /auth/login` e `POST /users` não mudam.** O `isNewUser` é específico do
  fluxo Google. O gatilho de "primeira entrada" para o cadastro por **senha** é
  decidido na spec `boas-vindas`.
- O caso de corrida (`resolveGoogleAfterRace`, `auth.service.ts:297`) devolve os
  flags coerentes com o desfecho real (quase sempre `isNewUser:false` — o `User`
  foi criado pela requisição concorrente).

### E3 — Cadastro × login com o mesmo e-mail (tela `/register`)

| Situação na tela `/register` | Resultado |
|---|---|
| 1ª vez, conta nova (`isNewUser: true`) | entra direto no app (→ boas-vindas) |
| Pessoa sai e volta | entra pela tela **de login** (fluxo normal, sem bloqueio) |
| Tenta de novo pela tela **de cadastro** (`isNewUser: false`) | **não entra**; aviso *"Você já tem conta no Oratio. Entre pela tela de login."* + botão para `/login` |

**Por que a tela `/login` NÃO bloqueia nenhum dos três casos:** lá a intenção
declarada é **entrar**, e entrar é o que acontece — conta nova (raro, mas
possível pelo botão do `/login`), auto-ligação ou login recorrente. A restrição
existe **só** no `/register`, onde a ação nomeada é "criar uma conta"; fazer isso
com uma conta que já existe é a única operação que **mente** sobre o que
aconteceu. E3 é regra de **frontend** — o backend responde igual nos dois; quem
decide é a tela, pelo `isNewUser`.

**Detalhe de implementação que não pode passar batido — os tokens órfãos:**
quando o backend responde, a pessoa **já está autenticada** — `loginWithGoogle`
sempre chama `generateTokens`, que **cria uma `RefreshSession`** e emite o par.
No caso "não é conta nova, veio do `/register`", o frontend **precisa descartar
os tokens** — não gravar no `localStorage` **e** não deixar o
`api.defaults.headers.Authorization` setado (o `loginWithGoogle` atual, em
`authService.ts`, faz as duas coisas no sucesso). Se qualquer uma sobrar, a
pessoa fica logada e o aviso não faz sentido.

**Efeito colateral — a `RefreshSession` órfã** vira um **dispositivo fantasma** em
`GET /users/me/sessions`.

**Solução — decidida (2026-09-09):** o frontend, no ramo de descarte, chama
**`POST /auth/logout`** com o `refresh_token` recém-recebido **antes** de
descartá-lo, e só então mostra o aviso.

- **Por que essa e não outra:** `POST /auth/logout` (`auth.controller.ts:68`) já
  faz **exatamente** o necessário — revoga **uma** `RefreshSession` pelo hash do
  token, é best-effort e idempotente. Zero mudança de backend, zero contrato
  novo. A janela em que a sessão fantasma existe é o intervalo entre as duas
  chamadas (milissegundos).
- **Detalhe:** o frontend faz o `POST /auth/logout` com um timeout curto (~3s) e
  **ignora** a falha — um logout pendurado não pode atrasar o aviso "Você já tem
  conta".
- **Falha do logout** (offline no instante exato): a sessão fantasma sobrevive
  até 180 dias. Aceitável porque (a) é o **próprio dispositivo** da pessoa, (b)
  não carrega privilégio além do que a pessoa já tem, (c) dá para encerrá-la na
  tela de sessões, (d) é raro.
- **Alternativa descartada para o v1:** um campo `intent: "register"` no corpo do
  `POST /auth/google`, com o backend **não** chamando `generateTokens` quando a
  conta não é nova (devolvendo só `{ isNewUser: false }`). Elimina a sessão
  fantasma na origem e o round-trip, mas parte o `POST /auth/google` em dois
  comportamentos, adiciona um ramo no service + testes próprios, e acopla o
  backend a qual tela chamou. Para o ganho (fechar uma janela de milissegundos +
  1 request), não compensa. Fica registrado como melhoria possível.

### E4 — Toast de auto-ligação

Quando `googleLinkedNow: true`, o frontend mostra um toast:

> *"Sua conta Google foi conectada à sua conta Oratio."*

**Por que é obrigatório, não enfeite:** a auto-ligação foi a decisão mais
delicada da feature — ligar silenciosamente a identidade Google a uma conta
e-mail+senha existente, condicionada só a `email_verified: true`. **Não há tela
para desvincular no v1** ("Fora de escopo"). Este toast é a **única** chance de a
pessoa perceber que uma ligação aconteceu e, se indesejada (e-mail comprometido
no Google, engano), procurar suporte. Sem ele, a ligação é invisível para sempre.
Aparece uma vez, no login em que `googleLinkedNow` vem `true`. Toast comum, não
bloqueante.

### E5 — Rótulo do botão do Google

`Register.tsx` passa `text="signup_with"` e `Login.tsx` passa `text="signin_with"`
ao `GoogleSignInButton` — mas **as duas telas chamam o mesmo endpoint e fazem a
mesma coisa** (`loginWithGoogle`). "Cadastre-se com o Google" promete um fluxo de
cadastro que não existe como coisa separada.

**Trocar as duas para `text="continue_with"`** ("Continuar com o Google") — que já
é o **default** do `GoogleSignInButton` (as telas sobrescreveram sem motivo). O
ideal é remover a prop nas duas chamadas e deixar o default agir.

### E6 — Estado de carregamento do botão

Entre o clique no botão do Google e a navegação (ou o aviso do E3) não há
**nenhum** feedback: `handleGoogleCredential` faz `setLoading(true)`, mas o
`GoogleSignInButton` não recebe nem usa esse estado — o botão do GIS continua
clicável. Com rede lenta, a pessoa clica de novo → **duas** requisições
concorrentes → é **exatamente** a corrida que o tratamento de `P2002`
(`auth.service.ts:248`) existe para segurar. O `P2002` é a rede de segurança, não
pode ser a única linha de defesa.

- `GoogleSignInButton` passa a aceitar `disabled?: boolean`; quando `true`, cobre
  o botão do GIS com um overlay que intercepta o clique e mostra um spinner (o
  iframe do GIS não dá para desabilitar por dentro).
- `Login.tsx` / `Register.tsx` passam `disabled={loading}`.

### E7 — Excluir conta só-Google: ligar o frontend ao caminho que o backend já tem

**Bug confirmado (teste manual 2026-09-09):** uma conta que entrou por Google
**não consegue ser excluída pelo app**.

- **Backend:** já resolvido na **A8** (`users.service.ts:428` em diante). Com
  `user.password` nulo, `deleteAccount` aceita `proof.googleCredential`, revalida
  por `AuthService.verifyGoogleIdentity`, e exige que `payload.sub` case um
  `LinkedAccount` (`provider: "google"`) **deste** usuário. Prova ausente / de
  outra conta Google → **400**, nunca 500.
- **Frontend:** nunca foi ligado a esse caminho.
  `profileService.deleteAccount(password)` só monta `{ password }`
  (`profileService.ts:88`); `DeleteAccountModal` só tem campo de senha.

**Correção (frontend):**

1. `DeleteAccountModal` passa a olhar `hasPassword` (que "Configurações da conta"
   **já busca e usa** para escolher entre "Definir senha" / "Trocar senha"):
   - `hasPassword === true` → campo de senha, como hoje.
   - `hasPassword === false` → botão do Google para **reautenticar**; o
     `credential` do callback vira a prova.
2. `profileService.deleteAccount` aceita as duas formas —
   `deleteAccount({ password })` **ou** `deleteAccount({ googleCredential })` →
   `DELETE /users/me` com `{ data: { password } }` ou `{ data: { googleCredential } }`.
   O `DeleteAccountDto` do backend (`{ password?, googleCredential? }`) já aceita
   os dois; nada muda no backend.

**Raciocínio — por que a exclusão exige reautenticação, e não basta o JWT:** o
access token prova que **existe uma sessão**, não que **a pessoa certa está ali
agora**. Um token roubado (XSS, dispositivo destravado, refresh token vazado)
daria, sozinho, poder de **apagar a conta inteira e o histórico** — sem
confirmação, sem estorno (`ARCHITECTURE.md` §7). Por isso a exclusão pede uma
**prova fresca de posse da credencial**: a senha, ou um `id_token` recém-emitido
pelo Google. É a mesma barreira do `change-password` com a "senha atual". A conta
só-Google não podia ficar de fora dela só por não ter senha — ficaria mais fácil
de destruir que as outras, e ainda seria um problema de LGPD (o titular
**precisa** conseguir apagar os próprios dados). A A8 fechou isso no backend; a
E7 liga o frontend.

**Falha esperada — `googleCredential` de outra conta.** Se a pessoa reautentica
com uma conta Google que **não** é a logada no Oratio, o `sub` não casa nenhum
`LinkedAccount` deste usuário → backend responde **400** e **não apaga nada**.
Confirmado em `users.service.ts:463` (`if (!link || link.userId !== userId)`).

### Critérios de aceite — Fase E

> `[x]` = coberto por teste automatizado (backend Jest / frontend Vitest). Os fluxos ponta-a-ponta
> com `id_token` real ficam no **Checkpoint E** (teste manual humano).

- [x] **Dado** um `User` com `password: null`, **quando** `POST /auth/login` com o e-mail dele e qualquer senha, **então** 401 `{ message: "Esta conta entra com o Google. Use o botão \"Continuar com o Google\" abaixo." }` (E1). *(`auth.service.spec.ts`)*
- [x] **Dado** o mesmo cenário, **quando** o login roda, **então** `bcrypt.compare` **não** é chamado (a mensagem exata prova o caminho — `bcrypt` é binding nativo, não mockável aqui).
- [x] **Dado** um `credential` válido de um e-mail **sem** `User`, **quando** `POST /auth/google`, **então** 200 com `isNewUser: true`, `googleLinkedNow: false`.
- [x] **Dado** um `credential` válido de um e-mail com `User` e-mail+senha **sem** `LinkedAccount`, **quando** `POST /auth/google`, **então** 200 com `isNewUser: false`, `googleLinkedNow: true`.
- [x] **Dado** um `credential` válido cujo `sub` **já tem** `LinkedAccount`, **quando** `POST /auth/google`, **então** 200 com `isNewUser: false`, `googleLinkedNow: false`.
- [x] **Dado** o caminho de corrida (`P2002` capturado, re-resolução), **quando** o 2º request conclui, **então** 200 com `isNewUser: false`.
- [x] **Dado** a tela `/login` carregada, **então** o texto fixo *"Já entrou com Google antes?…"* **não** aparece mais (E1a). *(`Login.test.tsx`)*
- [x] **Dado** o callback do GIS na `/register` e a resposta `isNewUser: false`, **quando** o fluxo conclui, **então** nenhum token é gravado no `localStorage`, `discardGoogleSession` (`POST /auth/logout`) é chamado com o `refresh_token` recebido, e o aviso *"Você já tem conta no Oratio…"* aparece com um caminho para `/login` (E3). *(`Register.test.tsx`)*
- [x] **Dado** o mesmo callback na `/register` com `isNewUser: true`, **quando** conclui, **então** os tokens são gravados e a navegação vai para a Home (a spec `boas-vindas`, quando existir, intercepta pelo `showWelcome`). *(`Register.test.tsx`)*
- [x] **Dado** `googleLinkedNow: true` em qualquer das duas telas, **quando** o login conclui, **então** o toast *"Sua conta Google foi conectada…"* aparece (E4). *(`Login.test.tsx`, `FlashToast.test.tsx`; na `/register` vira a mensagem do `AlertModal`)*
- [x] **Dado** `Login.tsx` e `Register.tsx`, **então** o `GoogleSignInButton` renderiza com o rótulo `continue_with` (default; as telas não passam mais `text=`) (E5). *(`GoogleSignInButton.test.tsx`)*
- [x] **Dado** um `POST /auth/google` em andamento, **quando** o usuário clica no botão do Google de novo, **então** o segundo clique é bloqueado pela camada de `disabled` (E6). *(`GoogleSignInButton.test.tsx`, `Login.test.tsx`)*
- [x] **Dado** uma conta só-Google (`hasPassword: false`) autenticada, **quando** abre o `DeleteAccountModal` e o e-mail confere, **então** vê o botão de reautenticação do Google, não o campo de senha (E7). *(`DeleteAccountModal.test.tsx`)*
- [x] **Dado** essa conta, **quando** reautentica pelo Google e confirma, **então** `DELETE /users/me` é chamado com `{ googleCredential }`, responde 200, `clearSession` roda.
- [x] **Dado** essa conta, **quando** o backend responde 400 (conta Google não é deste user), **então** a conta **não** é apagada, `clearSession` **não** roda, a pessoa continua no app. *(backend: `users.service.spec.ts`; frontend: `DeleteAccountModal.test.tsx`)*
- [x] **Dado** uma conta com senha (`hasPassword: true`), **quando** abre o modal → campo de senha; senha certa → 200 + `clearSession`; senha errada → mensagem, sem `clearSession` (comportamento atual preservado).

### Bugs conhecidos — Fase E

**BUG-E1 — o balão do aviso "Defina uma senha" (E1b) era recortado no desktop. ✅ RESOLVIDO
(2026-09-10).**

- **Sintoma (histórico):** a última linha do balão (*"…para também entrar sem o Google"*) sumia
  no desktop. No mobile o card do perfil é mais alto e cabia, por isso passou no teste inicial.
  Piorava com `FONT_SCALE_OPTIONS` no maior tamanho.
- **Causa:** `.pwdHint` era `position:absolute` (`oratio/src/pages/Profile/Profile.module.css`,
  `top:64px`) dentro de `.profileHero`, que tem **`overflow:hidden`**. O balão ultrapassava a
  altura do card e era recortado. O `overflow:hidden` não podia ser removido — segura o
  gradiente dentro das bordas arredondadas do card.
- **Correção aplicada** (`oratio` branch `fix/login-google-bug-e1`, commit `23b0d78`, na
  `develop` pelo merge `4401808`): o balão **e** o backdrop foram para um `<Portal/>`
  (`#overlay-root`), `position:fixed`, posicionado por JS a partir do `getBoundingClientRect()`
  da engrenagem (`gearRef`), recalculado no `resize`/`scroll` via rAF.
  `max-width: min(250px, calc(100vw - 24px))`. A pulsação fica na engrenagem
  (`.settingsGearPulse`, no botão). 836 testes de frontend verdes.
- **Verificado no Checkpoint E (2026-09-10):** desktop largo, mobile e `FONT_SCALE` máximo — as
  3 configurações OK, balão inteiro e sem cobrir a engrenagem.
- **Regra registrada** (`oratio/docs/ARCHITECTURE.md` §6): `.profileHero` tem `overflow:hidden` —
  nada `position:absolute` dentro dele pode ultrapassar as bordas do card; overlays vão pelo
  `<Portal/>`.

### Plano de testes — Fase E

- **Unitário (backend):** `auth.service.spec.ts` — E1 (mensagem nova, `bcrypt` não
  chamado); E2 (os três desfechos devolvem os flags certos, incl. o caminho
  `P2002`). `users.service.spec.ts` — E7 já coberto pela A8 (confirmar os casos
  "outra conta Google" e "sub sem LinkedAccount").
- **Unitário (frontend, Vitest, `./api` mockado):** `authService` — `loginWithGoogle`
  devolve os flags; ramo de descarte do E3 (nenhum token gravado + `POST /auth/logout`
  chamado com o `refresh_token`). `profileService` — `deleteAccount` monta
  `{ password }` **ou** `{ googleCredential }`. `Login.test.tsx` / `Register.test.tsx` —
  texto fixo ausente (E1a), rótulo `continue_with` (E5), botão bloqueado durante
  `loading` (E6), aviso do E3, toast do E4. `DeleteAccountModal.test.tsx` — ramo
  `hasPassword` (E7) e os dois jeitos de falhar.
- **Contrato (`curl`):** `POST /auth/login` numa conta só-Google → 401 com a
  mensagem de E1. Os flags de E2 exigem um `id_token` real (mesmo procedimento da
  Fase B).
- **Manual (humano):** o fluxo `/register` repetido (E3) e a exclusão de conta
  só-Google ponta a ponta (E7) no navegador.

## Fora de escopo

- **Login com Apple.** Só o formato de dados (`LinkedAccount` com `provider`) comporta; nada da
  Apple entra nesta entrega.
- **Desvincular / remover a conexão Google.** Não há rota nem UI no v1. Uma conta ligada continua
  ligada; quem perde o acesso à conta Google recupera por "Esqueci minha senha".
- **Exibir foto/avatar do Google** em qualquer tela — a `picture` não é persistida.
- **One Tap automático / `auto_select`.** O escopo é o botão renderizado. One Tap não aparece no
  Safari e fica como melhoria futura opcional.
- **Merge de contas com escolha de qual manter / histórico divergente.** A auto-ligação é
  silenciosa e direta, condicionada a `email_verified: true`.
- **`nonce` anti-replay.** Cortado na aprovação. **Não readicionar a versão de fachada**
  (frontend gera → manda no corpo → backend compara com o payload): ela não protege de nada,
  porque um replay reenvia corpo e `credential` juntos e a checagem passa. Anti-replay real =
  servidor emite o `nonce`, persiste, e recusa reuso. Só faz sentido se esse mecanismo completo
  for construído — e hoje não há motivo para isso (a assinatura do Google + `aud` + `exp` são a
  defesa).
- **Processo de dev, não critério de aceite:**
  - ~~`npx prisma db push` em produção~~ — **feito em 2026-09-09** (Supabase de produção;
    `LinkedAccount` + `password` nullable aplicados).
  - ~~Criar o cliente OAuth e a tela de consentimento no Google Cloud Console~~ — feito
    2026-09-09. Falta **publicar** o app + env vars de produção.
  - Adicionar `google-auth-library` ao `package.json` (aprovada; acontece na Fase A).
  - Atualizar `docs/ARCHITECTURE.md` §5/§8/§9 e o §7 (CSP) do `oratio` — no mesmo commit da
    implementação que muda o comportamento.
  - Revisar o contrato com o frontend (`/review-pr`).

## Notas de ambiente

- **Variáveis novas:**
  - Backend (Render): `GOOGLE_CLIENT_ID` — o **Client ID** do cliente OAuth "Web application".
    Usado como `audience` na verificação do `id_token`. Adicionar em `docs/ARCHITECTURE.md` §9.
  - Frontend (Vercel): `VITE_GOOGLE_CLIENT_ID` — **o mesmo valor**.
  - **`client_secret` não é usado** neste fluxo (verificação de `id_token` só precisa do Client
    ID). Não guardar o secret em lugar nenhum.
- **Google Cloud Console — FEITO em 2026-09-09** (registro do que foi criado):
  - Projeto **Oratio**. Cliente *OAuth 2.0 Client ID* tipo **Web application**, nome **"Oratio
    Web"**. *Authorized JavaScript origins:* `http://localhost:5173` + `https://oratio-phi.vercel.app`.
    *Redirect URIs:* nenhuma.
  - *OAuth consent screen:* User type **External**; os 3 escopos (`openid`, `.../userinfo.email`,
    `.../userinfo.profile`) — **não sensíveis**, sem revisão; **usuários de teste** adicionados.
  - Client ID copiado para os `.env` **locais** dos dois repos.
  - **Falta:** `GOOGLE_CLIENT_ID` (Render) + `VITE_GOOGLE_CLIENT_ID` (Vercel), e mudar o
    *Publishing status* de **Testing** → **In production** (só usuários de teste logam em prod
    até publicar; publicar exige a **Política de Privacidade** — dívida em `docs/specs/INDEX.md`).
- **CSP (`oratio/vercel.json`, bloco `headers`):** adicionar
  - `script-src`: `https://accounts.google.com/gsi/client`
  - `style-src`: `https://accounts.google.com/gsi/style`
  - `frame-src`: `https://accounts.google.com/gsi/`
  - `connect-src`: `https://accounts.google.com/gsi/`

  Fonte: [Setup / CSP](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).
  A CSP **falha fechada** e **não é testável** com `vite preview` — só a Vercel aplica
  (`oratio` `RULES.md` §4, `ARCHITECTURE.md` §7; já quebrou o PDF uma vez). A tarefa da Fase D
  precisa de um plano escrito de verificação pós-deploy: abrir o app publicado, checar o console
  por violações de CSP, confirmar que o botão renderiza e o `POST /auth/google` completa.
- **CORS (`ALLOWED_ORIGINS`, backend `main.ts`): sem mudança.** O `POST /auth/google` é chamado
  da mesma origem de frontend que já está na allowlist; nenhuma origem nova é introduzida.
- **PWA no iOS:** usar `ux_mode: "popup"` (o default) com callback JS + XHR. **Nunca**
  `ux_mode: "redirect"` / `login_uri`: num PWA instalado (standalone) no iPhone, um
  redirecionamento de página inteira joga a pessoa para o Safari e perde o contexto do app.
  One Tap (`google.accounts.id.prompt()`) **não renderiza no Safari** — o botão
  (`renderButton`) é o caminho primário e único garantido.
- **FedCM:** GIS já integra FedCM de forma retrocompatível. Para o botão, passar
  `use_fedcm_for_button: true` ([fedcm-migration](https://developers.google.com/identity/gsi/web/guides/fedcm-migration)).
  Não há prazo obrigatório em vigor para o **botão** GIS (o prazo de agosto/2025 era da lib
  antiga *Google Sign-In platform library*, que não usamos).
- **Custo:** a verificação do `id_token` busca as chaves públicas do Google (endpoint de certs,
  cacheado pela lib) — **sem custo por chamada**, diferente da OpenAI. Nenhum e-mail real é
  disparado no fluxo Google (o cadastro via Google **não** manda e-mail de verificação — o
  Google já verificou).
- **Throttler:** `POST /auth/google` usa o `ThrottlerGuard` in-memory existente (5/60s). É contra
  **abuso genérico** (spam de requisições), **não** força bruta — não há segredo a adivinhar na
  rota; um `credential` só passa se o Google o assinou. Mesma ressalva de escala horizontal do
  login (`ARCHITECTURE.md` §5).

## Decisões tomadas na aprovação (2026-09-08)

> **Revisão da Fase E (2026-09-09):** a escolha de **erro genérico** no login por senha de conta
> só-Google (anti-enumeração) foi **revertida** — ver "## Fase E → E1" para o raciocínio. As
> demais decisões abaixo seguem valendo.

- **`nonce`: cortado.** Do jeito que estava proposto (frontend gera, manda no corpo, backend
  compara com o payload) **não protege**: quem replica a requisição replica corpo e `credential`
  juntos, e os dois continuam batendo entre si. Anti-replay de verdade exigiria o servidor
  **emitir**, **guardar** e **recusar reuso** de cada `nonce` — infra de estado que não vale o
  custo aqui. Ver "Fora de escopo".
- **`set-password` não revoga sessão nenhuma.** Ver "Comportamento esperado → Conta só-Google".
- **`POST /auth/google` devolve 200**; `POST /auth/login` continua **201** (não será alterado). A
  inconsistência é registrada como quirk conhecido — bullet a adicionar em `docs/ARCHITECTURE.md`
  §8 **no commit da Fase A** (texto exato abaixo).
- **`google-auth-library` aprovada** (`RULES.md` §8).

Texto do bullet para `ARCHITECTURE.md` §8 (aplicar na Fase A, quando a rota existir):

> - **`POST /auth/google` responde `200`, `POST /auth/login` responde `201`.** O login é `201`
>   só por ser o default do Nest para `@Post` sem `@HttpCode` — nunca criou um "recurso". A rota
>   do Google foi fixada em `200` de propósito (`@HttpCode(200)`), que descreve melhor "sessão
>   emitida". Não alinhe as duas mudando o login: o frontend e qualquer cliente já tratam o `201`
>   dele. É inconsistência cosmética conhecida, não bug.

## Questões em aberto

Nenhuma.

### Resolvida

- **E2 — formato do sinal de desfecho no `POST /auth/google`** (2026-09-09). Escolhidos **dois
  booleanos** no corpo do 200: `isNewUser` (`User` criado nesta requisição) e `googleLinkedNow`
  (`LinkedAccount` criado nesta requisição para um `User` que já existia). Motivo: cada consumidor
  testa **uma** condição; é aditivo (um provider novo não muda o shape); e segue a precedência do
  `showVoxIntro` (booleano) em `getBootstrap`. Enum descartado. Raciocínio completo em
  "## Fase E → E2". Muda `oratio/src/services/authService.ts` em lockstep.
- **E3 — sessão órfã do cadastro repetido** (2026-09-09). O frontend chama `POST /auth/logout`
  com o `refresh_token` **antes** de descartá-lo (e limpa o `Authorization` default; timeout
  curto, falha ignorada). Motivo: `/auth/logout` já faz exatamente isso, best-effort e
  idempotente, sem backend novo. `intent: "register"` no corpo do `POST /auth/google` descartado
  para o v1 (partiria o endpoint em dois comportamentos). Raciocínio em "## Fase E → E3".

- **`DELETE /users/me` numa conta só-Google** (2026-09-09). Escolhida a proposta recomendada:
  `DeleteAccountDto` → `{ password?, googleCredential? }`; conta com senha usa `password`
  (inalterado), conta sem senha exige um `googleCredential` fresco verificado por
  `AuthService.verifyGoogleIdentity` (o mesmo helper do `POST /auth/google`, agora exportado pelo
  `AuthModule` e consumido pelo `UsersModule`), com `payload.sub` batendo num `LinkedAccount`
  google deste user. Prova ausente/incorreta → 400. Implementado na A8.

- **`DELETE /users/me` numa conta só-Google** (2026-09-09). Escolhida a proposta recomendada:
  `DeleteAccountDto` → `{ password?, googleCredential? }`; conta com senha usa `password`
  (inalterado), conta sem senha exige um `googleCredential` fresco verificado por
  `AuthService.verifyGoogleIdentity` (o mesmo helper do `POST /auth/google`, agora exportado pelo
  `AuthModule` e consumido pelo `UsersModule`), com `payload.sub` batendo num `LinkedAccount`
  google deste user. Prova ausente/incorreta → 400. Implementado na A8.

- `X-App` no `set-password`: `POST /users/me/change-password` **não** exige `X-App` hoje, então
  `set-password` também não. Pilha: `@UseGuards(JwtAuthGuard, ThrottlerGuard)` +
  `@Throttle({ default: { limit: 5, ttl: 60_000 } })`.
