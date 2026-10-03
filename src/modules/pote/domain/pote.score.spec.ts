import { ROCK_IDS, ROUND1_SEQUENCE } from './catalog';
import { CLASSIFICATION_TEXT } from './content';
import { canPlace, deriveJar, place, EMPTY_JAR } from './rules';
import { classify, computeScore, sandFun } from './score';

const SAND_10 = ['reels', 'serie', 'videogame']; // ⚡10 cada, ❤0

describe('"o scroll cansa" (areia)', () => {
  it('1ª a 4ª: 100%; 5ª a 8ª: 50% arredondado para baixo; 9ª em diante: 0', () => {
    expect(sandFun(10, 0)).toBe(10);
    expect(sandFun(10, 3)).toBe(10);
    expect(sandFun(10, 4)).toBe(5);
    expect(sandFun(10, 7)).toBe(5);
    expect(sandFun(5, 4)).toBe(2); // 2,5 → 2
    expect(sandFun(10, 8)).toBe(0);
    expect(sandFun(10, 14)).toBe(0);
  });

  it('aplica a regra na ordem da lista (9 areias de ⚡10 = 4·10 + 4·5 + 0)', () => {
    const placed = [...SAND_10, 'feed', 'youtube', 'joguinho', 'meme', 'figurinha', 'cochilo'];
    const s = computeScore(placed, 2);
    // 1ª–4ª: 10+10+10+8 = 38; 5ª–8ª: 4+3+3+2 = 12; 9ª (cochilo): 0
    expect(s.fun).toBe(38 + 12);
    expect(s.sandCount).toBe(9);
  });

  it('marca sandTired a partir da 5ª areia', () => {
    expect(computeScore(['reels', 'serie', 'videogame', 'feed'], 2).sandTired).toBe(false);
    expect(computeScore(['reels', 'serie', 'videogame', 'feed', 'youtube'], 2).sandTired).toBe(true);
  });

  it('a Vida negativa da areia não é reduzida pelo cansaço', () => {
    const fillers = ['reels', 'serie', 'videogame', 'feed', 'youtube', 'joguinho', 'meme', 'figurinha'];
    const s = computeScore([...fillers, 'madrugada'], 2); // 9ª areia, ⚡ 0, ❤ -10
    expect(s.life).toBe(-10);
  });
});

describe('placar', () => {
  it('rodada 1 pegando tudo que cabe: ⚡143, ❤15 (com −40 de duas pedras de fora)', () => {
    let jar = EMPTY_JAR;
    for (const item of ROUND1_SEQUENCE) {
      if (canPlace(jar, item.category)) jar = place(jar, item.id, item.category).state;
    }
    const s = computeScore(jar.placed, 1);
    expect(s.rocksIn).toBe(3);
    expect([...s.rocksMissing].sort()).toEqual(['missa', 'oracao']);
    expect(s.fun).toBe(143);
    expect(s.life).toBe(15);
    expect(s.combos).toEqual([]);
  });

  it('penalidade de −20 de Vida por pedra de fora, só na rodada 1', () => {
    expect(computeScore([], 1).life).toBe(-100);
    expect(computeScore([], 2).life).toBe(0);
    expect(computeScore(['oracao'], 1).life).toBe(20 - 80);
  });

  it('rodada 1 não conta combos, mesmo com a condição satisfeita', () => {
    expect(computeScore(['oracao'], 1).combos).toEqual([]);
    expect(computeScore(['oracao'], 2).combos).toEqual(['deus_primeiro']);
  });

  it('5 pedras na rodada 2 sem penalidade: ❤ = 85 + combo Deus em primeiro', () => {
    const s = computeScore(['oracao', 'missa', 'familia', 'estudos', 'sono'], 2);
    expect(s.life).toBe(20 + 20 + 15 + 15 + 15 + 10);
    expect(s.rocksMissing).toEqual([]);
  });
});

describe('combos', () => {
  const rocks = ROCK_IDS.filter((id) => id !== 'oracao');

  it('deus_primeiro: só se oração for o 1º item; some se deixar de ser', () => {
    expect(computeScore(['oracao', ...rocks], 2).combos).toContain('deus_primeiro');
    expect(computeScore(['sono', 'oracao'], 2).combos).not.toContain('deus_primeiro');
    expect(computeScore(['oracao'], 2).life).toBe(30);
    expect(computeScore([], 2).combos).toEqual([]);
  });

  it.each([
    ['comunidade', ['ejc', 'pastoral'], { life: 10 + 10 + 12, fun: 10 + 5 }],
    ['corpo', ['academia', 'futebol'], { life: 10 + 8 + 5, fun: 5 + 12 + 5 }],
    ['raizes', ['familia', 'avos'], { life: 15 + 12 + 5, fun: 10 + 5 }],
    ['turma', ['amigos', 'role'], { life: 5 + 0, fun: 15 + 15 + 10 }],
  ])('%s ativa com o par e desativa sem um deles', (id, pair, expected) => {
    const withPair = computeScore(pair, 2);
    expect(withPair.combos).toContain(id);
    expect(withPair).toMatchObject(expected);
    expect(computeScore([pair[0]], 2).combos).not.toContain(id);
    expect(computeScore([pair[1]], 2).combos).not.toContain(id);
  });
});

describe('classificação', () => {
  it.each([
    [60, 150, 'PLENA'],
    [59, 150, 'PESADA'],
    [60, 149, 'VAZIA'],
    [59, 149, 'CORRIDA'],
    [200, 300, 'PLENA'],
    [0, -50, 'CORRIDA'],
  ] as const)('⚡%d ❤%d → %s', (fun, life, expected) => {
    expect(classify(fun, life)).toBe(expected);
  });

  it('cada classificação tem ícone, nome e texto', () => {
    for (const key of ['PLENA', 'PESADA', 'VAZIA', 'CORRIDA'] as const) {
      expect(CLASSIFICATION_TEXT[key].text.length).toBeGreaterThan(10);
    }
    expect(CLASSIFICATION_TEXT.PLENA.name).toBe('Semana plena');
  });

  it('uma rodada 2 com as 5 pedras e escolhas que cabem é derivável do pote', () => {
    const placed = [...ROCK_IDS, 'amigos', 'role'];
    expect(() => deriveJar(placed)).not.toThrow();
  });
});
