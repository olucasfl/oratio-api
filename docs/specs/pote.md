# Spec: Dinâmica "O Pote" (jogo multiplayer por convite, só admin cria)

> Status: 📝 rascunho
> Plano: `docs/tasks/pote-plan.md` · Checklist: `docs/tasks/pote-todo.md`
> Frontend pareado: `oratio/docs/specs/pote.md` (ponteiro)
> Origem: "Spec — Dinâmica O Pote no Oratio.pdf" (2026-10-02), **adaptada à stack real do Oratio**. As regras do jogo, o catálogo, a pontuação e os textos vêm dela sem mudança; o que mudou é acesso, convite e tempo real (seção "O que mudou em relação ao PDF").

## Objetivo

Permitir que Lucas (admin) conduza, numa reunião de jovens do EJC (~10–20 pessoas, tema "Como anda o seu tempo?"), um jogo em tempo real de duas rodadas + parábola + reflexão, convidando as pessoas **por notificação dentro do próprio Oratio**.

A lição que a mecânica ensina: o tempo é o mesmo, a ordem é que muda. Rodada 1: os itens chegam areia → cascalho → pedra, e quem pega tudo não consegue colocar as pedras (Oração, Missa…). Rodada 2: as pedras entram primeiro e o resto é escolha, porque não cabe tudo.

## Modelo de acesso (decisão de Lucas, 2026-10-02)

| Quem | O que vê / faz |
|---|---|
| **Admin** (`User.isAdmin`) | Só ele vê o jogo no app (entrada "Dinâmicas" no menu). Cria a sala, escolhe quem convidar, conduz (líder), abre o telão. |
| **Convidado** (qualquer usuário logado) | **Não vê entrada nenhuma.** Recebe uma notificação no sino da Home ("Convite: O Pote"); tocar nela abre `/oratio/dinamicas/pote/:code` e ele entra. |
| **Qualquer outro** | Abrir a URL da sala sem convite → 403 → tela "Você não foi convidado para esta dinâmica". |

- **O convite é o controle de acesso.** O código de 4 dígitos vira só um identificador na URL, **não é segredo** e não dá acesso sozinho.
- **Sem lista de e-mails em env var, sem coluna `canPlayPote`:** o admin escolhe os convidados na hora, a partir da lista de usuários, e o servidor só aceita quem foi convidado.
- **Sem endpoint público.** O telão é aberto pelo próprio admin (outra aba/dispositivo logado) — não existe `GET /screen` sem login.
- Admin que quer ver sem jogar usa líder/telão; o líder **não joga**.

## Stack

Padrão da casa (NestJS + Prisma/Postgres, JWT próprio, React + Vite na Vercel), com três decisões:

1. **Sem Supabase.** O PDF assumia Supabase Auth/Realtime; o Oratio não usa nenhum dos dois. A auth é o `JwtAuthGuard` atual.
2. **Tempo real por polling curto, não por WebSocket.** O cliente chama `GET /oratio/pote/rooms/:code?since=<version>` a cada ~1 s. Se nada mudou, resposta mínima `{ changed: false }`. Sem infra nova, funciona no Render, reaproveita a auth, e 20 pessoas = ~20 req/s. Se um dia pesar, trocar por SSE sem mudar telas (o contrato é "estado + version").
3. **Lógica pura duplicada nos dois repos** (não há pacote compartilhado): fonte em `oratio-api/src/modules/pote/domain/`, cópia idêntica em `oratio/src/pages/Pote/domain/`, com teste que compara o hash das duas cópias para impedir divergência.

## Convite (notificação no sino)

- `POST /oratio/pote/rooms/:code/invites { userIds: string[] }` (admin) cria/garante um `PotePlayer` para cada convidado (ainda sem `joinedAt`) **e** grava uma linha em `Notification` por convidado:
  - `title`: "Convite: O Pote", `body`: "Lucas te convidou para uma dinâmica. Toque para entrar.", `url`: `/oratio/dinamicas/pote/:code`, `source: CAMPAIGN`, `campaignId: null`.
  - `expiresAt`: **fim da sala** (12 h no máximo) — não os 7 dias padrão.
  - **Sem push.** Só o sino (a pessoa abre o app). Também não passa pelo funil anti-spam, que é só do scheduler de regras. Convidar de novo a mesma pessoa não duplica (se já existir convite não expirado para esta sala, não grava outra).
- Convidar é permitido em qualquer fase antes de `FINAL` (entrada tardia = convidar depois).
- Tocar no sino navega para `url`; **verificar na implementação** que `NotificationBell` abre URLs internas do app.
- Convidado que abre a sala: `POST /oratio/pote/rooms/:code/join` marca `joinedAt` (idempotente). Sem convite → 403.
- **Remover** (admin): `removed = true`; o jogador vê "Você foi removido da sala" e some das estatísticas. Para readmitir, o admin convida de novo (zera `removed`).

## Regras do pote

Capacidade 100. Itens pequenos ocupam primeiro os vãos deixados pelas pedras já colocadas; pedras sempre ocupam espaço livre.

| Categoria | Qtd. | Tamanho | Vão gerado |
|---|---|---|---|
| Pedra | 5 | 14 | 6 |
| Cascalho | 14 | 5 | 0 |
| Areia | 15 | 2 | 0 |

Consequências que os testes confirmam:
- **5 pedras primeiro** ocupam 70, geram 30 de vão, sobram 30 livres → 60 disponíveis para cascalho + areia. O catálogo tem 100 de cascalho + areia, então **não cabe tudo**.
- **Rodada 1 pegando tudo:** 8 areias (16) + 6 cascalhos (30) = 46 gastos; sobram 54, cabem 3 pedras (42); **2 ficam de fora**.

### Algoritmo (função pura, sempre recalculada do zero a partir da lista ordenada)

```ts
type Category = 'PEDRA' | 'CASCALHO' | 'AREIA';
const CAPACITY = 100;
const SIZE = { PEDRA: 14, CASCALHO: 5, AREIA: 2 };
const GAP  = { PEDRA: 6,  CASCALHO: 0, AREIA: 0 };
interface JarState { free: number; gaps: number; placed: string[]; }

canPlace(state, cat): PEDRA → free >= 14; senão → free >= SIZE[cat] - min(gaps, SIZE[cat])
place(state, itemId, cat): throws 'NAO_CABE' se !canPlace; devolve { state, usedGap: boolean }
```

`usedGap = true` quando o item (cascalho/areia) consumiu algum vão — o frontend dispara "Encaixou nos vãos". O estado do pote **não é persistido**: deriva de `round1Placed` / `round2Placed`.

## Catálogo (fixo em código — `domain/catalog.ts`)

R1 = posição na sequência da rodada 1 (vazio = não aparece). Vida/Diversão são valores base.

**Pedras (14, vão 6):** `oracao` Oração ❤20 ⚡0 R1=19 · `missa` Missa ❤20 ⚡0 R1=18 · `familia` Família ❤15 ⚡10 R1=17 · `estudos` Estudos/Trabalho ❤15 ⚡0 R1=15 · `sono` Sono ❤15 ⚡0 R1=16

**Cascalho (5):** `amigos` Amigos 5/15 R1=9 · `role` Rolê 0/15 R1=10 · `futebol` Futebol/esporte 8/12 R1=11 · `namoro` Encontro com namorado(a) 5/15 R1=12 · `violao` Tocar violão/hobby 5/12 R1=13 · `praia` Praia/passeio 5/12 R1=14 · `academia` Academia 10/5 · `livro` Ler um livro 8/5 · `ejc` Reunião do EJC 10/10 · `pastoral` Pastoral/voluntariado 12/5 · `avos` Visitar os avós 12/5 · `curso` Curso extra 10/0 · `cozinhar` Cozinhar algo 5/8 · `quarto` Arrumar o quarto 6/0

**Areia (2):** `reels` Reels/TikTok 0/10 R1=1 · `serie` Série 0/10 R1=2 · `feed` Rolar o feed 0/8 R1=3 · `videogame` Videogame 0/10 R1=4 · `fofoca` Fofoca no grupo −5/8 R1=5 · `youtube` YouTube 0/8 R1=6 · `stories` Stories dos outros −3/5 R1=7 · `madrugada` Celular de madrugada −10/8 R1=8 · `joguinho` Joguinho no celular 0/6 · `meme` Meme no grupo 0/6 · `figurinha` Figurinha no zap 0/5 · `comentarios` Discutir nos comentários −5/3 · `compras` Compras online à toa −2/6 · `maratona` Maratonar série −3/12 · `cochilo` Cochilo extra 2/4

Sequência da rodada 1: posições 1–8 areias, 9–14 cascalhos, 15–19 pedras. Emojis ficam no arquivo de catálogo (escolha livre, um por item).

## Pontuação (função pura sobre a mesma lista ordenada)

- **Visibilidade:** rodada 1 mostra só ⚡ ao vivo (❤ oculta até o resultado); rodada 2 mostra ⚡ e ❤ ao vivo.
- **"O scroll cansa" (areia):** a ⚡ de cada areia depende de quantas areias já estavam no pote (na ordem da lista): 1ª–4ª = 100%; 5ª–8ª = 50% (arredonda para baixo); 9ª em diante = 0. Na 5ª areia: "📱 Você já nem tá curtindo mais…". A ❤ negativa da areia **não** diminui.
- **Vida negativa:** ícone ⚠️ discreto sobre o item **depois** de colocado; nunca antes.
- **Combos (só rodada 2; somem se a condição deixar de valer):**

| id | Nome | Condição | ❤ | ⚡ |
|---|---|---|---|---|
| `deus_primeiro` | 🕊️ Deus em primeiro lugar | `oracao` é o 1º item da lista | +10 | 0 |
| `comunidade` | ⛪ Vida em comunidade | `ejc` + `pastoral` | +10 | 0 |
| `corpo` | 💪 Corpo em dia | `academia` + `futebol` | +5 | +5 |
| `raizes` | 👵 Raízes | `familia` + `avos` | +5 | 0 |
| `turma` | 🎉 Turma reunida | `amigos` + `role` | 0 | +10 |

- **Penalidade (só rodada 1):** −20 ❤ por pedra que não entrou.
- **Classificação final (rodada 2):** `FUN_THRESHOLD = 60`, `LIFE_THRESHOLD = 150` (constantes configuráveis; calibrar jogando ~5 partidas antes da reunião).

| | ⚡ ≥ 60 | ⚡ < 60 |
|---|---|---|
| ❤ ≥ 150 | 🌟 Semana plena | 📚 Semana pesada |
| ❤ < 150 | 🎈 Semana vazia | 😮‍💨 Semana corrida |

Textos: plena "Deus em primeiro lugar e espaço para viver. Coube o que importa." · pesada "Muita responsabilidade e pouco descanso. Deus também quer a sua alegria." · vazia "Diversão de sobra, mas pouca coisa que fica. O que você vai lembrar dessa semana?" · corrida "A semana passou e pouca coisa encheu o coração. Que tal recomeçar pelas pedras?"

## Fases e transições

`LOBBY → ROUND_1 → RESULT_1 → PARABLE → ROUND_2 → FINAL → ENDED`; de qualquer fase `→ CANCELLED` (líder). `isPaused` é flag independente da fase.

| De | Para | Quem | Observação |
|---|---|---|---|
| LOBBY | ROUND_1 | Líder: Iniciar | ≥ 1 jogador com `joinedAt` e não removido |
| ROUND_1 | RESULT_1 | Líder: Encerrar rodada 1 | confirmação se alguém não terminou; itens restantes contam como PASS |
| RESULT_1 | PARABLE | Líder: Mostrar parábola | |
| PARABLE | ROUND_2 | Líder: Iniciar rodada 2 | define `round2EndsAt` (padrão 180 s) |
| ROUND_2 | FINAL | Líder: Encerrar rodada 2, ou timer zerado | o pote fica como está; todos → FINISHED |
| FINAL | ENDED | Líder: Encerrar jogo | |

O tutorial **não** é fase da sala: ao entrar em ROUND_1, cada jogador passa por `IN_TUTORIAL` e só começa tocando "Entendi, começar". Status individual: `WAITING → IN_TUTORIAL → PLAYING → FINISHED` (por rodada).

### Timers e pausa
- **Rodada 1:** o timer de 6 s por item roda no cliente; ao zerar, o cliente envia `PASS`. O servidor guarda `round1Index` e rejeita ação fora de ordem. Cada jogador anda no próprio ritmo.
- **Rodada 2:** servidor guarda `round2EndsAt`; clientes calculam o restante a partir dele. Zeramento tratado de forma **lazy**: toda leitura/ação confere `now > round2EndsAt` e, se sim, move a sala para FINAL (o polling de 1 s garante que acontece quase na hora; sem job agendado).
- **Pausa:** guarda `round2RemainingMs`, congela timers em todas as telas; retomar recalcula `round2EndsAt = now + remaining`. Ações de jogador na pausa → 409 com mensagem clara.
- **Presença:** cada `GET` do cliente atualiza `PotePlayer.lastSeenAt` (no máx. 1 escrita a cada ~5 s por jogador). "Desconectado" = `lastSeenAt` há mais de ~8 s.

## Rodadas (regras)

**Rodada 1:** sequência fixa de 19 itens (igual para todos); 6 s por item; ações Pegar / Deixar passar; tempo esgotado = deixar passar; item que não cabe → Pegar desabilitado; **nada sai do pote**. `round1/action` é idempotente por `index`.

**Rodada 2:** os 34 itens em abas Pedras / Cascalho / Areia; cascalho e areia **bloqueados até as 5 pedras**; pedras em qualquer ordem e **sem retirada**; cascalho/areia podem ser retirados e trocados; timer padrão 180 s, `+60 s` pelo líder; "Fechar minha semana" (confirma) encerra antes. `place`/`remove` ignoram item que já está no estado pedido.

## Telas

Quatro visões. O líder vê sempre, no topo, fase, código da sala e barra fixa de controles válidos para a fase.

- **Entrada (`/oratio/dinamicas`, só admin):** "Criar sala" → escolhe convidados (busca por nome/e-mail, multiseleção, "convidar" grava as notificações) → vai para o líder. Lista de salas ativas do admin para retomar.
- **Jogador (`/oratio/dinamicas/pote/:code`):** abaixo.
- **Líder (`/oratio/dinamicas/pote/:code/lider`, admin):** controles + status por jogador + estatísticas + botão **Convidar mais gente** + **Abrir telão**.
- **Telão (`/oratio/dinamicas/pote/:code/telao`, admin logado, só leitura):** projetado; fonte grande; só nomes de exibição e dados do jogo, nunca e-mail.

Controles do líder por fase: LOBBY = Iniciar, Convidar, Abrir telão, Remover, Cancelar · ROUND_1 = Pausar/Retomar, Encerrar rodada 1, Remover, Cancelar · RESULT_1 = Mostrar parábola, Cancelar · PARABLE = Iniciar rodada 2, Cancelar · ROUND_2 = Pausar/Retomar, +1 minuto, Encerrar rodada 2, Remover, Cancelar · FINAL = Encerrar jogo. Ações destrutivas (encerrar com gente jogando, cancelar, remover) pedem confirmação.

### Jogador, por fase
- **LOBBY:** "Aguardando o líder iniciar…" + pote vazio desenhado.
- **ROUND_1 tutorial (3 telas de passar):** textos abaixo; botão final "Entendi, começar". Não explica o vão nem a Vida.
- **ROUND_1 jogando:** topo = ⚡ e "Item X de 19"; centro = card (emoji, nome, tamanho, "+N diversão" em destaque — ❤ escondida) + barra de 6 s; botões Pegar / Deixar passar (cinza com "Não cabe: precisa de N, você tem M" + card treme quando não cabe); pote enchendo com "Espaço livre: N"; faixa "Ficou de fora" (pedra que não coube cai com destaque). Terminou: "Sua semana acabou. Aguardando os outros… (X/N terminaram)", ainda sem revelar ❤.
- **RESULT_1:** com 5 pedras → "🕊️ Parabéns! Você teve uma semana com Deus. Todas as pedras estão no seu pote." Sem → "Sua semana ficou cheia… mas não coube: [pedras]." Mostra ⚡ e revela ❤ (com −20 por pedra em vermelho).
- **PARABLE:** texto + perguntas (fonte grande no telão).
- **ROUND_2:** topo ⚡ ❤ timer; "Pedras: N/5"; abas (Cascalho/Areia com "🔒 Primeiro as pedras" até 5/5); depois "Espaço para escolhas: N"; tocar item fora do pote coloca, tocar cascalho/areia dentro retira; "Encaixou nos vãos ✨" quando `usedGap`; "Pote cheio. Para colocar algo, tire outra coisa."; combos com animação; "Fechar minha semana" (confirma) → espera.
- **FINAL:** classificação (emoji, nome, texto), ⚡ e ❤ finais, combos, "Ficou de fora da sua semana", texto final e campo "Qual pedra você vai colocar primeiro nesta semana?" (placeholder "Ex.: 10 minutos de oração antes de pegar o celular", máx. 140) com Salvar.
- **ENDED/CANCELLED:** "Obrigado por jogar!" + voltar ao Oratio; CANCELLED: "A sala foi encerrada pelo líder."
- **Pausa (qualquer fase):** overlay "⏸️ Pausado pelo líder" em todas as telas; timers congelados, botões desabilitados.

### Líder / telão por fase
- **ROUND_1:** linha por jogador ("Pedro, 🎮 item 13/19", "Ana, ✅ terminou, 5/5 pedras", "João, ⚠️ desconectado"); "X/N terminaram"; destaques: quantos têm 5/5, pedra mais deixada de fora, areia mais pega. Telão: contador + grade de potes em miniatura (só preenchimento).
- **RESULT_1:** grade de potes (nome, preenchimento, pedras de fora em vermelho), "X de N tiveram uma semana com Deus", "Pedra mais deixada de fora: [nome] (N pessoas)".
- **ROUND_2:** por jogador "🎮 montando, N/100, pedras N/5" ou "✅ fechou"; "X/N fecharam"; 3 itens mais escolhidos, 3 mais deixados de fora, combo mais ativado, média de ❤ e ⚡; telão com timer grande.
- **FINAL:** nº de jogadores em cada classificação, itens mais escolhidos/deixados de fora, comparativo "% com 5 pedras na rodada 1 × 100% na rodada 2".

## Visual (decisão de Lucas, 2026-10-03)

- **Sem emojis em lugar nenhum**: só ícones do Google (Material Symbols Rounded), carregados em `index.html` como subconjunto da fonte (`icon_names`). No domínio, cada item/combo/classificação tem um campo `icon` (nome do ícone), não `emoji`; os textos fixos abaixo ficam **sem** os emojis do PDF original (o ícone vai ao lado, na tela).
- **Movimento**: CSS puro (transform/opacity), entrada escalonada, troca de fase com o mesmo gesto, números que rolam, aba com indicador deslizante, pote com queda suave, celebração ao ativar combo; tudo sob `prefers-reduced-motion: no-preference`.
- **Perfil (admin)**: o card "Dinâmicas" é um card próprio, logo **abaixo** do painel admin e com visual distinto (não é mais um botão dentro do card admin).

## Textos fixos (arquivo de conteúdo `domain/content.ts`, fora dos componentes)

**Tutorial:** (1) "🫙 Este pote é a sua semana. Tudo o que você fizer precisa caber nele." (2) "Vão aparecer coisas da sua semana, uma de cada vez. Você tem 6 segundos para tocar em Pegar ou Deixar passar." (3) "⚠️ O que entra no pote não sai mais. Tempo gasto não volta. Boa semana!" → "Entendi, começar".

**Parábola — "O pote do professor":** Um professor colocou um pote vazio na mesa e o encheu de pedras grandes. "Está cheio?", perguntou. Os alunos disseram que sim. / Ele despejou cascalho, que escorreu entre as pedras. "E agora?" Já não tinham tanta certeza. / Então despejou areia, que preencheu cada vão. / "Este pote é a sua vida", disse. "As pedras são o que realmente importa: Deus, a família, sua missão, seu descanso. O cascalho são coisas boas, como amigos, hobbies e esporte. A areia é todo o resto. / Se você começar pela areia, não sobra espaço para as pedras. Mas se as pedras entrarem primeiro, o resto encontra o seu lugar." / "Buscai em primeiro lugar o Reino de Deus, e todas essas coisas vos serão dadas por acréscimo." (Mt 6,33). **Debate:** 1. Na rodada 1, o que você pegou sem pensar? 2. Qual é a "areia" que mais rouba o seu tempo na vida real? 3. Qual pedra costuma ficar de fora da sua semana?

**Considerações finais — "Não dá para colocar tudo":** Na primeira rodada, a vida escolheu por você: o que aparecia primeiro, você pegava. Na segunda, você escolheu. / Repare que as pedras entraram, todas as cinco. Elas não se negociam. Mas depois delas, você teve que decidir, porque não cabia tudo. E ficou alguma coisa de fora. / Isso não é uma falha do seu pote. É a vida. Toda escolha é também uma renúncia. Quem tenta caber tudo acaba não aproveitando nada, como a areia que, depois de um tempo, já nem diverte mais. / São Paulo diz: "Tudo me é permitido, mas nem tudo me convém." (1Cor 6,12) A série, o jogo, o feed: nada disso é proibido. Mas nem tudo merece o espaço que tem ocupado. / E diz também: "Vede com cuidado como andais… aproveitando bem o tempo." (Ef 5,15-16) / Organizar a semana não é deixar de viver. É escolher viver o que importa, começando por Deus, que não disputa espaço com nada. Ele é quem dá lugar a tudo. / Então, como anda o seu tempo?

> Citações bíblicas (Mt 6,33; 1Cor 6,12; Ef 5,15-16) vêm do texto aprovado por Lucas na spec original; não alterar sem aceite dele (`RULES.md` §4).

## Requisitos de saída (contrato)

Todas as rotas: `JwtAuthGuard`; `userId` sempre de `req.user.userId`, nunca do body (sem exigência de `X-App`, como `bible-marks`). **Sem `ThrottlerGuard` nas rotas do jogo:** o throttle do app é escopado (só auth/admin), então o polling de 1 s não é limitado; ninguém deve adicionar `ThrottlerGuard` aqui.

| Método | Rota | Guard extra | Ação |
|---|---|---|---|
| POST | `/oratio/pote/rooms` | `AdminGuard` | Cria sala (`code` de 4 dígitos único entre salas ativas), devolve `{ code }` |
| GET | `/oratio/pote/rooms/mine` | `AdminGuard` | Salas ativas do admin |
| POST | `/oratio/pote/rooms/:code/invites` | `AdminGuard` + líder da sala | `{ userIds }` → cria `PotePlayer` + `Notification`; devolve `{ invited, alreadyInvited }` |
| GET | `/oratio/pote/users/search?q=` | `AdminGuard` | Usuários para convidar (`id`, `name`, `email`); mín. 2 caracteres, máx. 20 resultados |
| GET | `/oratio/pote/rooms/:code?since=N` | convidado **ou** líder | Estado da sala para quem chama; `{ changed: false }` se `version <= since`. Atualiza `lastSeenAt` |
| POST | `/oratio/pote/rooms/:code/join` | convidado | `joinedAt = now` (idempotente) |
| POST | `/oratio/pote/rooms/:code/phase` | líder | `{ to }`, valida a transição |
| POST | `/oratio/pote/rooms/:code/pause` | líder | `{ paused: boolean }` |
| POST | `/oratio/pote/rooms/:code/extend` | líder | +60 s na rodada 2 |
| DELETE | `/oratio/pote/rooms/:code/players/:userId` | líder | remove jogador |
| POST | `/oratio/pote/rooms/:code/cancel` | líder | cancela a sala |
| POST | `/oratio/pote/rooms/:code/round1/tutorial-done` | jogador | `IN_TUTORIAL → PLAYING` |
| POST | `/oratio/pote/rooms/:code/round1/action` | jogador | `{ index, action: 'TAKE' \| 'PASS' }` |
| POST | `/oratio/pote/rooms/:code/round2/place` | jogador | `{ itemId }` |
| POST | `/oratio/pote/rooms/:code/round2/remove` | jogador | `{ itemId }` |
| POST | `/oratio/pote/rooms/:code/round2/finish` | jogador | fecha a semana |
| POST | `/oratio/pote/rooms/:code/commitment` | jogador | `{ text }` (≤ 140), upsert por sala+usuário |

O `GET` devolve **a visão de quem chama**: jogador = próprio pote/placar (❤ omitida na rodada 1 até RESULT_1); líder/telão = todos os jogadores com status e estatísticas agregadas (calculadas no servidor). Nunca devolve e-mail de ninguém (só `displayName`, que é o primeiro nome do usuário). Erros: 401 sem token · 403 sem convite / não é líder / não é admin · 404 sala inexistente ou código que não tem 4 dígitos · 409 pausa, fase errada ou ação fora de ordem · 400 payload inválido.

Cada ação de jogador: valida fase, pausa e regras com as funções puras → persiste → incrementa `PoteRoom.version` → devolve o estado atualizado do jogador.

## Modelo de dados

**Tudo aditivo** (3 tabelas novas e 3 enums novos; nada existente é alterado). `db push` de produção é **pendente de execução humana** (`RULES.md` §2): entregar `prisma/db-scripts/2026-10-02-pote.sql` com o rollback (`DROP TABLE` das 3 + `DROP TYPE` dos enums).

- `PoteRoom`: `id`, `code` (varchar 4), `leaderId → User`, `phase` (enum), `isPaused`, `round2EndsAt?`, `round2RemainingMs?`, `version Int @default(0)`, `createdAt`, `updatedAt`. Índice em `(code, phase)`; unicidade do código entre salas ativas garantida no service (ativa = fora de ENDED/CANCELLED).
- `PotePlayer`: `id`, `roomId`, `userId → User (onDelete: Cascade)`, `displayName`, `joinedAt?`, `lastSeenAt?`, `statusRound1`, `round1Index Int @default(0)`, `round1Placed String[]`, `statusRound2`, `round2Placed String[]`, `removed Boolean @default(false)`; `@@unique([roomId, userId])`.
- `PoteCommitment`: `id`, `roomId`, `userId → User (onDelete: Cascade)`, `text` (varchar 140), `createdAt`; `@@unique([roomId, userId])`.
- Pontuação, espaço livre e classificação **não** são persistidos.

## Critérios de aceite (BDD)

**Funções puras (Jest):**
- [ ] **Dado** 5 pedras colocadas primeiro, **então** `free = 30`, `gaps = 30` e restam exatamente 60 para escolhas.
- [ ] **Dado** a sequência da rodada 1 pegando tudo que cabe, **então** entram 3 pedras e 2 ficam de fora.
- [ ] Areia usa vão parcialmente (`gaps = 1`, areia de tamanho 2 → consome 1 de vão e 1 de livre) e `usedGap` reflete isso.
- [ ] "Scroll cansa": 4ª areia 100%, 5ª–8ª 50% (arredondado para baixo), 9ª+ 0; ❤ negativa não é reduzida.
- [ ] Cada combo ativa e desativa conforme a lista muda; `deus_primeiro` exige `oracao` como 1º item.
- [ ] Penalidade −20 ❤ por pedra de fora (só rodada 1); as 4 classificações nos limites 60/150 (59/60, 149/150).
- [ ] Sequência da rodada 1 = exatamente a da tabela (19 itens, 8/6/5).

**Acesso e convite:**
- [ ] **Dado** usuário não-admin, **quando** `POST /oratio/pote/rooms`, **então** 403.
- [ ] **Dado** admin, **quando** convida 3 usuários, **então** 3 `PotePlayer` e 3 `Notification` (sem push) com `url = /oratio/dinamicas/pote/:code`; convidar de novo não duplica.
- [ ] **Dado** usuário **sem** convite, **quando** `GET`/`join` da sala, **então** 403, mesmo sabendo o código.
- [ ] **Dado** convidado, **quando** `GET /oratio/pote/rooms/:code`, **então** a resposta não contém e-mail de ninguém.
- [ ] **Dado** convidado, **quando** chama uma rota de líder, **então** 403.
- [ ] **Dado** sala em ENDED/CANCELLED, **quando** um convidado faz `GET`, **então** recebe a fase final (para mostrar "Obrigado por jogar!" / "A sala foi encerrada pelo líder."); `join` e qualquer ação → 409; o código passa a poder ser reaproveitado por uma sala nova (o `GET` sempre resolve para a sala mais recente com aquele código).

**Jogo:**
- [ ] Rodada 1: `action` com `index` repetido é idempotente; `index` fora de ordem → 409; `TAKE` de item que não cabe → 409.
- [ ] Rodada 1: encerrar com gente jogando conta os itens restantes como PASS.
- [ ] Rodada 2: `place` de cascalho/areia com < 5 pedras → 409; pedra não pode ser removida; remoção recalcula placar e combos.
- [ ] Pausa: qualquer ação de jogador → 409 com mensagem; retomar recalcula `round2EndsAt` a partir do restante.
- [ ] Rodada 2 com `now > round2EndsAt`: o próximo `GET` já devolve FINAL.
- [ ] Compromisso > 140 caracteres → 400; salvo duas vezes → atualiza, não duplica.
- [ ] Líder que recarrega volta ao estado atual; jogador que reconecta volta de onde parou (rodada 1: o item atual reinicia com 6 s cheios).

**Manual (Lucas, na tela):**
- [ ] Fluxo completo com 3 navegadores (líder + 2 jogadores) + telão; convite chega no sino da Home e o toque entra na sala.
- [ ] Celular ~380 px: botões grandes e legíveis; pausa congela timers em todas as telas; estatísticas do líder atualizam em ~1 s.
- [ ] Calibrar 60/150 jogando ~5 partidas sozinho antes da reunião.

## Plano de testes

- **Unitário (Jest):** `pote.rules.spec.ts` (pote), `pote.score.spec.ts` (pontuação/combos/classificação), `pote.service.spec.ts` (transições, idempotência, pausa, lazy-timeout, convite, acesso), `pote.controller.spec.ts` (guards). Frontend: Vitest para a cópia do domínio (+ teste de hash igual ao do backend) e para os componentes de timer/aba bloqueada.
- **Contrato:** sequência de `curl` contra `localhost:3000` com 1 admin e 2 usuários de teste, cobrindo o fluxo todo.
- **Manual:** o que está acima.

Loop por tarefa: `npm test -- pote` → `npm test` → `npm run build` → `npm run lint` → commit (na `develop`).

## O que mudou em relação ao PDF

| PDF | Aqui | Por quê |
|---|---|---|
| Supabase Auth + Realtime (broadcast/presence) | JWT atual + polling de 1 s + `lastSeenAt` | Supabase não existe no Oratio |
| "Migrations" | `schema.prisma` + script SQL com rollback; `db push` humano | `RULES.md` §2 |
| Qualquer usuário cria sala e entra com o código | Só admin cria; entra quem foi convidado pelo sino | Decisão de Lucas |
| Ponto de entrada "Dinâmicas" visível a todos | Visível só ao admin | Idem |
| Telão público por código | Telão é uma sessão admin | Sem endpoint público |
| Código de 4 dígitos como acesso | Código só identifica a sala; o convite dá acesso | Código de 4 dígitos é adivinhável |
| Pacote compartilhado front/back | Cópia + teste de hash | Não há workspace compartilhado |
| Timer da rodada 2 por job | Verificação lazy a cada leitura/ação | O polling já garante a frequência |

## Fora de escopo

Ranking global, histórico de partidas, avatares, sons; editor de itens (catálogo é fixo em código); push/lembrete do compromisso; física real de partículas; jogadores sem conta; convite por e-mail/WhatsApp; WebSocket/SSE (fica como evolução se o polling pesar); líder jogando.
