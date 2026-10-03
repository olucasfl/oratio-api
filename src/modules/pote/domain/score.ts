import {
  FUN_THRESHOLD,
  ITEM_BY_ID,
  LIFE_THRESHOLD,
  ROCK_IDS,
  ROCK_MISSING_PENALTY,
} from './catalog';

export type Round = 1 | 2;

export interface Combo {
  id: string;
  name: string;
  /** Nome do ícone (Material Symbols Rounded do Google). */
  icon: string;
  life: number;
  fun: number;
  active: (placed: readonly string[]) => boolean;
}

const has = (placed: readonly string[], ...ids: string[]) =>
  ids.every((id) => placed.includes(id));

export const COMBOS: readonly Combo[] = [
  {
    id: 'deus_primeiro',
    name: 'Deus em primeiro lugar',
    icon: 'light_mode',
    life: 10,
    fun: 0,
    active: (p) => p[0] === 'oracao',
  },
  {
    id: 'comunidade',
    name: 'Vida em comunidade',
    icon: 'groups',
    life: 10,
    fun: 0,
    active: (p) => has(p, 'ejc', 'pastoral'),
  },
  {
    id: 'corpo',
    name: 'Corpo em dia',
    icon: 'fitness_center',
    life: 5,
    fun: 5,
    active: (p) => has(p, 'academia', 'futebol'),
  },
  {
    id: 'raizes',
    name: 'Raízes',
    icon: 'family_restroom',
    life: 5,
    fun: 0,
    active: (p) => has(p, 'familia', 'avos'),
  },
  {
    id: 'turma',
    name: 'Turma reunida',
    icon: 'celebration',
    life: 0,
    fun: 10,
    active: (p) => has(p, 'amigos', 'role'),
  },
];

/** Diversão de uma areia conforme quantas areias já estavam no pote ("o scroll cansa"). */
export function sandFun(baseFun: number, sandsBefore: number): number {
  if (sandsBefore < 4) return baseFun;
  if (sandsBefore < 8) return Math.floor(baseFun / 2);
  return 0;
}

export interface Score {
  fun: number;
  life: number;
  combos: string[];
  rocksIn: number;
  rocksMissing: string[];
  sandCount: number;
  /** A 5ª areia (ou mais) já entrou: mostrar "Você já nem tá curtindo mais…". */
  sandTired: boolean;
}

/**
 * Pontuação derivada da lista ordenada de itens colocados.
 * Rodada 1: penaliza pedras de fora e não conta combos.
 * Rodada 2: conta combos e não penaliza.
 */
export function computeScore(placed: readonly string[], round: Round): Score {
  let fun = 0;
  let life = 0;
  let sandCount = 0;

  for (const id of placed) {
    const item = ITEM_BY_ID[id];
    if (!item) continue;
    life += item.life;
    if (item.category === 'AREIA') {
      fun += sandFun(item.fun, sandCount);
      sandCount += 1;
    } else {
      fun += item.fun;
    }
  }

  const rocksMissing = ROCK_IDS.filter((id) => !placed.includes(id));
  const rocksIn = ROCK_IDS.length - rocksMissing.length;

  const combos: string[] = [];
  if (round === 1) {
    life -= rocksMissing.length * ROCK_MISSING_PENALTY;
  } else {
    for (const combo of COMBOS) {
      if (combo.active(placed)) {
        combos.push(combo.id);
        life += combo.life;
        fun += combo.fun;
      }
    }
  }

  return {
    fun,
    life,
    combos,
    rocksIn,
    rocksMissing,
    sandCount,
    sandTired: sandCount >= 5,
  };
}

export type Classification = 'PLENA' | 'PESADA' | 'VAZIA' | 'CORRIDA';

export function classify(fun: number, life: number): Classification {
  const funHigh = fun >= FUN_THRESHOLD;
  const lifeHigh = life >= LIFE_THRESHOLD;
  if (lifeHigh) return funHigh ? 'PLENA' : 'PESADA';
  return funHigh ? 'VAZIA' : 'CORRIDA';
}
