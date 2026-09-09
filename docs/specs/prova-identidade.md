# Spec: prova-identidade — reautenticação para operações sensíveis

> Status: **rascunho** (2026-09-09) — proposta com raciocínio, aguarda "ok"
> Plano: `docs/tasks/prova-identidade-plan.md` · Checklist: `docs/tasks/prova-identidade-todo.md` *(a criar)*
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
  "Definir senha" só funciona quando **não há** senha. Não há terceira porta.

Especificar as duas correções **juntas** porque compartilham a mesma primitiva — a "prova de
identidade fresca". Separadas, viram duas mudanças que se contradizem no `users.service`.

## Stack

Padrão da casa. **Sem mudança de schema, sem `db push`** — `LinkedAccount`, `User.password`
nullable e `AuthService.verifyGoogleIdentity` já existem (login-google). É só afrouxar os
`if`s do `users.service` e ajustar DTOs/telas. O `passwordResetToken` mecanismo já existe.

## Comportamento esperado

### A primitiva — `assertFreshProof(userId, proof)`

Um helper novo em `UsersService` (ou `AuthService`), reusado pela exclusão e pela troca de senha
sem a atual. `proof: { password?: string; googleCredential?: string }`:

1. Carrega o `user` (com `password`) e os `LinkedAccount` `google` dele.
2. **Se `proof.password` veio E `user.password != null`:** `bcrypt.compare`. Bateu → prova
   válida. Não bateu → 401 `{ message: "Invalid credentials" }` (mesma mensagem de sempre).
3. **Senão, se `proof.googleCredential` veio:** `AuthService.verifyGoogleIdentity(credential)`
   (o mesmo helper do `POST /auth/google` — assinatura, `aud`, `exp`, `email_verified`), e
   `payload.sub` tem que casar **um `LinkedAccount` `google` deste `userId`**. Bateu → prova
   válida. `sub` de outra conta / sem `LinkedAccount` → **400** (não 500). `credential`
   inválido/expirado → o **401** do helper propaga.
4. **Nenhuma prova válida** → **400** `{ message: "Não foi possível confirmar sua identidade." }`.

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
- **Frontend (`DeleteAccountModal`):** deixa de ramificar rígido em `hasPassword`. Passa a
  oferecer, depois que o e-mail confere:
  - conta **só senha** → campo de senha (como hoje);
  - conta **só Google** → botão de reautenticação Google (como a E7 já faz);
  - conta **com os dois** → campo de senha **+** um link "Não lembro minha senha" que troca
    para o botão de reautenticação Google. A pessoa usa o que conseguir.
- Falhas: senha errada → 401 + mensagem, conta intacta; Google de outra conta → 400 + mensagem,
  conta intacta, **nenhum token limpo**.

### Correção do sintoma 2 — definir senha nova sem a atual

- **Conta com Google ligado:** em "Trocar senha", um link **"Não lembro minha senha atual"** →
  reautentica pelo Google → abre o formulário de senha nova (novo + confirmar, **sem** campo de
  senha atual). `POST /users/me/set-password` passa a aceitar
  `{ password, confirmPassword, googleCredential? }`:
  - `user.password == null` → como hoje (primeira senha, sem prova).
  - `user.password != null` **e** `googleCredential` válido para este user (via
    `assertFreshProof`) → grava a senha nova **e revoga todas as `RefreshSession`** (uma
    credencial que valia deixou de valer — mesma regra do `changePassword`/`resetPassword`).
  - `user.password != null` sem prova válida → **409**, "use Trocar senha".
- **Conta só senha que esqueceu a senha:** não há como provar sem um segundo método. O link
  "Não lembro minha senha atual" dispara o `requestPasswordReset` **do próprio e-mail** (a
  pessoa está autenticada, sabemos o e-mail) e abre o `ResetPasswordModal` que **já existe** —
  sem sair do app. O reset revoga sessões (correto) e a pessoa entra de novo com a senha que
  acabou de definir. **Reusa o `forgot`→`reset` inteiro; nada novo no backend.**

### Sem autenticação / sem permissão

Todas as rotas afetadas continuam sob `JwtAuthGuard` + throttle 5/60s. `userId` vem sempre de
`req.user.userId`. O `googleCredential` no corpo é **prova**, não identidade — nunca substitui o
token.

### Timezone

Não se aplica.

## Requisitos de saída

### `DELETE /users/me` (alteração de comportamento, contrato inalterado)

- DTO `{ password?, googleCredential? }` (inalterado). Passa a aceitar `googleCredential`
  **independente** de `user.password`.
- `assertFreshProof` decide. Prova ausente/inválida → 400; `credential` malformado → 401;
  sucesso → 200 + conta apagada (cascade).

### `POST /users/me/set-password` (alteração de DTO + comportamento)

- DTO passa a `{ password, confirmPassword, googleCredential? }`.
- `user.password == null` → grava (sem prova). `user.password != null` + `googleCredential`
  válido → grava **e revoga `RefreshSession`s**. `user.password != null` sem prova → 409.
- 400 (senhas diferentes), 401 (sem token / `credential` inválido), 409 (já tem senha e sem
  prova), 429.

### `POST /users/me/forgot-password-self` *(a confirmar se precisa de rota nova)*

- Alternativa 1: **rota nova** autenticada que chama `requestPasswordReset(req.user.email)` —
  explícita, sem depender do frontend saber o e-mail.
- Alternativa 2: o frontend, autenticado, chama o `POST /auth/forgot-password` **público** que
  já existe, passando o próprio e-mail (que ele tem do perfil). Zero backend novo.
- **Proposta:** alternativa 2 — nada novo, e o `forgot-password` já é idempotente e genérico.
  A rota nova só valeria se quiséssemos telemetria separada de "reset a partir de logado".

### Frontend (detalhe em `oratio/docs/specs/prova-identidade.md`)

- `DeleteAccountModal` — três modos (só senha / só Google / os dois com fallback).
- "Trocar senha" (`AccountSettings` / `ChangePasswordModal`) — link "Não lembro minha senha
  atual"; ramifica em `authProviders`/`hasPassword` do perfil.
- `profileService.setPassword` aceita `googleCredential` opcional.
- Reautenticação Google reusa `GoogleSignInButton` (como a E7).

## Modelo de dados

**Nada muda.** Zero `ALTER TABLE`, zero `db push`. Só lê `User.password` e `LinkedAccount` que
já existem.

## Critérios de aceite (testáveis, em BDD)

### Backend

- [ ] **Dado** um `User` com `password != null` **e** um `LinkedAccount` `google`, **quando**
  `DELETE /users/me` com um `googleCredential` fresco cujo `sub` casa esse `LinkedAccount`,
  **então** 200 e a conta é apagada (o teste asserta que `bcrypt.compare` **não** foi chamado e
  `verifyGoogleIdentity` **foi**).
- [ ] **Dado** o mesmo `User`, **quando** `DELETE /users/me` com `password` **correto**, **então**
  200 e a conta é apagada (o caminho da senha continua valendo).
- [ ] **Dado** o mesmo `User`, **quando** `DELETE /users/me` com um `googleCredential` cujo `sub`
  é de **outro** user, **então** 400, `user.delete` **não** chamado.
- [ ] **Dado** o mesmo `User`, **quando** `DELETE /users/me` com `password` **errado** e sem
  `googleCredential`, **então** 401, `user.delete` **não** chamado.
- [ ] **Dado** um `User` com `password != null` e Google ligado, **quando**
  `POST /users/me/set-password` com senhas válidas iguais **e** `googleCredential` válido,
  **então** 200, `user.update` grava o hash novo **e** `refreshSession.deleteMany` **é** chamado.
- [ ] **Dado** o mesmo `User`, **quando** `POST /users/me/set-password` **sem** `googleCredential`,
  **então** 409 (use "Trocar senha") e a senha não muda.
- [ ] **Dado** um `User` **só senha** (sem Google), **quando** `POST /users/me/set-password` com
  `googleCredential` qualquer, **então** 409 (não há `LinkedAccount` para casar).
- [ ] **Dado** nenhuma credencial, **quando** `DELETE /users/me` **ou**
  `POST /users/me/set-password`, **então** 401.
- [ ] **Dado** um token de **outro** usuário, **quando** `DELETE /users/me` com o
  `googleCredential` do **próprio** (do token), **então** só a conta **do token** é avaliada —
  nunca um `userId` de corpo.

### Frontend (resumo — completo no par)

- [ ] **Dado** uma conta com os dois métodos, **quando** abre o `DeleteAccountModal` e confere o
  e-mail, **então** vê o campo de senha **e** o link "Não lembro minha senha"; clicar no link
  troca para o botão de reautenticação Google.
- [ ] **Dado** "Trocar senha" numa conta com Google, **então** há um link "Não lembro minha
  senha atual" que leva à reautenticação Google → formulário de senha nova sem "senha atual".
- [ ] **Dado** "Trocar senha" numa conta **só senha**, **então** o link dispara o
  `forgot-password` do próprio e-mail e abre o `ResetPasswordModal` **sem** deslogar antes.

## Plano de testes

- **Unitário (Jest):** `users.service.spec.ts` — `assertFreshProof` (os 4 desfechos) + os dois
  consumidores (`deleteAccount`, `setPassword`) para conta só-senha / só-Google / os-dois.
  `users.controller.spec.ts` — DTOs, 401 sem token.
- **Contrato (`curl`):** conta com os dois métodos → `DELETE /users/me` com senha certa → 200;
  repetir com `googleCredential` (id_token real, como na Fase B) → 200. `set-password` com
  `googleCredential` numa conta com senha → 200 + sessões revogadas.
- **Manual (humano):** os três caminhos de exclusão e os dois de "não lembro a senha" no
  navegador.

Loop de verificação: `npm test -- <pattern>` → `npm test` → `npm run build` → `npm run lint`.

## Fora de escopo

- **Segundo fator / TOTP / e-mail de confirmação de exclusão.** A prova continua sendo senha ou
  Google fresco — não muda o modelo, só amplia.
- **Reautenticação para outras operações** (trocar e-mail, etc.) — hoje só exclusão e senha
  entram; a primitiva `assertFreshProof` fica pronta para reuso, mas ampliar o alcance é
  decisão à parte.
- **Login com Apple / outros provedores** — `authProviders` já comporta; só `google` existe.
- **Processo:** atualizar `ARCHITECTURE.md` §7; criar o ponteiro no `oratio`; revisar contrato.

## Notas de ambiente

Sem env var nova, sem `db push`, sem custo externo (a verificação do `id_token` busca certs
cacheados do Google — sem custo por chamada), sem impacto no scheduler.

## Questões em aberto

- [ ] **Isolar como spec própria ou virar Fase F do login-google?** **Proposta: spec própria
  (esta).** Motivos: (a) o **sintoma 2** não é sobre Google — é uma lacuna de UX de senha que
  existe independente de login social; pendurar em "login-google" rotula errado. (b)
  `login-google` está entrando na `develop` e quase fechando; uma Fase F atrasa o fechamento e
  mistura escopos. (c) **exclusão de conta é irreversível** — merece critérios de aceite,
  revisão e rollout próprios, não diluídos numa fase de outra feature. (d) a primitiva
  `assertFreshProof` é reusável e conceitualmente "prova de identidade para operação sensível",
  não "detalhe do login com Google".
- [ ] **`forgot-password-self`: rota nova ou reusar a pública?** Proposta: reusar a pública
  (`POST /auth/forgot-password` com o próprio e-mail) — zero backend novo. Confirmar.
