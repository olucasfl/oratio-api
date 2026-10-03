-- =============================================================================
-- 2026-10-02 — pote (dinâmica multiplayer "O Pote", só admin cria, convite pelo sino)
-- Spec: docs/specs/pote.md · Plano: docs/tasks/pote-plan.md (fase P2)
--
-- CLASSIFICAÇÃO: 100% ADITIVA. Três tabelas novas e três enums novos.
--   Nenhuma tabela ou coluna existente é alterada ou removida; nenhum UPDATE,
--   nenhum backfill. O schema.prisma ganhou 3 linhas em "User" (poteRoomsLed,
--   potePlayers, poteCommitments), mas são só o lado inverso das relações — NÃO
--   existem como coluna, então "User" não muda no banco.
--
-- Este projeto NÃO tem prisma/migrations (ARCHITECTURE.md §2/§8). O schema vai
-- pro banco por `npx prisma db push`. Este arquivo é o registro + o artefato
-- revisado ANTES de aplicar. O AGENTE NÃO EXECUTA — quem roda é o humano.
--
-- COMO APLICAR (uma das duas, não as duas):
--   a) `npx prisma db push && npx prisma generate`   (recomendado: mantém o
--      Prisma como fonte da verdade; produz DDL equivalente ao PASSO 1 abaixo)
--   b) executar o PASSO 1 à mão e depois `npx prisma generate`.
--   Antes de a): confira que DATABASE_URL/DIRECT_URL apontam para o banco que
--   você quer (por padrão apontam para PRODUÇÃO).
--
-- NOTA: a unicidade do código de sala entre salas ATIVAS não está no banco
-- (índice parcial não é expressável no schema Prisma e o `db push` o ignoraria,
-- gerando drift). O service garante, gerando outro código se houver colisão.
-- =============================================================================


-- =========================== O QUE MUDA ======================================
--
-- Enums NOVOS:
--   "PotePhase"        LOBBY | ROUND_1 | RESULT_1 | PARABLE | ROUND_2 | FINAL | ENDED | CANCELLED
--   "PoteRound1Status" WAITING | IN_TUTORIAL | PLAYING | FINISHED
--   "PoteRound2Status" WAITING | PLAYING | FINISHED
--
-- Tabelas NOVAS:
--   "PoteRoom"       a sala (código de 4 dígitos, líder, fase, pausa, fim da rodada 2,
--                    "version" para o polling). FK -> "User" ON DELETE CASCADE.
--   "PotePlayer"     convite + estado de cada jogador na sala (listas de itens
--                    colocados nas rodadas 1 e 2). FK -> "PoteRoom" e "User", CASCADE.
--                    UNIQUE ("roomId", "userId").
--   "PoteCommitment" o compromisso final (≤ 140 caracteres). FK -> "PoteRoom" e "User",
--                    CASCADE. UNIQUE ("roomId", "userId").
--
-- Perda de dado: nenhuma (tudo novo). Efeito colateral: apagar um "User" apaga em
-- cascata as salas que ele liderou e suas participações/compromissos — mesmo
-- comportamento das demais tabelas do app.
--
-- =============================================================================


-- ===================== PASSO 0 — CONFERÊNCIA ANTES ===========================
-- Deve retornar 0 linhas (as tabelas ainda não existem).

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('PoteRoom', 'PotePlayer', 'PoteCommitment');


-- ===================== PASSO 1 — APLICAÇÃO (estrutura) =======================
-- Equivalente ao que `npx prisma db push` faz a partir do schema atual.

BEGIN;

CREATE TYPE "PotePhase" AS ENUM (
  'LOBBY', 'ROUND_1', 'RESULT_1', 'PARABLE', 'ROUND_2', 'FINAL', 'ENDED', 'CANCELLED'
);
CREATE TYPE "PoteRound1Status" AS ENUM ('WAITING', 'IN_TUTORIAL', 'PLAYING', 'FINISHED');
CREATE TYPE "PoteRound2Status" AS ENUM ('WAITING', 'PLAYING', 'FINISHED');

CREATE TABLE "PoteRoom" (
  "id"                TEXT         NOT NULL,
  "code"              VARCHAR(4)   NOT NULL,
  "leaderId"          TEXT         NOT NULL,
  "phase"             "PotePhase"  NOT NULL DEFAULT 'LOBBY',
  "isPaused"          BOOLEAN      NOT NULL DEFAULT false,
  "round2EndsAt"      TIMESTAMP(3),
  "round2RemainingMs" INTEGER,
  "version"           INTEGER      NOT NULL DEFAULT 0,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PoteRoom_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PotePlayer" (
  "id"           TEXT               NOT NULL,
  "roomId"       TEXT               NOT NULL,
  "userId"       TEXT               NOT NULL,
  "displayName"  TEXT               NOT NULL,
  "invitedAt"    TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "joinedAt"     TIMESTAMP(3),
  "lastSeenAt"   TIMESTAMP(3),
  "statusRound1" "PoteRound1Status" NOT NULL DEFAULT 'WAITING',
  "round1Index"  INTEGER            NOT NULL DEFAULT 0,
  "round1Placed" TEXT[]             DEFAULT ARRAY[]::TEXT[],
  "statusRound2" "PoteRound2Status" NOT NULL DEFAULT 'WAITING',
  "round2Placed" TEXT[]             DEFAULT ARRAY[]::TEXT[],
  "removed"      BOOLEAN            NOT NULL DEFAULT false,
  CONSTRAINT "PotePlayer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PoteCommitment" (
  "id"        TEXT         NOT NULL,
  "roomId"    TEXT         NOT NULL,
  "userId"    TEXT         NOT NULL,
  "text"      VARCHAR(140) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PoteCommitment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PoteRoom_code_phase_idx"   ON "PoteRoom"("code", "phase");
CREATE INDEX "PoteRoom_leaderId_idx"     ON "PoteRoom"("leaderId");
CREATE UNIQUE INDEX "PotePlayer_roomId_userId_key"     ON "PotePlayer"("roomId", "userId");
CREATE INDEX "PotePlayer_userId_idx"     ON "PotePlayer"("userId");
CREATE UNIQUE INDEX "PoteCommitment_roomId_userId_key" ON "PoteCommitment"("roomId", "userId");
CREATE INDEX "PoteCommitment_userId_idx" ON "PoteCommitment"("userId");

ALTER TABLE "PoteRoom"
  ADD CONSTRAINT "PoteRoom_leaderId_fkey" FOREIGN KEY ("leaderId")
  REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PotePlayer"
  ADD CONSTRAINT "PotePlayer_roomId_fkey" FOREIGN KEY ("roomId")
  REFERENCES "PoteRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PotePlayer"
  ADD CONSTRAINT "PotePlayer_userId_fkey" FOREIGN KEY ("userId")
  REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PoteCommitment"
  ADD CONSTRAINT "PoteCommitment_roomId_fkey" FOREIGN KEY ("roomId")
  REFERENCES "PoteRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PoteCommitment"
  ADD CONSTRAINT "PoteCommitment_userId_fkey" FOREIGN KEY ("userId")
  REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;


-- ===================== PASSO 2 — VERIFICAÇÃO DEPOIS ==========================
-- Deve retornar as 3 tabelas e 0 em cada contagem.

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('PoteRoom', 'PotePlayer', 'PoteCommitment')
ORDER BY table_name;

SELECT
  (SELECT count(*) FROM "PoteRoom")       AS rooms,
  (SELECT count(*) FROM "PotePlayer")     AS players,
  (SELECT count(*) FROM "PoteCommitment") AS commitments;


-- ===================== ROLLBACK (comentado — só rodar se precisar) ===========
-- ATENÇÃO: apaga TODAS as salas, convites e compromissos já gravados.
-- Só faz sentido antes do jogo ser usado de verdade, ou se você aceita perder o histórico.
--
-- BEGIN;
-- DROP TABLE "PoteCommitment";
-- DROP TABLE "PotePlayer";
-- DROP TABLE "PoteRoom";
-- DROP TYPE "PoteRound2Status";
-- DROP TYPE "PoteRound1Status";
-- DROP TYPE "PotePhase";
-- COMMIT;
