// Textos fixos do jogo "O Pote", fora dos componentes para facilitar a revisão.
// Citações bíblicas vêm do texto aprovado por Lucas na spec original (RULES.md §4):
// não alterar sem aceite dele.

import type { Classification } from './score';

export const TUTORIAL_SCREENS: readonly string[] = [
  'Este pote é a sua semana. Tudo o que você fizer precisa caber nele.',
  'Vão aparecer coisas da sua semana, uma de cada vez. Você tem 6 segundos para tocar em Pegar ou Deixar passar.',
  'O que entra no pote não sai mais. Tempo gasto não volta. Boa semana!',
];
export const TUTORIAL_BUTTON = 'Entendi, começar';

export const SAND_TIRED_MESSAGE = 'Você já nem tá curtindo mais…';
export const JAR_FULL_MESSAGE = 'Pote cheio. Para colocar algo, tire outra coisa.';
export const PAUSED_MESSAGE = 'Pausado pelo líder';

export const PARABLE = {
  title: 'O pote do professor',
  paragraphs: [
    'Um professor colocou um pote vazio na mesa e o encheu de pedras grandes. "Está cheio?", perguntou. Os alunos disseram que sim.',
    'Ele despejou cascalho, que escorreu entre as pedras. "E agora?" Já não tinham tanta certeza.',
    'Então despejou areia, que preencheu cada vão.',
    '"Este pote é a sua vida", disse. "As pedras são o que realmente importa: Deus, a família, sua missão, seu descanso. O cascalho são coisas boas, como amigos, hobbies e esporte. A areia é todo o resto.',
    'Se você começar pela areia, não sobra espaço para as pedras. Mas se as pedras entrarem primeiro, o resto encontra o seu lugar."',
    '"Buscai em primeiro lugar o Reino de Deus, e todas essas coisas vos serão dadas por acréscimo." (Mt 6,33)',
  ],
  questions: [
    'Na rodada 1, o que você pegou sem pensar?',
    'Qual é a "areia" que mais rouba o seu tempo na vida real?',
    'Qual pedra costuma ficar de fora da sua semana?',
  ],
} as const;

export const FINAL_TEXT = {
  title: 'Não dá para colocar tudo',
  paragraphs: [
    'Na primeira rodada, a vida escolheu por você: o que aparecia primeiro, você pegava. Na segunda, você escolheu.',
    'Repare que as pedras entraram, todas as cinco. Elas não se negociam. Mas depois delas, você teve que decidir, porque não cabia tudo. E ficou alguma coisa de fora.',
    'Isso não é uma falha do seu pote. É a vida. Toda escolha é também uma renúncia. Quem tenta caber tudo acaba não aproveitando nada, como a areia que, depois de um tempo, já nem diverte mais.',
    'São Paulo diz: "Tudo me é permitido, mas nem tudo me convém." (1Cor 6,12) A série, o jogo, o feed: nada disso é proibido. Mas nem tudo merece o espaço que tem ocupado.',
    'E diz também: "Vede com cuidado como andais… aproveitando bem o tempo." (Ef 5,15-16)',
    'Organizar a semana não é deixar de viver. É escolher viver o que importa, começando por Deus, que não disputa espaço com nada. Ele é quem dá lugar a tudo.',
    'Então, como anda o seu tempo?',
  ],
} as const;

export const CLASSIFICATION_TEXT: Record<
  Classification,
  { icon: string; name: string; text: string }
> = {
  PLENA: {
    icon: 'auto_awesome',
    name: 'Semana plena',
    text: 'Deus em primeiro lugar e espaço para viver. Coube o que importa.',
  },
  PESADA: {
    icon: 'menu_book',
    name: 'Semana pesada',
    text: 'Muita responsabilidade e pouco descanso. Deus também quer a sua alegria.',
  },
  VAZIA: {
    icon: 'bubble_chart',
    name: 'Semana vazia',
    text: 'Diversão de sobra, mas pouca coisa que fica. O que você vai lembrar dessa semana?',
  },
  CORRIDA: {
    icon: 'directions_run',
    name: 'Semana corrida',
    text: 'A semana passou e pouca coisa encheu o coração. Que tal recomeçar pelas pedras?',
  },
};
