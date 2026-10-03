import { ROCK_IDS, ROUND1_POOL } from './catalog';

/*
 Ordem dos 19 itens da rodada 1 para UM jogador: sorteada, diferente para cada
 pessoa, mas sempre com a mesma estrutura — 2 pedras misturadas entre as areias e
 os cascalhos e as outras 3 pedras no final. É determinística a partir da semente
 (sala + usuário): quem reconecta recebe a mesma ordem, e o servidor não precisa
 guardar nada (sem coluna nova no banco).
*/

/** Mistura de string -> número de 32 bits (xmur3). */
function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/** Gerador pseudoaleatório com semente (mulberry32): devolve números em [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export const ROUND1_MID_STONES = 2;

export function buildRound1Order(seed: string): string[] {
  const rand = mulberry32(hashSeed(seed));
  const smalls = ROUND1_POOL.filter((i) => i.category !== 'PEDRA').map((i) => i.id);
  const stones = shuffle(ROCK_IDS, rand);
  const mid = stones.slice(0, ROUND1_MID_STONES);
  const end = stones.slice(ROUND1_MID_STONES);
  const front = shuffle([...smalls, ...mid], rand);
  return [...front, ...end];
}
