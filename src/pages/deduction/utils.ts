import { assignRoles, getNegativeCount } from '@/config/deductionGame';
import type { Role, Alignment } from '@/types/deduction';
import type { LocalPlayer, BotPersonalityType } from './types';
import { BOT_PERSONALITIES } from '@/config/deductionGame';

const botNames = ['Vega', 'Orion', 'Nova', 'Apex', 'Rift', 'Pulse', 'Echo', 'Blitz'];

export function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export function makePlayers(count: number, observerMode: boolean = false): LocalPlayer[] {
  const roles = assignRoles(count);
  const negativeCount = getNegativeCount(count);
  const negativeIndices = shuffle([...Array(count).keys()]).slice(0, negativeCount);
  const alignments: Alignment[] = roles.map((_, i) => negativeIndices.includes(i) ? 'negative' : 'positive');
  const roleCards = roles.map((role, i) => ({ role, alignment: alignments[i] }));
  const humanSeat = observerMode ? -1 : Math.floor(Math.random() * count);
  const shuffledBotNames = shuffle(botNames).slice(0, observerMode ? count : Math.max(0, count - 1));
  const personalities: BotPersonalityType[] = ['aggressive', 'cautious', 'balanced', 'chaotic'];
  return roleCards.map((card, index) => {
    const isHuman = index === humanSeat;
    return {
      id: `p${index + 1}`,
      number: index + 1,
      name: isHuman ? 'You' : shuffledBotNames[isHuman ? index : index > humanSeat ? index - 1 : index],
      role: card.role,
      alignment: card.alignment,
      isAlive: true,
      isHuman,
      personality: isHuman ? undefined : pickRandom(personalities),
    };
  });
}

export function logOdds(probability: number): number {
  const p = Math.max(0.01, Math.min(0.99, probability / 100));
  return Math.log(p / (1 - p));
}

export function fromLogOdds(lo: number): number {
  const p = 1 / (1 + Math.exp(-lo));
  return Math.max(1, Math.min(99, p * 100));
}

export function claimCode(role: Role, alignment: Alignment): string {
  return `${role}${alignment === 'positive' ? '+' : '-'}`;
}

export function buildSuspicionMap(players: LocalPlayer[], dnfCount: number): Record<string, Record<string, number>> {
  const map: Record<string, Record<string, number>> = {};
  players.filter((p) => p.isAlive).forEach((observer) => {
    map[observer.id] = {};
    players.filter((target) => target.isAlive && target.id !== observer.id).forEach((target) => {
      const base = 20;
      const dnfBonus = dnfCount > 0 ? 10 : 0;
      const jitter = Math.floor(Math.random() * 11) - 5;
      map[observer.id][target.id] = Math.max(5, Math.min(50, base + dnfBonus + jitter));
    });
  });
  return map;
}

export function isExplosiveClaim(claim?: { alignment?: Alignment; actionVerb?: string }): boolean {
  return claim?.alignment === 'negative' || claim?.actionVerb === 'sabotaged';
}

export function hasPublicClaimContradiction(claim?: { role?: Role; actionVerb?: string }): boolean {
  if (!claim || !claim.role || !claim.actionVerb) return false;
  if (claim.role === 'TP') return claim.actionVerb !== 'inspected' && claim.actionVerb !== 'ejected';
  if (claim.role === 'TC') return claim.actionVerb !== 'protected' && claim.actionVerb !== 'sabotaged';
  if (claim.role === 'IS') return claim.actionVerb !== 'inspected' && claim.actionVerb !== 'ejected';
  if (claim.role === 'ST') return claim.actionVerb !== 'analyzed' && claim.actionVerb !== 'sabotaged';
  return false;
}

export function hasAbnormalProtectionClaim(round: number, claim?: { role?: Role; actionVerb?: string; actionDriver?: number }, knowledge?: { dnfs: number }): boolean {
  if (!claim || claim.actionVerb !== 'protected') return false;
  if (!claim.actionDriver || !knowledge) return false;
  return knowledge.dnfs > 0;
}

export function countRoleClaims(knowledge: { claims: Record<string, { role?: Role }> }, role: Role): number {
  return Object.values(knowledge.claims).filter((claim) => claim.role === role).length;
}
