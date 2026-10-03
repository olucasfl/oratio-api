import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PoteService } from './pote.service';
import { ITEM_BY_ID, ROCK_IDS } from './domain/catalog';
import { buildRound1Order } from './domain/order';
import { canPlace, deriveJar } from './domain/rules';
import { computeScore } from './domain/score';

// ── Prisma em memória: só o que o PoteService usa, com semântica de where/update
//    suficiente para exercitar versão, trava otimista e transições (sem banco). ──

type Row = Record<string, any>;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    const value = row[key];
    if (cond === null || typeof cond !== 'object' || cond instanceof Date) return value === cond;
    if ('in' in cond && !cond.in.includes(value)) return false;
    if ('notIn' in cond && cond.notIn.includes(value)) return false;
    if ('not' in cond && value === cond.not) return false;
    if ('equals' in cond && JSON.stringify(value) !== JSON.stringify(cond.equals)) return false;
    return true;
  });
}

function applyData(row: Row, data: Row) {
  for (const [key, val] of Object.entries(data)) {
    if (val && typeof val === 'object' && !(val instanceof Date)) {
      if ('increment' in val) row[key] = (row[key] ?? 0) + val.increment;
      else if ('set' in val) row[key] = [...val.set];
      else row[key] = val;
    } else row[key] = val;
  }
}

function makeFakePrisma() {
  const db = {
    users: [] as Row[],
    rooms: [] as Row[],
    players: [] as Row[],
    commitments: [] as Row[],
    notifications: [] as Row[],
  };
  let seq = 0;
  const id = (p: string) => `${p}-${++seq}`;

  const prisma: any = {
    user: {
      findMany: jest.fn(async ({ where }: Row) => db.users.filter((u) => matches(u, where))),
      findUnique: jest.fn(async ({ where }: Row) => db.users.find((u) => u.id === where.id) ?? null),
    },
    poteRoom: {
      findFirst: jest.fn(async ({ where, include }: Row) => {
        const room = [...db.rooms]
          .filter((r) => matches(r, where))
          .sort((a, b) => b.createdAt - a.createdAt)[0];
        if (!room) return null;
        // cópias rasas dos jogadores (como o Prisma): a mutação do banco não vaza para o que já foi lido
        return include?.players
          ? { ...room, players: db.players.filter((p) => p.roomId === room.id).map((p) => ({ ...p })) }
          : { ...room };
      }),
      create: jest.fn(async ({ data }: Row) => {
        const row = {
          id: id('room'), phase: 'LOBBY', isPaused: false, round2EndsAt: null,
          round2RemainingMs: null, version: 0, createdAt: new Date(Date.now() + seq), ...data,
        };
        db.rooms.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: Row) => {
        const row = db.rooms.find((r) => r.id === where.id)!;
        applyData(row, data);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: Row) => {
        const rows = db.rooms.filter((r) => matches(r, where));
        rows.forEach((r) => applyData(r, data));
        return { count: rows.length };
      }),
    },
    potePlayer: {
      findMany: jest.fn(async ({ where }: Row) => db.players.filter((p) => matches(p, where))),
      findUnique: jest.fn(async ({ where }: Row) =>
        db.players.find(
          (p) => p.roomId === where.roomId_userId.roomId && p.userId === where.roomId_userId.userId,
        ) ?? null,
      ),
      count: jest.fn(async ({ where }: Row) => db.players.filter((p) => matches(p, where)).length),
      createMany: jest.fn(async ({ data }: Row) => {
        data.forEach((d: Row) =>
          db.players.push({
            id: id('pl'), joinedAt: null, lastSeenAt: null, statusRound1: 'WAITING', round1Index: 0,
            round1Placed: [], statusRound2: 'WAITING', round2Placed: [], removed: false, ...d,
          }),
        );
        return { count: data.length };
      }),
      update: jest.fn(async ({ where, data }: Row) => {
        const row = db.players.find((p) => p.id === where.id)!;
        applyData(row, data);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: Row) => {
        const rows = db.players.filter((p) => matches(p, where));
        rows.forEach((r) => applyData(r, data));
        return { count: rows.length };
      }),
    },
    poteCommitment: {
      findUnique: jest.fn(async ({ where }: Row) =>
        db.commitments.find(
          (c) => c.roomId === where.roomId_userId.roomId && c.userId === where.roomId_userId.userId,
        ) ?? null,
      ),
      upsert: jest.fn(async ({ where, create, update }: Row) => {
        const found = db.commitments.find(
          (c) => c.roomId === where.roomId_userId.roomId && c.userId === where.roomId_userId.userId,
        );
        if (found) Object.assign(found, update);
        else db.commitments.push({ id: id('c'), ...create });
      }),
    },
    notification: {
      createMany: jest.fn(async ({ data }: Row) => {
        db.notifications.push(...data);
        return { count: data.length };
      }),
    },
  };
  return { prisma, db };
}

// ── cenário ──

const ADMIN = 'admin-1';
const ANA = 'user-ana';
const BIA = 'user-bia';
const OUTSIDER = 'user-fora';

function setup() {
  const { prisma, db } = makeFakePrisma();
  db.users.push(
    { id: ADMIN, name: 'Lucas Teste', email: 'admin@exemplo.com' },
    { id: ANA, name: 'Ana Souza', email: 'ana@exemplo.com' },
    { id: BIA, name: 'Bia Lima', email: 'bia@exemplo.com' },
    { id: OUTSIDER, name: 'Fulano de Tal', email: 'fulano@exemplo.com' },
  );
  const service = new PoteService(prisma);
  return { service, prisma, db };
}

async function newRoom(s: ReturnType<typeof setup>, invite = [ANA, BIA]) {
  const { code } = await s.service.createRoom(ADMIN);
  await s.service.invite(code, ADMIN, invite);
  return code;
}

/** Leva a sala até ROUND_1 com Ana e Bia dentro. */
async function startRound1(s: ReturnType<typeof setup>) {
  const code = await newRoom(s);
  await s.service.join(code, ANA);
  await s.service.join(code, BIA);
  await s.service.changePhase(code, ADMIN, 'ROUND_1');
  return code;
}

/** A ordem sorteada deste jogador (a mesma que o servidor calcula: sala + usuário). */
function orderOf(s: ReturnType<typeof setup>, code: string, userId: string): string[] {
  const room = s.db.rooms.find((r) => r.code === code)!;
  return buildRound1Order(`${room.id}:${userId}`);
}

async function playRound1(s: ReturnType<typeof setup>, code: string, userId: string, takeAll = true) {
  await s.service.tutorialDone(code, userId);
  const order = orderOf(s, code, userId);
  let jar = deriveJar([]);
  for (let i = 0; i < order.length; i++) {
    const item = ITEM_BY_ID[order[i]];
    if (takeAll && canPlace(jar, item.category)) {
      await s.service.round1Action(code, userId, i, 'TAKE');
      jar = deriveJar([...jar.placed, item.id]);
    } else {
      await s.service.round1Action(code, userId, i, 'PASS');
    }
  }
}

describe('PoteService — acesso e convite', () => {
  it('cria sala com código de 4 dígitos', async () => {
    const s = setup();
    const { code } = await s.service.createRoom(ADMIN);
    expect(code).toMatch(/^\d{4}$/);
  });

  it('convida: cria PotePlayer + Notification sem push, com a URL da sala e expiração curta', async () => {
    const s = setup();
    const { code } = await s.service.createRoom(ADMIN);
    const result = await s.service.invite(code, ADMIN, [ANA, BIA]);

    expect(result).toEqual({ invited: 2, alreadyInvited: 0 });
    expect(s.db.players).toHaveLength(2);
    expect(s.db.players[0]).toMatchObject({ displayName: 'Ana', joinedAt: null });
    expect(s.db.notifications).toHaveLength(2);
    expect(s.db.notifications[0]).toMatchObject({
      userId: ANA,
      title: 'Convite: O Pote',
      url: `/oratio/dinamicas/pote/${code}`,
      source: 'CAMPAIGN',
    });
    expect(s.db.notifications[0]).not.toHaveProperty('pushSent');
    const ttl = s.db.notifications[0].expiresAt.getTime() - Date.now();
    expect(ttl).toBeLessThanOrEqual(12 * 60 * 60 * 1000);
    expect(ttl).toBeGreaterThan(11 * 60 * 60 * 1000);
  });

  it('convidar de novo não duplica jogador nem notificação', async () => {
    const s = setup();
    const { code } = await s.service.createRoom(ADMIN);
    await s.service.invite(code, ADMIN, [ANA]);
    const again = await s.service.invite(code, ADMIN, [ANA, BIA]);

    expect(again).toEqual({ invited: 1, alreadyInvited: 1 });
    expect(s.db.players).toHaveLength(2);
    expect(s.db.notifications.filter((n) => n.userId === ANA)).toHaveLength(1);
  });

  it('o líder nunca é convidado a si mesmo', async () => {
    const s = setup();
    const { code } = await s.service.createRoom(ADMIN);
    expect(await s.service.invite(code, ADMIN, [ADMIN])).toEqual({ invited: 0, alreadyInvited: 0 });
    expect(s.db.players).toHaveLength(0);
  });

  it('só o líder da sala convida (outro admin recebe 403)', async () => {
    const s = setup();
    const { code } = await s.service.createRoom(ADMIN);
    await expect(s.service.invite(code, 'outro-admin', [ANA])).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('usuário sem convite recebe 403 no GET e no join, mesmo sabendo o código', async () => {
    const s = setup();
    const code = await newRoom(s);
    await expect(s.service.getState(code, OUTSIDER)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(s.service.join(code, OUTSIDER)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('sala inexistente → 404', async () => {
    const s = setup();
    await expect(s.service.getState('9999', ANA)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a resposta do GET nunca contém e-mail de ninguém', async () => {
    const s = setup();
    const code = await newRoom(s);
    await s.service.join(code, ANA);
    const asPlayer = JSON.stringify(await s.service.getState(code, ANA));
    const asLeader = JSON.stringify(await s.service.getState(code, ADMIN));
    for (const text of [asPlayer, asLeader]) {
      expect(text).not.toContain('@exemplo.com');
      expect(text).not.toContain('email');
    }
  });

  it('sala de espera: o jogador vê quem já entrou (só nomes), em ordem de chegada, e a si mesmo marcado', async () => {
    const s = setup();
    const code = await newRoom(s);
    await s.service.join(code, ANA);
    await s.service.join(code, BIA);
    // Bia chegou antes (os dois joins caem no mesmo milissegundo, então fixa a hora)
    s.db.players.find((p) => p.userId === BIA)!.joinedAt = new Date(Date.now() - 5000);

    const asAna: any = await s.service.getState(code, ANA);
    expect(asAna.lobby.players).toEqual([
      { displayName: 'Bia', isMe: false },
      { displayName: 'Ana', isMe: true },
    ]);
    const text = JSON.stringify(asAna.lobby);
    expect(text).not.toContain('@');
    expect(text).not.toContain('user-');
  });

  it('sala de espera: convidado que ainda não entrou e removido não aparecem; chegada nova muda a versão', async () => {
    const s = setup();
    const code = await newRoom(s);
    await s.service.join(code, ANA);
    const before: any = await s.service.getState(code, ANA);
    expect(before.lobby.players.map((p: any) => p.displayName)).toEqual(['Ana']); // Bia só foi convidada

    await s.service.join(code, BIA);
    const after: any = await s.service.getState(code, ANA, before.version);
    expect(after.changed).toBe(true);
    expect(after.lobby.players.map((p: any) => p.displayName)).toEqual(['Ana', 'Bia']);

    await s.service.removePlayer(code, ADMIN, BIA);
    const removed: any = await s.service.getState(code, ANA);
    expect(removed.lobby.players.map((p: any) => p.displayName)).toEqual(['Ana']);
  });

  it('a lista da sala de espera some depois do LOBBY (não pesa o jogo)', async () => {
    const s = setup();
    const code = await newRoom(s);
    await s.service.join(code, ANA);
    await s.service.changePhase(code, ADMIN, 'ROUND_1');
    expect(((await s.service.getState(code, ANA)) as any).lobby).toBeUndefined();
  });

  it('join é idempotente e marca joinedAt', async () => {
    const s = setup();
    const code = await newRoom(s);
    await s.service.join(code, ANA);
    const first = s.db.players.find((p) => p.userId === ANA)!.joinedAt;
    await s.service.join(code, ANA);
    expect(s.db.players.find((p) => p.userId === ANA)!.joinedAt).toBe(first);
    expect(first).toBeInstanceOf(Date);
  });

  it('jogador removido vê "removed" e não entra mais; reconvidar o readmite', async () => {
    const s = setup();
    const code = await newRoom(s);
    await s.service.join(code, ANA);
    await s.service.removePlayer(code, ADMIN, ANA);

    const state: any = await s.service.getState(code, ANA);
    expect(state.removed).toBe(true);
    await expect(s.service.join(code, ANA)).rejects.toBeInstanceOf(ForbiddenException);

    const leader: any = await s.service.getState(code, ADMIN);
    expect(leader.players.map((p: any) => p.userId)).not.toContain(ANA);

    const re = await s.service.invite(code, ADMIN, [ANA]);
    expect(re.invited).toBe(1);
    await s.service.join(code, ANA);
  });

  it('buscar usuários exige ao menos 2 caracteres', async () => {
    const s = setup();
    await expect(s.service.searchUsers(ADMIN, 'a')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('PoteService — fases', () => {
  it('só avança na ordem LOBBY → ROUND_1 → RESULT_1 → PARABLE → ROUND_2 → FINAL → ENDED', async () => {
    const s = setup();
    const code = await startRound1(s);
    await expect(s.service.changePhase(code, ADMIN, 'ROUND_2')).rejects.toBeInstanceOf(
      ConflictException,
    );
    for (const to of ['RESULT_1', 'PARABLE', 'ROUND_2', 'FINAL', 'ENDED'] as const) {
      const state: any = await s.service.changePhase(code, ADMIN, to);
      expect(state.room.phase).toBe(to);
    }
  });

  it('não inicia sem ao menos 1 jogador que entrou', async () => {
    const s = setup();
    const code = await newRoom(s);
    await expect(s.service.changePhase(code, ADMIN, 'ROUND_1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('jogador não conduz a sala (o service exige ser o líder)', async () => {
    const s = setup();
    const code = await newRoom(s);
    await expect(s.service.changePhase(code, ANA, 'ROUND_1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('cancelar encerra a sala e o jogador vê CANCELLED; ações depois → 409', async () => {
    const s = setup();
    const code = await newRoom(s);
    await s.service.join(code, ANA);
    await s.service.cancel(code, ADMIN);
    const state: any = await s.service.getState(code, ANA);
    expect(state.room.phase).toBe('CANCELLED');
    await expect(s.service.join(code, BIA)).rejects.toBeInstanceOf(ConflictException);
    await expect(s.service.changePhase(code, ADMIN, 'ROUND_1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('o código de uma sala encerrada pode ser reaproveitado por outra', async () => {
    const s = setup();
    const { code } = await s.service.createRoom(ADMIN);
    await s.service.cancel(code, ADMIN);
    // força colisão: o próximo sorteio devolve o mesmo código
    jest.spyOn(Math, 'random').mockReturnValueOnce(Number(code) / 10000);
    const second = await s.service.createRoom(ADMIN);
    expect(second.code).toBe(code);
    (Math.random as jest.Mock).mockRestore?.();
    // a sala "mais recente" é a nova
    expect(((await s.service.getState(code, ADMIN)) as any).room.phase).toBe('LOBBY');
  });

  it('avançar com a sala pausada → 409; cancelar ainda é permitido', async () => {
    const s = setup();
    const code = await startRound1(s);
    await s.service.setPaused(code, ADMIN, true);
    await expect(s.service.changePhase(code, ADMIN, 'RESULT_1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(s.service.cancel(code, ADMIN)).resolves.toBeDefined();
  });

  it('entrada tardia: na rodada 1 cai no tutorial; na rodada 2 vai direto jogar', async () => {
    const s = setup();
    const code = await newRoom(s, [ANA, BIA]);
    await s.service.join(code, ANA);
    await s.service.changePhase(code, ADMIN, 'ROUND_1');
    await s.service.join(code, BIA);
    expect(s.db.players.find((p) => p.userId === BIA)!.statusRound1).toBe('IN_TUTORIAL');

    await s.service.changePhase(code, ADMIN, 'RESULT_1');
    await s.service.changePhase(code, ADMIN, 'PARABLE');
    const { code: _unused } = { code };
    await s.service.invite(code, ADMIN, [OUTSIDER]);
    await s.service.changePhase(code, ADMIN, 'ROUND_2');
    await s.service.join(code, OUTSIDER);
    expect(s.db.players.find((p) => p.userId === OUTSIDER)!.statusRound2).toBe('PLAYING');
  });
});

describe('PoteService — rodada 1', () => {
  it('não joga antes de passar pelo tutorial', async () => {
    const s = setup();
    const code = await startRound1(s);
    await expect(s.service.round1Action(code, ANA, 0, 'TAKE')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('action com index repetido é idempotente; fora de ordem → 409', async () => {
    const s = setup();
    const code = await startRound1(s);
    await s.service.tutorialDone(code, ANA);

    const order = orderOf(s, code, ANA);
    await s.service.round1Action(code, ANA, 0, 'TAKE');
    await s.service.round1Action(code, ANA, 0, 'TAKE'); // duplo toque
    const ana = s.db.players.find((p) => p.userId === ANA)!;
    expect(ana.round1Placed).toEqual([order[0]]);
    expect(ana.round1Index).toBe(1);

    await expect(s.service.round1Action(code, ANA, 5, 'PASS')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('PASS avança sem colocar nada', async () => {
    const s = setup();
    const code = await startRound1(s);
    await s.service.tutorialDone(code, ANA);
    await s.service.round1Action(code, ANA, 0, 'PASS');
    const ana = s.db.players.find((p) => p.userId === ANA)!;
    expect(ana.round1Placed).toEqual([]);
    expect(ana.round1Index).toBe(1);
  });

  it('pegando tudo: o que não cabe → 409 NAO_CABE (e passa); termina com 2 ou 3 pedras, nunca as 5', async () => {
    const s = setup();
    const code = await startRound1(s);
    await s.service.tutorialDone(code, ANA);
    const order = orderOf(s, code, ANA);
    let jar = deriveJar([]);
    let refused = 0;
    for (let i = 0; i < order.length; i++) {
      const item = ITEM_BY_ID[order[i]];
      if (canPlace(jar, item.category)) {
        await s.service.round1Action(code, ANA, i, 'TAKE');
        jar = deriveJar([...jar.placed, item.id]);
      } else {
        await expect(s.service.round1Action(code, ANA, i, 'TAKE')).rejects.toThrow('NAO_CABE');
        await s.service.round1Action(code, ANA, i, 'PASS');
        refused += 1;
      }
    }
    const ana = s.db.players.find((p) => p.userId === ANA)!;
    expect(ana.statusRound1).toBe('FINISHED');
    const stones = ana.round1Placed.filter((id: string) => ROCK_IDS.includes(id)).length;
    expect(stones).toBeGreaterThanOrEqual(2);
    expect(stones).toBeLessThanOrEqual(3);
    expect(refused).toBe(5 - stones);
  });

  it('a Vida da rodada 1 fica oculta no jogo e é revelada no RESULT_1', async () => {
    const s = setup();
    const code = await startRound1(s);
    await playRound1(s, code, ANA);
    const during: any = await s.service.getState(code, ANA);
    expect(during.me.round1.life).toBeNull();
    expect(during.me.round1.fun).toBeGreaterThan(0);

    await s.service.changePhase(code, ADMIN, 'RESULT_1');
    const after: any = await s.service.getState(code, ANA);
    const ana = s.db.players.find((p) => p.userId === ANA)!;
    const score = computeScore(ana.round1Placed, 1);
    expect(after.me.round1.life).toBe(score.life);
    expect(after.me.round1.penalty).toBe(20 * score.rocksMissing.length);
  });

  it('encerrar a rodada 1 com gente jogando conta os itens restantes como PASS', async () => {
    const s = setup();
    const code = await startRound1(s);
    await s.service.tutorialDone(code, ANA);
    const order = orderOf(s, code, ANA);
    await s.service.round1Action(code, ANA, 0, 'TAKE');
    await s.service.changePhase(code, ADMIN, 'RESULT_1');

    const ana = s.db.players.find((p) => p.userId === ANA)!;
    const bia = s.db.players.find((p) => p.userId === BIA)!;
    expect(ana).toMatchObject({ statusRound1: 'FINISHED', round1Index: 19 });
    expect(ana.round1Placed).toEqual([order[0]]);
    expect(bia.statusRound1).toBe('FINISHED'); // estava no tutorial: tudo PASS
    expect(bia.round1Placed).toEqual([]);
  });

  it('o item atual só é informado a quem está jogando', async () => {
    const s = setup();
    const code = await startRound1(s);
    const before: any = await s.service.getState(code, ANA);
    expect(before.me.round1.currentItemId).toBeNull();
    await s.service.tutorialDone(code, ANA);
    const after: any = await s.service.getState(code, ANA);
    expect(after.me.round1.currentItemId).toBe(orderOf(s, code, ANA)[0]);
  });
});

describe('PoteService — ordem sorteada por jogador', () => {
  it('cada jogador recebe a SUA ordem (diferente da dos outros) e ela é a mesma ao reconectar', async () => {
    const s = setup();
    const code = await startRound1(s);
    await s.service.tutorialDone(code, ANA);
    await s.service.tutorialDone(code, BIA);

    const ana: any = await s.service.getState(code, ANA);
    const bia: any = await s.service.getState(code, BIA);
    expect(ana.me.round1.currentItemId).toBe(orderOf(s, code, ANA)[0]);
    expect(bia.me.round1.currentItemId).toBe(orderOf(s, code, BIA)[0]);
    expect(orderOf(s, code, ANA)).not.toEqual(orderOf(s, code, BIA));

    const again: any = await s.service.getState(code, ANA);
    expect(again.me.round1.currentItemId).toBe(ana.me.round1.currentItemId);
  });

  it('o jogador só vê o que já passou (seen); o que vem por aí continua surpresa', async () => {
    const s = setup();
    const code = await startRound1(s);
    await s.service.tutorialDone(code, ANA);
    const order = orderOf(s, code, ANA);
    await s.service.round1Action(code, ANA, 0, 'PASS');
    const state: any = await s.service.round1Action(code, ANA, 1, 'PASS');

    expect(state.me.round1.seen).toEqual(order.slice(0, 2));
    expect(state.me.round1.currentItemId).toBe(order[2]);
    const future = order.slice(3).find((id) => ITEM_BY_ID[id].category !== 'PEDRA')!;
    expect(JSON.stringify(state.me)).not.toContain(future); // um item futuro não vaza
  });

  it('a resposta da ação já traz o próximo item (sem precisar de outro GET)', async () => {
    const s = setup();
    const code = await startRound1(s);
    await s.service.tutorialDone(code, ANA);
    const order = orderOf(s, code, ANA);
    const state: any = await s.service.round1Action(code, ANA, 0, 'PASS');
    expect(state.changed).toBe(true);
    expect(state.me.round1.index).toBe(1);
    expect(state.me.round1.currentItemId).toBe(order[1]);
    expect(state.version).toBeGreaterThan(0);
  });
});

describe('PoteService — poucas idas ao banco (velocidade)', () => {
  async function inRound2(s: ReturnType<typeof setup>) {
    const code = await startRound1(s);
    await s.service.changePhase(code, ADMIN, 'RESULT_1');
    await s.service.changePhase(code, ADMIN, 'PARABLE');
    await s.service.changePhase(code, ADMIN, 'ROUND_2');
    return code;
  }
  const clear = (s: ReturnType<typeof setup>) => {
    for (const table of Object.values(s.prisma) as Record<string, jest.Mock>[]) {
      for (const fn of Object.values(table)) if (jest.isMockFunction(fn)) fn.mockClear();
    }
  };

  it('um poll sem novidade custa UMA consulta (sala + jogadores juntos)', async () => {
    const s = setup();
    const code = await startRound1(s);
    const first: any = await s.service.getState(code, ANA);
    clear(s);

    const res: any = await s.service.getState(code, ANA, first.version);
    expect(res.changed).toBe(false);
    expect(s.prisma.poteRoom.findFirst).toHaveBeenCalledTimes(1);
    expect(s.prisma.potePlayer.findMany).not.toHaveBeenCalled();
    expect(s.prisma.potePlayer.findUnique).not.toHaveBeenCalled();
    expect(s.prisma.poteCommitment.findUnique).not.toHaveBeenCalled();
  });

  it('um poll COM novidade também é uma consulta só', async () => {
    const s = setup();
    const code = await startRound1(s);
    clear(s);
    await s.service.getState(code, ANA);
    expect(s.prisma.poteRoom.findFirst).toHaveBeenCalledTimes(1);
    expect(s.prisma.potePlayer.findMany).not.toHaveBeenCalled();
  });

  it('uma ação da rodada 2 = 1 leitura + 2 escritas (paralelas), nada de reler o estado', async () => {
    const s = setup();
    const code = await inRound2(s);
    clear(s);

    const state: any = await s.service.round2Place(code, ANA, 'oracao');
    expect(state.me.round2.placed).toEqual(['oracao']);
    expect(s.prisma.poteRoom.findFirst).toHaveBeenCalledTimes(1);
    expect(s.prisma.potePlayer.updateMany).toHaveBeenCalledTimes(1);
    expect(s.prisma.poteRoom.update).toHaveBeenCalledTimes(1);
    expect(s.prisma.potePlayer.findUnique).not.toHaveBeenCalled();
    expect(s.prisma.potePlayer.findMany).not.toHaveBeenCalled();
  });

  it('uma ação da rodada 1 também: 1 leitura + 2 escritas', async () => {
    const s = setup();
    const code = await startRound1(s);
    await s.service.tutorialDone(code, ANA);
    clear(s);

    await s.service.round1Action(code, ANA, 0, 'PASS');
    expect(s.prisma.poteRoom.findFirst).toHaveBeenCalledTimes(1);
    expect(s.prisma.potePlayer.updateMany).toHaveBeenCalledTimes(1);
    expect(s.prisma.poteRoom.update).toHaveBeenCalledTimes(1);
    expect(s.prisma.potePlayer.findUnique).not.toHaveBeenCalled();
  });

  it('ação repetida (idempotente) não escreve nada', async () => {
    const s = setup();
    const code = await inRound2(s);
    await s.service.round2Place(code, ANA, 'oracao');
    clear(s);
    await s.service.round2Place(code, ANA, 'oracao');
    expect(s.prisma.potePlayer.updateMany).not.toHaveBeenCalled();
    expect(s.prisma.poteRoom.update).not.toHaveBeenCalled();
  });
});

describe('PoteService — rodada 2 em lote (sync)', () => {
  async function inRound2(s: ReturnType<typeof setup>) {
    const code = await startRound1(s);
    await s.service.changePhase(code, ADMIN, 'RESULT_1');
    await s.service.changePhase(code, ADMIN, 'PARABLE');
    await s.service.changePhase(code, ADMIN, 'ROUND_2');
    return code;
  }
  const placedOf = (s: ReturnType<typeof setup>) =>
    s.db.players.find((p) => p.userId === ANA)!.round2Placed as string[];

  it('vários toques viram UM pedido: tudo entra de uma vez, na ordem pedida', async () => {
    const s = setup();
    const code = await inRound2(s);
    s.prisma.potePlayer.updateMany.mockClear();

    const state: any = await s.service.round2Sync(code, ANA, ['oracao', 'amigos', 'reels', 'missa']);
    expect(placedOf(s)).toEqual(['oracao', 'amigos', 'reels', 'missa']);
    expect(state.me.round2.placed).toEqual(['oracao', 'amigos', 'reels', 'missa']);
    expect(s.prisma.potePlayer.updateMany).toHaveBeenCalledTimes(1);
  });

  it('retirar cascalho/areia e adicionar outros no mesmo pedido', async () => {
    const s = setup();
    const code = await inRound2(s);
    await s.service.round2Sync(code, ANA, ['oracao', 'amigos', 'reels']);
    await s.service.round2Sync(code, ANA, ['oracao', 'reels', 'role']);
    expect(placedOf(s)).toEqual(['oracao', 'reels', 'role']);
  });

  it('pedra não sai: tirar uma pedra da lista → 409 e nada muda', async () => {
    const s = setup();
    const code = await inRound2(s);
    await s.service.round2Sync(code, ANA, ['oracao', 'missa']);
    await expect(s.service.round2Sync(code, ANA, ['missa'])).rejects.toBeInstanceOf(ConflictException);
    expect(placedOf(s)).toEqual(['oracao', 'missa']);
  });

  it('não dá para reordenar: os itens que ficam mantêm a ordem do servidor (sem forjar combo)', async () => {
    const s = setup();
    const code = await inRound2(s);
    await s.service.round2Sync(code, ANA, ['reels', 'oracao']);
    await s.service.round2Sync(code, ANA, ['oracao', 'reels', 'amigos']); // tenta pôr Oração na frente
    expect(placedOf(s)).toEqual(['reels', 'oracao', 'amigos']);
  });

  it('lista que não cabe → 409 NAO_CABE e nada é salvo', async () => {
    const s = setup();
    const code = await inRound2(s);
    await s.service.round2Sync(code, ANA, ['oracao']);
    const all = ['oracao', 'missa', 'familia', 'estudos', 'sono', 'amigos']; // 5 pedras + cascalho: cabe (vãos)
    await expect(s.service.round2Sync(code, ANA, all)).resolves.toBeDefined();
    const tooMuch = [...all, 'role', 'futebol', 'namoro', 'violao', 'praia', 'academia', 'livro', 'ejc'];
    const before = [...placedOf(s)];
    await expect(s.service.round2Sync(code, ANA, tooMuch)).rejects.toThrow('NAO_CABE');
    expect(placedOf(s)).toEqual(before);
  });

  it('item desconhecido ou repetido → 400', async () => {
    const s = setup();
    const code = await inRound2(s);
    await expect(s.service.round2Sync(code, ANA, ['nao_existe'])).rejects.toBeInstanceOf(BadRequestException);
    await expect(s.service.round2Sync(code, ANA, ['reels', 'reels'])).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a mesma lista de novo não escreve nada (idempotente)', async () => {
    const s = setup();
    const code = await inRound2(s);
    await s.service.round2Sync(code, ANA, ['oracao', 'reels']);
    s.prisma.potePlayer.updateMany.mockClear();
    await s.service.round2Sync(code, ANA, ['oracao', 'reels']);
    expect(s.prisma.potePlayer.updateMany).not.toHaveBeenCalled();
  });

  it('semana fechada ou sala pausada → 409', async () => {
    const s = setup();
    const code = await inRound2(s);
    await s.service.setPaused(code, ADMIN, true);
    await expect(s.service.round2Sync(code, ANA, ['reels'])).rejects.toThrow(/pausada/);
    await s.service.setPaused(code, ADMIN, false);
    await s.service.round2Finish(code, ANA);
    await expect(s.service.round2Sync(code, ANA, ['reels'])).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('PoteService — lista do líder estável', () => {
  it('a ordem dos jogadores não muda quando o banco devolve as linhas embaralhadas', async () => {
    const s = setup();
    const code = await newRoom(s, [ANA, BIA, OUTSIDER]);
    await s.service.join(code, ANA);
    await s.service.join(code, BIA);
    const names = (state: any) => state.players.map((p: any) => p.userId);

    const first: any = await s.service.getState(code, ADMIN);
    const order = names(first);
    expect(order).toHaveLength(3);

    for (let i = 0; i < 6; i++) {
      s.db.players.reverse(); // simula o banco devolvendo em outra ordem a cada leitura
      s.db.players.push(s.db.players.shift()!);
      const again: any = await s.service.getState(code, ADMIN);
      expect(names(again)).toEqual(order);
    }
  });
});

describe('PoteService — pausa e polling', () => {
  it('ação de jogador durante a pausa → 409 com mensagem; retomar libera', async () => {
    const s = setup();
    const code = await startRound1(s);
    await s.service.tutorialDone(code, ANA);
    await s.service.setPaused(code, ADMIN, true);
    await expect(s.service.round1Action(code, ANA, 0, 'TAKE')).rejects.toThrow(/pausada/);
    await s.service.setPaused(code, ADMIN, false);
    await expect(s.service.round1Action(code, ANA, 0, 'TAKE')).resolves.toBeDefined();
  });

  it('?since devolve {changed:false} se nada mudou e o estado completo se mudou', async () => {
    const s = setup();
    const code = await startRound1(s);
    const first: any = await s.service.getState(code, ANA);
    expect(first.changed).toBe(true);
    expect(await s.service.getState(code, ANA, first.version)).toEqual({
      changed: false,
      version: first.version,
    });
    await s.service.tutorialDone(code, ANA);
    const next: any = await s.service.getState(code, ANA, first.version);
    expect(next.changed).toBe(true);
    expect(next.version).toBeGreaterThan(first.version);
  });

  it('o GET atualiza lastSeenAt só a cada ~5 s (presença sem escrita a cada segundo)', async () => {
    const s = setup();
    const code = await startRound1(s);
    s.prisma.potePlayer.update.mockClear();
    await s.service.getState(code, ANA);
    await s.service.getState(code, ANA);
    await s.service.getState(code, ANA);
    expect(s.prisma.potePlayer.update).not.toHaveBeenCalled(); // join acabou de carimbar
    const ana = s.db.players.find((p) => p.userId === ANA)!;
    ana.lastSeenAt = new Date(Date.now() - 6000);
    await s.service.getState(code, ANA);
    expect(s.prisma.potePlayer.update).toHaveBeenCalledTimes(1);
  });

  it('o líder marca desconectado quem não bate há mais de ~8 s', async () => {
    const s = setup();
    const code = await startRound1(s);
    s.db.players.find((p) => p.userId === BIA)!.lastSeenAt = new Date(Date.now() - 20000);
    const leader: any = await s.service.getState(code, ADMIN);
    const byId = Object.fromEntries(leader.players.map((p: any) => [p.userId, p]));
    expect(byId[ANA].connected).toBe(true);
    expect(byId[BIA].connected).toBe(false);
  });
});

describe('PoteService — rodada 2', () => {
  async function toRound2(s: ReturnType<typeof setup>) {
    const code = await startRound1(s);
    await s.service.changePhase(code, ADMIN, 'RESULT_1');
    await s.service.changePhase(code, ADMIN, 'PARABLE');
    await s.service.changePhase(code, ADMIN, 'ROUND_2');
    return code;
  }

  it('começa com timer de 180 s e todos jogando', async () => {
    const s = setup();
    const code = await toRound2(s);
    const state: any = await s.service.getState(code, ANA);
    const left = new Date(state.room.round2EndsAt).getTime() - Date.now();
    expect(left).toBeGreaterThan(178_000);
    expect(left).toBeLessThanOrEqual(180_000);
    expect(state.me.round2.status).toBe('PLAYING');
  });

  it('cascalho e areia estão liberados desde o início; quem enche antes pode perder a 5ª pedra e recupera retirando', async () => {
    const s = setup();
    const code = await toRound2(s);
    await expect(s.service.round2Place(code, ANA, 'amigos')).resolves.toBeDefined();
    await expect(s.service.round2Place(code, ANA, 'reels')).resolves.toBeDefined(); // 7 usados

    for (const id of ROCK_IDS.slice(0, 4)) await s.service.round2Place(code, ANA, id);
    // sobram 13 livres: a 5ª pedra (20) não cabe
    await expect(s.service.round2Place(code, ANA, ROCK_IDS[4])).rejects.toThrow('NAO_CABE');

    // as pedras não saem, mas cascalho/areia sim: retirar libera o espaço
    await s.service.round2Remove(code, ANA, 'amigos');
    await s.service.round2Remove(code, ANA, 'reels');
    await expect(s.service.round2Place(code, ANA, ROCK_IDS[4])).resolves.toBeDefined();

    const state: any = await s.service.getState(code, ANA);
    expect(state.me.round2.rocksIn).toBe(5);
    expect(state.me.round2).not.toHaveProperty('unlocked');
  });

  it('com o pote cheio de cascalho e areia a pedra não cabe (20 livres); retirar libera', async () => {
    const s = setup();
    const code = await toRound2(s);
    const cascalhos = ['amigos', 'role', 'futebol', 'namoro', 'violao', 'praia', 'academia', 'livro', 'ejc', 'pastoral', 'avos', 'curso', 'cozinhar', 'quarto'];
    for (const id of cascalhos) await s.service.round2Place(code, ANA, id); // 70
    for (const id of ['reels', 'serie', 'feed', 'videogame', 'fofoca', 'youtube', 'stories', 'madrugada']) {
      await s.service.round2Place(code, ANA, id); // +16 = 86 usados, 14 livres
    }
    await expect(s.service.round2Place(code, ANA, 'oracao')).rejects.toThrow('NAO_CABE');

    await s.service.round2Remove(code, ANA, 'quarto');
    await s.service.round2Remove(code, ANA, 'cozinhar'); // 76 usados, 24 livres
    await expect(s.service.round2Place(code, ANA, 'oracao')).resolves.toBeDefined();
  });

  it('place é idempotente e pedra não pode ser retirada; cascalho/areia podem', async () => {
    const s = setup();
    const code = await toRound2(s);
    for (const id of ROCK_IDS) await s.service.round2Place(code, ANA, id);
    await s.service.round2Place(code, ANA, 'reels');
    await s.service.round2Place(code, ANA, 'reels');
    expect(s.db.players.find((p) => p.userId === ANA)!.round2Placed.filter((i: string) => i === 'reels')).toHaveLength(1);

    await expect(s.service.round2Remove(code, ANA, 'oracao')).rejects.toBeInstanceOf(
      ConflictException,
    );
    await s.service.round2Remove(code, ANA, 'reels');
    await s.service.round2Remove(code, ANA, 'reels'); // já saiu: idempotente
    expect(s.db.players.find((p) => p.userId === ANA)!.round2Placed).not.toContain('reels');
  });

  it('não cabe tudo: ao encher o pote, colocar mais → 409; retirar libera o espaço e recalcula o placar', async () => {
    const s = setup();
    const code = await toRound2(s);
    for (const id of ROCK_IDS) await s.service.round2Place(code, ANA, id);
    // 8 cascalhos = 40 exatos (o espaço para escolhas com as 5 pedras)
    const cascalhos = ['amigos', 'role', 'futebol', 'namoro', 'violao', 'praia', 'academia', 'livro'];
    for (const id of cascalhos) await s.service.round2Place(code, ANA, id);
    await expect(s.service.round2Place(code, ANA, 'reels')).rejects.toThrow('NAO_CABE');

    const full: any = await s.service.getState(code, ANA);
    expect(full.me.round2.spaceLeft).toBe(0);
    const lifeFull = full.me.round2.life;

    await s.service.round2Remove(code, ANA, 'livro'); // Vida 8
    const after: any = await s.service.getState(code, ANA);
    expect(after.me.round2.spaceLeft).toBe(5);
    expect(after.me.round2.life).toBe(lifeFull - 8);
    await expect(s.service.round2Place(code, ANA, 'reels')).resolves.toBeDefined();
  });

  it('combo some ao retirar um item da condição', async () => {
    const s = setup();
    const code = await toRound2(s);
    for (const id of ROCK_IDS) await s.service.round2Place(code, ANA, id);
    await s.service.round2Place(code, ANA, 'amigos');
    await s.service.round2Place(code, ANA, 'role');
    expect(((await s.service.getState(code, ANA)) as any).me.round2.combos).toContain('turma');
    await s.service.round2Remove(code, ANA, 'role');
    expect(((await s.service.getState(code, ANA)) as any).me.round2.combos).not.toContain('turma');
  });

  it('item desconhecido → 400', async () => {
    const s = setup();
    const code = await toRound2(s);
    await expect(s.service.round2Place(code, ANA, 'nao_existe')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('fechar a semana encerra a participação; depois, place → 409; finish é idempotente', async () => {
    const s = setup();
    const code = await toRound2(s);
    await s.service.round2Finish(code, ANA);
    await s.service.round2Finish(code, ANA);
    await expect(s.service.round2Place(code, ANA, 'oracao')).rejects.toBeInstanceOf(
      ConflictException,
    );
    const leader: any = await s.service.getState(code, ADMIN);
    expect(leader.stats.round2.finished).toBe(1);
  });

  it('pausa guarda o tempo restante e retomar recalcula o fim', async () => {
    const s = setup();
    const code = await toRound2(s);
    await s.service.setPaused(code, ADMIN, true);
    const paused: any = await s.service.getState(code, ANA);
    expect(paused.room.isPaused).toBe(true);
    expect(paused.room.round2EndsAt).toBeNull();
    expect(paused.room.round2RemainingMs).toBeGreaterThan(170_000);

    await s.service.setPaused(code, ADMIN, false);
    const resumed: any = await s.service.getState(code, ANA);
    expect(resumed.room.round2RemainingMs).toBeNull();
    expect(new Date(resumed.room.round2EndsAt).getTime() - Date.now()).toBeGreaterThan(170_000);
  });

  it('+1 minuto soma 60 s (rodando ou pausada); fora da rodada 2 → 409', async () => {
    const s = setup();
    const code = await toRound2(s);
    const before = s.db.rooms[0].round2EndsAt.getTime();
    await s.service.extend(code, ADMIN);
    expect(s.db.rooms[0].round2EndsAt.getTime() - before).toBe(60_000);

    await s.service.setPaused(code, ADMIN, true);
    const remaining = s.db.rooms[0].round2RemainingMs;
    await s.service.extend(code, ADMIN);
    expect(s.db.rooms[0].round2RemainingMs - remaining).toBe(60_000);

    const other = setup();
    const lobby = await newRoom(other);
    await expect(other.service.extend(lobby, ADMIN)).rejects.toBeInstanceOf(ConflictException);
  });

  it('timer zerado: o próximo GET já devolve FINAL e todos FINISHED', async () => {
    const s = setup();
    const code = await toRound2(s);
    s.db.rooms[0].round2EndsAt = new Date(Date.now() - 1000);

    const state: any = await s.service.getState(code, ANA);
    expect(state.room.phase).toBe('FINAL');
    expect(state.me.round2.status).toBe('FINISHED');
    expect(state.me.round2.classification).toBeTruthy();
  });

  it('com a sala pausada o timer não zera mesmo com o horário passado', async () => {
    const s = setup();
    const code = await toRound2(s);
    await s.service.setPaused(code, ADMIN, true);
    const state: any = await s.service.getState(code, ANA);
    expect(state.room.phase).toBe('ROUND_2');
  });

  it('encerrar a rodada 2 manualmente deixa o pote como está e vai para FINAL', async () => {
    const s = setup();
    const code = await toRound2(s);
    await s.service.round2Place(code, ANA, 'oracao');
    await s.service.changePhase(code, ADMIN, 'FINAL');
    expect(s.db.players.find((p) => p.userId === ANA)).toMatchObject({
      statusRound2: 'FINISHED',
      round2Placed: ['oracao'],
    });
  });
});

describe('PoteService — compromisso e estatísticas', () => {
  async function toFinal(s: ReturnType<typeof setup>) {
    const code = await startRound1(s);
    await s.service.changePhase(code, ADMIN, 'RESULT_1');
    await s.service.changePhase(code, ADMIN, 'PARABLE');
    await s.service.changePhase(code, ADMIN, 'ROUND_2');
    await s.service.changePhase(code, ADMIN, 'FINAL');
    return code;
  }

  it('salva o compromisso, e salvar de novo atualiza em vez de duplicar', async () => {
    const s = setup();
    const code = await toFinal(s);
    await s.service.saveCommitment(code, ANA, 'Rezar antes do celular');
    await s.service.saveCommitment(code, ANA, 'Rezar 10 minutos');
    expect(s.db.commitments).toHaveLength(1);
    expect(s.db.commitments[0].text).toBe('Rezar 10 minutos');
    // o campo saiu da tela: o estado do jogador não carrega mais o compromisso (economiza uma consulta)
    expect(((await s.service.getState(code, ANA)) as any).me.commitment).toBeNull();
  });

  it('compromisso fora da fase FINAL → 409', async () => {
    const s = setup();
    const code = await startRound1(s);
    await expect(s.service.saveCommitment(code, ANA, 'x')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('o líder vê estatísticas agregadas: comparativo de pedras R1 × R2 e classificações', async () => {
    const s = setup();
    const code = await startRound1(s);
    await playRound1(s, code, ANA); // pega tudo → 3 pedras
    await playRound1(s, code, BIA, false); // passa tudo → 0 pedras
    await s.service.changePhase(code, ADMIN, 'RESULT_1');
    await s.service.changePhase(code, ADMIN, 'PARABLE');
    await s.service.changePhase(code, ADMIN, 'ROUND_2');
    for (const id of ROCK_IDS) await s.service.round2Place(code, ANA, id);
    await s.service.changePhase(code, ADMIN, 'FINAL');

    const leader: any = await s.service.getState(code, ADMIN);
    expect(leader.stats.round1.finished).toBe(2);
    expect(leader.stats.round1.withAllRocks).toBe(0);
    expect(leader.stats.round1.mostMissedRock.count).toBe(2); // Missa ou Oração, as duas faltaram nos dois
    expect(leader.stats.round2.withAllRocks).toBe(1);
    const total = Object.values(leader.stats.classifications as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(total).toBe(2);
    expect(leader.joinedCount).toBe(2);
  });
});
