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
  ROCK_IDS,
  ROUND1_LENGTH,
  ROUND1_SEQUENCE,
  ROUND2_DEFAULT_SECONDS,
  ROUND2_EXTEND_SECONDS,
} from './domain/catalog';
import { canPlace, deriveJar } from './domain/rules';
import {
  buildLeaderView,
  buildPlayerView,
  buildRoomView,
  isActivePlayer,
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

type Room = RoomRow & { id: string; leaderId: string; createdAt: Date };
type Player = PlayerRow & { id: string; roomId: string };

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
      const players = await this.prisma.potePlayer.findMany({ where: { roomId: room.id } });
      return {
        changed: true,
        version: room.version,
        role: 'LEADER' as const,
        room: buildRoomView(room, now),
        ...buildLeaderView(players as unknown as PlayerRow[], now),
      };
    }

    const player = (await this.prisma.potePlayer.findUnique({
      where: { roomId_userId: { roomId: room.id, userId } },
    })) as Player | null;
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

    if (
      player.joinedAt &&
      (!player.lastSeenAt || now.getTime() - player.lastSeenAt.getTime() > SEEN_WRITE_INTERVAL_MS)
    ) {
      await this.prisma.potePlayer.update({ where: { id: player.id }, data: { lastSeenAt: now } });
    }

    if (since !== undefined && room.version <= since) {
      return { changed: false, version: room.version };
    }

    const [others, commitment] = await Promise.all([
      this.prisma.potePlayer.findMany({
        where: { roomId: room.id },
        select: { joinedAt: true, removed: true, statusRound1: true, statusRound2: true },
      }),
      this.prisma.poteCommitment.findUnique({
        where: { roomId_userId: { roomId: room.id, userId } },
        select: { text: true },
      }),
    ]);
    const active = others.filter(isActivePlayer);

    return {
      changed: true,
      version: room.version,
      role: 'PLAYER' as const,
      room: buildRoomView(room, now),
      me: buildPlayerView(player, room.phase, commitment?.text ?? null),
      progress: {
        total: active.length,
        round1Finished: active.filter((p) => p.statusRound1 === 'FINISHED').length,
        round2Finished: active.filter((p) => p.statusRound2 === 'FINISHED').length,
      },
    };
  }

  async join(code: string, userId: string) {
    let room = await this.findRoom(code);
    room = await this.syncTimers(room);
    this.assertActive(room);
    const player = (await this.prisma.potePlayer.findUnique({
      where: { roomId_userId: { roomId: room.id, userId } },
    })) as Player | null;
    if (!player) throw new ForbiddenException('Você não foi convidado para esta dinâmica.');
    if (player.removed) throw new ForbiddenException('Você foi removido da sala.');

    const data: Record<string, unknown> = {};
    if (!player.joinedAt) data.joinedAt = new Date();
    // Entrada tardia: ROUND_1 → tutorial e joga; ROUND_2 → direto na rodada 2.
    if (room.phase === 'ROUND_1' && player.statusRound1 === 'WAITING') {
      data.statusRound1 = 'IN_TUTORIAL';
    }
    if (room.phase === 'ROUND_2' && player.statusRound2 === 'WAITING') {
      data.statusRound2 = 'PLAYING';
    }
    if (Object.keys(data).length > 0) {
      data.lastSeenAt = new Date();
      await this.prisma.potePlayer.update({ where: { id: player.id }, data });
      await this.bump(room.id);
    }
    return this.getState(code, userId);
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
    if (player.statusRound1 === 'PLAYING') return this.getState(code, userId);
    if (player.statusRound1 !== 'IN_TUTORIAL') {
      throw new ConflictException('Você não está no tutorial.');
    }
    await this.prisma.potePlayer.updateMany({
      where: { id: player.id, statusRound1: 'IN_TUTORIAL' },
      data: { statusRound1: 'PLAYING' },
    });
    await this.bump(room.id);
    return this.getState(code, userId);
  }

  async round1Action(code: string, userId: string, index: number, action: 'TAKE' | 'PASS') {
    const { room, player } = await this.actionContext(code, userId, 'ROUND_1');

    // Duplo toque / retry de rede: índice já processado → idempotente.
    if (index < player.round1Index) return this.getState(code, userId);
    if (player.statusRound1 !== 'PLAYING') {
      throw new ConflictException('Você não está jogando a rodada 1.');
    }
    if (index > player.round1Index) {
      throw new ConflictException('Ação fora de ordem.');
    }

    const item = ROUND1_SEQUENCE[index];
    let placed = player.round1Placed;
    if (action === 'TAKE') {
      const jar = deriveJar(player.round1Placed);
      if (!canPlace(jar, item.category)) throw new ConflictException('NAO_CABE');
      placed = [...player.round1Placed, item.id];
    }

    const next = index + 1;
    const result = await this.prisma.potePlayer.updateMany({
      // Trava otimista: só avança se ninguém avançou nesse meio tempo.
      where: { id: player.id, round1Index: index, statusRound1: 'PLAYING' },
      data: {
        round1Index: next,
        round1Placed: { set: placed },
        statusRound1: next >= ROUND1_LENGTH ? 'FINISHED' : 'PLAYING',
      },
    });
    if (result.count > 0) await this.bump(room.id);
    return this.getState(code, userId);
  }

  // ───────────────────────── rodada 2 ─────────────────────────

  async round2Place(code: string, userId: string, itemId: string) {
    const item = ITEM_BY_ID[itemId];
    if (!item) throw new BadRequestException('Item desconhecido.');
    return this.round2Mutate(code, userId, (placed) => {
      if (placed.includes(itemId)) return null; // já está: idempotente
      if (item.category !== 'PEDRA' && !ROCK_IDS.every((id) => placed.includes(id))) {
        throw new ConflictException('PEDRAS_PRIMEIRO');
      }
      if (!canPlace(deriveJar(placed), item.category)) {
        throw new ConflictException('NAO_CABE');
      }
      return [...placed, itemId];
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
    if (player.statusRound2 === 'FINISHED') return this.getState(code, userId);
    await this.prisma.potePlayer.updateMany({
      where: { id: player.id, statusRound2: 'PLAYING' },
      data: { statusRound2: 'FINISHED' },
    });
    await this.bump(room.id);
    return this.getState(code, userId);
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
      if (next === null) return this.getState(code, userId);

      const result = await this.prisma.potePlayer.updateMany({
        where: {
          id: player.id,
          statusRound2: 'PLAYING',
          round2Placed: { equals: player.round2Placed },
        },
        data: { round2Placed: { set: next } },
      });
      if (result.count > 0) {
        await this.bump(room.id);
        return this.getState(code, userId);
      }
    }
    throw new ConflictException('Muitas ações ao mesmo tempo. Tente de novo.');
  }

  /**
   * Contexto comum das ações de jogador: sala ativa, na fase certa, sem pausa,
   * e o jogador convidado, que já entrou e não foi removido.
   */
  private async actionContext(code: string, userId: string, phase: PhaseName) {
    let room = await this.findRoom(code);
    room = await this.syncTimers(room);
    this.assertActive(room);
    if (room.isPaused) throw new ConflictException('A sala está pausada pelo líder.');
    if (room.phase !== phase) {
      throw new ConflictException(`Esta ação não vale na fase ${room.phase}.`);
    }
    const player = (await this.prisma.potePlayer.findUnique({
      where: { roomId_userId: { roomId: room.id, userId } },
    })) as Player | null;
    if (!player) throw new ForbiddenException('Você não foi convidado para esta dinâmica.');
    if (player.removed) throw new ForbiddenException('Você foi removido da sala.');
    if (!player.joinedAt) throw new ForbiddenException('Entre na sala primeiro.');
    return { room, player };
  }

  /** Código → sala mais recente com esse código (códigos de salas encerradas são reaproveitados). */
  private async findRoom(code: string): Promise<Room> {
    const room = (await this.prisma.poteRoom.findFirst({
      where: { code },
      orderBy: { createdAt: 'desc' },
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
