-- =============================================================================
-- 2026-09-10 — boas-vindas (guia de primeira entrada)
-- Spec: docs/specs/boas-vindas.md
--
-- CLASSIFICAÇÃO: DUAS mudanças de natureza diferente.
--   PASSO 1 — ADITIVA + NÃO-DESTRUTIVA: coluna nova nullable, sem default.
--   PASSO 2 — ESCRITA DE DADOS EM MASSA: o backfill toca TODA linha de "User".
--             Não é "aditivo" — é UPDATE em toda a tabela. Sem ele, o guia
--             apareceria retroativamente para a base inteira no próximo login
--             de cada um.
--
-- Este projeto NÃO tem prisma/migrations (ARCHITECTURE.md §2/§8). O schema vai
-- pro banco por `npx prisma db push` direto. Este arquivo é o registro que a
-- ausência de migrations deixa faltando + o artefato revisado ANTES de aplicar.
-- O AGENTE NÃO EXECUTA — quem roda é o humano.
--
-- ORDEM DE EXECUÇÃO (mesma janela):
--   1. `npx prisma db push` de produção  -> aplica só a ESTRUTURA (o PASSO 1).
--      (o db push do login-google, 2026-09-09, NÃO sincroniza esta coluna —
--       ela não existia no schema naquele momento.)
--   2. Este script, PASSO 2 (o backfill) -> logo em seguida, à mão.
--   `prisma db push` NÃO roda o UPDATE — só estrutura.
-- =============================================================================


-- =========================== O QUE MUDA ======================================
--
-- Tabela ALTERADA: "User"
--   Coluna NOVA "welcomeSeenAt": timestamp(3) NULL, sem default.
--   Semântica: carimbada quando a pessoa CONCLUI o guia de boas-vindas.
--   `GET /users/me` devolve showWelcome = ("welcomeSeenAt" IS NULL).
--   Paralela a "voxOnboardingSeenAt" (mesmo propósito, para o onboarding do Vox).
--   Perda de dado no PASSO 1: nenhuma (coluna nova).
--
-- Backfill (PASSO 2): "welcomeSeenAt" = now() em TODA linha onde ainda é NULL
--   (ou seja, todas, logo após o PASSO 1). Efeito: só contas criadas DEPOIS
--   deste backfill terão "welcomeSeenAt" NULL -> só elas veem o guia.
--
-- =============================================================================


-- ===================== PASSO 0 — CONTAGEM ANTES ==============================
-- Anote este número. O PASSO 2 deve deixar EXATAMENTE esta quantidade de
-- linhas com "welcomeSeenAt" preenchido.

SELECT count(*) AS total_users_antes FROM "User";


-- ===================== PASSO 1 — ADD COLUMN (estrutura) ======================
-- Equivalente ao que `npx prisma db push` faz a partir do schema atual.
-- Se você já rodou o `db push`, esta coluna JÁ existe — pule o PASSO 1.
-- Isolado do PASSO 2 de propósito: não misturar DDL com a escrita em massa.

ALTER TABLE "User" ADD COLUMN "welcomeSeenAt" TIMESTAMP(3);


-- ===================== PASSO 2 — BACKFILL (dados) ============================
-- Escreve em TODA linha de "User". Rode sozinho, logo após o PASSO 1 / db push.
-- Numa tabela pequena (usuários do Oratio hoje) é um UPDATE trivial e rápido;
-- não precisa de lote. Se a tabela crescer muito no futuro, quebrar em lotes
-- por faixa de "createdAt".

BEGIN;

UPDATE "User" SET "welcomeSeenAt" = now() WHERE "welcomeSeenAt" IS NULL;

-- Conferência: este número TEM que bater com "total_users_antes" do PASSO 0.
SELECT count(*) AS total_users_com_welcome_depois
FROM "User"
WHERE "welcomeSeenAt" IS NOT NULL;

COMMIT;


-- =============================== ROLLBACK ====================================
--
-- A COLUNA — rollback LIVRE. Ninguém perde a conta.
--
--   ALTER TABLE "User" DROP COLUMN "welcomeSeenAt";
--
--   (Rodar isto exige que o backend novo — que seleciona "welcomeSeenAt" no
--   GET /users/me e escreve em POST /users/me/welcome-seen — NÃO esteja mais
--   no ar, senão dá 500. Ordem de reversão: derrubar o código novo primeiro,
--   depois dropar a coluna.)
--
-- O BACKFILL — NÃO tem volta útil. Depois de aplicado, uma conta antiga
--   (backfillada) e uma conta que concluiu o guia de verdade ficam
--   IDÊNTICAS: ambas com "welcomeSeenAt" preenchido. Não há como
--   "des-backfillar" seletivamente. Se for preciso reverter o COMPORTAMENTO
--   (fazer o guia aparecer de novo), a única saída é DROP COLUMN acima e
--   recomeçar do zero.
--
-- =============================================================================
