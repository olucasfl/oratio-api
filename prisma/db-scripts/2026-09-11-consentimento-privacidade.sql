-- =============================================================================
-- 2026-09-11 — consentimento-privacidade (Termos de Uso + Política de Privacidade)
-- Spec: docs/specs/consentimento-privacidade.md
--
-- ⚠️⚠️⚠️ SEM BACKFILL — É O OPOSTO DO welcomeSeenAt (2026-09-10-boas-vindas.sql) ⚠️⚠️⚠️
--
-- O script do welcomeSeenAt carimbou a base TODA com now() para NINGUÉM ver o
-- guia de estreia de novo. AQUI É O OPOSTO: TODA conta que existe hoje DEVE
-- ver a tela de consentimento pelo menos uma vez, porque NENHUMA delas jamais
-- deu este consentimento formalmente. NÃO existe um "estado anterior
-- equivalente" a herdar por backfill — diferente do guia de boas-vindas (que
-- é onboarding, não uma obrigação legal), consentimento não pode ser
-- presumido.
--
-- SE ESTE SCRIPT GANHAR UM PASSO DE UPDATE NO FUTURO, A FEATURE INTEIRA VIRA
-- LETRA MORTA — ninguém nunca vê a tela, e a base fica "consentida" sem
-- nunca ter aceitado nada. NÃO ADICIONE UM PASSO 2. Este script é só:
--   ADD COLUMN "legalTermsAcceptedAt" — nullable, SEM DEFAULT.
--   ADD COLUMN "legalTermsVersion"    — nullable, SEM DEFAULT.
--   Nenhum UPDATE. Nenhum backfill. Ponto.
--
-- Este projeto NÃO tem prisma/migrations (ARCHITECTURE.md §2/§8). O schema vai
-- pro banco por `npx prisma db push` direto. Este arquivo é o registro que a
-- ausência de migrations deixa faltando + o artefato revisado ANTES de aplicar.
-- O AGENTE NÃO EXECUTA — quem roda é o humano.
--
-- ORDEM DE EXECUÇÃO:
--   1. `npx prisma db push` de produção -> já aplica esta estrutura sozinho
--      (o ALTER TABLE abaixo é o equivalente manual, só para revisão/registro
--      — não é um segundo passo a rodar depois do db push).
--   NÃO HÁ PASSO 2. Nada mais roda depois disto.
-- =============================================================================


-- =========================== O QUE MUDA ======================================
--
-- Tabela ALTERADA: "User"
--   Coluna NOVA "legalTermsAcceptedAt": timestamp(3) NULL, sem default.
--   Coluna NOVA "legalTermsVersion":    text NULL, sem default.
--   Semântica: carimbadas quando a pessoa aceita o PAR Termos de Uso +
--   Política de Privacidade (POST /users/me/legal-terms-accepted, ou na
--   criação da conta por senha — CreateUserDto.legalTermsAccepted).
--   `GET /users/me` devolve legalTermsAccepted = (legalTermsAcceptedAt IS
--   NOT NULL AND legalTermsVersion = LEGAL_TERMS_VERSION atual, em código —
--   src/modules/users/legal-terms-version.ts).
--   Perda de dado: nenhuma (duas colunas novas, ambas nullable).
--
-- Backfill: NENHUM. Ver o aviso no cabeçalho — é proposital.
--
-- =============================================================================


-- ===================== ADD COLUMN (estrutura, sem dados) =====================
-- Equivalente ao que `npx prisma db push` faz a partir do schema atual.
-- Se você já rodou o `db push`, estas colunas JÁ existem — este bloco é só
-- para revisão/registro, não precisa ser executado separadamente.

ALTER TABLE "User" ADD COLUMN "legalTermsAcceptedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "legalTermsVersion" TEXT;


-- =============================== ROLLBACK ====================================
--
-- Rollback LIVRE — ninguém perde a conta, e não há backfill para desfazer.
--
--   ALTER TABLE "User" DROP COLUMN "legalTermsAcceptedAt";
--   ALTER TABLE "User" DROP COLUMN "legalTermsVersion";
--
--   (Rodar isto exige que o backend novo — que seleciona as duas colunas no
--   GET /users/me, escreve em POST /users e em POST /users/me/legal-terms-
--   accepted — NÃO esteja mais no ar, senão dá 500. Ordem de reversão:
--   derrubar o código novo primeiro, depois dropar as colunas.)
--
-- =============================================================================
