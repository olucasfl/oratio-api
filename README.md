<h1 align="center">oratio-api</h1>

<p align="center">
  Backend <strong>NestJS</strong> do <a href="https://oratio-phi.vercel.app/">Oratio</a> —
  aplicativo de espiritualidade católica (liturgia diária, terço, consagração de 33 dias,
  Quaresma de São Miguel, biblioteca de orações, leitura da Bíblia e do Catecismo,
  notificações push e o VoxAI, assistente espiritual com IA).
</p>

---

## Visão geral

Serviço único NestJS + Prisma que serve o frontend **`oratio`** (repositório irmão,
React/Vite PWA). Autenticação JWT com access + refresh token, uma sessão de refresh
por dispositivo. Sem histórico de migrations — o schema vai a produção via
`npx prisma db push`.

## Documentação

| Arquivo | Para quê |
|---|---|
| **[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)** | Guia técnico completo — módulos, modelo de domínio, auth, VoxAI, scheduler de notificações, convenções e as "pegadinhas" não óbvias. **Leia antes de mexer no código.** |
| [`docs/tasks/`](./docs/tasks/) | Planos de trabalho ativos (`*-plan.md` + `*-todo.md`). |
| [`CLAUDE.md`](./CLAUDE.md) | Índice para o Claude Code, com o mapa de tudo acima. |

## Começando

```bash
npm install
npx prisma generate
npm run start:dev        # http://localhost:3000
```

Variáveis de ambiente em `docs/ARCHITECTURE.md` §9. Precisa de um Postgres acessível
(`DATABASE_URL`) e do `JWT_SECRET_KEY`; VAPID (`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`)
e a chave do VoxAI são opcionais (as features desligam sozinhas se faltarem).

## Scripts

| Script | O que faz |
|---|---|
| `npm run start:dev` | Servidor Nest em watch mode |
| `npm run build` | Compila para `dist/` |
| `npm test` | Jest (suíte completa) |
| `npm test -- <pattern>` | Jest filtrado |
| `npm run lint` | ESLint |

Prisma: `npx prisma db push && npx prisma generate` após editar `prisma/schema.prisma`
(sem migrations — cuidado com mudança destrutiva, ver `docs/ARCHITECTURE.md` §2).

## Contribuindo

Trabalhe a partir de `develop`. Antes de commitar: `npm test` + `npm run build`.
Mudou comportamento? Atualize a seção correspondente de `ARCHITECTURE.md` no
mesmo commit.
