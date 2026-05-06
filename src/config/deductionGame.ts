// F1 Team Deduction Game Configuration

import type { Role, Alignment } from '@/types/deduction';

// ============================================================================
// ROLE ASSIGNMENT
// ============================================================================

export const ROLE_SEQUENCE: Role[] = ['TC', 'IS', 'ST'];

export function assignRoles(playerCount: number): Role[] {
  const roles: Role[] = ['TP'];
  let sequenceIndex = 0;

  for (let i = 1; i < playerCount; i++) {
    roles.push(ROLE_SEQUENCE[sequenceIndex]);
    sequenceIndex = (sequenceIndex + 1) % ROLE_SEQUENCE.length;
  }

  return roles;
}

// ============================================================================
// NEGATIVE COUNT TABLE
// ============================================================================

export const DEFAULT_NEGATIVE_COUNTS: Record<number, number> = {
  4: 1,
  5: 1,
  6: 1,
  7: 2,
  8: 2,
  9: 2,
  10: 2,
  11: 3,
  12: 3,
};

export function getNegativeCount(playerCount: number, override?: number): number {
  if (override !== undefined && override !== null) return override;
  return DEFAULT_NEGATIVE_COUNTS[playerCount] || Math.floor(playerCount / 3);
}

// ============================================================================
// TP NEGATIVE PROBABILITY
// ============================================================================

export const TP_NEGATIVE_PROBABILITY = {
  off: 0,
  rare: 0.15,
  allowed: 1.0,
};

// ============================================================================
// RACE RANDOMNESS
// ============================================================================

export const BASE_DNF_RATE = 0.2;
export const SABOTAGE_DNF_INCREASE = 0.4;
export const PROTECTION_EFFECTIVENESS = 0.8;

// ============================================================================
// EXPULSION THRESHOLDS
// ============================================================================

export const DEFAULT_EXPULSION_THRESHOLDS = {
  board_threshold: 3,
  integrity_threshold: 100,
  sporting_threshold: 5,
};

export const CONSECUTIVE_DNF_BOARD_PRESSURE = 15;
export const SINGLE_DNF_BOARD_PRESSURE = 5;
export const LEAK_INTEGRITY_PRESSURE = 25;
export const SABOTAGE_DETECTED_SPORTING_PRESSURE = 1;

// ============================================================================
// TIMERS (seconds)
// ============================================================================

export const DEFAULT_TIMERS = {
  night: 60,
  discussion: 120,
  voting: 60,
};

// ============================================================================
// TRACK DATA
// ============================================================================

export const TRACKS = [
  { id: 'bahrain', name: 'Bahrain', risk: 1.0 },
  { id: 'jeddah', name: 'Saudi Arabia', risk: 1.2 },
  { id: 'melbourne', name: 'Australia', risk: 0.9 },
  { id: 'suzuka', name: 'Japan', risk: 1.1 },
  { id: 'shanghai', name: 'China', risk: 0.95 },
  { id: 'miami', name: 'Miami', risk: 1.0 },
  { id: 'imola', name: 'Emilia Romagna', risk: 1.15 },
  { id: 'monaco', name: 'Monaco', risk: 1.4 },
  { id: 'montreal', name: 'Canada', risk: 1.1 },
  { id: 'barcelona', name: 'Spain', risk: 0.85 },
  { id: 'spielberg', name: 'Austria', risk: 0.9 },
  { id: 'silverstone', name: 'Great Britain', risk: 1.0 },
  { id: 'hungaroring', name: 'Hungary', risk: 0.95 },
  { id: 'spa', name: 'Belgium', risk: 1.3 },
  { id: 'zandvoort', name: 'Netherlands', risk: 1.05 },
  { id: 'monza', name: 'Italy', risk: 1.2 },
  { id: 'baku', name: 'Azerbaijan', risk: 1.25 },
  { id: 'singapore', name: 'Singapore', risk: 1.35 },
  { id: 'austin', name: 'United States', risk: 1.0 },
  { id: 'mexico', name: 'Mexico', risk: 1.05 },
  { id: 'interlagos', name: 'Brazil', risk: 1.15 },
  { id: 'vegas', name: 'Las Vegas', risk: 1.1 },
  { id: 'losail', name: 'Qatar', risk: 0.95 },
  { id: 'yas', name: 'Abu Dhabi', risk: 0.9 },
];

export function generateSeasonCalendar(raceCount: number, seed: string): typeof TRACKS {
  const rng = seedRandom(seed);
  const shuffled = [...TRACKS].sort(() => rng() - 0.5);
  return shuffled.slice(0, raceCount);
}

// ============================================================================
// BOT PERSONALITIES
// ============================================================================

export const BOT_PERSONALITIES = {
  aggressive: {
    aggression: 0.8,
    trust_bias: 0.3,
    accusation_threshold: 0.4,
    reveal_threshold: 0.6,
  },
  cautious: {
    aggression: 0.3,
    trust_bias: 0.6,
    accusation_threshold: 0.7,
    reveal_threshold: 0.8,
  },
  balanced: {
    aggression: 0.5,
    trust_bias: 0.5,
    accusation_threshold: 0.55,
    reveal_threshold: 0.7,
  },
  chaotic: {
    aggression: 0.7,
    trust_bias: 0.4,
    accusation_threshold: 0.3,
    reveal_threshold: 0.5,
  },
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function seedRandom(seed: string): () => number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash = hash & hash;
  }

  return function() {
    hash = (hash * 9301 + 49297) % 233280;
    return hash / 233280;
  };
}

export function generateRoundSeed(seasonSeed: string, round: number): string {
  return `${seasonSeed}-r${round}`;
}

export function calculateDNFProbability(
  baseDNF: number,
  trackRisk: number,
  isSabotaged: boolean,
  isProtected: boolean
): number {
  let prob = baseDNF * trackRisk;

  if (isSabotaged && !isProtected) {
    prob += SABOTAGE_DNF_INCREASE;
  } else if (isSabotaged && isProtected) {
    prob += SABOTAGE_DNF_INCREASE * (1 - PROTECTION_EFFECTIVENESS);
  }

  return Math.min(prob, 0.95);
}
