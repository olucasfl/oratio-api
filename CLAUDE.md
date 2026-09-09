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
| **Entrar com Google** (login social; `LinkedAccount`, `User.password` opcional) | `docs/specs/login-google.md` · `docs/tasks/login-google-plan.md` · `docs/tasks/login-google-todo.md` | 🚧 **Ativo — Fase A (backend, incl. A8 `deleteAccount` com re-auth Google) + Fase B (frontend) na `develop`**. Plano-mestre cross-repo; frontend tem ponteiro em `oratio/docs/tasks/login-google-todo.md`. Falta: teste manual no navegador, Fase C (UI "definir senha") e Fase D (CSP/deploy/PWA). `db push` (local dev + produção) e cliente OAuth no Google Cloud Console são pendências humanas — `docs/specs/INDEX.md`. Nenhuma decisão pendente. |

When you finish a task, tick it in its `*-todo.md` and, if behavior changed,
update `docs/ARCHITECTURE.md` in the same commit.

## Sibling repo

The frontend is **`oratio`** (React/Vite PWA), a sibling folder. Any change to a
route path, DTO shape, or header requirement here needs a matching change in its
`src/services/*Service.ts`. Its own guide is `oratio/docs/ARCHITECTURE.md`.
