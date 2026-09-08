# Spec: login-google — "Entrar com Google"

> Status: aprovada (2026-09-08)
> Plano: `docs/tasks/login-google-plan.md` · Checklist: `docs/tasks/login-google-todo.md` *(a criar)*
> Frontend pareado: `oratio/docs/specs/login-google.md` (ponteiro)

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
       só chega aqui com `email_verified: true` já confirmado). **Se `User.emailVerified` for
       `false`, passa para `true`** (ver "E-mail verificado na auto-ligação"). Emite tokens.
       `User.password` e `User.name` **não são tocados**.
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

### Nome e foto

- O `name` do Google é usado **só na criação** da conta. Logins seguintes **nunca** sobrescrevem
  `User.name` — quem manda é o que a pessoa editou dentro do app.
- A `picture` chega junto no escopo `profile` (que pedimos por causa do `name`), então **não é
  questão de escopo e sim de não persistir**. Não é gravada em lugar nenhum. Nota: URLs de foto
  do Google não são estáveis a longo prazo, o que reforça não guardá-las.

### Conta só-Google (sem senha)

- **Login por senha** (`POST /auth/login`) numa conta com `password: null`: responde o mesmo
  **401 `{ message: "Invalid credentials" }`** genérico de sempre — não revela que a conta é
  só-Google (mantém a anti-enumeração já existente em `AuthService.login`). O
  `bcrypt.compare(password, user.password)` **não pode** receber `null` como hash — o código
  trata `password == null` como "credencial inválida" antes de chamar o `bcrypt`.
- **Recuperação de quem perdeu o acesso à conta Google**: `POST /auth/forgot-password` →
  `POST /auth/reset-password` funciona normalmente e **define** senha mesmo quando não havia
  nenhuma. É o caminho oficial de recuperação (o Google já nos deu `email_verified: true`, o
  e-mail é comprovadamente entregável). A resposta continua genérica — nenhum vazamento novo.
  `resetPassword` já revoga todas as `RefreshSession`; isso se mantém.
- **Definir senha autenticado** (`POST /users/me/set-password`): aceita **só** quando
  `user.password` é `null`. Se a conta já tem senha → **409**, com mensagem mandando usar
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
  destruir a conta). **Comportamento a definir** — proposta: `DeleteAccountDto` aceita
  `{ password?, googleCredential? }`; conta com senha → `password` obrigatório (inalterado);
  conta sem senha → `googleCredential` fresco obrigatório, verificado pelo mesmo helper do
  `POST /auth/google`, com `payload.sub` batendo num `LinkedAccount` deste user. Não conseguir
  excluir a conta seria problema de LGPD, então **algum** caminho sem senha precisa existir.

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
| `set-password` com `password` != `confirmPassword` | 400 | `{ message: [...] }` | não |
| `change-password` numa conta só-Google (`password: null`) | 409 | `{ message: "Esta conta não tem senha. Use \"Definir senha\" para criar uma." }` | não |
| `DELETE /users/me` numa conta só-Google | (a definir — ver "Conta só-Google") | idem | não |
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
- **`userId`:** de `req.user.userId`, **nunca** do corpo (`RULES.md` §5).
- **Response 200:** `{ "message": "Senha definida." }`
- **Efeito colateral:** grava `bcrypt.hash(password, 10)` em `User.password`. **Nada além disso** —
  nenhuma `RefreshSession` é tocada (ver "Comportamento esperado → Conta só-Google" para o porquê
  da diferença em relação a `changePassword`).
- **Erros:** 400 (DTO inválido / senhas diferentes), 401 (sem token), 409 (conta já tem senha), 429.

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

### `db push` pendente

`/db-change` escreve `prisma/db-scripts/AAAA-MM-DD-login-google.sql` (aplicação + rollback
comentado). O `npx prisma db push && npx prisma generate` em produção é **execução humana** —
registrado em `docs/specs/INDEX.md`.

## Critérios de aceite (testáveis, em BDD)

### Backend — `POST /auth/google`

- [ ] **Dado** que não existe `User` com o e-mail do token, **quando** `POST /auth/google` com
  `credential` válido e `email_verified: true`, **então** 200 com `{ access_token, refresh_token }`,
  um `User` novo existe (`password` nulo, `emailVerified: true`, `name` == `name` do Google) e uma
  linha `LinkedAccount` (`provider: "google"`, `providerAccountId` == `sub` do token).
- [ ] **Dado** um `LinkedAccount` google já existente para o `sub` do token, **quando**
  `POST /auth/google` com `credential` válido, **então** 200 com par de tokens do usuário dono e
  **nenhuma** linha `User` ou `LinkedAccount` nova é criada.
- [ ] **Dado** um `User` e-mail+senha já cadastrado com o mesmo e-mail do token e **sem**
  `LinkedAccount`, **quando** `POST /auth/google` com `credential` válido e `email_verified: true`,
  **então** 200 com par de tokens **desse** usuário, uma linha `LinkedAccount` nova ligada a ele,
  e `User.password` + `User.name` **inalterados**.
- [ ] **Dado** um `User` e-mail+senha com `emailVerified: false` e sem `LinkedAccount`, **quando**
  `POST /auth/google` auto-liga esse user, **então** `User.emailVerified` passa a `true` (o teste
  asserta o `data` do `user.update`); `password`/`name` continuam intactos.
- [ ] **Dado** que dois `POST /auth/google` concorrentes chegam para o mesmo e-mail inédito (o
  2º encontra o `@@unique` já preenchido — `P2002`), **quando** o 2º é processado, **então**
  responde 200 com o par de tokens do `User` recém-criado, não 500.
- [ ] **Dado** um `credential` cujo payload traz `email_verified: false`, **quando**
  `POST /auth/google`, **então** 401 com `{ message: "Seu e-mail no Google não está verificado. ..." }`
  e **nenhum** `User`/`LinkedAccount` é criado ou alterado.
- [ ] **Dado** um `credential` com assinatura inválida (`verifyIdToken` lança), **quando**
  `POST /auth/google`, **então** 401 com `{ message: "Não foi possível validar seu login com o Google. Tente de novo." }`.
- [ ] **Dado** um `credential` expirado (`exp` no passado), **quando** `POST /auth/google`,
  **então** 401.
- [ ] **Dado** um `credential` válido mas com `aud` de outro client ID, **quando**
  `POST /auth/google`, **então** 401.
- [ ] **Dado** um corpo `{}` (sem `credential`), **quando** `POST /auth/google`, **então** 400.
- [ ] **Dado** 6 requisições em 60s do mesmo IP, **quando** a 6ª chega em `POST /auth/google`,
  **então** 429.

### Backend — senha / recuperação

- [ ] **Dado** um `User` com `password: null`, **quando** `POST /auth/login` com o e-mail dele e
  qualquer senha, **então** 401 com `{ message: "Invalid credentials" }` (idêntico ao de senha
  errada — sem revelar que é conta Google).
- [ ] **Dado** um `User` com `password: null`, **quando** `POST /auth/forgot-password` com o
  e-mail dele e depois `POST /auth/reset-password` com o token gerado e uma senha nova, **então**
  `POST /auth/login` com essa senha passa a devolver 200, e todas as `RefreshSession` anteriores
  desse usuário foram apagadas.
- [ ] **Dado** um usuário autenticado cuja conta tem `password: null`, **quando**
  `POST /users/me/set-password` com `password`/`confirmPassword` iguais e válidos, **então** 200
  `{ message: "Senha definida." }`, `User.password` passa a ter um hash bcrypt, e **nenhuma**
  `RefreshSession` do usuário é apagada (o teste asserta que o mock de `refreshSession.deleteMany`
  não foi chamado).
- [ ] **Dado** um usuário autenticado cuja conta **já tem** senha (`password` não-nulo), **quando**
  `POST /users/me/set-password`, **então** 409 com a mensagem que aponta para "Trocar senha", e
  `User.password` não muda. *(Teste obrigatório — é o controle de segurança da rota.)*
- [ ] **Dado** nenhuma credencial (`Authorization` ausente), **quando**
  `POST /users/me/set-password`, **então** 401.
- [ ] **Dado** `password` != `confirmPassword`, **quando** `POST /users/me/set-password`, **então** 400.
- [ ] **Dado** um usuário autenticado cuja conta tem `password: null`, **quando**
  `POST /users/me/change-password`, **então** 409 `{ message: "Esta conta não tem senha. ..." }`
  e o `bcrypt.compare` **não** é chamado com `null` (o teste asserta o mock).
- [ ] **Dado** um usuário autenticado cuja conta tem `password: null`, **quando**
  `DELETE /users/me` **sem** a prova de identidade exigida para conta sem senha, **então** 400
  (não 500); **e quando** com a prova válida, **então** 200 e a conta é apagada. *(Contrato
  exato depende da decisão pendente — ver "Questões em aberto".)*

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
  - `npx prisma db push` em produção (Fase D).
  - Criação do cliente OAuth + tela de consentimento no Google Cloud Console (antes da Fase B).
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
- **C — Bordas + definir senha.** `POST /users/me/set-password` (sem tocar em `RefreshSession`) +
  UI nas configurações; fluxo `forgot`→`reset` para conta só-Google (esse **sim** revoga
  sessões, via `resetPassword` existente); mensagens acionáveis. Testes.
- **D — CSP, deploy, PWA.** Entradas de CSP no `vercel.json` do frontend + plano de verificação
  pós-deploy; `db push` de produção (humano); origens de produção no Google Cloud Console
  (humano); smoke no iPhone com PWA instalado (humano).

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
  - `npx prisma db push` em produção (execução humana — `RULES.md` §2).
  - Criar o cliente OAuth e a tela de consentimento no Google Cloud Console (execução humana).
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
- **Google Cloud Console (checklist para o humano):**
  - Criar *OAuth 2.0 Client ID*, tipo **Web application**, nome ex. "Oratio Web".
  - *Authorized JavaScript origins:* `http://localhost:5173` (Vite dev) e
    `https://oratio-phi.vercel.app` (produção). **Não** precisa `http://localhost:3000` — o GIS
    carrega na origem do frontend, não da API.
  - *Authorized redirect URIs:* **nenhuma** (fluxo popup + callback JS; deixar vazio).
  - *OAuth consent screen:* User type **External**; App name "Oratio"; e-mails de suporte e de
    contato; *Authorized domains:* `vercel.app`. Scopes: `openid`, `.../auth/userinfo.email`,
    `.../auth/userinfo.profile` — todos **não sensíveis**, sem revisão do Google. *Publishing
    status:* pode ir a **In production** (seguro só com scopes não sensíveis) ou ficar em
    **Testing** com usuários de teste.
  - Copiar o Client ID → `GOOGLE_CLIENT_ID` (Render) e `VITE_GOOGLE_CLIENT_ID` (Vercel).
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

- [ ] **`DELETE /users/me` numa conta só-Google.** Proposta (recomendada): `DeleteAccountDto`
  aceita `{ password?, googleCredential? }` — conta com senha usa `password` (inalterado), conta
  sem senha exige um `googleCredential` fresco verificado pelo helper do `POST /auth/google`,
  com `payload.sub` batendo num `LinkedAccount` do user. Alternativa mais simples: aceitar só o
  JWT para contas sem senha, registrando no `ARCHITECTURE.md` §7 que isso reabre parcialmente o
  risco de "token roubado → exclusão". **Aguardando decisão humana antes de implementar a A8
  (parte `deleteAccount`).**

### Resolvida

- `X-App` no `set-password`: `POST /users/me/change-password` **não** exige `X-App` hoje, então
  `set-password` também não. Pilha: `@UseGuards(JwtAuthGuard, ThrottlerGuard)` +
  `@Throttle({ default: { limit: 5, ttl: 60_000 } })`.
