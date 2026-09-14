# Índice de specs — Oratio API

Mapa único de `spec ↔ plano ↔ checklist ↔ status`. **Este arquivo é a fonte da verdade sobre o
que existe**; não confie em adivinhar nome de arquivo. Quem fecha uma fase atualiza esta tabela
no mesmo commit — e `/docs-sync` confere se ela bate com a realidade.

| Feature | Spec | Plano | Checklist | Frontend pareado | Status |
|---|---|---|---|---|---|
| Reformulação das notificações | — | `tasks/notifications-plan.md` | `tasks/notifications-todo.md` | `oratio/docs/tasks/notifications.md` (ponteiro) | ✅ concluída (Fases 1–5) |
| Perfis de resposta do VoxAI | — *(não precisa: já entregue)* | `tasks/vox-profiles-plan.md` | `tasks/vox-profiles-todo.md` | `oratio/docs/tasks/vox-profiles-todo.md` | ✅ **em produção** (`main`: 2 campos no schema, 6 perfis com `systemAppend`, 3 rotas; `db push` aplicado) |
| Bíblia de Estudo | — *(não precisa: já entregue)* | `tasks/biblia-plan.md` | `tasks/biblia-todo.md` | `oratio/docs/tasks/biblia-*.md` | ✅ **em produção** (B1–B3 na `main`; `npx jest bible` → 4 suítes, 39 testes verdes) |
| Entrar com Google | `specs/login-google.md` | `tasks/login-google-plan.md` | `tasks/login-google-todo.md` | `oratio/docs/specs/login-google.md` (ponteiro) | 🚧 **Fases A–E na `develop`** dos dois repos — **`main` não tem NADA de login-google**; promover "para a `main`" = promover A–E de uma vez. Fase E (2026-09-09): reverte a anti-enumeração do login, `isNewUser`/`googleLinkedNow` no `POST /auth/google`, bloqueio de cadastro repetido, toast de auto-ligação, rótulo do botão, loading state, exclusão de conta só-Google, aviso "Defina uma senha" no Perfil. **✅ Fase E verificada no navegador (Checkpoint E, 2026-09-10): os 7 cenários OK. BUG-E1 corrigido e verificado nas 3 configurações** (balão "Defina uma senha" via `<Portal/>` — `oratio` commit `23b0d78`, na `develop` pelo merge `4401808`). **Sem bloqueio de código pra `main`.** Console OAuth **feito** (2026-09-09); `db push` de produção **feito** (2026-09-09); `GOOGLE_CLIENT_ID` no Render + `VITE_GOOGLE_CLIENT_ID` na Vercel **feitos** (2026-09-14). Falta: publicar o app OAuth + verificação pós-deploy da CSP. |
| Boas-vindas (guia de primeira entrada) | `specs/boas-vindas.md` | — *(sem plano: mudança pequena, foi direto)* | — | `oratio/docs/specs/boas-vindas.md` (ponteiro) | 🚧 **na `develop` dos dois repos** (2026-09-10) — **`main` não tem nada**. Guia de 3 páginas na 1ª entrada (senha e Google), 1x só. **Backend:** `User.welcomeSeenAt DateTime?` (paralelo a `voxOnboardingSeenAt`); `showWelcome` aditivo no `GET /users/me`; `POST /users/me/welcome-seen` (`JwtAuthGuard`, sem throttle/X-App) → `markWelcomeSeen`, idempotente (só carimba se ainda null). **Frontend:** rota `/oratio/boas-vindas` tela cheia (fora de bottom nav), `WelcomeGuide` (3 páginas, progresso, sem pular) — **animado desde 2026-09-10** (2º prompt): texto que se digita, transição entre páginas, ícone em movimento, tocar completa / arrastar avança, `prefers-reduced-motion` = tudo instantâneo. **Cada tela é um capítulo (3º prompt):** título + intro + lista de 3–4 recursos com rota (Oração diária / Caminhos / Estudo e conversa); lista `<ul>/<li>` inteira no DOM + cópia `.srOnly`; cabe em 375×667 sem rolar. Copy = desvios nesta spec. `WelcomeGate` no shell redireciona por `showWelcome` e **reavalia a cada troca de rota** (fix 2026-09-10: cadastro por senha só via o guia no boot seguinte). `welcomeService.markWelcomeSeen`, Login/Register vão direto ao guia no `isNewUser` (só evita flash). 11 testes (3 `WelcomeGate` + 8 `WelcomeGuide`, fake timers). **Coluna + backfill aplicados em produção** (2026-09-14, `depois` = `total_users_antes` conferido) — script `prisma/db-scripts/2026-09-10-boas-vindas.sql`. Falta QA na tela + promoção pra `main`. |
| Admin: método de entrada | `specs/admin-provedor.md` | — *(sem plano: mudança pequena, foi direto)* | — | `oratio/docs/specs/admin-provedor.md` (ponteiro) | 🚧 **na `develop` dos dois repos** (2026-09-10) — **`main` não tem nada**. Ver/filtrar Oratio × Google × ambos no painel admin, **só leitura**. **Backend:** `getAllUsers`/`getUserDetail` selecionam `password` + `linkedAccounts.provider`, mapeiam pra `hasPassword` + `authProviders: string[]` e **descartam o hash** (como `getProfile`); `GET /users/admin/users` ganha o query param `provider` (`oratio` \| `google` \| `both`; valor inválido → ignorado, nunca 400) → cláusula `where` de `password`/`linkedAccounts` (3 estados). **Frontend:** `AdminFilters.provider` + campos novos em `AdminUser` no `adminService`; grupo de chips "Entrada" no `AdminFilterSheet`, `filterProvider` no `AdminPanel` (contagem/summary/limpar); ícones `Mail`/Google + `AlertTriangle` pra anomalia no `renderCard`/`renderCompactRow` e no modal de detalhe. **Sem schema, sem `db push`, sem rota nova.** `ARCHITECTURE.md` §7 atualizado. Falta teste manual no painel + promoção pra `main`. |
| Prova de identidade (reautenticação p/ operações sensíveis) | `specs/prova-identidade.md` | — *(sem plano: mudança pequena, foi direto)* | — | `oratio/docs/specs/prova-identidade.md` (ponteiro) | 🚧 **na `develop` dos dois repos** (2026-09-10) — **`main` não tem nada**. Uma causa (o backend decidia a prova por `user.password == null`, não pelo que a conta tem) → dois sintomas: (1) não dava pra excluir a conta com o Google se você tinha senha; (2) quem esqueceu a senha precisava deslogar pra trocá-la. **Sintoma 1 (backend, commit separado — exclusão é irreversível):** `deleteAccount` chama `assertFreshProof` (senha **ou** Google fresco casando um `LinkedAccount` deste user; `private`, pronto pra reuso) + `hasGoogle` aditivo no `GET /users/me`; +2 testes (Google de outra conta → 400 e não apaga; conta com os dois métodos → aceita qualquer prova). Frontend: `DeleteAccountModal` em 3 modos (só senha / só Google / os dois com link "Não lembro minha senha" → botão Google), `profileService`/tipo do perfil com `hasGoogle`. **Sintoma 2 (só frontend):** link "Não lembro minha senha atual" no `ChangePasswordModal` → `forgotPassword(profile.email)` → `ResetPasswordModal` (rota pública reusada, **sem rota nova**), com aviso de que o e-mail chega e é preciso sair do app pra concluir. Sem schema, sem `db push`. `ARCHITECTURE.md` §5/§7 atualizado. Falta: teste manual humano dos 3 modos + do link (na tela); promoção pra `main`. |
| Consentimento de privacidade (LGPD) | `specs/consentimento-privacidade.md` | — | `oratio/docs/tasks/consentimento-legal-todo.md` | `oratio/docs/specs/consentimento-privacidade.md` (ponteiro) | 🚧 **na `develop` dos dois repos** (merge `2fa0858` aqui, `ba706e0` no `oratio`, 2026-09-11) — **`main` não tem nada**. Colunas **aplicadas em produção sem backfill** (2026-09-14; `consentidos = 0` conferido, depois de zerar a conta de teste que tinha aceitado via backend local apontando pro banco de produção). Falta: `/review-pr` (item 6 do checklist, nunca rodado) + QA na tela + promoção pra `main`. Mecanismo de consentimento a **dois** documentos (Termos de Uso + Política de Privacidade, aceitos juntos — **texto já existe e já foi aprovado**, `oratio/docs/legal/2026-09-11-*.md`, não é mais placeholder). **Backend:** `User.legalTermsAcceptedAt`/`legalTermsVersion` (renomeado de `privacy*` — um par cobre os dois documentos, não dois pares; versão por causa do ônus da prova do art. 8º §2 e de reconsentimento quando qualquer um dos textos mudar, sem precisar de script novo), `LEGAL_TERMS_VERSION` em código (já `"2026-09-11"`, real), `CreateUserDto.legalTermsAccepted` **obrigatório** (`@Equals(true)`, 400 se faltar), `GET /users/me` ganha `legalTermsAccepted`, `POST /users/me/legal-terms-accepted` novo. `auth.service.ts` **nunca** grava consentimento (nem no registro nem no login por Google) — só o frontend, depois de mostrar a tela. **Sem `db push`, sem backfill** — ao contrário do `welcomeSeenAt`, aqui backfilar anularia a feature (ver a spec, "⚠️ SEM BACKFILL"). Correção desta revisão: o app não guarda "intenções de oração" (`Prayer`/`GeneralPrayer` são catálogo sem `userId`) — o dado sensível real é `Message.content`, `BibleMark.note`, `QuaresmaMichaelPenance.content`, registros de prática devocional e a própria existência da conta. **Bloqueada por** `specs/vox-protocolo-crise.md` (linha abaixo) antes de publicar os Termos de Uso. |
| Protocolo de crise do Vox | `specs/vox-protocolo-crise.md` | — *(ainda não escrito)* | — | n/a — só prompt | 🚧 **instrução na `develop`** (2026-09-11) — bloco `## Crise aguda` dentro de `VOX_IDENTITY` → "Apoio em sofrimento emocional", com precedência sobre os 6 perfis (o teto de `maxTokens` do `DIRECT` não pode cortar o encaminhamento). Texto **aceito por Lucas**, que o inseriu ele mesmo. **Os 6 critérios de comportamento seguem em aberto** — só verificáveis com chamada real ao modelo, ainda não feita. **Bloqueante** da publicação dos Termos de Uso (linha acima): os Termos já aprovados (`oratio/docs/legal/2026-09-11-termos-de-uso.md` §4) prometem que o Vox encaminha crise/ideação suicida para CVV 188/`cvv.org.br`/SAMU 192; a instrução já existe em `vox.prompt.ts` (`fc6f2e9`); o que falta é provar o comportamento com chamada real. Precedência sobre os 6 perfis de `VOX_PROFILES`. **Redação final do bloco de prompt exige preflight `doutrina-guardrail` e aceite explícito de Lucas antes do commit** (`RULES.md` §3) — esta spec descreve o comportamento em critérios de aceite, não a redação. |

## Legenda de status

| Status | Significa |
|---|---|
| 📝 rascunho | spec escrita, ainda não aprovada pelo humano |
| ✅ aprovada | aprovada, implementação não começou |
| 🚧 em andamento | tem plano e checklist abertos em `docs/tasks/` |
| ✅ implementada | todos os critérios de aceite verificados por `/qa-verify` |
| 🗑️ obsoleta | superada por outra spec — diga qual |

## Como usar

- **Feature nova:** `/criar-spec <nome>` → gera `specs/<nome>.md` a partir de `_template.md` e
  adiciona a linha aqui.
- **Implementar:** `/implement-story specs/<nome>.md`.
- **Provar que está pronto:** `/qa-verify specs/<nome>.md` — um `curl` por critério, contra o
  serviço local no ar, com evidência.
- **Requisito mudou:** edite **só a spec** e rode `/spec-sync specs/<nome>.md`.
- **Mudança de schema:** `/db-change <descrição>` — escreve o script e o rollback para revisão
  humana. Nunca executa (`RULES.md` §2).

## Pendências de execução humana registradas

Estas não são tarefas de código; são passos que só o humano pode executar e que bloqueiam o
fechamento de uma feature. Mantenha a lista curta e atual — **pendência resolvida e ainda
listada é tão ruim quanto pendência não registrada.**

- **login-google** — **produção do OAuth** (o cliente/tela de consentimento no Google Cloud
  Console foi feito em 2026-09-09: projeto Oratio, consent screen com os 3 escopos não-sensíveis,
  usuários de teste, cliente "Oratio Web" com origens `http://localhost:5173` +
  `https://oratio-phi.vercel.app`; Client ID nos `.env` locais dos dois repos). Env vars no
  Render + Vercel **feitas** (2026-09-14). **Falta:** **publicar** o app OAuth (sai de "Testing"
  → só usuários de teste conseguem logar em prod até publicar; publicar exige a URL pública da
  Política de Privacidade, que só existe com a `main` no ar).
- **login-google** — verificação pós-deploy da CSP do GIS (console do navegador no app da Vercel)
  + smoke do PWA no iPhone.

Resolvidas em 2026-09-14 (conferidas no Supabase de produção): `User.welcomeSeenAt` + backfill
(`depois` = `total_users_antes`), `User.legalTermsAcceptedAt`/`legalTermsVersion` **sem backfill**
(`consentidos = 0`). O `db push` de produção do **login-google** foi feito em 2026-09-09 (Supabase;
`LinkedAccount` + `password` nullable — reconferidos em 2026-09-14). O do VoxAI e o aceite doutrinário dos perfis também já haviam sido
feitos — removidos em 2026-09-04. `google-auth-library` foi aprovada (2026-09-08) e já está no
`package.json`.

## Dívidas conhecidas

Gaps reais que precisam de dono — não são specs nem pendências de deploy.

- ~~**Editar o nome no perfil não funciona ponta a ponta.**~~ ✅ Resolvido em 2026-09-11: o
  `PATCH /users/me` ganhou `UpdateProfileDto` (validação real) e parou de vazar
  `emailVerificationToken`/`passwordResetToken`/`pendingEmailToken` na resposta; o frontend ganhou
  o botão "Editar nome" em Configurações da conta (`oratio` commit da branch `feat/editar-nome`).
- ~~**Não há Política de Privacidade.**~~ Atualizado 2026-09-11: o texto **já existe e já foi
  aprovado** (`oratio/docs/legal/2026-09-11-politica-de-privacidade.md` e
  `2026-09-11-termos-de-uso.md`) — não é mais placeholder. O mecanismo tem spec
  (`specs/consentimento-privacidade.md`, ✅ aprovada) e está **bloqueado** por
  `specs/vox-protocolo-crise.md` antes de publicar (ver tabela acima), e implementação ainda não
  começou.
- **A Política de Privacidade aprovada declarava três coisas como fato que não eram
  verdade** (achado ao escrever/revisar `consentimento-privacidade.md`, 2026-09-11 —
  `oratio/docs/legal/2026-09-11-politica-de-privacidade.md` §8 principalmente):
  - ~~`RefreshSession.location` sem finalidade declarada~~ — **resolvido 2026-09-14**: a §8
    passou a declarar a localização aproximada obtida do IP e a finalidade (mostrar em quais
    aparelhos a pessoa está conectada). A coluna fica.
  - ~~Promessa de "período curto" sem job de limpeza~~ — **resolvido 2026-09-14 reescrevendo a
    frase**, não criando job (`oratio` `fix/politica-retencao-sessoes`): registros de acesso
    ficam enquanto a conta existir; saem por logout (`auth.service.ts:534`), encerramento na
    tela de sessões, troca/reset de senha (`auth.service.ts:769`) ou exclusão da conta. Editado
    em-place na versão `2026-09-11` (ninguém em produção tinha aceitado).
  - **Não existe exclusão de contas inativas por 24 meses, nem aviso por e-mail antes.** A
    política (§8) declara os dois como fato. Ainda aberto — não bloqueia o lançamento.
- **Itens baixos do `/review-pr` da subida (2026-09-14), registrados como dívida por decisão de
  Lucas:**
  - DTOs sem `@MaxLength` (`google-login.dto.ts` `credential`, `delete-account.dto.ts`,
    `set-password.dto.ts`, `create-user.dto.ts` `name`); o bcrypt só considera 72 bytes da senha.
    O throttle limita o abuso.
  - `AuthService` cria `new OAuth2Client` a cada verificação do Google — sem cache das chaves
    entre requisições (latência extra em `/auth/google` e na prova de identidade).
  - **Rollback**: voltar o Render para a `main` antiga depois desta subida quebra as contas
    só-Google (`bcrypt.compare(x, null)` no código velho → 500 no login por senha e no
    `DELETE /users/me`). Rollback de código não é "gratuito" depois que existem contas só-Google.
  - `npm run lint` não roda (a config do ESLint ignora os globs passados) e ainda tem `--fix`.
  - A prova Google só confere validade do id_token (até 1h), sem `iat`/`auth_time`/nonce — fora
    de escopo na spec `prova-identidade`.
  - **Build do Render**: o Build Command deve gerar o Prisma Client explicitamente
    (`npm install && npx prisma generate && npm run build`). Localmente o client velho derrubou
    a API com 12 erros de tipo e o `npm test` não pegou (Jest não confere tipos).
- **`oratio/docs/ARCHITECTURE.md` ainda cita `guestAllowedPrefixes`** (§3/§7/quirks) como se
  fosse uma lista real no código — não é. Checado nesta revisão (2026-09-11):
  `oratio-api/docs/ARCHITECTURE.md` **não** tem essa menção (busca sem resultado) — só o
  `oratio/docs/ARCHITECTURE.md` tem. A versão anterior desta linha generalizava "os dois repos"
  por engano. `RULES.md` dos dois repos já foi corrigido (pedido explícito).

## Por que não há spec para as features existentes

Todas as features desta tabela foram construídas direto no par plano+checklist, sem spec — e
**não vale a pena escrever spec retroativa para elas**. Spec é contrato antes do código: quando o
código já existe e funciona, o que sobra é documentação, e isso o `docs/ARCHITECTURE.md` já faz.
Um terceiro arquivo dizendo o mesmo só cria mais uma coisa para manter em sincronia.

O template e os comandos (`/criar-spec`, `/qa-verify`, `/spec-sync`) valem para a **próxima**
feature — a que ainda não existe. Aí a spec é contrato de verdade, e mudar um requisito vira
editar um arquivo em vez de reexplicar contexto numa conversa nova.
