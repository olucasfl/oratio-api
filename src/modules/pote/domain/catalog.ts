// Catálogo fixo do jogo "O Pote" (spec: docs/specs/pote.md). Sem dependência de
// framework: este arquivo é copiado idêntico para o frontend
// (oratio/src/pages/Pote/domain/) e um teste compara o hash das duas cópias.

export type Category = 'PEDRA' | 'CASCALHO' | 'AREIA';

export const CAPACITY = 100;
export const SIZE: Record<Category, number> = {
  PEDRA: 20,
  CASCALHO: 5,
  AREIA: 2,
};
export const GAP: Record<Category, number> = {
  PEDRA: 8,
  CASCALHO: 0,
  AREIA: 0,
};

export interface PoteItem {
  id: string;
  name: string;
  /** Nome do ícone (Material Symbols Rounded do Google). */
  icon: string;
  category: Category;
  /** Vida base, antes das regras de pontuação. */
  life: number;
  /** Diversão base, antes das regras de pontuação. */
  fun: number;
  /** Faz parte dos 19 itens da rodada 1 (a ORDEM é sorteada por jogador, ver order.ts). */
  r1?: true;
}

export const ITEMS: readonly PoteItem[] = [
  // Pedras
  { id: 'oracao', name: 'Oração', icon: 'volunteer_activism', category: 'PEDRA', life: 20, fun: 0, r1: true },
  { id: 'missa', name: 'Missa', icon: 'church', category: 'PEDRA', life: 20, fun: 0, r1: true },
  { id: 'familia', name: 'Família', icon: 'family_restroom', category: 'PEDRA', life: 15, fun: 10, r1: true },
  { id: 'estudos', name: 'Estudos/Trabalho', icon: 'school', category: 'PEDRA', life: 15, fun: 0, r1: true },
  { id: 'sono', name: 'Sono', icon: 'bedtime', category: 'PEDRA', life: 15, fun: 0, r1: true },

  // Cascalho
  { id: 'amigos', name: 'Amigos', icon: 'group', category: 'CASCALHO', life: 5, fun: 15, r1: true },
  { id: 'role', name: 'Rolê', icon: 'nightlife', category: 'CASCALHO', life: 0, fun: 15, r1: true },
  { id: 'futebol', name: 'Futebol/esporte', icon: 'sports_soccer', category: 'CASCALHO', life: 8, fun: 12, r1: true },
  { id: 'namoro', name: 'Encontro com namorado(a)', icon: 'diversity_1', category: 'CASCALHO', life: 5, fun: 15, r1: true },
  { id: 'violao', name: 'Tocar violão/hobby', icon: 'music_note', category: 'CASCALHO', life: 5, fun: 12, r1: true },
  { id: 'praia', name: 'Praia/passeio', icon: 'beach_access', category: 'CASCALHO', life: 5, fun: 12, r1: true },
  { id: 'academia', name: 'Academia', icon: 'fitness_center', category: 'CASCALHO', life: 10, fun: 5 },
  { id: 'livro', name: 'Ler um livro', icon: 'menu_book', category: 'CASCALHO', life: 8, fun: 5 },
  { id: 'ejc', name: 'Reunião do EJC', icon: 'local_fire_department', category: 'CASCALHO', life: 10, fun: 10 },
  { id: 'pastoral', name: 'Pastoral/voluntariado', icon: 'handshake', category: 'CASCALHO', life: 12, fun: 5 },
  { id: 'avos', name: 'Visitar os avós', icon: 'elderly', category: 'CASCALHO', life: 12, fun: 5 },
  { id: 'curso', name: 'Curso extra', icon: 'workspace_premium', category: 'CASCALHO', life: 10, fun: 0 },
  { id: 'cozinhar', name: 'Cozinhar algo', icon: 'skillet', category: 'CASCALHO', life: 5, fun: 8 },
  { id: 'quarto', name: 'Arrumar o quarto', icon: 'cleaning_services', category: 'CASCALHO', life: 6, fun: 0 },

  // Areia
  { id: 'reels', name: 'Reels/TikTok', icon: 'smartphone', category: 'AREIA', life: 0, fun: 10, r1: true },
  { id: 'serie', name: 'Série', icon: 'tv', category: 'AREIA', life: 0, fun: 10, r1: true },
  { id: 'feed', name: 'Rolar o feed', icon: 'swipe_vertical', category: 'AREIA', life: 0, fun: 8, r1: true },
  { id: 'videogame', name: 'Videogame', icon: 'sports_esports', category: 'AREIA', life: 0, fun: 10, r1: true },
  { id: 'fofoca', name: 'Fofoca no grupo', icon: 'forum', category: 'AREIA', life: -5, fun: 8, r1: true },
  { id: 'youtube', name: 'YouTube', icon: 'smart_display', category: 'AREIA', life: 0, fun: 8, r1: true },
  { id: 'stories', name: 'Stories dos outros', icon: 'visibility', category: 'AREIA', life: -3, fun: 5, r1: true },
  { id: 'madrugada', name: 'Celular de madrugada', icon: 'dark_mode', category: 'AREIA', life: -10, fun: 8, r1: true },
  { id: 'joguinho', name: 'Joguinho no celular', icon: 'videogame_asset', category: 'AREIA', life: 0, fun: 6 },
  { id: 'meme', name: 'Meme no grupo', icon: 'mood', category: 'AREIA', life: 0, fun: 6 },
  { id: 'figurinha', name: 'Figurinha no zap', icon: 'sticky_note_2', category: 'AREIA', life: 0, fun: 5 },
  { id: 'comentarios', name: 'Discutir nos comentários', icon: 'chat_bubble', category: 'AREIA', life: -5, fun: 3 },
  { id: 'compras', name: 'Compras online à toa', icon: 'shopping_cart', category: 'AREIA', life: -2, fun: 6 },
  { id: 'maratona', name: 'Maratonar série', icon: 'live_tv', category: 'AREIA', life: -3, fun: 12 },
  { id: 'cochilo', name: 'Cochilo extra', icon: 'hotel', category: 'AREIA', life: 2, fun: 4 },
];

export const ITEM_BY_ID: Readonly<Record<string, PoteItem>> = Object.fromEntries(
  ITEMS.map((item) => [item.id, item]),
);

export const ROCK_IDS: readonly string[] = ITEMS.filter(
  (i) => i.category === 'PEDRA',
).map((i) => i.id);

/**
 * Os 19 itens da rodada 1 (8 areias, 6 cascalhos e as 5 pedras). São os mesmos para
 * todos; a ORDEM em que aparecem é sorteada por jogador (`buildRound1Order`).
 */
export const ROUND1_POOL: readonly PoteItem[] = ITEMS.filter((i) => i.r1);

export const ROUND1_LENGTH = ROUND1_POOL.length;
export const ROUND1_ITEM_SECONDS = 6;
export const ROUND2_DEFAULT_SECONDS = 180;
export const ROUND2_EXTEND_SECONDS = 60;
export const COMMITMENT_MAX_LENGTH = 140;

/** Limites da classificação final — constantes para calibrar jogando. */
export const FUN_THRESHOLD = 60;
export const LIFE_THRESHOLD = 150;
export const ROCK_MISSING_PENALTY = 20;
