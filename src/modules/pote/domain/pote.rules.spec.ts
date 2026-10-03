import {
  CAPACITY,
  ITEMS,
  ITEM_BY_ID,
  ROCK_IDS,
  ITEM_BY_ID as BY_ID,
  ROUND1_POOL,
} from './catalog';
import {
  EMPTY_JAR,
  NAO_CABE,
  canPlace,
  deriveJar,
  place,
  spaceForChoices,
} from './rules';
import { buildRound1Order } from './order';

/** Uma ordem fixa só para os testes de conta (a real é sorteada por jogador). */
const FIXED_ORDER = ['reels', 'serie', 'feed', 'videogame', 'estudos', 'fofoca', 'youtube', 'stories', 'madrugada', 'amigos', 'role', 'futebol', 'sono', 'namoro', 'violao', 'praia', 'familia', 'missa', 'oracao'];
const fixedItems = FIXED_ORDER.map((id) => BY_ID[id]);


describe('catálogo', () => {
  it('tem 5 pedras, 14 cascalhos e 15 areias, com ids únicos', () => {
    const count = (c: string) => ITEMS.filter((i) => i.category === c).length;
    expect(count('PEDRA')).toBe(5);
    expect(count('CASCALHO')).toBe(14);
    expect(count('AREIA')).toBe(15);
    expect(new Set(ITEMS.map((i) => i.id)).size).toBe(34);
  });

  it('cascalho + areia somam 100 de tamanho (não cabe tudo)', () => {
    const total = ITEMS.filter((i) => i.category !== 'PEDRA').reduce(
      (sum, i) => sum + (i.category === 'CASCALHO' ? 5 : 2),
      0,
    );
    expect(total).toBe(100);
  });

  it('o conjunto da rodada 1 tem 19 itens: 8 areias, 6 cascalhos e as 5 pedras', () => {
    const cats = ROUND1_POOL.map((i) => i.category);
    expect(ROUND1_POOL).toHaveLength(19);
    expect(cats.filter((c) => c === 'AREIA')).toHaveLength(8);
    expect(cats.filter((c) => c === 'CASCALHO')).toHaveLength(6);
    expect(cats.filter((c) => c === 'PEDRA')).toHaveLength(5);
  });
});

describe('ordem da rodada 1 (sorteada por jogador)', () => {
  const seeds = Array.from({ length: 300 }, (_, i) => `sala-1:usuario-${i}`);

  it('é sempre uma permutação dos mesmos 19 itens', () => {
    const pool = ROUND1_POOL.map((i) => i.id).sort();
    for (const seed of seeds) {
      expect([...buildRound1Order(seed)].sort()).toEqual(pool);
    }
  });

  it('sempre 2 pedras misturadas entre areias/cascalhos e as 3 últimas posições são pedras', () => {
    for (const seed of seeds) {
      const cats = buildRound1Order(seed).map((id) => BY_ID[id].category);
      expect(cats.slice(16)).toEqual(['PEDRA', 'PEDRA', 'PEDRA']);
      expect(cats.slice(0, 16).filter((c) => c === 'PEDRA')).toHaveLength(2);
    }
  });

  it('é determinística: a mesma pessoa na mesma sala recebe sempre a mesma ordem', () => {
    expect(buildRound1Order('sala-1:ana')).toEqual(buildRound1Order('sala-1:ana'));
  });

  it('muda de pessoa para pessoa e de sala para sala (sem ordem predefinida)', () => {
    const orders = new Set(seeds.map((s) => buildRound1Order(s).join(',')));
    expect(orders.size).toBeGreaterThan(290);
    expect(buildRound1Order('sala-1:ana')).not.toEqual(buildRound1Order('sala-2:ana'));
  });

  it('qualquer pedra pode cair no meio ou no final (nenhuma é fixa)', () => {
    const mid = new Set<string>();
    const lastOne = new Set<string>();
    for (const seed of seeds) {
      const order = buildRound1Order(seed);
      order.slice(0, 16).filter((id) => ROCK_IDS.includes(id)).forEach((id) => mid.add(id));
      lastOne.add(order[18]);
    }
    expect(mid.size).toBe(5);
    expect(lastOne.size).toBe(5);
  });

  it('quem pega tudo nunca junta as 5 pedras; quem só pega pedras junta sempre; quem ignora areia fica com 3 ou 4', () => {
    const play = (order: string[], take: (c: string) => boolean) => {
      let jar = EMPTY_JAR;
      for (const id of order) {
        const item = BY_ID[id];
        if (take(item.category) && canPlace(jar, item.category)) jar = place(jar, id, item.category).state;
      }
      return jar.placed.filter((id) => ROCK_IDS.includes(id)).length;
    };
    for (const seed of seeds) {
      const order = buildRound1Order(seed);
      expect(play(order, () => true)).toBeGreaterThanOrEqual(2);
      expect(play(order, () => true)).toBeLessThanOrEqual(3);
      expect(play(order, (c) => c !== 'AREIA')).toBeGreaterThanOrEqual(3);
      expect(play(order, (c) => c !== 'AREIA')).toBeLessThanOrEqual(4);
      expect(play(order, (c) => c === 'PEDRA')).toBe(5);
    }
  });
});

describe('regras do pote', () => {
  it('5 pedras primeiro: ocupam 100, geram 40 de vão e deixam exatamente 40 para escolhas', () => {
    const jar = deriveJar(ROCK_IDS);
    expect(jar.free).toBe(0);
    expect(jar.gaps).toBe(40);
    expect(spaceForChoices(jar)).toBe(40);
  });

  it('a 5ª pedra cabe exatamente (20 livres) e uma 6ª não caberia', () => {
    const four = deriveJar(ROCK_IDS.slice(0, 4));
    expect(four.free).toBe(20);
    expect(canPlace(four, 'PEDRA')).toBe(true);
    expect(canPlace(deriveJar(ROCK_IDS), 'PEDRA')).toBe(false);
  });

  it('uma pedra não usa vão: exige espaço livre', () => {
    // 3 pedras = 60 usados, 24 de vão, 40 livres → ainda cabe pedra
    let jar = deriveJar(['estudos', 'sono', 'familia']);
    expect(jar.free).toBe(40);
    jar = { ...jar, free: 10 };
    expect(canPlace(jar, 'PEDRA')).toBe(false);
    expect(() => place(jar, 'missa', 'PEDRA')).toThrow(NAO_CABE);
  });

  it('areia usa vão parcialmente (1 de vão + 1 de livre) e avisa usedGap', () => {
    const jar = { free: 10, gaps: 1, placed: [] as string[] };
    const result = place(jar, 'reels', 'AREIA');
    expect(result.usedGap).toBe(true);
    expect(result.state.gaps).toBe(0);
    expect(result.state.free).toBe(9);
  });

  it('cascalho usa vão primeiro e só depois o espaço livre', () => {
    const afterRock = place(EMPTY_JAR, 'estudos', 'PEDRA').state; // gaps 8, free 80
    const first = place(afterRock, 'amigos', 'CASCALHO');
    expect(first.usedGap).toBe(true);
    expect(first.state).toMatchObject({ gaps: 3, free: 80 });
    const second = place(first.state, 'role', 'CASCALHO'); // 3 do vão + 2 do livre
    expect(second.state).toMatchObject({ gaps: 0, free: 78 });
  });

  it('sem vão, nada usa vão (usedGap = false)', () => {
    expect(place(EMPTY_JAR, 'reels', 'AREIA').usedGap).toBe(false);
    expect(place(EMPTY_JAR, 'estudos', 'PEDRA').usedGap).toBe(false);
  });

  it('item que não cabe lança NAO_CABE e não altera o estado', () => {
    const full = { free: 1, gaps: 0, placed: [] as string[] };
    expect(canPlace(full, 'AREIA')).toBe(false);
    expect(() => place(full, 'reels', 'AREIA')).toThrow(NAO_CABE);
    expect(full.free).toBe(1);
  });

  it('rodada 1 pegando tudo que cabe: 3 pedras entram e 2 ficam de fora (Missa e Oração)', () => {
    let jar = EMPTY_JAR;
    const left: string[] = [];
    for (const item of fixedItems) {
      if (canPlace(jar, item.category)) {
        jar = place(jar, item.id, item.category).state;
      } else {
        left.push(item.id);
      }
    }
    expect(left).toEqual(['missa', 'oracao']);
    expect(jar.placed.filter((id) => ROCK_IDS.includes(id))).toEqual([
      'estudos', 'sono', 'familia',
    ]);
    // sobram só 10 livres: nem a Missa (20) nem a Oração (20) cabem
    expect(jar.free).toBe(10);
    expect(CAPACITY - jar.free).toBe(90);
  });

  it('sem pedras no pote, 8 areias + 6 cascalhos gastam 46 e sobram 54 (cabem 2 pedras)', () => {
    const placed = ROUND1_POOL.filter((i) => i.category !== 'PEDRA').map((i) => i.id);
    const jar = deriveJar(placed);
    expect(jar.free).toBe(54);
    expect(Math.floor(jar.free / 20)).toBe(2);
  });

  it('deriveJar recalcula do zero e rejeita listas impossíveis ou ids desconhecidos', () => {
    expect(deriveJar([])).toEqual(EMPTY_JAR);
    expect(() => deriveJar(['nao_existe'])).toThrow('ITEM_DESCONHECIDO');
    const tooMany = ITEMS.map((i) => i.id); // 34 itens não cabem
    expect(() => deriveJar(tooMany)).toThrow(NAO_CABE);
  });

  it('retirar areia/cascalho e recalcular devolve o espaço', () => {
    const withSand = deriveJar([...ROCK_IDS, 'reels', 'serie']);
    const without = deriveJar([...ROCK_IDS, 'reels']);
    expect(spaceForChoices(without) - spaceForChoices(withSand)).toBe(2);
    expect(ITEM_BY_ID.reels.category).toBe('AREIA');
  });
});
