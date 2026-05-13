import type { Role, Alignment } from '@/types/deduction';
import type { LocalPlayer, DiscussionMessage, SuspicionMap, SharedKnowledge, BotPrivateKnowledge, BotEvaluation, ParsedComment, RoleCertaintyMap } from './types';

export function logOdds(p: number): number {
  const clamped = Math.max(0.01, Math.min(0.99, p / 100));
  return Math.log(clamped / (1 - clamped));
}

export function fromLogOdds(lo: number): number {
  return Math.round((1 / (1 + Math.exp(-lo))) * 100);
}

export function hasPublicClaimContradiction(claim?: SharedKnowledge['claims'][string]): boolean {
  if (!claim?.role || !claim.actionVerb) return false;
  if (claim.role === 'TP') return claim.actionVerb !== 'ejected';
  if (claim.role === 'TC') return claim.actionVerb !== 'protected' && claim.actionVerb !== 'sabotaged';
  if (claim.role === 'IS') return claim.actionVerb !== 'inspected' && claim.actionVerb !== 'ejected';
  if (claim.role === 'ST') return claim.actionVerb !== 'analyzed' && claim.actionVerb !== 'sabotaged';
  return false;
}

export function hasAbnormalProtectionClaim(baseSuspicion: number, claim?: SharedKnowledge['claims'][string], knowledge?: SharedKnowledge): boolean {
  if (!claim || claim.actionVerb !== 'protected') return false;
  const negativeClaims = Object.values(knowledge?.claims ?? {}).filter((item) => item.alignment === 'negative').length;
  return Boolean(negativeClaims > 1 && claim.actionDriver && (knowledge?.dnfs || baseSuspicion >= 45));
}

export function countRoleClaims(knowledge: SharedKnowledge, role: Role): number {
  return Object.values(knowledge.claims).filter((c) => c.role === role).length;
}

export function isExplosiveClaim(claim?: SharedKnowledge['claims'][string]): boolean {
  return claim?.alignment === 'negative' || claim?.actionVerb === 'sabotaged';
}

export function parseComment(players: LocalPlayer[], message: string): ParsedComment {
  const lower = message.toLowerCase();
  const targetNumberMatch = message.match(/#(\d+)\b/);
  const targetNumber = targetNumberMatch ? Number(targetNumberMatch[1]) : undefined;
  const target = targetNumber === undefined ? null : players.find((player) => player.number === targetNumber) ?? null;
  const roleMatch = message.match(/\b(TP|TC|IS|ST)([+-])?\b/i);
  const claimedRole = roleMatch?.[1]?.toUpperCase() as Role | undefined;
  const claimedAlignment = roleMatch?.[2] === '-' ? 'negative' : roleMatch?.[2] === '+' ? 'positive' : undefined;
  const actionDriverMatch = lower.match(/driver\s*([12])|车手\s*([12])/);
  const actionDriver = actionDriverMatch ? Number(actionDriverMatch[1] ?? actionDriverMatch[2]) : undefined;
  const actionVerb = lower.includes('protect') || lower.includes('保护')
    ? 'protected'
    : lower.includes('sabotage') || lower.includes('破坏')
      ? 'sabotaged'
      : lower.includes('analy') || lower.includes('分析')
        ? 'analyzed'
        : lower.includes('sense') || lower.includes('inspect') || lower.includes('感知') || lower.includes('检查')
          ? 'inspected'
          : lower.includes('eject') || lower.includes('kill') || lower.includes('驱逐') || lower.includes('击杀')
            ? 'ejected'
            : undefined;
  const isSelfClaim = lower.includes('i claim') || lower.includes('my role') || lower.includes('i am') || lower.includes("i'm") || lower.includes('声明') || Boolean(actionVerb || actionDriver);

  if (actionVerb || actionDriver) return { intent: 'claim', target, claimedRole, claimedAlignment, actionDriver, actionVerb, isSelfClaim };
  if (lower.includes('trust') || lower.includes('信任')) return { intent: 'trust', target, claimedRole, claimedAlignment, isSelfClaim: false };
  if (lower.includes('explain') || lower.includes('why') || lower.includes('解释') || lower.includes('为什么')) return { intent: 'ask', target, claimedRole, claimedAlignment, isSelfClaim: false };
  if (lower.includes('abstain') || lower.includes('弃票')) return { intent: 'abstain', target, claimedRole, claimedAlignment, isSelfClaim: false };
  if (lower.includes('claim') || lower.includes('声明') || (claimedRole && !target)) return { intent: 'claim', target, claimedRole, claimedAlignment, isSelfClaim };
  if (lower.includes('certain') || lower.includes('confidence') || lower.includes('确定') || lower.includes('自信')) return { intent: 'challenge', target, claimedRole, claimedAlignment, isSelfClaim: false };
  if (lower.includes('suspect') || lower.includes('suspicious') || lower.includes('怀疑') || lower.includes('可疑')) return { intent: 'suspect', target, claimedRole, claimedAlignment, isSelfClaim: false };

  return { intent: target ? 'suspect' : 'neutral', target, claimedRole, claimedAlignment, isSelfClaim };
}

export function calculateInformationalEntropy(knowledge: SharedKnowledge, playerCount: number): number {
  const claimCount = Object.keys(knowledge.claims).length;
  const roleClaims = Object.values(knowledge.claims).filter((c) => c.role).length;
  const actionClaims = Object.values(knowledge.claims).filter((c) => c.actionVerb).length;
  const alignmentClaims = Object.values(knowledge.claims).filter((c) => c.alignment).length;

  const maxClaims = playerCount - 1;
  const informationScore = (roleClaims + actionClaims + alignmentClaims) / (maxClaims * 3);

  return Math.max(0, Math.min(1, 1 - informationScore));
}

export function parsePublicKnowledge(players: LocalPlayer[], messages: DiscussionMessage[], pressure: number, dnfs: number): SharedKnowledge {
  const claims: SharedKnowledge['claims'] = {};

  messages.forEach((message) => {
    const speaker = players.find((player) => player.id === message.playerId);
    if (!speaker) return;
    const parsed = parseComment(players, message.message);
    if (!parsed.isSelfClaim) return;
    claims[speaker.id] = {
      ...(claims[speaker.id] ?? {}),
      role: parsed.claimedRole ?? claims[speaker.id]?.role,
      alignment: parsed.claimedAlignment ?? claims[speaker.id]?.alignment,
      actionDriver: parsed.actionDriver ?? claims[speaker.id]?.actionDriver,
      actionVerb: parsed.actionVerb ?? claims[speaker.id]?.actionVerb,
    };
  });

  const knowledge: SharedKnowledge = { claims, pressure, dnfs };
  knowledge.entropy = calculateInformationalEntropy(knowledge, players.length);
  return knowledge;
}

export function buildSuspicionMap(players: LocalPlayer[], dnfs: number): SuspicionMap {
  const map: SuspicionMap = {};
  players.filter((p) => p.isAlive).forEach((observer) => {
    map[observer.id] = {};
    players.filter((target) => target.isAlive && target.id !== observer.id).forEach((target) => {
      const base = 20;
      const dnfBonus = dnfs > 0 ? 10 : 0;
      const jitter = Math.floor(Math.random() * 11) - 5;
      map[observer.id][target.id] = Math.max(5, Math.min(50, base + dnfBonus + jitter));
    });
  });
  return map;
}

export function computeSuspicion(
  seed: number,
  bot: LocalPlayer,
  target: LocalPlayer,
  players: LocalPlayer[],
  log: DiscussionMessage[],
  knowledge: SharedKnowledge,
  privateKnowledge?: BotPrivateKnowledge,
): number {
  const knownInfo = privateKnowledge?.inspectedPlayers[target.id] ?? privateKnowledge?.knownRoles[target.id];
  if (knownInfo?.alignment !== undefined) {
    return knownInfo.alignment === 'negative' ? 95 : 5;
  }

  const teammateKnown = bot.alignment === 'negative' && target.alignment === 'negative';
  const prior = teammateKnown ? Math.max(0, seed - 35) : seed;

  let lo = logOdds(prior);

  const inference = privateKnowledge?.inferences[target.id] ?? 0;
  if (inference > 0) {
    lo += inference / 100;
  }

  if (knowledge.dnfs > 0) lo += 0.4 * knowledge.dnfs;

  let hasContradiction = false;
  let hasExplosive = false;
  let claimedRole: Role | undefined;
  let claimedAlignment: Alignment | undefined;
  let claimedActionVerb: string | undefined;
  let claimedActionDriver: number | undefined;
  let trustCount = 0;
  let accuseCount = 0;

  log.forEach((msg) => {
    const isVoteMessage = msg.playerId.startsWith('vote-');

    if (msg.playerId !== target.id) {
      const parsed = parseComment(players, msg.message);
      if (parsed.target?.id === target.id) {
        if (parsed.intent === 'trust') trustCount++;
        if (parsed.intent === 'suspect' || parsed.intent === 'challenge') accuseCount++;
        if (isVoteMessage && parsed.intent === 'suspect') {
          lo += 0.02;
        }
      }
      return;
    }
    const parsed = parseComment(players, msg.message);

    if (parsed.claimedRole) claimedRole = parsed.claimedRole;
    if (parsed.claimedAlignment) claimedAlignment = parsed.claimedAlignment;
    if (parsed.actionVerb) claimedActionVerb = parsed.actionVerb;
    if (parsed.actionDriver) claimedActionDriver = parsed.actionDriver;

    if (isExplosiveClaim({ alignment: parsed.claimedAlignment, actionVerb: parsed.actionVerb })) {
      hasExplosive = true;
    }
    if (claimedRole && claimedActionVerb && hasPublicClaimContradiction({ role: claimedRole, actionVerb: claimedActionVerb })) {
      hasContradiction = true;
    }
  });

  if (hasExplosive) lo += 2.5;

  if (hasContradiction) {
    lo += 1.8;
  } else if (claimedRole && claimedAlignment === 'positive') {
    lo -= 0.9;
    if (claimedActionVerb && !hasPublicClaimContradiction({ role: claimedRole, actionVerb: claimedActionVerb })) {
      lo -= 0.5;
    }
  } else if (!claimedRole && !claimedActionVerb && log.some((m) => m.playerId === target.id)) {
    const entropy = knowledge.entropy ?? 1;
    const informationLevel = 1 - entropy;
    const basePenalty = informationLevel * 0.8;
    const suspicionBonus = informationLevel * 0.4 * (prior / 100);
    lo += basePenalty + suspicionBonus;
  }

  if (claimedRole) {
    const roleClaims = countRoleClaims(knowledge, claimedRole);
    const expectedSlots = claimedRole === 'TP' ? 1 : Math.ceil((players.length - 1) / 3);
    if (roleClaims > expectedSlots) {
      const certaintyBonus = claimedRole === bot.role ? 0.5 : 0;
      lo += (0.4 + certaintyBonus) * (roleClaims - expectedSlots);
    }
  }

  lo += accuseCount * 0.25;
  lo -= trustCount * 0.15;

  const attackCounts: Record<string, number> = {};
  log.forEach((msg) => {
    const parsed = parseComment(players, msg.message);
    if (parsed.target && (parsed.intent === 'suspect' || parsed.intent === 'challenge')) {
      attackCounts[parsed.target.id] = (attackCounts[parsed.target.id] ?? 0) + 1;
    }
  });
  const consensusTarget = Object.entries(attackCounts).sort((a, b) => b[1] - a[1])[0];
  if (consensusTarget && consensusTarget[1] >= 2) {
    const targetAttacked = log.find((msg) => {
      if (msg.playerId !== target.id) return false;
      const parsed = parseComment(players, msg.message);
      return parsed.target && (parsed.intent === 'suspect' || parsed.intent === 'challenge');
    });
    if (targetAttacked) {
      const parsed = parseComment(players, targetAttacked.message);
      if (parsed.target?.id !== consensusTarget[0]) {
        lo += 0.5;
      }
    }
  }

  if (knowledge.pressure >= 18) lo += 0.3;

  if (claimedActionVerb === 'protected' && claimedActionDriver && knowledge.dnfs > 0) lo += 0.4;

  const targetVoteMessages = log.filter((msg) => msg.playerId === `vote-${target.id}`);
  if (targetVoteMessages.length > 0) {
    const voteMsg = targetVoteMessages[0];
    const voteParsed = parseComment(players, voteMsg.message);
    const votedFor = voteParsed.target;

    if (votedFor) {
      const discussionMessages = log.filter((msg) => !msg.playerId.startsWith('vote-') && msg.playerId === target.id);
      const suspectedInDiscussion = discussionMessages.some((msg) => {
        const parsed = parseComment(players, msg.message);
        return parsed.target?.id === votedFor.id && (parsed.intent === 'suspect' || parsed.intent === 'challenge');
      });

      if (!suspectedInDiscussion) {
        const strongSuspicions = discussionMessages.filter((msg) => {
          const parsed = parseComment(players, msg.message);
          return parsed.target && (parsed.intent === 'suspect' || parsed.intent === 'challenge');
        });

        const votedForAttacks = log.filter((msg) => {
          if (msg.playerId === target.id || msg.playerId.startsWith('vote-')) return false;
          const parsed = parseComment(players, msg.message);
          return parsed.target?.id === votedFor.id && (parsed.intent === 'suspect' || parsed.intent === 'challenge');
        }).length;

        const hadStrongOpinions = strongSuspicions.length >= 2;
        const hadSocialPressure = votedForAttacks >= 2;

        if (hadStrongOpinions && !hadSocialPressure) {
          lo += 0.6;
        } else if (!hadStrongOpinions && hadSocialPressure) {
          lo += 0.1;
        } else if (hadStrongOpinions && hadSocialPressure) {
          lo += 0.3;
        } else {
          lo += 0.2;
        }
      }
    }
  }

  const personalityBias = ((bot.id.charCodeAt(1) * 7 + target.id.charCodeAt(1) * 3) % 11) / 100 - 0.05;
  lo += personalityBias;

  return fromLogOdds(lo);
}

export function evaluateBotTargets(bot: LocalPlayer, players: LocalPlayer[], suspicions: SuspicionMap, knowledge: SharedKnowledge, log: DiscussionMessage[], botPrivateKnowledge?: Record<string, BotPrivateKnowledge>): BotEvaluation[] {
  return players
    .filter((target) => target.isAlive && target.id !== bot.id)
    .map((target) => {
      const claim = knowledge.claims[target.id];
      const explosiveClaim = isExplosiveClaim(claim);
      const claimContradiction = hasPublicClaimContradiction(claim);
      const abnormalProtection = hasAbnormalProtectionClaim(0, claim, knowledge);

      const seed = suspicions[bot.id]?.[target.id] ?? 20;
      const publicScore = computeSuspicion(seed, bot, target, players, log, knowledge, botPrivateKnowledge?.[bot.id]);

      const attackCounts: Record<string, number> = {};
      log.forEach((msg) => {
        const parsed = parseComment(players, msg.message);
        if (parsed.target && (parsed.intent === 'suspect' || parsed.intent === 'challenge')) {
          attackCounts[parsed.target.id] = (attackCounts[parsed.target.id] ?? 0) + 1;
        }
      });
      const consensusTarget = Object.entries(attackCounts).sort((a, b) => b[1] - a[1])[0];
      const targetAttackedAnomaly = consensusTarget && consensusTarget[1] >= 2 && log.some((msg) => {
        if (msg.playerId !== target.id) return false;
        const parsed = parseComment(players, msg.message);
        return parsed.target && (parsed.intent === 'suspect' || parsed.intent === 'challenge') && parsed.target.id !== consensusTarget[0];
      });

      const teammate = bot.alignment === 'negative' && target.alignment === 'negative';
      const exposedTeammate = teammate && publicScore >= 80;
      const privateScore = bot.alignment === 'negative'
        ? teammate ? (exposedTeammate ? -4 : -70) : 10
        : 0;
      const totalScore = Math.max(0, Math.min(100, publicScore + privateScore));
      const publicReason: BotEvaluation['publicReason'] = explosiveClaim || claim?.alignment === 'negative' || claimContradiction
        ? 'claim'
        : targetAttackedAnomaly
          ? 'vote'
          : abnormalProtection || knowledge.pressure >= 18
            ? 'pressure'
            : knowledge.dnfs > 0
              ? 'race'
              : 'uncertain';

      return { target, publicScore, privateScore, totalScore, publicReason, shouldBusTeammate: exposedTeammate };
    })
    .sort((a, b) => b.totalScore - a.totalScore);
}

export function getTopEvaluation(bot: LocalPlayer, players: LocalPlayer[], suspicions: SuspicionMap, knowledge: SharedKnowledge, log: DiscussionMessage[], botPrivateKnowledge?: Record<string, BotPrivateKnowledge>): BotEvaluation | null {
  return evaluateBotTargets(bot, players, suspicions, knowledge, log, botPrivateKnowledge)[0] ?? null;
}

export function deriveRoleSuspicion(
  target: LocalPlayer,
  players: LocalPlayer[],
  log: DiscussionMessage[],
  knowledge: SharedKnowledge
): number {
  let lo = 0;
  const claim = knowledge.claims[target.id];
  const roleClaimCount = claim?.role ? countRoleClaims(knowledge, claim.role) : 0;
  const rolePressure = claim?.role === 'TP' ? 0.4 : 0.25;

  if (claim?.role) {
    const contradiction = hasPublicClaimContradiction(claim);
    if (contradiction) {
      lo += 0.9;
    } else {
      lo -= 0.35;
    }

    if (roleClaimCount > 1) {
      lo += Math.min(0.8, (roleClaimCount - 1) * 0.25);
    }
  }

  const actionVerb = claim?.actionVerb;
  if (actionVerb) {
    if ((claim.role === 'TC' && actionVerb === 'protected') || (claim.role === 'IS' && actionVerb === 'inspected') || (claim.role === 'ST' && actionVerb === 'analyzed')) {
      lo -= 0.25;
    } else if ((claim.role === 'TP' && actionVerb !== 'ejected') || (claim.role === 'TC' && actionVerb === 'ejected')) {
      lo += 0.45;
    }
  }

  if (claim?.actionDriver) {
    const driverOutcomes = players
      .filter((p) => p.isAlive || p.id === target.id)
      .map((player) => knowledge.claims[player.id]?.actionDriver)
      .filter((driver) => driver !== undefined);
    if (driverOutcomes.length > 0) {
      const agreement = driverOutcomes.filter((driver) => driver === claim.actionDriver).length / driverOutcomes.length;
      lo += (1 - agreement) * 0.5 - agreement * 0.15;
    }
  }

  const roleMentions = log.filter((msg) => msg.message.toLowerCase().includes(claim?.role?.toLowerCase() ?? '')).length;
  lo += Math.min(0.35, roleMentions * 0.05);

  return lo * rolePressure;
}

export function derivePublicSuspicions(
  players: LocalPlayer[],
  log: DiscussionMessage[],
  knowledge: SharedKnowledge,
  base: SuspicionMap,
  botPrivateKnowledge?: Record<string, BotPrivateKnowledge>
): SuspicionMap {
  const result: SuspicionMap = {};

  players.filter((obs) => !obs.isHuman && obs.isAlive).forEach((observer) => {
    result[observer.id] = {};
    players.filter((target) => target.isAlive && target.id !== observer.id).forEach((target) => {
      const seed = base[observer.id]?.[target.id] ?? 20;
      let lo = logOdds(seed);
      lo += deriveRoleSuspicion(target, players, log, knowledge);

      const publicClaim = knowledge.claims[target.id];
      const negativeClaims = Object.values(knowledge.claims).filter((claim) => claim.alignment === 'negative').length;
      if (publicClaim?.alignment === 'negative') lo += 0.3;
      if (publicClaim?.actionVerb === 'protected' && knowledge.dnfs > 0 && negativeClaims > 1) lo += 0.15;
      if (publicClaim?.actionVerb === 'inspected' && publicClaim.role === 'IS') lo -= 0.1;
      if (publicClaim?.actionVerb === 'analyzed' && publicClaim.role === 'ST') lo -= 0.1;

      const privateInfo = botPrivateKnowledge?.[observer.id];
      if (privateInfo?.knownRoles[target.id]?.alignment === 'negative') lo += 1.4;
      if (privateInfo?.knownRoles[target.id]?.alignment === 'positive') lo -= 1.0;
      if (privateInfo?.inspectedPlayers[target.id]) lo += privateInfo.inspectedPlayers[target.id].alignment === 'negative' ? 2.0 : -1.5;

      result[observer.id][target.id] = fromLogOdds(lo);
    });
  });

  return result;
}

export function updateSuspicionsAfterDeath(
  eliminated: LocalPlayer,
  voteResults: Record<string, string>,
  currentSuspicions: SuspicionMap,
  gameLog: DiscussionMessage[],
  knowledge: SharedKnowledge,
  players: LocalPlayer[]
): SuspicionMap {
  const updated: SuspicionMap = {};
  const votedForEliminated = Object.entries(voteResults)
    .filter(([_, targetId]) => targetId === eliminated.id)
    .map(([voterId]) => voterId);
  const firstVoteForEliminated = Object.entries(voteResults).find(([_, targetId]) => targetId === eliminated.id)?.[0];

  players.filter((obs) => !obs.isHuman && obs.isAlive).forEach((observer) => {
    updated[observer.id] = { ...(currentSuspicions[observer.id] ?? {}) };

    players.filter((tgt) => tgt.isAlive && tgt.id !== observer.id).forEach((target) => {
      const currentSus = updated[observer.id][target.id] ?? 20;
      const currentLo = logOdds(currentSus);

      const targetVotedForEliminated = votedForEliminated.includes(target.id);
      const accusationCount = gameLog.filter((msg) => {
        if (msg.playerId !== target.id) return false;
        const parsed = parseComment(players, msg.message);
        return parsed.target?.id === eliminated.id && (parsed.intent === 'suspect' || parsed.intent === 'challenge');
      }).length;
      const defenseCount = gameLog.filter((msg) => {
        if (msg.playerId !== target.id) return false;
        const parsed = parseComment(players, msg.message);
        return parsed.target?.id === eliminated.id && parsed.intent === 'trust';
      }).length;

      let adjustment = 0;
      const jitter = (Math.random() - 0.5) * 0.15;

      const voterCredibility = 1 - Math.min(0.65, Math.max(0, currentSus - 35) / 80);
      const initiatorCurve = target.id === firstVoteForEliminated ? 1.35 + Math.random() * 0.25 : 0.85 + Math.random() * 0.2;

      if (eliminated.alignment === 'positive') {
        if (targetVotedForEliminated) {
          const baseImpact = 0.42 + Math.random() * 0.18;
          const intensityCurve = Math.min(1.35, 0.75 + accusationCount * 0.22);
          adjustment += baseImpact * intensityCurve * initiatorCurve * voterCredibility + jitter;
        }
        if (accusationCount > 0) {
          const baseImpact = 0.3 + Math.random() * 0.2;
          const curve = Math.log(1 + accusationCount) * 0.4;
          adjustment += baseImpact + curve + jitter;
        }
      } else {
        if (defenseCount > 0) {
          const baseImpact = 0.6 + Math.random() * 0.3;
          const curve = Math.tanh(defenseCount * 0.5) * 0.5;
          adjustment += baseImpact + curve + jitter;
        }
        if (!targetVotedForEliminated && accusationCount > 0) {
          const reward = -(0.2 + Math.random() * 0.15);
          adjustment += reward + jitter * 0.5;
        }
      }

      const eliminatedClaim = knowledge.claims[eliminated.id];
      const targetClaim = knowledge.claims[target.id];
      if (eliminatedClaim?.role && targetClaim?.role && eliminatedClaim.role === targetClaim.role) {
        const ccImpact = 0.9 + Math.random() * 0.5;
        const susModifier = currentSus < 50 ? 1.2 : 0.8;
        adjustment += ccImpact * susModifier + jitter;
      }

      if (adjustment !== 0) {
        const dampening = currentSus > 70 ? 0.7 : currentSus > 50 ? 0.85 : 1.0;
        updated[observer.id][target.id] = fromLogOdds(currentLo + adjustment * dampening);
      }
    });
  });

  return updated;
}

export function isAtRiskOfElimination(
  bot: LocalPlayer,
  suspicions: SuspicionMap,
  players: LocalPlayer[]
): { atRisk: boolean; avgSuspicion: number; maxSuspicion: number; suspiciousCount: number } {
  const aliveBots = players.filter((p) => !p.isHuman && p.isAlive && p.id !== bot.id);
  const suspicionValues = aliveBots
    .map((observer) => suspicions[observer.id]?.[bot.id] ?? 20)
    .filter((v) => v !== undefined);

  if (suspicionValues.length === 0) {
    return { atRisk: false, avgSuspicion: 20, maxSuspicion: 20, suspiciousCount: 0 };
  }

  const avgSuspicion = suspicionValues.reduce((sum, v) => sum + v, 0) / suspicionValues.length;
  const maxSuspicion = Math.max(...suspicionValues);
  const suspiciousCount = suspicionValues.filter((v) => v >= 60).length;

  const atRisk = avgSuspicion >= 55 || maxSuspicion >= 75 || suspiciousCount >= Math.ceil(aliveBots.length * 0.4);

  return { atRisk, avgSuspicion, maxSuspicion, suspiciousCount };
}

export function findStrategicTarget(
  bot: LocalPlayer,
  players: LocalPlayer[],
  suspicions: SuspicionMap,
  knowledge: SharedKnowledge
): LocalPlayer | null {
  const alivePlayers = players.filter((p) => p.isAlive && p.id !== bot.id);

  const candidates = alivePlayers.map((target) => {
    const targetRisk = isAtRiskOfElimination(target, suspicions, players);
    const hasClaimConflict = knowledge.claims[bot.id]?.role && knowledge.claims[target.id]?.role &&
                             knowledge.claims[bot.id].role === knowledge.claims[target.id].role;
    const targetSusFromBot = suspicions[bot.id]?.[target.id] ?? 20;

    const othersSusOfTarget = players
      .filter((p) => !p.isHuman && p.isAlive && p.id !== bot.id && p.id !== target.id)
      .map((obs) => suspicions[obs.id]?.[target.id] ?? 20);
    const avgOthersSus = othersSusOfTarget.length > 0
      ? othersSusOfTarget.reduce((sum, v) => sum + v, 0) / othersSusOfTarget.length
      : 20;

    const score = avgOthersSus * 0.6 + targetSusFromBot * 0.3 + (hasClaimConflict ? 25 : 0) + (targetRisk.atRisk ? 15 : 0);

    return { target, score, avgOthersSus };
  });

  candidates.sort((a, b) => b.score - a.score);

  return candidates[0]?.score > 35 ? candidates[0].target : null;
}

export function buildRoleCertaintyMap(players: LocalPlayer[], knowledge: SharedKnowledge): RoleCertaintyMap {
  const map: RoleCertaintyMap = {};
  const alivePlayers = players.filter((p) => p.isAlive);

  alivePlayers.forEach((observer) => {
    if (observer.isHuman) return;
    map[observer.id] = {};

    alivePlayers.forEach((target) => {
      if (target.id === observer.id) return;

      const certainty: Partial<Record<Role, number>> = { TP: 25, TC: 25, IS: 25, ST: 25 };
      const claim = knowledge.claims[target.id];

      if (claim?.role) {
        certainty[claim.role] = (certainty[claim.role] ?? 0) + 35;
        if (hasPublicClaimContradiction(claim)) {
          certainty[claim.role] = Math.max(0, (certainty[claim.role] ?? 0) - 30);
          const otherRoles = (['TP', 'TC', 'IS', 'ST'] as Role[]).filter((r) => r !== claim.role);
          otherRoles.forEach((r) => {
            certainty[r] = (certainty[r] ?? 0) + 10;
          });
        }
      }

      if (claim?.actionVerb) {
        if (claim.actionVerb === 'protected' || claim.actionVerb === 'sabotaged') {
          certainty.TC = (certainty.TC ?? 0) + 20;
        } else if (claim.actionVerb === 'analyzed') {
          certainty.ST = (certainty.ST ?? 0) + 20;
        } else if (claim.actionVerb === 'inspected' || claim.actionVerb === 'ejected') {
          certainty.IS = (certainty.IS ?? 0) + 15;
          certainty.TP = (certainty.TP ?? 0) + 5;
        }
      }

      if (knowledge.dnfs > 0) {
        certainty.TC = (certainty.TC ?? 0) + 10;
        certainty.ST = (certainty.ST ?? 0) + 10;
      }

      if (observer.alignment === 'negative' && target.alignment === 'negative') {
        certainty[target.role] = 90;
        (['TP', 'TC', 'IS', 'ST'] as Role[]).filter((r) => r !== target.role).forEach((r) => {
          certainty[r] = 5;
        });
      }

      const total = (certainty.TP ?? 0) + (certainty.TC ?? 0) + (certainty.IS ?? 0) + (certainty.ST ?? 0);
      if (total > 0) {
        certainty.TP = Math.round(((certainty.TP ?? 0) / total) * 100);
        certainty.TC = Math.round(((certainty.TC ?? 0) / total) * 100);
        certainty.IS = Math.round(((certainty.IS ?? 0) / total) * 100);
        certainty.ST = Math.round(((certainty.ST ?? 0) / total) * 100);
      }

      map[observer.id][target.id] = certainty;
    });
  });

  return map;
}
