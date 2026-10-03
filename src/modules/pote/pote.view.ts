// Montagem das "visões" que o GET devolve. Funções puras sobre linhas do banco
// (sem Prisma, sem Nest) — nunca incluem e-mail ou qualquer dado do usuário
// além do displayName e do userId (que o líder precisa para remover alguém).

import {
  CAPACITY,
  ROUND1_LENGTH,
  ROUND1_SEQUENCE,
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
      ? ROUND1_SEQUENCE[player.round1Index].id
      : null;

  return {
    displayName: player.displayName,
    round1: {
      status: player.statusRound1,
      index: player.round1Index,
      total: ROUND1_LENGTH,
      currentItemId,
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

export function buildLeaderView(players: PlayerRow[], now: Date) {
  const visible = players.filter((p) => !p.removed);
  const active = visible.filter(isActivePlayer);
  const stats: PoteStats = buildStats(active);
  return {
    players: visible.map((p) => buildLeaderPlayerView(p, now)),
    joinedCount: active.length,
    invitedCount: visible.length,
    stats,
  };
}
