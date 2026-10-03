import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  ITEM_BY_ID,
  ROUND1_LENGTH,
  ROUND2_DEFAULT_SECONDS,
  ROUND2_EXTEND_SECONDS,
} from './domain/catalog';
import { buildRound1Order } from './domain/order';
import { canPlace, deriveJar } from './domain/rules';
import {
  buildLeaderView,
  buildPlayerState,
  buildRoomView,
  type PhaseName,
  type PlayerRow,
  type RoomRow,
} from './pote.view';

const INACTIVE: PhaseName[] = ['ENDED', 'CANCELLED'];
const NEXT_PHASE: Partial<Record<PhaseName, PhaseName>> = {
  LOBBY: 'ROUND_1',
  ROUND_1: 'RESULT_1',
  RESULT_1: 'PARABLE',
  PARABLE: 'ROUND_2',
  ROUND_2: 'FINAL',
  FINAL: 'ENDED',
};
/** Convites só fazem sentido enquanto o jogo não chegou ao FINAL. */
const INVITABLE: PhaseName[] = ['LOBBY', 'ROUND_1', 'RESULT_1', 'PARABLE', 'ROUND_2'];

/** No máximo uma escrita de presença a cada tanto por jogador. */
const SEEN_WRITE_INTERVAL_MS = 5000;
const INVITE_MAX_TTL_MS = 12 * 60 * 60 * 1000;
const CODE_ATTEMPTS = 30;

type Player = PlayerRow & { id: string; roomId: string };
/** A sala já vem com TODOS os jogadores (uma consulta só): dá para montar tudo em memória. */
type Room = RoomRow & { id: string; leaderId: string; createdAt: Date; players: Player[] };

const firstName = (name: string | null | undefined) =>
  (name ?? '').trim().split(/\s+/)[0] || 'Jogador';

@Injectable()
export class PoteService {
  constructor(private readonly prisma: PrismaService) {}

  // ───────────────────────── salas (admin) ─────────────────────────

  async createRoom(leaderId: string) {
    for (let i = 0; i < CODE_ATTEMPTS; i++) {
      const code = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
      const clash = await this.prisma.poteRoom.findFirst({
        where: { code, phase: { notIn: INACTIVE as any } },
        select: { id: true },
      });
      if (clash) continue;
      const room = await this.prisma.poteRoom.create({
        data: { code, leaderId },
        select: { code: true },
      });
      return { code: room.code };
    }
    throw new ConflictException('Não foi possível gerar um código de sala. Tente de novo.');
  }

  async listMine(leaderId: string) {
    const rooms = await this.prisma.poteRoom.findMany({
      where: { leaderId, phase: { notIn: INACTIVE as any } },
      orderBy: { createdAt: 'desc' },
      select: { code: true, phase: true, createdAt: true, _count: { select: { players: true } } },
    });
    return rooms.map((r) => ({
      code: r.code,
      phase: r.phase,
      createdAt: r.createdAt,
      invited: r._count.players,
    }));
  }

  async searchUsers(adminId: string, q: string) {
    const term = (q ?? '').trim();
    if (term.length < 2) throw new BadRequestException('Digite ao menos 2 caracteres.');
    return this.prisma.user.findMany({
      where: {
        id: { not: adminId },
        OR: [
          { name: { contains: term, mode: 'insensitive' } },
          { email: { contains: term, mode: 'insensitive' } },
        ],
      },
      orderBy: { name: 'asc' },
      take: 20,
      select: { id: true, name: true, email: true },
    });
  }

  async invite(code: string, leaderId: string, userIds: string[]) {
    const room = await this.requireLeaderRoom(code, leaderId);
    this.assertActive(room);
    if (!INVITABLE.includes(room.phase)) {
      throw new ConflictException('Esta sala já chegou ao fim; não dá mais para convidar.');
    }

    const ids = [...new Set(userIds)].filter((id) => id !== leaderId);
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    const existing = await this.prisma.potePlayer.findMany({
      where: { roomId: room.id, userId: { in: users.map((u) => u.id) } },
      select: { userId: true, removed: true },
    });
    const existingById = new Map(existing.map((p) => [p.userId, p]));

    const fresh = users.filter((u) => !existingById.has(u.id));
    const readmitted = users.filter((u) => existingById.get(u.id)?.removed === true);
    const alreadyInvited = users.length - fresh.length - readmitted.length;

    if (fresh.length > 0) {
      await this.prisma.potePlayer.createMany({
        data: fresh.map((u) => ({
          roomId: room.id,
          userId: u.id,
          displayName: firstName(u.name),
        })),
        skipDuplicates: true,
      });
    }
    if (readmitted.length > 0) {
      await this.prisma.potePlayer.updateMany({
        where: { roomId: room.id, userId: { in: readmitted.map((u) => u.id) } },
        data: { removed: false },
      });
    }

    const toNotify = [...fresh, ...readmitted];
    if (toNotify.length > 0) {
      const leader = await this.prisma.user.findUnique({
        where: { id: leaderId },
        select: { name: true },
      });
      // Só o sino: nenhum push. Expira no máximo em 12 h (a sala é de uma noite).
      await this.prisma.notification.createMany({
        data: toNotify.map((u) => ({
          userId: u.id,
          title: 'Convite: O Pote',
          body: `${firstName(leader?.name)} te convidou para uma dinâmica. Toque para entrar.`,
          url: `/oratio/dinamicas/pote/${room.code}`,
          source: 'CAMPAIGN' as const,
          expiresAt: new Date(Date.now() + INVITE_MAX_TTL_MS),
        })),
      });
      await this.bump(room.id);
    }

    return { invited: toNotify.length, alreadyInvited };
  }

  // ───────────────────────── estado (GET) ─────────────────────────

  async getState(code: string, userId: string, since?: number) {
    let room = await this.findRoom(code);
    room = await this.syncTimers(room);
    const now = new Date();

    if (room.leaderId === userId) {
      return {
        changed: true,
        version: room.version,
        role: 'LEADER' as const,
        room: buildRoomView(room, now),
        ...buildLeaderView(room.players, now),
      };
    }

    const player = room.players.find((p) => p.userId === userId);
    if (!player) throw new ForbiddenException('Você não foi convidado para esta dinâmica.');
    if (player.removed) {
      return {
        changed: true,
        version: room.version,
        role: 'PLAYER' as const,
        removed: true,
        room: buildRoomView(room, now),
      };
    }

    // Presença: escrita em segundo plano (o jogador não espera por ela).
    if (
      player.joinedAt &&
      (!player.lastSeenAt || now.getTime() - player.lastSeenAt.getTime() > SEEN_WRITE_INTERVAL_MS)
    ) {
      void Promise.resolve(
        this.prisma.potePlayer.update({ where: { id: player.id }, data: { lastSeenAt: now } }),
      ).catch(() => undefined);
    }

    if (since !== undefined && room.version <= since) {
      return { changed: false, version: room.version };
    }

    return buildPlayerState(room, room.players, userId, now, this.orderFor(room, userId));
  }

  async join(code: string, userId: string) {
    let room = await this.findRoom(code);
    room = await this.syncTimers(room);
    this.assertActive(room);
    const player = room.players.find((p) => p.userId === userId);
    if (!player) throw new ForbiddenException('Você não foi convidado para esta dinâmica.');
    if (player.removed) throw new ForbiddenException('Você foi removido da sala.');

    const changes: Partial<Player> = {};
    if (!player.joinedAt) changes.joinedAt = new Date();
    // Entrada tardia: ROUND_1 → tutorial e joga; ROUND_2 → direto na rodada 2.
    if (room.phase === 'ROUND_1' && player.statusRound1 === 'WAITING') {
      changes.statusRound1 = 'IN_TUTORIAL';
    }
    if (room.phase === 'ROUND_2' && player.statusRound2 === 'WAITING') {
      changes.statusRound2 = 'PLAYING';
    }
    if (Object.keys(changes).length === 0) {
      return this.respond(room, player, {}, userId);
    }
    changes.lastSeenAt = new Date();
    const [, bumped] = await Promise.all([
      this.prisma.potePlayer.update({ where: { id: player.id }, data: changes as never }),
      this.bump(room.id),
    ]);
    return this.respond({ ...room, version: bumped.version }, player, changes, userId);
  }

  // ───────────────────────── controles do líder ─────────────────────────

  async changePhase(code: string, leaderId: string, to: PhaseName) {
    let room = await this.requireLeaderRoom(code, leaderId);
    room = await this.syncTimers(room);
    this.assertActive(room);

    if (to === 'CANCELLED') {
      await this.prisma.poteRoom.update({
        where: { id: room.id },
        data: { phase: 'CANCELLED', isPaused: false, version: { increment: 1 } },
      });
      return this.getState(code, leaderId);
    }

    if (room.isPaused) throw new ConflictException('A sala está pausada. Retome antes de avançar.');
    if (NEXT_PHASE[room.phase] !== to) {
      throw new ConflictException(`Transição inválida: ${room.phase} → ${to}.`);
    }

    const roomData: Record<string, unknown> = { phase: to, version: { increment: 1 } };
    const activeWhere = { roomId: room.id, joinedAt: { not: null }, removed: false };

    if (to === 'ROUND_1') {
      const joined = await this.prisma.potePlayer.count({ where: activeWhere });
      if (joined < 1) throw new ConflictException('Ninguém entrou na sala ainda.');
      await this.prisma.potePlayer.updateMany({
        where: { ...activeWhere, statusRound1: 'WAITING' },
        data: { statusRound1: 'IN_TUTORIAL' },
      });
    } else if (to === 'RESULT_1') {
      // Itens que ainda não apareceram contam como "deixados passar".
      await this.prisma.potePlayer.updateMany({
        where: { ...activeWhere, statusRound1: { in: ['IN_TUTORIAL', 'PLAYING'] } },
        data: { statusRound1: 'FINISHED', round1Index: ROUND1_LENGTH },
      });
    } else if (to === 'ROUND_2') {
      await this.prisma.potePlayer.updateMany({
        where: { ...activeWhere, statusRound2: 'WAITING' },
        data: { statusRound2: 'PLAYING' },
      });
      roomData.round2EndsAt = new Date(Date.now() + ROUND2_DEFAULT_SECONDS * 1000);
      roomData.round2RemainingMs = null;
    } else if (to === 'FINAL') {
      await this.finishRound2Players(room.id);
      roomData.round2EndsAt = null;
      roomData.round2RemainingMs = null;
    }

    await this.prisma.poteRoom.update({ where: { id: room.id }, data: roomData });
    return this.getState(code, leaderId);
  }

  async setPaused(code: string, leaderId: string, paused: boolean) {
    let room = await this.requireLeaderRoom(code, leaderId);
    room = await this.syncTimers(room);
    this.assertActive(room);
    if (room.isPaused === paused) return this.getState(code, leaderId);

    const data: Record<string, unknown> = { isPaused: paused, version: { increment: 1 } };
    if (room.phase === 'ROUND_2') {
      if (paused) {
        const remaining = room.round2EndsAt ? room.round2EndsAt.getTime() - Date.now() : 0;
        data.round2RemainingMs = Math.max(0, remaining);
        data.round2EndsAt = null;
      } else {
        data.round2EndsAt = new Date(Date.now() + (room.round2RemainingMs ?? 0));
        data.round2RemainingMs = null;
      }
    }
    await this.prisma.poteRoom.update({ where: { id: room.id }, data });
    return this.getState(code, leaderId);
  }

  async extend(code: string, leaderId: string) {
    let room = await this.requireLeaderRoom(code, leaderId);
    room = await this.syncTimers(room);
    this.assertActive(room);
    if (room.phase !== 'ROUND_2') {
      throw new ConflictException('Só dá para somar tempo durante a rodada 2.');
    }
    const extra = ROUND2_EXTEND_SECONDS * 1000;
    const data: Record<string, unknown> = { version: { increment: 1 } };
    if (room.isPaused) {
      data.round2RemainingMs = (room.round2RemainingMs ?? 0) + extra;
    } else {
      data.round2EndsAt = new Date((room.round2EndsAt?.getTime() ?? Date.now()) + extra);
    }
    await this.prisma.poteRoom.update({ where: { id: room.id }, data });
    return this.getState(code, leaderId);
  }

  async removePlayer(code: string, leaderId: string, targetUserId: string) {
    const room = await this.requireLeaderRoom(code, leaderId);
    this.assertActive(room);
    const result = await this.prisma.potePlayer.updateMany({
      where: { roomId: room.id, userId: targetUserId },
      data: { removed: true },
    });
    if (result.count === 0) throw new NotFoundException('Jogador não encontrado nesta sala.');
    await this.bump(room.id);
    return this.getState(code, leaderId);
  }

  async cancel(code: string, leaderId: string) {
    return this.changePhase(code, leaderId, 'CANCELLED');
  }

  // ───────────────────────── rodada 1 ─────────────────────────

  async tutorialDone(code: string, userId: string) {
    const { room, player } = await this.actionContext(code, userId, 'ROUND_1');
    if (player.statusRound1 === 'PLAYING') return this.respond(room, player, {}, userId);
    if (player.statusRound1 !== 'IN_TUTORIAL') {
      throw new ConflictException('Você não está no tutorial.');
    }
    const done = await this.writeAndRespond(
      room,
      player,
      { id: player.id, statusRound1: 'IN_TUTORIAL' },
      { statusRound1: 'PLAYING' },
      { statusRound1: 'PLAYING' },
      userId,
    );
    return done ?? this.getState(code, userId);
  }

  async round1Action(code: string, userId: string, index: number, action: 'TAKE' | 'PASS') {
    const { room, player } = await this.actionContext(code, userId, 'ROUND_1');

    // Duplo toque / retry de rede: índice já processado → idempotente.
    if (index < player.round1Index) return this.respond(room, player, {}, userId);
    if (player.statusRound1 !== 'PLAYING') {
      throw new ConflictException('Você não está jogando a rodada 1.');
    }
    if (index > player.round1Index) {
      throw new ConflictException('Ação fora de ordem.');
    }

    // O item da vez vem da ordem SORTEADA deste jogador (cada pessoa tem a sua).
    const item = ITEM_BY_ID[this.orderFor(room, userId)[index]];
    let placed = player.round1Placed;
    if (action === 'TAKE') {
      const jar = deriveJar(player.round1Placed);
      if (!canPlace(jar, item.category)) throw new ConflictException('NAO_CABE');
      placed = [...player.round1Placed, item.id];
    }

    const next = index + 1;
    const statusRound1 = next >= ROUND1_LENGTH ? 'FINISHED' : 'PLAYING';
    const done = await this.writeAndRespond(
      room,
      player,
      // Trava otimista: só avança se ninguém avançou nesse meio tempo.
      { id: player.id, round1Index: index, statusRound1: 'PLAYING' },
      { round1Index: next, round1Placed: { set: placed }, statusRound1 },
      { round1Index: next, round1Placed: placed, statusRound1 },
      userId,
    );
    return done ?? this.getState(code, userId);
  }

  // ───────────────────────── rodada 2 ─────────────────────────

  async round2Place(code: string, userId: string, itemId: string) {
    const item = ITEM_BY_ID[itemId];
    if (!item) throw new BadRequestException('Item desconhecido.');
    return this.round2Mutate(code, userId, (placed) => {
      if (placed.includes(itemId)) return null; // já está: idempotente
      // Sem bloqueio por categoria: cascalho e areia entram desde o início. Quem
      // decide se cabe é só o pote (a pedra exige 20 livres; o resto usa os vãos).
      if (!canPlace(deriveJar(placed), item.category)) {
        throw new ConflictException('NAO_CABE');
      }
      return [...placed, itemId];
    });
  }

  /**
   * Define o pote da rodada 2 de uma vez: o cliente manda a lista que QUER ter e o
   * servidor valida tudo junto (1 pedido em vez de um por toque — o que mais pesava
   * quando o servidor está lento). Regras: só ids conhecidos e sem repetir; as pedras
   * já colocadas não saem; os itens que ficam mantêm a ordem do servidor e os novos
   * entram no fim (o cliente não consegue reordenar para forjar um combo); a lista
   * final precisa caber no pote.
   */
  async round2Sync(code: string, userId: string, wanted: string[]) {
    if (new Set(wanted).size !== wanted.length || wanted.some((id) => !ITEM_BY_ID[id])) {
      throw new BadRequestException('Lista de itens inválida.');
    }
    return this.round2Mutate(code, userId, (old) => {
      const wantedSet = new Set(wanted);
      const oldSet = new Set(old);
      if (old.some((id) => ITEM_BY_ID[id].category === 'PEDRA' && !wantedSet.has(id))) {
        throw new ConflictException('As pedras não saem do pote.');
      }
      const final = [
        ...old.filter((id) => wantedSet.has(id)),
        ...wanted.filter((id) => !oldSet.has(id)),
      ];
      if (final.length === old.length && final.every((id, i) => id === old[i])) return null;
      try {
        deriveJar(final);
      } catch {
        throw new ConflictException('NAO_CABE');
      }
      return final;
    });
  }

  async round2Remove(code: string, userId: string, itemId: string) {
    const item = ITEM_BY_ID[itemId];
    if (!item) throw new BadRequestException('Item desconhecido.');
    if (item.category === 'PEDRA') {
      throw new ConflictException('As pedras não saem do pote.');
    }
    return this.round2Mutate(code, userId, (placed) => {
      if (!placed.includes(itemId)) return null; // já não está: idempotente
      return placed.filter((id) => id !== itemId);
    });
  }

  async round2Finish(code: string, userId: string) {
    const { room, player } = await this.actionContext(code, userId, 'ROUND_2');
    if (player.statusRound2 === 'FINISHED') return this.respond(room, player, {}, userId);
    const done = await this.writeAndRespond(
      room,
      player,
      { id: player.id, statusRound2: 'PLAYING' },
      { statusRound2: 'FINISHED' },
      { statusRound2: 'FINISHED' },
      userId,
    );
    return done ?? this.getState(code, userId);
  }

  // ───────────────────────── compromisso ─────────────────────────

  async saveCommitment(code: string, userId: string, text: string) {
    const { room } = await this.actionContext(code, userId, 'FINAL');
    await this.prisma.poteCommitment.upsert({
      where: { roomId_userId: { roomId: room.id, userId } },
      create: { roomId: room.id, userId, text },
      update: { text },
    });
    await this.bump(room.id);
    return this.getState(code, userId);
  }

  // ───────────────────────── internos ─────────────────────────

  /** Aplica uma mudança na lista da rodada 2, com trava otimista e até 3 tentativas. */
  private async round2Mutate(
    code: string,
    userId: string,
    change: (placed: string[]) => string[] | null,
  ) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { room, player } = await this.actionContext(code, userId, 'ROUND_2');
      if (player.statusRound2 !== 'PLAYING') {
        throw new ConflictException('Sua semana já foi fechada.');
      }
      const next = change(player.round2Placed);
      if (next === null) return this.respond(room, player, {}, userId);

      const done = await this.writeAndRespond(
        room,
        player,
        { id: player.id, statusRound2: 'PLAYING', round2Placed: { equals: player.round2Placed } },
        { round2Placed: { set: next } },
        { round2Placed: next },
        userId,
      );
      if (done) return done;
    }
    throw new ConflictException('Muitas ações ao mesmo tempo. Tente de novo.');
  }

  /**
   * Contexto comum das ações de jogador: sala ativa, na fase certa, sem pausa,
   * e o jogador convidado, que já entrou e não foi removido. UMA consulta (a sala
   * já traz os jogadores); o resto é memória.
   */
  private async actionContext(code: string, userId: string, phase: PhaseName) {
    let room = await this.findRoom(code);
    room = await this.syncTimers(room);
    this.assertActive(room);
    if (room.isPaused) throw new ConflictException('A sala está pausada pelo líder.');
    if (room.phase !== phase) {
      throw new ConflictException(`Esta ação não vale na fase ${room.phase}.`);
    }
    const player = room.players.find((p) => p.userId === userId);
    if (!player) throw new ForbiddenException('Você não foi convidado para esta dinâmica.');
    if (player.removed) throw new ForbiddenException('Você foi removido da sala.');
    if (!player.joinedAt) throw new ForbiddenException('Entre na sala primeiro.');
    return { room, player };
  }

  /** Ordem sorteada da rodada 1 deste jogador (determinística: sala + usuário). */
  private orderFor(room: Room, userId: string): string[] {
    return buildRound1Order(`${room.id}:${userId}`);
  }

  /** Estado que o jogador recebe, montado em memória com as mudanças já aplicadas a ele. */
  private respond(room: Room, player: Player, changes: Partial<Player>, userId: string) {
    const players = room.players.map((p) => (p.id === player.id ? { ...p, ...changes } : p));
    return buildPlayerState(room, players, userId, new Date(), this.orderFor(room, userId));
  }

  /**
   * Grava a mudança do jogador e sobe a versão da sala EM PARALELO (2 idas ao banco
   * ao mesmo tempo, não uma depois da outra) e já devolve o estado montado em memória
   * — sem reler nada. `null` = a trava otimista não casou (alguém mexeu antes).
   */
  private async writeAndRespond(
    room: Room,
    player: Player,
    where: Record<string, unknown>,
    data: Record<string, unknown>,
    changes: Partial<Player>,
    userId: string,
  ) {
    const [result, bumped] = await Promise.all([
      this.prisma.potePlayer.updateMany({ where, data }),
      this.bump(room.id),
    ]);
    if (result.count === 0) return null;
    return this.respond({ ...room, version: bumped.version }, player, changes, userId);
  }

  /** Código → sala mais recente com esse código, JÁ com todos os jogadores (1 consulta). */
  private async findRoom(code: string): Promise<Room> {
    const room = (await this.prisma.poteRoom.findFirst({
      where: { code },
      orderBy: { createdAt: 'desc' },
      include: { players: { orderBy: [{ invitedAt: 'asc' }, { id: 'asc' }] } },
    })) as Room | null;
    if (!room) throw new NotFoundException('Sala não encontrada.');
    return room;
  }

  private async requireLeaderRoom(code: string, userId: string): Promise<Room> {
    const room = await this.findRoom(code);
    if (room.leaderId !== userId) {
      throw new ForbiddenException('Só quem criou a sala pode fazer isso.');
    }
    return room;
  }

  private assertActive(room: Room) {
    if (INACTIVE.includes(room.phase)) {
      throw new ConflictException('Esta sala já foi encerrada.');
    }
  }

  private bump(roomId: string) {
    return this.prisma.poteRoom.update({
      where: { id: roomId },
      data: { version: { increment: 1 } },
    });
  }

  private finishRound2Players(roomId: string) {
    return this.prisma.potePlayer.updateMany({
      where: {
        roomId,
        joinedAt: { not: null },
        removed: false,
        statusRound2: 'PLAYING',
      },
      data: { statusRound2: 'FINISHED' },
    });
  }

  /**
   * Fim da rodada 2 por tempo: verificação "lazy" a cada leitura/ação (o
   * polling de 1 s garante que isso acontece quase na hora; sem job agendado).
   * O guard `phase: 'ROUND_2'` no updateMany deixa chamadas concorrentes seguras.
   */
  private async syncTimers(room: Room): Promise<Room> {
    if (
      room.phase !== 'ROUND_2' ||
      room.isPaused ||
      !room.round2EndsAt ||
      room.round2EndsAt.getTime() > Date.now()
    ) {
      return room;
    }
    await this.finishRound2Players(room.id);
    await this.prisma.poteRoom.updateMany({
      where: { id: room.id, phase: 'ROUND_2' },
      data: {
        phase: 'FINAL',
        round2EndsAt: null,
        round2RemainingMs: null,
        version: { increment: 1 },
      },
    });
    return this.findRoom(room.code);
  }
}
