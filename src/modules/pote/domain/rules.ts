import { CAPACITY, GAP, ITEM_BY_ID, SIZE, type Category } from './catalog';

export interface JarState {
  free: number;
  gaps: number;
  placed: string[];
}

export const EMPTY_JAR: JarState = { free: CAPACITY, gaps: 0, placed: [] };

export const NAO_CABE = 'NAO_CABE';

/** Quanto do item vem de vãos e quanto exige espaço livre. */
function split(state: JarState, cat: Category) {
  if (cat === 'PEDRA') return { fromGaps: 0, fromFree: SIZE.PEDRA };
  const fromGaps = Math.min(state.gaps, SIZE[cat]);
  return { fromGaps, fromFree: SIZE[cat] - fromGaps };
}

export function canPlace(state: JarState, cat: Category): boolean {
  return state.free >= split(state, cat).fromFree;
}

export function place(
  state: JarState,
  itemId: string,
  cat: Category,
): { state: JarState; usedGap: boolean } {
  if (!canPlace(state, cat)) throw new Error(NAO_CABE);
  const { fromGaps, fromFree } = split(state, cat);
  return {
    state: {
      free: state.free - fromFree,
      gaps: state.gaps - fromGaps + GAP[cat],
      placed: [...state.placed, itemId],
    },
    usedGap: fromGaps > 0,
  };
}

/**
 * Recalcula o pote do zero a partir da lista ordenada de ids colocados.
 * Lança NAO_CABE se a lista é impossível (o servidor nunca persiste uma).
 */
export function deriveJar(placed: readonly string[]): JarState {
  let state = EMPTY_JAR;
  for (const id of placed) {
    const item = ITEM_BY_ID[id];
    if (!item) throw new Error(`ITEM_DESCONHECIDO:${id}`);
    state = place(state, id, item.category).state;
  }
  return state;
}

/** Espaço realmente disponível para cascalho/areia com as 5 pedras dentro. */
export function spaceForChoices(state: JarState): number {
  return state.free + state.gaps;
}
