// Minimal bot phrase templates for MVP

export const BOT_PHRASES = {
  en: {
    suspicion: [
      "Something feels off about {player}",
      "I don't trust {player}",
      "{player} seems suspicious",
    ],
    defense: [
      "I think {player} is innocent",
      "{player} has been helpful",
      "We should look elsewhere",
    ],
    reaction_dnf: [
      "Another DNF... this is bad",
      "The team is falling apart",
      "We need to find who's sabotaging",
    ],
    reaction_success: [
      "Good race, finally",
      "That's more like it",
      "We're back on track",
    ],
    voting: [
      "I'm voting {player}",
      "{player} has to go",
      "Time to fire {player}",
    ],
  },
  zh: {
    suspicion: [
      "{player}有点可疑",
      "我不信任{player}",
      "{player}的行为很奇怪",
    ],
    defense: [
      "我觉得{player}是清白的",
      "{player}一直在帮忙",
      "应该看看别人",
    ],
    reaction_dnf: [
      "又退赛了...",
      "车队要完了",
      "必须找出内鬼",
    ],
    reaction_success: [
      "终于正常了",
      "不错的比赛",
      "回到正轨了",
    ],
    voting: [
      "我投{player}",
      "{player}必须走",
      "开除{player}",
    ],
  },
};

export function generateBotMessage(
  type: keyof typeof BOT_PHRASES.en,
  language: 'en' | 'zh',
  targetPlayer?: string,
  rng?: () => number
): string | null {
  const phrases = BOT_PHRASES[language][type];
  if (!phrases || phrases.length === 0) return null;

  const random = rng || Math.random;
  const phrase = phrases[Math.floor(random() * phrases.length)];

  if (targetPlayer) {
    return phrase.replace('{player}', targetPlayer);
  }

  return phrase;
}
