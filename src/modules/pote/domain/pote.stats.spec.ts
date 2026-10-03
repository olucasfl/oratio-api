import { ROCK_IDS } from './catalog';
import { buildStats, type StatsPlayer } from './stats';

const finished = (round1Placed: string[], round2Placed: string[] = []): StatsPlayer => ({
  statusRound1: 'FINISHED',
  statusRound2: round2Placed.length ? 'FINISHED' : 'PLAYING',
  round1Placed,
  round2Placed,
});

describe('buildStats', () => {
  it('sala vazia: zeros e nulos, sem estourar', () => {
    const s = buildStats([]);
    expect(s.players).toBe(0);
    expect(s.round1).toEqual({ finished: 0, withAllRocks: 0, mostMissedRock: null, mostTakenSand: null });
    expect(s.round2.avgFun).toBe(0);
    expect(s.round2.mostActivatedCombo).toBeNull();
  });

  it('rodada 1: pedra mais deixada de fora, areia mais pega e quem tem 5/5', () => {
    const s = buildStats([
      finished(['reels', 'serie', 'estudos', 'sono', 'familia']),
      finished(['reels', 'estudos', 'sono', 'familia', 'missa']),
      finished([...ROCK_IDS]),
    ]);
    expect(s.round1.finished).toBe(3);
    expect(s.round1.withAllRocks).toBe(1);
    expect(s.round1.mostMissedRock).toEqual({ id: 'oracao', count: 2 });
    expect(s.round1.mostTakenSand).toEqual({ id: 'reels', count: 2 });
  });

  it('quem não terminou a rodada 1 não conta nas estatísticas dela', () => {
    const s = buildStats([
      { ...finished([]), statusRound1: 'PLAYING' },
      finished([...ROCK_IDS]),
    ]);
    expect(s.round1.finished).toBe(1);
    expect(s.round1.mostMissedRock).toBeNull();
  });

  it('rodada 2: mais escolhidos, mais deixados de fora, combo e médias', () => {
    const a = [...ROCK_IDS, 'amigos', 'role'];
    const b = [...ROCK_IDS, 'amigos'];
    const s = buildStats([finished([], a), finished([], b)]);
    expect(s.round2.finished).toBe(2);
    expect(s.round2.topChosen[0]).toEqual({ id: 'amigos', count: 2 });
    expect(s.round2.topChosen).toHaveLength(2); // só 2 itens distintos foram escolhidos
    // ROCK_IDS começa por 'oracao' → "Deus em primeiro lugar" ativa nos dois potes
    expect(s.round2.mostActivatedCombo).toEqual({ id: 'deus_primeiro', count: 2 });
    expect(s.round2.topLeftOut[0].count).toBe(2);
    expect(s.round2.withAllRocks).toBe(2);
    expect(s.round2.avgFun).toBeGreaterThan(0);
  });

  it('classificações somam o número de quem fechou a rodada 2', () => {
    const s = buildStats([finished([], [...ROCK_IDS]), finished([], [...ROCK_IDS, 'amigos'])]);
    const total = Object.values(s.classifications).reduce((x, y) => x + y, 0);
    expect(total).toBe(2);
  });
});
