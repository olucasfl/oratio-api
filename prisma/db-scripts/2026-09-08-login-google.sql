-- =============================================================================
-- 2026-09-08 — login-google (feature "Entrar com Google")
-- Spec: docs/specs/login-google.md · Plano: docs/tasks/login-google-plan.md
--
-- CLASSIFICAÇÃO: ADITIVA + NÃO-DESTRUTIVA.
--   - Cria a tabela nova "LinkedAccount" (não toca em dado existente).
--   - Torna "User"."password" nullable (DROP NOT NULL) — não apaga nem
--     converte nada; só relaxa a restrição.
--   Nenhuma linha existente é alterada por este script.
--
-- Este projeto NÃO tem prisma/migrations (ARCHITECTURE.md §2/§8). O schema
-- vai pro banco por `npx prisma db push` direto. Este arquivo é o registro
-- que a ausência de migrations deixa faltando + o artefato revisado ANTES
-- de aplicar. O AGENTE NÃO EXECUTA — quem roda é o humano.
-- =============================================================================


-- =========================== O QUE MUDA ======================================
--
-- Tabela NOVA: "LinkedAccount"
--   Vínculo (User) <-> identidade de provedor social. Uma linha por
--   (provider, conta no provedor). Colunas:
--     id                text  PK  (uuid gerado pela aplicação)
--     userId            text  NOT NULL  -> FK "User"(id) ON DELETE CASCADE
--     provider          text  NOT NULL  ("google")
--     providerAccountId text  NOT NULL  (o `sub` do id_token do Google)
--     emailSnapshot     text  NOT NULL  (e-mail que o Google afirmou na ligação)
--     linkedAt          timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
--   Índices:
--     UNIQUE (provider, providerAccountId)  -- impede 2 contas ligadas ao mesmo Google
--     INDEX  (userId)                       -- lookup "logins sociais deste user"
--   Perda de dado: nenhuma (tabela nova, vazia).
--
-- Tabela ALTERADA: "User"
--   Coluna "password": de `text NOT NULL` para `text NULL`.
--   Motivo: conta criada via Google nasce sem senha (a app trata NULL como
--   credencial inválida no login por senha).
--   Perda de dado: nenhuma. Toda linha atual tem senha e continua com ela.
--
-- =============================================================================


-- ============================== APLICAÇÃO ====================================
-- Equivalente ao que `npx prisma db push` faria a partir do schema atual.
-- Rode preferencialmente dentro de uma transação.

BEGIN;

-- 1) User.password -> nullable
ALTER TABLE "User" ALTER COLUMN "password" DROP NOT NULL;

-- 2) Tabela LinkedAccount
CREATE TABLE "LinkedAccount" (
    "id"                TEXT NOT NULL,
    "userId"            TEXT NOT NULL,
    "provider"          TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "emailSnapshot"     TEXT NOT NULL,
    "linkedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LinkedAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LinkedAccount_provider_providerAccountId_key"
    ON "LinkedAccount" ("provider", "providerAccountId");

CREATE INDEX "LinkedAccount_userId_idx"
    ON "LinkedAccount" ("userId");

ALTER TABLE "LinkedAccount"
    ADD CONSTRAINT "LinkedAccount_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;

-- Observação: as duas tabelas são pequenas / a "LinkedAccount" nasce vazia,
-- então CREATE INDEX comum (sem CONCURRENTLY) não trava nada relevante. Se
-- rodar em janela de tráfego alto e quiser zero lock, criar a tabela primeiro,
-- commitar, e depois `CREATE INDEX CONCURRENTLY` fora de transação.


-- =============================== ROLLBACK ====================================
-- NÃO é um rollback "livre". Ler antes de rodar.
--
-- Passo A (sempre seguro): dropar a tabela LinkedAccount.
--   Só apaga os vínculos sociais. Ninguém perde a CONTA (User continua).
--   Quem entrou por Google e JÁ definiu uma senha continua entrando por senha.
--   Quem entrou por Google e NÃO tem senha perde o acesso até usar
--   "esqueci minha senha" (o e-mail está verificado, então funciona).
--
--   BEGIN;
--   DROP TABLE "LinkedAccount";
--   COMMIT;
--
-- Passo B (CONDICIONAL): voltar "User"."password" para NOT NULL.
--   SÓ funciona se NÃO existir nenhuma conta com password NULL. Depois do
--   primeiro cadastro via Google, existe — e aí este passo FALHA até essas
--   contas ganharem senha ou serem removidas. NÃO force.
--
--   -- 1. Checar quantas contas estão sem senha:
--   SELECT count(*) FROM "User" WHERE "password" IS NULL;
--
--   -- 2a. Se o count for 0: pode reverter direto.
--   ALTER TABLE "User" ALTER COLUMN "password" SET NOT NULL;
--
--   -- 2b. Se o count for > 0: NÃO dá para reverter sem decidir o que fazer
--   --     com essas contas (só-Google). Opções: deixar a coluna nullable
--   --     (recomendado — é inofensivo), ou apagar/definir senha nessas
--   --     contas primeiro. Não há resposta automática aqui.
--
-- =============================================================================
