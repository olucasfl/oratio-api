# Índice de specs — Oratio API

Mapa único de `spec ↔ plano ↔ checklist ↔ status`. **Este arquivo é a fonte da verdade sobre o
que existe**; não confie em adivinhar nome de arquivo. Quem fecha uma fase atualiza esta tabela
no mesmo commit — e `/docs-sync` confere se ela bate com a realidade.

| Feature | Spec | Plano | Checklist | Frontend pareado | Status |
|---|---|---|---|---|---|
| Reformulação das notificações | — | `tasks/notifications-plan.md` | `tasks/notifications-todo.md` | `oratio/docs/tasks/notifications.md` (ponteiro) | ✅ concluída (Fases 1–5) |
| Perfis de resposta do VoxAI | — *(não precisa: já entregue)* | `tasks/vox-profiles-plan.md` | `tasks/vox-profiles-todo.md` | `oratio/docs/tasks/vox-profiles-todo.md` | ✅ **em produção** (`main`: 2 campos no schema, 6 perfis com `systemAppend`, 3 rotas; `db push` aplicado) |
| Bíblia de Estudo | — *(não precisa: já entregue)* | `tasks/biblia-plan.md` | `tasks/biblia-todo.md` | `oratio/docs/tasks/biblia-*.md` | ✅ **em produção** (B1–B3 na `main`; `npx jest bible` → 4 suítes, 39 testes verdes) |
| Entrar com Google | `specs/login-google.md` | `tasks/login-google-plan.md` | `tasks/login-google-todo.md` | `oratio/docs/specs/login-google.md` (ponteiro) | 🚧 **Fases A–E na `develop`** dos dois repos — **`main` não tem NADA de login-google**; promover "para a `main`" = promover A–E de uma vez. Fase E (2026-09-09): reverte a anti-enumeração do login, `isNewUser`/`googleLinkedNow` no `POST /auth/google`, bloqueio de cadastro repetido, toast de auto-ligação, rótulo do botão, loading state, exclusão de conta só-Google, aviso "Defina uma senha" no Perfil. **✅ Fase E verificada no navegador (Checkpoint E, 2026-09-10): os 7 cenários OK. BUG-E1 corrigido e verificado nas 3 configurações** (balão "Defina uma senha" via `<Portal/>` — `oratio` commit `23b0d78`, na `develop` pelo merge `4401808`). **Sem bloqueio de código pra `main`.** O que segura a promoção agora é só pendência humana: `GOOGLE_CLIENT_ID` no Render + `VITE_GOOGLE_CLIENT_ID` na Vercel + publicar o app OAuth (Política de Privacidade). Console OAuth **feito** (2026-09-09); `db push` de produção **feito** (2026-09-09). |
| Boas-vindas (guia de primeira entrada) | `specs/boas-vindas.md` | *(a criar)* | *(a criar)* | `oratio/docs/specs/boas-vindas.md` (ponteiro, a criar) | ✅ **aprovada** — guia de 3 páginas na 1ª entrada (senha e Google), 1x só. Backend: `User.welcomeSeenAt` (paralelo a `voxOnboardingSeenAt`) + `showWelcome` no `GET /users/me` + `POST /users/me/welcome-seen` + **backfill** `welcomeSeenAt=now()` em toda a tabela. **`db push` próprio** (o do login-google já foi rodado 2026-09-09; esta coluna não pega carona) + `UPDATE` do backfill na mesma janela. Falta plano/checklist. |
| Admin: método de entrada | `specs/admin-provedor.md` | *(a criar)* | *(a criar)* | `oratio/docs/specs/admin-provedor.md` (ponteiro, a criar) | ✅ **aprovada** — ver/filtrar Oratio × Google × ambos no painel admin. Só leitura: `hasPassword` + `authProviders` no `GET /users/admin/users` e no detalhe, filtro `provider`, ícones (`Mail` / Google) no frontend. **Sem schema, sem `db push`.** Falta plano/checklist. |
| Prova de identidade (reautenticação p/ operações sensíveis) | `specs/prova-identidade.md` | — *(sem plano: mudança pequena, vai direto)* | — | `oratio/docs/specs/prova-identidade.md` (ponteiro, a criar com o commit do frontend) | ✅ **aprovada** (2026-09-10) — spec spawned do teste da Fase E. Uma causa (o backend decide a prova por `user.password == null`, não pelo que a conta tem) → dois sintomas: (1) não dá pra excluir a conta com o Google se você tem senha; (2) quem esqueceu a senha precisa deslogar pra trocá-la. **Sintoma 1:** `deleteAccount` chama `assertFreshProof` (senha **ou** Google fresco casando um `LinkedAccount` deste user) + `hasGoogle` aditivo no `GET /users/me` + 3 modos no `DeleteAccountModal`. **Sintoma 2 (só frontend):** link "Não lembro minha senha atual" no `ChangePasswordModal` → `POST /auth/forgot-password` com o próprio e-mail → `ResetPasswordModal` (rota pública reusada, **sem rota nova**). Sem schema, sem `db push`. 2 testes novos (caminho da exclusão). Decisões fechadas 2026-09-10. Implementação bloqueada até o Checkpoint E fechar (dev servers em `develop` / `fix/login-google-bug-e1`). |

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
  `https://oratio-phi.vercel.app`; Client ID nos `.env` locais dos dois repos). **Falta:**
  `GOOGLE_CLIENT_ID` no Render + `VITE_GOOGLE_CLIENT_ID` na Vercel + **publicar** o app OAuth
  (sai de "Testing" → só usuários de teste conseguem logar em prod até publicar; publicar exige a
  Política de Privacidade — ver "Dívidas conhecidas").
- **login-google** — verificação pós-deploy da CSP do GIS (console do navegador no app da Vercel)
  + smoke do PWA no iPhone.
- **boas-vindas** — `npx prisma db push` de produção **próprio** para `User.welcomeSeenAt` (o do
  login-google já foi; esta coluna não pega carona) **+** o `UPDATE` do backfill
  `welcomeSeenAt = now()` logo em seguida, na mesma janela. Script
  `prisma/db-scripts/2026-09-09-boas-vindas.sql` com passos numerados (contagem antes · ALTER ·
  UPDATE · conferência) — gerado por `/db-change` na implementação.

O `db push` de produção do **login-google** foi feito em 2026-09-09 (Supabase; `LinkedAccount`
+ `password` nullable). O do VoxAI e o aceite doutrinário dos perfis também já haviam sido
feitos — removidos em 2026-09-04. `google-auth-library` foi aprovada (2026-09-08) e já está no
`package.json`.

## Dívidas conhecidas

Gaps reais que precisam de dono — não são specs nem pendências de deploy.

- **Editar o nome no perfil não funciona ponta a ponta.** Lacuna **pré-existente**, não é do
  login-google: o backend tem `PATCH /users/me` aceitando `{ name }`
  (`users.controller.ts:209`, `users.service.updateProfile`), mas o frontend **nunca chama essa
  rota** — não há UI de "editar nome" em Configurações da conta. Decidir: expor no frontend ou
  remover a rota.
- **Não há Política de Privacidade.** Bloqueia publicar o app OAuth no Google (a tela de
  consentimento exige uma URL de política) **e** é exigência de LGPD por conta própria — o app
  armazena convicção religiosa, que é dado pessoal **sensível** (`RULES.md` §6). Precisa de texto
  jurídico + página hospedada + link no app. Anotado também no `oratio/docs/specs/INDEX.md`.

## Por que não há spec para as features existentes

Todas as features desta tabela foram construídas direto no par plano+checklist, sem spec — e
**não vale a pena escrever spec retroativa para elas**. Spec é contrato antes do código: quando o
código já existe e funciona, o que sobra é documentação, e isso o `docs/ARCHITECTURE.md` já faz.
Um terceiro arquivo dizendo o mesmo só cria mais uma coisa para manter em sincronia.

O template e os comandos (`/criar-spec`, `/qa-verify`, `/spec-sync`) valem para a **próxima**
feature — a que ainda não existe. Aí a spec é contrato de verdade, e mudar um requisito vira
editar um arquivo em vez de reexplicar contexto numa conversa nova.
