# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The repo root holds only this file and `README.md` (project overview / GitHub
landing page). **Everything else — the rules, the technical guide and every work
plan — lives under `.claude/` and `docs/`, and there is important context there.
Do not start work without reading the relevant pieces below.**

## `.claude/rules/RULES.md` — read this FIRST, before anything else

The permanent rules of this project. In particular §2 (**database**): there are no
Prisma migrations here, so `db push` is the only path to production and it has no
rollback — the agent never runs it, it writes the script and the human executes.
Also covers production/Render, real email and push, doctrinal content in
`vox.prompt.ts`, guards, and personal data. **It outranks this file,
`docs/ARCHITECTURE.md`, any spec, and the prompt.** A repeated user instruction
unlocks a "Perguntar antes"; it does not unlock a "Nunca".

## `docs/ARCHITECTURE.md` — read this before ANY code change

The full guide to this backend: modules, domain model, auth design, the VoxAI
(AI chat) feature, the notification scheduler, known quirks (the `prayerStreak`
misnomer, the no-migrations Prisma setup, timezone rules), and conventions. It is
the single source of truth — this file stays a thin pointer so it can't drift.

## The layers, and what belongs in each

| Layer | Where | Answers |
|---|---|---|
| Permanent rule | `.claude/rules/RULES.md` | How do we work here? What is forbidden? |
| Technical truth | `docs/ARCHITECTURE.md` | How does this codebase actually work? |
| Specification | `docs/specs/*.md` | What must exist? (behavior + BDD acceptance criteria) |
| Plan | `docs/tasks/*-plan.md` · `*-todo.md` | In what order do we build it, and how is each step verified? |
| Procedure | `.claude/skills/*/SKILL.md` | How do we approach this recurring class of task well? |
| This run's goal | prompt / `.claude/commands/*` | What do I want in this specific execution? |

They do not replace each other. If you're about to repeat an instruction you've
given before, it belongs in one of the files above, not in the prompt.

## `docs/` — what's there and when to open it

| Path | What it is | Read it when |
|---|---|---|
| `docs/ARCHITECTURE.md` | The technical guide (§1–§10). | Always, before touching code. Update the affected §§ when you change behavior. |
| `README.md` (root) | Project overview / onboarding / GitHub landing page. | You need the high-level picture or setup steps. |
| `docs/specs/INDEX.md` | The map of `spec ↔ plan ↔ checklist ↔ status`, plus the list of steps pending human execution (production `db push`, doctrinal sign-off). | First stop when you don't know whether something is specified or what's blocking a feature. |
| `docs/specs/_template.md` | Spec template (Objetivo · Comportamento · Saída · Modelo de dados · **critérios BDD** · Plano de testes · Fora de escopo). | Writing a spec — or use `/criar-spec`. |
| `docs/tasks/` | Active and past work plans, each a `*-plan.md` (design + phases) plus a `*-todo.md` (executable checklist). | Before starting or continuing any multi-step feature — check for an existing plan first. |

## Commands

`/criar-spec` · `/implement-story` · `/qa-verify` · `/spec-sync` · `/fix-bug` ·
`/review-pr` · `/nova-branch` · `/docs-sync` · `/db-change`.
Definitions in `.claude/commands/`; agents in `.claude/agents/`.

Skills in `.claude/skills/` — `bug-research`, `oratio-testing`, and
`doutrina-guardrail`, a **mandatory preflight** (not a suggestion) before any edit
to `vox.prompt.ts`: `VOX_IDENTITY` is doctrine, `systemAppend` is tone only, and
neither changes without explicit human sign-off recorded in the commit.

## `docs/tasks/` — current plans

| Feature | Files | Status |
|---|---|---|
| **Reformulação das notificações** (torna regras/timing/textos configuráveis sem deploy) | `docs/tasks/notifications-plan.md` · `docs/tasks/notifications-todo.md` | Ativo. Plano-mestre cross-repo — o frontend tem só um ponteiro em `oratio/docs/tasks/notifications.md`. |
| **Bíblia de Estudo** (backend: bible-marks, bible-collections) | `docs/tasks/biblia-plan.md` · `docs/tasks/biblia-todo.md` | ✅ **Concluída e em produção** (B1–B3 na `main`). Os dois arquivos são registro histórico, não trabalho pendente — o comportamento vivo está em `ARCHITECTURE.md` §4/§7. |
| **Perfis de resposta do VoxAI** (identidade fixa + 6 perfis de estilo por usuário) | `docs/tasks/vox-profiles-plan.md` · `docs/tasks/vox-profiles-todo.md` | ✅ **Concluída e em produção** (`main`): os 2 campos no schema, os 6 perfis com `systemAppend` preenchido, as 3 rotas, `db push` aplicado. O checklist é registro histórico. O prompt vive em `voxai/prompts/vox.prompt.ts` — toda edição nele passa pela skill `doutrina-guardrail`. Frontend em `oratio/docs/tasks/vox-profiles-todo.md`. |
| **Entrar com Google** (login social; `LinkedAccount`, `User.password` opcional) | `docs/specs/login-google.md` · `docs/tasks/login-google-plan.md` · `docs/tasks/login-google-todo.md` | 🚧 **Fases A–E todas na `develop` dos dois repos** (2026-09-09) — **`main` não tem nada de login-google**. Fase E: 401 específico no login por senha de conta só-Google, `isNewUser`/`googleLinkedNow` no `POST /auth/google`, bloqueio de cadastro repetido, toast de auto-ligação, exclusão de conta só-Google, aviso "Defina uma senha" no Perfil. **Código pronto pra `main`:** BUG-E1 corrigido e Checkpoint E verificado no navegador (2026-09-10, os 7 cenários OK — commit `44b55b7`). `GOOGLE_CLIENT_ID` no Render + `VITE_GOOGLE_CLIENT_ID` na Vercel **feitos** (2026-09-14). Falta: publicar o app OAuth (só depois da `main` no ar — precisa da URL pública da Política) + verificação pós-deploy da CSP do GIS. Console OAuth **feito** + `db push` de produção **feito** (2026-09-09). Detalhe em `docs/specs/INDEX.md`. |
| **Admin: método de entrada** (filtro Oratio × Google × ambos no painel admin, só leitura) | `docs/specs/admin-provedor.md` | 🚧 **Na `develop` dos dois repos** (2026-09-10) — **`main` não tem nada**. `getAllUsers`/`getUserDetail` ganham `hasPassword`/`authProviders: string[]` (descartando o hash, como `getProfile`); `GET /users/admin/users` ganha o query param `provider` (`oratio` \| `google` \| `both`; inválido → ignorado, nunca 400) — 3 estados. Sem schema, sem `db push`, sem rota nova. `ARCHITECTURE.md` §7 atualizado. Falta teste manual no painel + promoção pra `main`. |
| **Prova de identidade** (reautenticação p/ operações sensíveis) | `docs/specs/prova-identidade.md` | 🚧 **Na `develop`** (2026-09-10) — **`main` não tem nada**. `deleteAccount` chama `assertFreshProof(userId, { password?, googleCredential? })`: qual prova vale sai do que a conta **tem**, não de `password == null`. `GET /users/me` ganha `hasGoogle`. Sem schema, sem `db push`. `ARCHITECTURE.md` §5/§7 atualizado. Falta teste manual humano + promoção pra `main`. |
| **Boas-vindas** (guia de primeira entrada) | `docs/specs/boas-vindas.md` | 🚧 **Na `develop`** (2026-09-10) — **`main` não tem nada**. `User.welcomeSeenAt DateTime?` + `showWelcome` no `GET /users/me` + `POST /users/me/welcome-seen` (idempotente). Coluna + backfill **aplicados em produção** (2026-09-14, `depois` = `total_users_antes` conferido; `prisma/db-scripts/2026-09-10-boas-vindas.sql`). Falta QA na tela + promoção pra `main`. `ARCHITECTURE.md` §4/§7. |
| **Consentimento de privacidade (LGPD)** (Termos de Uso + Política, aceitos juntos) | `docs/specs/consentimento-privacidade.md` · checklist no frontend: `oratio/docs/tasks/consentimento-legal-todo.md` | 🚧 **Na `develop` dos dois repos** (merge `2fa0858`, 2026-09-11) — **`main` não tem nada**. `User.legalTermsAcceptedAt`/`legalTermsVersion` + `LEGAL_TERMS_VERSION = '2026-09-11'`, `CreateUserDto.legalTermsAccepted` obrigatório, `legalTermsAccepted` no `GET /users/me`, `POST /users/me/legal-terms-accepted`. Colunas **aplicadas em produção, SEM backfill** (2026-09-14, `consentidos = 0` conferido). Falta: `/review-pr` (nunca rodado) + QA na tela + promoção pra `main`. |
| **Protocolo de crise do Vox** | `docs/specs/vox-protocolo-crise.md` | 🚧 **Na `develop`** (`fc6f2e9`, 2026-09-11) — bloco `## Crise aguda` em `VOX_IDENTITY`, texto aceito por Lucas. **Os 6 critérios de comportamento seguem abertos**: só verificáveis com chamada real ao modelo. Bloqueia a publicação dos Termos de Uso (§4 promete CVV 188 / SAMU 192). |

When you finish a task, tick it in its `*-todo.md` and, if behavior changed,
update `docs/ARCHITECTURE.md` in the same commit.

## Sibling repo

The frontend is **`oratio`** (React/Vite PWA), a sibling folder. Any change to a
route path, DTO shape, or header requirement here needs a matching change in its
`src/services/*Service.ts`. Its own guide is `oratio/docs/ARCHITECTURE.md`.
