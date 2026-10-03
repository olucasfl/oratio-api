# Checklist: O Pote (backend)

Plano: `docs/tasks/pote-plan.md` · Spec: `docs/specs/pote.md`
Loop por item: `npm test -- pote` → `npm test` → `npm run build` → `npm run lint` → commit na `develop`.

## P1 — Domínio puro (`src/modules/pote/domain/`)
- [x] `catalog.ts`: 34 itens (ids, nomes, emoji, categoria, ❤/⚡ base, posição R1) e `ROUND1_SEQUENCE` (19)
- [x] `rules.ts`: `CAPACITY/SIZE/GAP`, `canPlace`, `place` (com `usedGap`), `deriveJar(placed[])`
- [x] `score.ts`: ⚡ com "scroll cansa", ❤ com penalidade de pedras (R1), combos (R2), `classify(fun, life)` com `FUN_THRESHOLD/LIFE_THRESHOLD`
- [x] `content.ts`: tutorial, parábola, debate, considerações finais, textos das 4 classificações
- [x] Testes: todos os critérios "Funções puras" da spec
- [x] **Checkpoint 1** — mostrado ao Lucas

## P2 — Schema (sem `db push`)
- [x] Models `PoteRoom`, `PotePlayer`, `PoteCommitment` + enums (fase da sala, status R1, status R2) em `prisma/schema.prisma`
- [x] `prisma/db-scripts/2026-10-02-pote.sql` com rollback
- [x] `npx prisma validate`
- [x] Texto do efeito (3 tabelas novas, nada alterado) e comando `npx prisma db push && npx prisma generate` entregues ao Lucas
- [ ] 🧑 **db push de produção — pendente de execução humana**
- [x] **Checkpoint 2** (db push pendente, 🧑)

## P3 — Sala, acesso, convite
- [x] `PoteModule` registrado; sem `ThrottlerGuard` (o throttle do app é escopado; conferido)
- [x] `POST /pote/rooms`, `GET /pote/rooms/mine`, `GET /pote/users/search`
- [x] `POST /pote/rooms/:code/invites` + `Notification` (sem push, `expiresAt` = fim da sala, sem duplicar)
- [x] `POST .../join` e `GET .../:code?since=` (visão por papel, `version`, `lastSeenAt` com throttle de 5 s, sem e-mail na resposta)
- [x] Specs: não-admin 403, sem convite 403, líder×jogador, convite duplicado, resposta sem e-mail

## P4 — Fases e rodadas
- [x] `phase` (matriz de transições), `pause`, `extend`, `remove`, `cancel`
- [x] `round1/tutorial-done`, `round1/action` (idempotente por `index`)
- [x] `round2/place`, `round2/remove`, `round2/finish`
- [x] Timeout lazy da rodada 2 (e encerrar R1 conta o resto como PASS)
- [x] Estatísticas agregadas (itens mais pegos/deixados, combo mais ativado, médias, classificações)
- [x] `commitment` (≤ 140, upsert)
- [ ] 🧑 `curl` do fluxo completo — **só depois do `db push`** num Postgres local descartável (o `.env` aponta para produção; o agente não roda). Coberto até lá pelo `pote.service.spec.ts` com Prisma em memória
- [x] `docs/ARCHITECTURE.md` atualizado (modelo, módulo, polling, convite via `Notification`)
- [ ] **Checkpoint 3** — backend pronto e testado; falta só o `curl` real pós-`db push`

## P10 — Fechamento
- [ ] Linha em `docs/specs/INDEX.md` com o status real
- [ ] 🧑 Calibrar 60/150 (5 partidas) e ensaio com 3 navegadores + telão
