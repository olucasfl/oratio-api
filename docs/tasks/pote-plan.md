# Plano: O Pote (jogo por convite, só admin)

Spec: `docs/specs/pote.md` (fonte da verdade — regras, catálogo, textos e contrato estão lá).
Checklist executável: `docs/tasks/pote-todo.md`. Frontend: `oratio/docs/tasks/pote-todo.md`.

## Princípios

- Regras e pontuação são **funções puras sem framework**, testadas antes de qualquer tela.
- Servidor é a fonte da verdade; o cliente só renderiza o estado e dispara ações. Tempo real = polling de 1 s sobre `GET /pote/rooms/:code?since=`.
- Nada de produção pelo agente: o `db push` é do Lucas (`RULES.md` §2); nenhum push/e-mail; o convite é só linha em `Notification`.
- Commits na `develop`; `main` só com pedido explícito.

## Fases

| Fase | Entrega | Verificação |
|---|---|---|
| **P1** Domínio puro | `domain/` com catálogo, `canPlace/place`, pontuação, combos, classificação, sequência da rodada 1, textos | `npm test -- pote` verde; todos os critérios "Funções puras" da spec |
| **P2** Schema + script | 3 models + 3 enums no `schema.prisma`; `prisma/db-scripts/2026-10-02-pote.sql` com rollback | `npx prisma validate`; **parar** e entregar o `db push` ao Lucas |
| **P3** Backend: sala, acesso, convite | `PoteModule`: criar sala, buscar usuários, convidar (+`Notification`), `join`, `GET` com `since`, `lastSeenAt`, guards | specs de service/controller; `curl` local |
| **P4** Backend: fases, pausa, rodadas | `phase`, `pause`, `extend`, `remove`, `cancel`, `round1/*`, `round2/*`, `commitment`, estatísticas agregadas, timeout lazy | specs + sequência de `curl` do fluxo inteiro |
| **P5** Frontend: base | cópia do domínio + teste de hash; `poteService` + hook de polling; rota `/dinamicas` (admin), entrada no menu só p/ admin; guardrail PWA | Vitest; navegador |
| **P6** Frontend: jogador R1 | tutorial, card/timer/pote, "Ficou de fora", espera | navegador, 380 px |
| **P7** Frontend: líder + telão (lobby, R1, resultado, parábola) | | 3 abas |
| **P8** Frontend: rodada 2 | abas bloqueadas, retirada, combos, "Encaixou nos vãos", fechar | navegador |
| **P9** Final + compromisso + encerramento | | fluxo completo |
| **P10** Ensaio | 5 partidas sozinho calibrando 60/150; teste com 3 navegadores + telão; ARCHITECTURE.md atualizado | manual (Lucas) |

## Checkpoints (parar e mostrar ao Lucas)

1. Fim da P1 (regras provadas por teste).
2. Fim da P2 (`db push` pendente com texto do efeito e rollback).
3. Fim da P4 (fluxo inteiro por `curl`).
4. Fim da P9 (jogo completo na tela).

## Riscos

| Risco | Mitigação |
|---|---|
| Throttler bloqueia o polling | Não bloqueia: o throttle é escopado a auth/admin (conferido). Não pôr `ThrottlerGuard` no módulo |
| Render com cold start / instância dormindo no dia | Abrir o app 5 min antes e fazer um `GET` de aquecimento; avaliar upgrade só se necessário (decisão do Lucas) |
| Várias instâncias do Render | O estado vive no banco, não em memória — qualquer instância responde |
| `NotificationBell` não abre URL interna | Verificar na P3; se não abrir, ajustar o componente (é frontend) |
| Cópia do domínio diverge | Teste de hash nos dois repos |
| Pote do jogador e do servidor discordam | O servidor decide sempre; o cliente só usa `canPlace` para desabilitar botão |
