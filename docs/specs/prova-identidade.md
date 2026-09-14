# Spec: prova-identidade — reautenticação para operações sensíveis

> Status: **implementada, na `develop` dos dois repos** (2026-09-10) — falta o teste manual humano
> (os 3 modos do `DeleteAccountModal` + o link no `ChangePasswordModal`, na tela) e a promoção pra `main`.
> Plano/Checklist: **nenhum** — mudança pequena, foi direto ao código (decisão do humano, 2026-09-10).
> Frontend pareado: `oratio/docs/specs/prova-identidade.md` (ponteiro)

## Objetivo

Uma conta com **os dois métodos** de entrada (senha **e** Google) pode provar a identidade com
**qualquer um** deles antes de uma operação sensível — hoje o app só aceita a senha, mesmo com o
Google ligado. Isso destrava dois caminhos que hoje não existem:

1. **Excluir a conta com o Google mesmo tendo senha** (quem esqueceu a senha não consegue apagar
   a conta — é direito de LGPD, e o app guarda dado sensível).
2. **Definir uma senha nova sem saber a atual, dentro do app e autenticado** (hoje "Trocar senha"
   exige a senha atual; quem não lembra precisa **deslogar** para usar "Esqueci minha senha" da
   tela de login — sem sentido, a pessoa já provou quem é).

## Uma causa, dois sintomas

**Raiz:** o backend decide **qual** prova aceitar a partir de `user.password == null`, não a
partir de **o que a conta realmente tem**.

- `UsersService.deleteAccount` (`users.service.ts:428`): só aceita `googleCredential` quando
  `user.password` é **nulo**. Conta com os dois → o ramo do Google é inalcançável.
- `DeleteAccountModal` (frontend): ramifica em `hasPassword` — `true` → campo de senha e nada
  mais; o Google fica invisível mesmo estando ligado.
- `UsersService.changePassword` / `setPassword`: "Trocar senha" exige `currentPassword`;
  "Definir senha" só funciona quando **não há** senha. Não há terceira porta — quem esqueceu a
  senha precisa **deslogar** para usar "Esqueci minha senha" da tela de login.

As duas correções andam juntas porque nascem da mesma lacuna ("já provei quem sou com o token,
mas o app me trata como anônimo"). O **sintoma 1** mexe no backend (a decisão de qual prova
aceitar); o **sintoma 2** é resolvido **só no frontend**, reusando o fluxo
`forgot-password` → `reset-password` que já existe — sem rota nova
(decisão do humano, 2026-09-10).

## Stack

Padrão da casa. **Sem mudança de schema, sem `db push`** — `LinkedAccount`, `User.password`
nullable e `AuthService.verifyGoogleIdentity` já existem (login-google). É afrouxar um `if` no
`deleteAccount`, expor um flag aditivo no `GET /users/me`, e mexer em duas telas. O fluxo
`forgot-password` → `reset-password` já existe e é reusado inteiro para o sintoma 2.

## Comportamento esperado

### A primitiva — `assertFreshProof(userId, proof)`

Um helper em `UsersService` que centraliza "esta requisição traz uma prova de identidade fresca?".
Consumidores: `deleteAccount` e, desde 2026-09-14, `setPassword` (ver "Definir a primeira senha").
`proof: { password?: string; googleCredential?: string }`:

1. Carrega o `user` (com `password`) e os `LinkedAccount` `google` dele.
2. **Se `proof.password` veio E `user.password != null`:** `bcrypt.compare`. Bateu → prova
   válida. Não bateu → 401 `Senha incorreta` (mensagem que o `deleteAccount` já usa hoje).
3. **Senão, se `proof.googleCredential` veio:** `AuthService.verifyGoogleIdentity(credential)`
   (o mesmo helper do `POST /auth/google` — assinatura, `aud`, `exp`, `email_verified`), e
   `payload.sub` tem que casar **um `LinkedAccount` `google` deste `userId`**. Bateu → prova
   válida. `sub` de outra conta / sem `LinkedAccount` → **400** (não 500). `credential`
   inválido/expirado → o **401** do helper propaga.
4. **Nenhuma prova válida** → **400** `Não foi possível confirmar sua identidade.` O mesmo texto
   vale para o `sub` de outra conta no passo 3. *(Até 2026-09-14 era "…para excluir a conta.";
   generalizado quando o `set-password` passou a usar a mesma primitiva.)*

**Por que a segurança NÃO afrouxa.** A propriedade que importa —
*"uma sessão roubada não pode, sozinha, apagar a conta"* (`ARCHITECTURE.md` §7) — continua
valendo. Não estamos removendo a exigência de prova; estamos **ampliando quais provas contam**.
Um atacante com o access token:
- **não sabe a senha** → o ramo 2 falha;
- **não completa o fluxo do Google como a vítima** → não produz um `googleCredential` fresco
  com o `sub` dela → o ramo 3 falha.
Aceitar "senha **ou** Google" não abre nada que "só senha" já não abrisse; só para de **bloquear
o dono legítimo** que perdeu acesso a um dos dois métodos.

### Correção do sintoma 1 — excluir a conta

- `DeleteAccountDto` já é `{ password?, googleCredential? }`. `deleteAccount` passa a chamar
  `assertFreshProof` em vez do `if (!user.password)` atual. A ordem de tentativa é a da
  primitiva (senha primeiro se veio e existe; senão Google).
- **`GET /users/me` ganha `hasGoogle: boolean`** (aditivo, ao lado do `hasPassword` que já
  existe) — lê `LinkedAccount` `provider = 'google'` deste usuário. Sem isso o frontend não tem
  como saber que a conta tem **os dois** métodos. Sem schema, sem `db push`.
- **Frontend (`DeleteAccountModal`):** deixa de ramificar rígido em `hasPassword`. Passa a
  oferecer, depois que o e-mail confere:
  - conta **só senha** (`hasPassword && !hasGoogle`) → campo de senha (como hoje);
  - conta **só Google** (`!hasPassword`) → botão de reautenticação Google (como a E7 já faz);
  - conta **com os dois** (`hasPassword && hasGoogle`) → campo de senha **+** um link
    "Não lembro minha senha" que troca para o botão de reautenticação Google. A pessoa usa o
    que conseguir.
- Falhas: senha errada → 401 + mensagem, conta intacta; Google de outra conta → 400 + mensagem,
  conta intacta, **nenhum token limpo**.

### Definir a primeira senha — `POST /users/me/set-password` (2026-09-14)

Entrou no escopo na revisão pré-produção (decisão do dono). Antes, a rota definia a primeira
senha de uma conta só-Google só com o access token. O `409` barrava conta que **já** tinha senha,
mas numa conta só-Google uma sessão roubada criava uma senha conhecida pelo atacante: acesso
persistente mesmo depois de a sessão expirar. Agora a rota exige um **login Google recente**.

- **Request:** `{ password: string, confirmPassword: string, googleCredential: string }`.
  `googleCredential` é obrigatório no DTO (`@IsString` + `@IsNotEmpty`, mensagem
  "Confirme sua identidade entrando com o Google."). Ausente ou vazio → **400** do ValidationPipe.
- **Ordem no service:**
  1. `password !== confirmPassword` → **400** `As senhas não conferem`;
  2. usuário não existe → **401**;
  3. conta já tem senha → **409** (antes de verificar o Google: não gasta a verificação e não
     muda a mensagem que aponta para "Trocar senha");
  4. `assertFreshProof(userId, { googleCredential })`: id_token inválido/expirado → **401** do
     `verifyGoogleIdentity`; `sub` que não é um `LinkedAccount` google **deste** usuário → **400**
     `Não foi possível confirmar sua identidade.`;
  5. grava o hash. Resposta de sucesso inalterada: `200 { message: "Senha definida." }`.
- Só o Google conta como prova aqui, porque a conta não tem senha (passo 3). Continua **sem**
  revogar `RefreshSession`.

### Correção do sintoma 2 — trocar senha sem lembrar a atual

**Só frontend. Um mecanismo para todos.** No `ChangePasswordModal` (fluxo de "Trocar senha"), um
link **"Não lembro minha senha atual"** que:

1. chama `POST /auth/forgot-password` (público, já existe) com **o e-mail da própria pessoa** —
   ela está autenticada, o frontend já tem o e-mail do perfil;
2. abre o `ResetPasswordModal`, que **já existe**, para ela colar o token do e-mail e definir a
   senha nova, **sem sair do app**.

O `reset-password` já revoga todas as `RefreshSession` (correto — a senha antiga deixou de
valer) e a pessoa entra de novo com a senha que acabou de definir.

- **Vale para conta só-senha e para conta com os dois métodos** — o caminho é o mesmo.
- **Conta só-Google** não tem "Trocar senha" (usa "Definir senha", que não pede a atual) —
  fora do alcance deste link.
- `POST /auth/forgot-password` é idempotente e genérico (responde igual exista ou não a conta);
  chamá-lo autenticado com o próprio e-mail não vaza nada e não precisa de rota nova
  (decisão do humano, 2026-09-10 — a alternativa da rota autenticada dedicada só valeria para
  telemetria separada de "reset a partir de logado", que ninguém pediu).

### Sem autenticação / sem permissão

`DELETE /users/me` e `GET /users/me` continuam sob `JwtAuthGuard` + throttle. `userId` vem
sempre de `req.user.userId`. O `googleCredential` no corpo é **prova**, não identidade — nunca
substitui o token. O `POST /auth/forgot-password` do sintoma 2 é o mesmo endpoint público de
sempre — nada muda nele.

### Timezone

Não se aplica.

## Requisitos de saída

### `DELETE /users/me` (alteração de comportamento, contrato inalterado)

- DTO `{ password?, googleCredential? }` (inalterado). Passa a aceitar `googleCredential`
  **independente** de `user.password`.
- `assertFreshProof` decide. Prova ausente/inválida → 400; `credential` malformado → 401;
  sucesso → 200 + conta apagada (cascade).

### `GET /users/me` (campo aditivo)

- Resposta ganha `hasGoogle: boolean` ao lado de `hasPassword` — `true` quando existe um
  `LinkedAccount` `provider = 'google'` deste usuário. Nenhum campo removido ou renomeado.

### `POST /auth/forgot-password` (inalterado — só passa a ser chamado de outro lugar)

- O frontend autenticado o chama com o próprio e-mail no sintoma 2. Contrato, guards e throttle
  intactos.

### Frontend (detalhe em `oratio/docs/specs/prova-identidade.md`, a criar)

- `DeleteAccountModal` — três modos, a partir de `hasPassword` + `hasGoogle` do perfil: só senha
  / só Google / os dois (senha + link "Não lembro minha senha" → botão Google).
- `ChangePasswordModal` — link "Não lembro minha senha atual" → `forgotPassword(profile.email)`
  → abre `ResetPasswordModal` (ambos já existem).
- `profileService` / tipo do perfil ganham `hasGoogle`.
- Reautenticação Google no `DeleteAccountModal` reusa `GoogleSignInButton` (como a E7).

## Modelo de dados

**Nada muda.** Zero `ALTER TABLE`, zero `db push`. Só lê `User.password` e `LinkedAccount` que
já existem.

## Critérios de aceite (testáveis, em BDD)

### Backend — cobertos por teste automatizado (os dois pedidos)

- [x] **Dado** um `User` com `password != null` **e** um `LinkedAccount` `google`, **quando**
  `DELETE /users/me` com um `googleCredential` cujo `sub` é de **outra** conta (sem
  `LinkedAccount` deste usuário), **então** 400 e `user.delete` **não** é chamado.
  *(`users.service.spec.ts` — "conta COM senha: googleCredential cujo sub é de OUTRA conta")*
- [x] **Dado** um `User` com **os dois métodos**, **quando** `DELETE /users/me` com `password`
  **correto** (sem `googleCredential`) **ou** com um `googleCredential` fresco cujo `sub` casa um
  `LinkedAccount` `google` deste usuário (sem `password`), **então** 200 e a conta é apagada nos
  dois casos. *(`users.service.spec.ts` — "conta COM os dois métodos: aceita a senha correta OU um googleCredential fresco")*

### Backend — verificados por contrato / manualmente

- [x] **Dado** uma conta só-senha, **quando** `DELETE /users/me` com `password` **errado** e sem
  `googleCredential`, **então** 401 e `user.delete` **não** é chamado (regressão do caminho
  antigo — o `users.service.spec.ts` já cobre).
- [x] **Dado** nenhuma credencial no corpo, **quando** `DELETE /users/me`, **então** 400
  ("Não foi possível confirmar sua identidade.") — `users.service.spec.ts`.

### Backend — `set-password` (2026-09-14, cobertos por teste automatizado)

- [x] **Dado** um corpo sem `googleCredential`, **quando** `POST /users/me/set-password`, **então**
  400 de validação. *(`set-password.dto.spec.ts`)*
- [x] **Dado** uma conta só-Google, **quando** `POST /users/me/set-password` com um
  `googleCredential` cujo `sub` é de **outra** conta, **então** 400 e a senha **não** é gravada.
- [x] **Dado** uma conta só-Google, **quando** `POST /users/me/set-password` com um
  `googleCredential` inválido/expirado, **então** 401 e a senha **não** é gravada.
- [x] **Dado** uma conta só-Google, **quando** `POST /users/me/set-password` com um
  `googleCredential` fresco do próprio vínculo, **então** 200 e o hash é gravado.
- [x] **Dado** uma conta que já tem senha, **quando** `POST /users/me/set-password`, **então**
  409 **sem** chamar a verificação do Google. *(`users.service.spec.ts` — "setPassword")*
- [x] **Dado** um token de **outro** usuário, **quando** `DELETE /users/me`, **então** só a
  conta **do token** é avaliada — `userId` vem sempre de `req.user.userId` (`users.controller.ts`).
- [x] **Dado** um `User` com Google ligado, **quando** `GET /users/me`, **então** a resposta
  traz `hasGoogle: true` (e `false` para quem não tem `LinkedAccount` google) —
  `users.service.spec.ts` ("getProfile").

### Frontend (resumo — completo no par, verificado no navegador pelo humano)

- [ ] **Dado** uma conta com os dois métodos, **quando** abre o `DeleteAccountModal` e confere o
  e-mail, **então** vê o campo de senha **e** o link "Não lembro minha senha"; clicar no link
  troca para o botão de reautenticação Google.
- [ ] **Dado** "Trocar senha" (conta só-senha **ou** com os dois), **então** há um link "Não
  lembro minha senha atual" que dispara o `forgot-password` do próprio e-mail e abre o
  `ResetPasswordModal` **sem** deslogar antes.

## Plano de testes

- **Unitário (Jest) — só dois testes novos**, ambos no caminho da exclusão, em
  `users.service.spec.ts`:
  1. `googleCredential` cujo `sub` é de **outra** conta → recusa (400) e **não** apaga;
  2. conta com **os dois métodos** → aceita a senha correta **e** aceita um `googleCredential`
     válido deste usuário (dois casos, mesma conta).
  Os testes existentes de `deleteAccount` (só-senha, só-Google, senha errada) continuam verdes
  como regressão.
- **Manual (humano, no navegador):** os três modos do `DeleteAccountModal` (só senha / só Google
  / os dois) e o link "Não lembro minha senha atual" no `ChangePasswordModal`.

Loop de verificação: `npm test -- <pattern>` → `npm test` → `npm run build` → `npm run lint`.

## Fora de escopo

- **Segundo fator / TOTP / e-mail de confirmação de exclusão.** A prova continua sendo senha ou
  Google fresco — não muda o modelo, só amplia.
- ~~**`POST /users/me/set-password` com `googleCredential`**. Descartado em 2026-09-10.~~
  **Entrou no escopo em 2026-09-14** com outro objetivo: não é trocar a senha sem a atual (isso
  segue pelo `forgot`→`reset`), é exigir prova para definir a **primeira** senha. Ver
  "Definir a primeira senha".
- **Reautenticação para outras operações** (trocar e-mail, etc.) — ampliar o alcance além de
  `deleteAccount` e `setPassword` é decisão à parte.
- **Login com Apple / outros provedores** — só `google` existe.
- **Processo:** atualizar `ARCHITECTURE.md` §7 (feito no commit da implementação); criar o
  ponteiro no `oratio`; revisar contrato com o frontend.

## Notas de ambiente

Sem env var nova, sem `db push`, sem custo externo (a verificação do `id_token` busca certs
cacheados do Google — sem custo por chamada), sem impacto no scheduler.

## Decisões (fechadas 2026-09-10)

- **Spec própria, não Fase F do login-google.** O sintoma 2 não é sobre Google (é lacuna de UX
  de senha); `login-google` está quase fechando e não deve carregar mais escopo; exclusão de
  conta é irreversível e merece critérios e rollout próprios.
- **Reusar `POST /auth/forgot-password` com o próprio e-mail — sem rota nova.** O endpoint já é
  público, idempotente e genérico; chamá-lo autenticado com o e-mail do perfil não vaza nada.
- **Sem plano/checklist.** Mudança pequena — vai direto ao código, um commit para a exclusão de
  conta (backend + `hasGoogle`) e commits de frontend à parte.

## Questões em aberto

Nenhuma.
