# Índice de specs — Oratio API

Mapa único de `spec ↔ plano ↔ checklist ↔ status`. **Este arquivo é a fonte da verdade sobre o
que existe**; não confie em adivinhar nome de arquivo. Quem fecha uma fase atualiza esta tabela
no mesmo commit — e `/docs-sync` confere se ela bate com a realidade.

| Feature | Spec | Plano | Checklist | Frontend pareado | Status |
|---|---|---|---|---|---|
| Reformulação das notificações | — | `tasks/notifications-plan.md` | `tasks/notifications-todo.md` | `oratio/docs/tasks/notifications.md` (ponteiro) | ✅ concluída (Fases 1–5) |
| Perfis de resposta do VoxAI | — *(não precisa: já entregue)* | `tasks/vox-profiles-plan.md` | `tasks/vox-profiles-todo.md` | `oratio/docs/tasks/vox-profiles-todo.md` | ✅ **em produção** (`main`: 2 campos no schema, 6 perfis com `systemAppend`, 3 rotas; `db push` aplicado) |
| Bíblia de Estudo | — *(não precisa: já entregue)* | `tasks/biblia-plan.md` | `tasks/biblia-todo.md` | `oratio/docs/tasks/biblia-*.md` | ✅ **em produção** (B1–B3 na `main`; `npx jest bible` → 4 suítes, 39 testes verdes) |
| Entrar com Google | `specs/login-google.md` | `tasks/login-google-plan.md` | `tasks/login-google-todo.md` | `oratio/docs/specs/login-google.md` (ponteiro) | 🚧 Fases A–D com código na `develop` dos dois repos (Fase D / CSP do GIS **já mergeada** no `oratio`, commit `946cfac`). **Fase E aprovada** (`docs/login-google-fase-e`): reverte a anti-enumeração do login, adiciona `isNewUser`/`googleLinkedNow` ao `POST /auth/google`, bloqueio de cadastro repetido, toast de auto-ligação, rótulo do botão, loading state, e liga o frontend à exclusão de conta só-Google. Falta plano/checklist. Pendências humanas: env vars Vercel/Render, `db push` de produção, cliente OAuth no Google Cloud Console, teste manual + verificação pós-deploy da CSP. |

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

- **login-google** — `npx prisma db push` **local** (dev) ao fim da Fase A: o `curl` dos
  caminhos de auto-ligação / conta só-Google dá 500 sem as tabelas novas. E `db push` de
  **produção** na Fase D. Script em `prisma/db-scripts/` (gerado por `/db-change` na Fase A).
- **login-google** — criar o cliente OAuth "Web application" e a tela de consentimento no Google
  Cloud Console; preencher `GOOGLE_CLIENT_ID` (Render) e `VITE_GOOGLE_CLIENT_ID` (Vercel). Lista
  de valores em `specs/login-google.md` → "Notas de ambiente". Necessário para a Fase B.
- **login-google** — `google-auth-library` **aprovada** (2026-09-08); o `npm install` acontece na
  Fase A, no commit da implementação.

O `db push` de produção do VoxAI e o aceite doutrinário dos perfis estavam listados aqui e
**já haviam sido feitos** — o Vox roda em produção com os perfis desde antes desta auditoria.
Removidos em 2026-09-04.

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
