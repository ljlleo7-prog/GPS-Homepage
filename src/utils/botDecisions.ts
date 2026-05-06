// Minimal bot decision engine for F1 Team Deduction Game

interface BotContext {
  botPlayer: any;
  allPlayers: any[];
  races: any[];
  seasonState: any;
  currentRound: number;
}

interface BotMemory {
  suspicion_scores: Record<string, number>;
  trust_scores: Record<string, number>;
  vote_history: any[];
}

function seedRandom(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash = hash & hash;
  }
  return () => {
    hash = (hash * 9301 + 49297) % 233280;
    return hash / 233280;
  };
}

export function decideBotAction(context: BotContext, memory: BotMemory, seed: string): string | null {
  const { botPlayer, allPlayers, races } = context;
  const rng = seedRandom(seed);

  if (botPlayer.role === 'TC') {
    const target = rng() < 0.5 ? '1' : '2';

    if (botPlayer.alignment === 'positive') {
      return `tc_protect:${target}`;
    } else {
      return `tc_sabotage:${target}`;
    }
  }

  if (botPlayer.role === 'IS' && botPlayer.alignment === 'positive') {
    const alive = allPlayers.filter(p => p.is_alive && p.id !== botPlayer.id);
    if (alive.length > 0) {
      const target = alive[Math.floor(rng() * alive.length)];
      return `is_check:${target.id}`;
    }
  }

  return null;
}

export function decideBotVote(context: BotContext, memory: BotMemory, seed: string): string | null {
  const { botPlayer, allPlayers } = context;
  const rng = seedRandom(seed);

  const alive = allPlayers.filter(p => p.is_alive && p.id !== botPlayer.id);
  if (alive.length === 0) return null;

  if (botPlayer.alignment === 'negative') {
    const positives = alive.filter(p => p.alignment === 'positive');
    if (positives.length > 0) {
      return positives[Math.floor(rng() * positives.length)].id;
    }
  }

  const suspicions = Object.entries(memory.suspicion_scores || {})
    .filter(([id]) => alive.some(p => p.id === id))
    .sort((a, b) => b[1] - a[1]);

  if (suspicions.length > 0 && suspicions[0][1] > 50) {
    return suspicions[0][0];
  }

  return alive[Math.floor(rng() * alive.length)].id;
}

export function updateBotMemory(context: BotContext, memory: BotMemory, raceResult: any): BotMemory {
  const { allPlayers } = context;

  if (!memory.suspicion_scores) memory.suspicion_scores = {};
  if (!memory.trust_scores) memory.trust_scores = {};

  allPlayers.forEach(p => {
    if (!memory.suspicion_scores[p.id]) memory.suspicion_scores[p.id] = 30;
    if (!memory.trust_scores[p.id]) memory.trust_scores[p.id] = 50;
  });

  if (raceResult?.driver_1_dnf || raceResult?.driver_2_dnf) {
    allPlayers.forEach(p => {
      if (p.role === 'TC' && p.is_alive) {
        memory.suspicion_scores[p.id] = Math.min(100, memory.suspicion_scores[p.id] + 10);
      }
    });
  }

  return memory;
}
