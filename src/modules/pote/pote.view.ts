// Montagem das "visões" que o GET devolve. Funções puras sobre linhas do banco
// (sem Prisma, sem Nest) — nunca incluem e-mail ou qualquer dado do usuário
// além do displayName e do userId (que o líder precisa para remover alguém).

import {
  CAPACITY,
  ROUND1_LENGTH,
  ROCK_MISSING_PENALTY,
} from './domain/catalog';
import { deriveJar, spaceForChoices } from './domain/rules';
import { classify, computeScore, type Classification } from './domain/score';
import { buildStats, type PoteStats } from './domain/stats';

export const PHASE_ORDER = [
  'LOBBY',
  'ROUND_1',
  'RESULT_1',
  'PARABLE',
  'ROUND_2',
  'FINAL',
  'ENDED',
  'CANCELLED',
] as const;
export type PhaseName = (typeof PHASE_ORDER)[number];

/** Depois de quanto tempo sem "bater" o jogador aparece como desconectado. */
export const CONNECTED_WINDOW_MS = 8000;

export interface RoomRow {
  code: string;
  phase: PhaseName;
  isPaused: boolean;
  round2EndsAt: Date | null;
  round2RemainingMs: number | null;
  version: number;
}

export interface PlayerRow {
  id?: string;
  invitedAt?: Date;
  userId: string;
  displayName: string;
  joinedAt: Date | null;
  lastSeenAt: Date | null;
  statusRound1: string;
  round1Index: number;
  round1Placed: string[];
  statusRound2: string;
  round2Placed: string[];
  removed: boolean;
}

const phaseAtLeast = (phase: PhaseName, min: PhaseName) =>
  PHASE_ORDER.indexOf(phase) >= PHASE_ORDER.indexOf(min);

export function buildRoomView(room: RoomRow, now: Date) {
  return {
    code: room.code,
    phase: room.phase,
    isPaused: room.isPaused,
    round2EndsAt: room.round2EndsAt ? room.round2EndsAt.toISOString() : null,
    round2RemainingMs: room.round2RemainingMs,
    serverNow: now.toISOString(),
  };
}

/** A visão de UM jogador sobre si mesmo. A Vida da rodada 1 só aparece a partir do RESULT_1. */
export function buildPlayerView(
  player: PlayerRow,
  phase: PhaseName,
  commitment: string | null,
  /** Ordem dos 19 itens da rodada 1 PARA ESTE jogador (sorteada, ver domain/order.ts). */
  order: readonly string[],
) {
  const jar1 = deriveJar(player.round1Placed);
  const score1 = computeScore(player.round1Placed, 1);
  const revealLife1 = phaseAtLeast(phase, 'RESULT_1');

  const jar2 = deriveJar(player.round2Placed);
  const score2 = computeScore(player.round2Placed, 2);
  const finalPhase = phase === 'FINAL' || phase === 'ENDED';

  const playing1 = player.statusRound1 === 'PLAYING';
  const currentItemId =
    playing1 && player.round1Index < ROUND1_LENGTH
      ? order[player.round1Index]
      : null;

  return {
    displayName: player.displayName,
    round1: {
      status: player.statusRound1,
      index: player.round1Index,
      total: ROUND1_LENGTH,
      currentItemId,
      // só o que já passou (a ordem do que vem por aí continua surpresa)
      seen: order.slice(0, player.round1Index),
      placed: player.round1Placed,
      free: jar1.free,
      gaps: jar1.gaps,
      fun: score1.fun,
      life: revealLife1 ? score1.life : null,
      penalty: revealLife1 ? score1.rocksMissing.length * ROCK_MISSING_PENALTY : null,
      rocksIn: score1.rocksIn,
      rocksMissing: score1.rocksMissing,
      sandTired: score1.sandTired,
    },
    round2: {
      status: player.statusRound2,
      placed: player.round2Placed,
      free: jar2.free,
      gaps: jar2.gaps,
      spaceLeft: spaceForChoices(jar2),
      fun: score2.fun,
      life: score2.life,
      combos: score2.combos,
      rocksIn: score2.rocksIn,
      sandTired: score2.sandTired,
      classification:
        finalPhase && player.statusRound2 === 'FINISHED'
          ? (classify(score2.fun, score2.life) as Classification)
          : null,
    },
    commitment,
  };
}

/** Uma linha por jogador para o líder/telão (sem e-mail). */
export function buildLeaderPlayerView(player: PlayerRow, now: Date) {
  const jar1 = deriveJar(player.round1Placed);
  const score1 = computeScore(player.round1Placed, 1);
  const jar2 = deriveJar(player.round2Placed);
  const score2 = computeScore(player.round2Placed, 2);
  const joined = player.joinedAt !== null;

  return {
    userId: player.userId,
    displayName: player.displayName,
    joined,
    connected:
      joined &&
      player.lastSeenAt !== null &&
      now.getTime() - player.lastSeenAt.getTime() <= CONNECTED_WINDOW_MS,
    round1: {
      status: player.statusRound1,
      index: player.round1Index,
      total: ROUND1_LENGTH,
      fill: CAPACITY - jar1.free,
      rocksIn: score1.rocksIn,
      rocksMissing: score1.rocksMissing,
    },
    round2: {
      status: player.statusRound2,
      fill: CAPACITY - jar2.free,
      spaceLeft: spaceForChoices(jar2),
      rocksIn: score2.rocksIn,
      fun: score2.fun,
      life: score2.life,
      classification:
        player.statusRound2 === 'FINISHED'
          ? classify(score2.fun, score2.life)
          : null,
    },
  };
}

/** Quem conta nas estatísticas: entrou na sala e não foi removido. */
export const isActivePlayer = (p: Pick<PlayerRow, 'joinedAt' | 'removed'>) =>
  p.joinedAt !== null && !p.removed;

/**
 * Ordem ESTÁVEL dos jogadores: por quando foram convidados e, no empate, pelo id.
 * Sem isso o banco devolve as linhas em qualquer ordem (muda a cada UPDATE) e a lista
 * do líder ficava embaralhando — uma pessoa subia, outra descia, o tempo todo.
 */
export function byStableOrder(a: PlayerRow, b: PlayerRow): number {
  const diff = (a.invitedAt?.getTime() ?? 0) - (b.invitedAt?.getTime() ?? 0);
  if (diff !== 0) return diff;
  return (a.id ?? a.userId).localeCompare(b.id ?? b.userId);
}

export function buildLeaderView(players: PlayerRow[], now: Date) {
  const visible = players.filter((p) => !p.removed).sort(byStableOrder);
  const active = visible.filter(isActivePlayer);
  const stats: PoteStats = buildStats(active);
  return {
    players: visible.map((p) => buildLeaderPlayerView(p, now)),
    joinedCount: active.length,
    invitedCount: visible.length,
    stats,
  };
}

/**
 * O estado completo que o jogador recebe (GET e respostas de ação), montado só com o
 * que já está em memória — a sala e TODOS os jogadores vêm numa consulta única.
 */
export function buildPlayerState(
  room: RoomRow & { id: string },
  players: PlayerRow[],
  userId: string,
  now: Date,
  order: readonly string[],
  commitment: string | null = null,
) {
  const me = players.find((p) => p.userId === userId) as PlayerRow;
  const active = players.filter(isActivePlayer);
  return {
    changed: true as const,
    version: room.version,
    role: 'PLAYER' as const,
    room: buildRoomView(room, now),
    me: buildPlayerView(me, room.phase, commitment, order),
    // Sala de espera: quem já entrou (só nomes de exibição — nunca e-mail nem id).
    // Só no LOBBY, para não pesar a resposta durante o jogo.
    ...(room.phase === 'LOBBY' && {
      lobby: {
        players: [...active]
          .sort(
            (a, b) =>
              (a.joinedAt as Date).getTime() - (b.joinedAt as Date).getTime() || byStableOrder(a, b),
          )
          .map((p) => ({ displayName: p.displayName, isMe: p.userId === userId })),
      },
    }),
    progress: {
      total: active.length,
      round1Finished: active.filter((p) => p.statusRound1 === 'FINISHED').length,
      round2Finished: active.filter((p) => p.statusRound2 === 'FINISHED').length,
    },
  };
}
