import {
  CAPACITY,
  ITEMS,
  ITEM_BY_ID,
  ROCK_IDS,
  ROUND1_SEQUENCE,
} from './catalog';
import {
  EMPTY_JAR,
  NAO_CABE,
  canPlace,
  deriveJar,
  place,
  spaceForChoices,
} from './rules';

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

  it('a sequência da rodada 1 é exatamente a da spec (19 itens, 8/6/5)', () => {
    expect(ROUND1_SEQUENCE.map((i) => i.id)).toEqual([
      'reels', 'serie', 'feed', 'videogame', 'fofoca', 'youtube', 'stories', 'madrugada',
      'amigos', 'role', 'futebol', 'namoro', 'violao', 'praia',
      'estudos', 'sono', 'familia', 'missa', 'oracao',
    ]);
    expect(ROUND1_SEQUENCE.slice(0, 8).every((i) => i.category === 'AREIA')).toBe(true);
    expect(ROUND1_SEQUENCE.slice(8, 14).every((i) => i.category === 'CASCALHO')).toBe(true);
    expect(ROUND1_SEQUENCE.slice(14).every((i) => i.category === 'PEDRA')).toBe(true);
  });
});

describe('regras do pote', () => {
  it('5 pedras primeiro: ocupam 70, geram 30 de vão e deixam exatamente 60 para escolhas', () => {
    const jar = deriveJar(ROCK_IDS);
    expect(jar.free).toBe(30);
    expect(jar.gaps).toBe(30);
    expect(spaceForChoices(jar)).toBe(60);
  });

  it('uma pedra não usa vão: exige espaço livre', () => {
    // 3 pedras = 42 usados, 18 de vão, 58 livres → ainda cabe pedra
    let jar = deriveJar(['estudos', 'sono', 'familia']);
    expect(jar.free).toBe(58);
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
    const afterRock = place(EMPTY_JAR, 'estudos', 'PEDRA').state; // gaps 6, free 86
    const first = place(afterRock, 'amigos', 'CASCALHO');
    expect(first.usedGap).toBe(true);
    expect(first.state).toMatchObject({ gaps: 1, free: 86 });
    const second = place(first.state, 'role', 'CASCALHO');
    expect(second.state).toMatchObject({ gaps: 0, free: 82 });
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

  it('rodada 1 pegando tudo que cabe: 46 gastos, 3 pedras entram e 2 ficam de fora', () => {
    let jar = EMPTY_JAR;
    const left: string[] = [];
    for (const item of ROUND1_SEQUENCE) {
      if (canPlace(jar, item.category)) {
        jar = place(jar, item.id, item.category).state;
      } else {
        left.push(item.id);
      }
    }
    expect(CAPACITY - jar.free).toBe(46 + 42);
    expect(left).toEqual(['missa', 'oracao']);
    expect(jar.placed.filter((id) => ROCK_IDS.includes(id))).toEqual([
      'estudos', 'sono', 'familia',
    ]);
  });

  it('antes das pedras, 8 areias + 6 cascalhos gastam 46 e sobram 54', () => {
    const placed = ROUND1_SEQUENCE.slice(0, 14).map((i) => i.id);
    expect(deriveJar(placed).free).toBe(54);
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
