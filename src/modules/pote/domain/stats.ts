import { ITEM_BY_ID, ROCK_IDS } from './catalog';
import { classify, computeScore, type Classification } from './score';

/** O mínimo que as estatísticas precisam de cada jogador (sem e-mail, sem nada pessoal). */
export interface StatsPlayer {
  statusRound1: string;
  statusRound2: string;
  round1Placed: readonly string[];
  round2Placed: readonly string[];
}

export interface CountedItem {
  id: string;
  count: number;
}

export interface PoteStats {
  players: number;
  round1: {
    finished: number;
    withAllRocks: number;
    mostMissedRock: CountedItem | null;
    mostTakenSand: CountedItem | null;
  };
  round2: {
    finished: number;
    topChosen: CountedItem[];
    topLeftOut: CountedItem[];
    mostActivatedCombo: CountedItem | null;
    avgFun: number;
    avgLife: number;
    withAllRocks: number;
  };
  classifications: Record<Classification, number>;
}

function tally(ids: Iterable<string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}

/** Ordena por contagem desc e, no empate, pela ordem do catálogo (determinístico). */
function top(counts: Map<string, number>, n: number): CountedItem[] {
  const order = Object.keys(ITEM_BY_ID);
  return [...counts.entries()]
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0]))
    .slice(0, n)
    .map(([id, count]) => ({ id, count }));
}

const avg = (values: number[]) =>
  values.length === 0
    ? 0
    : Math.round(values.reduce((a, b) => a + b, 0) / values.length);

/**
 * Estatísticas agregadas da sala (líder/telão). Recebe só jogadores ativos
 * (entraram e não foram removidos). A rodada 1 só conta quem a terminou.
 */
export function buildStats(players: readonly StatsPlayer[]): PoteStats {
  const r1 = players.filter((p) => p.statusRound1 === 'FINISHED');
  const r2 = players.filter((p) => p.statusRound2 === 'FINISHED');

  const missedRocks = tally(
    r1.flatMap((p) => ROCK_IDS.filter((id) => !p.round1Placed.includes(id))),
  );
  const takenSand = tally(
    r1.flatMap((p) =>
      p.round1Placed.filter((id) => ITEM_BY_ID[id]?.category === 'AREIA'),
    ),
  );

  const chosen = tally(
    r2.flatMap((p) =>
      p.round2Placed.filter((id) => ITEM_BY_ID[id]?.category !== 'PEDRA'),
    ),
  );
  const leftOut = tally(
    r2.flatMap((p) =>
      Object.keys(ITEM_BY_ID).filter(
        (id) =>
          ITEM_BY_ID[id].category !== 'PEDRA' && !p.round2Placed.includes(id),
      ),
    ),
  );

  const scores2 = r2.map((p) => computeScore(p.round2Placed, 2));
  const combos = tally(scores2.flatMap((s) => s.combos));

  const classifications: Record<Classification, number> = {
    PLENA: 0,
    PESADA: 0,
    VAZIA: 0,
    CORRIDA: 0,
  };
  for (const s of scores2) classifications[classify(s.fun, s.life)] += 1;

  return {
    players: players.length,
    round1: {
      finished: r1.length,
      withAllRocks: r1.filter((p) =>
        ROCK_IDS.every((id) => p.round1Placed.includes(id)),
      ).length,
      mostMissedRock: top(missedRocks, 1)[0] ?? null,
      mostTakenSand: top(takenSand, 1)[0] ?? null,
    },
    round2: {
      finished: r2.length,
      topChosen: top(chosen, 3),
      topLeftOut: top(leftOut, 3),
      mostActivatedCombo: top(combos, 1)[0] ?? null,
      avgFun: avg(scores2.map((s) => s.fun)),
      avgLife: avg(scores2.map((s) => s.life)),
      withAllRocks: scores2.filter((s) => s.rocksIn === ROCK_IDS.length).length,
    },
    classifications,
  };
}
