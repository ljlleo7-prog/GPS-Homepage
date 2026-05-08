import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Flag, AlertTriangle, Send } from 'lucide-react';
import { assignRoles, getNegativeCount } from '@/config/deductionGame';
import type { Alignment, Role, RoomStatus } from '@/types/deduction';

interface LocalPlayer {
  id: string;
  number: number;
  name: string;
  role: Role;
  alignment: Alignment;
  isAlive: boolean;
  isHuman: boolean;
}

interface LocalRace {
  round: number;
  report: string;
  driver1DNF: boolean;
  driver2DNF: boolean;
  fired?: string;
}

interface DiscussionMessage {
  playerId: string;
  playerNumber: number;
  playerName: string;
  message: string;
  delayMs?: number;
}

type SuspicionMap = Record<string, Record<string, number>>;

interface BotEvaluation {
  target: LocalPlayer;
  publicScore: number;
  privateScore: number;
  totalScore: number;
  publicReason: 'race' | 'claim' | 'pressure' | 'vote' | 'uncertain';
  shouldBusTeammate: boolean;
}

interface SharedKnowledge {
  claims: Record<string, { role?: Role; alignment?: Alignment; actionDriver?: number; actionVerb?: string }>;
  pressure: number;
  dnfs: number;
}

type CommentIntent = 'suspect' | 'trust' | 'ask' | 'abstain' | 'claim' | 'challenge' | 'neutral';
type TemplateIntent = 'sus' | 'trust' | 'ask' | 'claim' | 'action' | 'def' | 'self' | 'logic' | 'attack' | 'explain' | 'vote' | 'world' | 'switch' | 'abs';
type TemplateReason = 'race_dnf' | 'race_clean' | 'claim_role' | 'claim_action' | 'claim_contradiction' | 'vote_pressure' | 'timing_push' | 'role_tp' | 'role_tc' | 'role_is' | 'role_st' | 'uncertain';
type TemplateCertainty = 'weak' | 'medium' | 'strong';
type TemplateModule = 'intent' | 'reason' | 'certainty';

interface ParsedComment {
  intent: CommentIntent;
  target?: LocalPlayer;
  claimedRole?: Role;
  claimedAlignment?: Alignment;
  actionDriver?: number;
  actionVerb?: 'protected' | 'sabotaged' | 'analyzed';
}

const botNames = ['Vega', 'Orion', 'Nova', 'Apex', 'Rift', 'Pulse', 'Echo', 'Blitz'];

function shuffle<T>(items: T[]): T[] {
  return [...items].sort(() => Math.random() - 0.5);
}

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function makePlayers(count: number): LocalPlayer[] {
  const roles = assignRoles(count);
  const negativeCount = getNegativeCount(count);
  const negativeSeats = new Set<number>();

  for (let i = count - negativeCount; i < count; i += 1) {
    negativeSeats.add(i);
  }

  const roleCards = shuffle(roles.map((role, index) => ({
    role,
    alignment: negativeSeats.has(index) ? 'negative' as Alignment : 'positive' as Alignment,
  })));
  const humanSeat = Math.floor(Math.random() * count);
  const shuffledIds = shuffle(Array.from({ length: count }, (_, i) => `p${i}`));
  const shuffledBotNames = shuffle(botNames).slice(0, Math.max(0, count - 1));
  let botNameIndex = 0;

  return roleCards.map((card, index) => {
    const isHuman = index === humanSeat;
    return {
      id: shuffledIds[index],
      number: index + 1,
      name: isHuman ? 'You' : shuffledBotNames[botNameIndex++] ?? `Bot ${botNameIndex}`,
      role: card.role,
      alignment: card.alignment,
      isAlive: true,
      isHuman,
    };
  });
}

function parsePublicKnowledge(players: LocalPlayer[], messages: DiscussionMessage[], pressure: number, dnfs: number): SharedKnowledge {
  const claims: SharedKnowledge['claims'] = {};

  messages.forEach((message) => {
    const speaker = players.find((player) => player.id === message.playerId);
    if (!speaker) return;
    const parsed = parseComment(players, message.message);
    claims[speaker.id] = {
      ...(claims[speaker.id] ?? {}),
      role: parsed.claimedRole ?? claims[speaker.id]?.role,
      alignment: parsed.claimedAlignment ?? claims[speaker.id]?.alignment,
      actionDriver: parsed.actionDriver ?? claims[speaker.id]?.actionDriver,
      actionVerb: parsed.actionVerb ?? claims[speaker.id]?.actionVerb,
    };
  });

  return { claims, pressure, dnfs };
}

function hasPublicClaimContradiction(claim?: SharedKnowledge['claims'][string]): boolean {
  if (!claim?.role || !claim.actionVerb) return false;
  if (claim.role === 'TP') return true;
  if (claim.role === 'TC') return claim.actionVerb === 'analyzed';
  if (claim.role === 'ST') return claim.actionVerb === 'protected';
  return claim.actionVerb !== undefined;
}

function evaluateBotTargets(bot: LocalPlayer, players: LocalPlayer[], suspicions: SuspicionMap, knowledge: SharedKnowledge): BotEvaluation[] {
  return players
    .filter((target) => target.isAlive && target.id !== bot.id)
    .map((target) => {
      const claim = knowledge.claims[target.id];
      const explosiveClaim = isExplosiveClaim(claim);
      const publicScore = (suspicions[bot.id]?.[target.id] ?? 20)
        + (knowledge.dnfs * 8)
        + (explosiveClaim ? 65 : 0)
        + (claim?.alignment === 'negative' ? 25 : 0)
        + (hasPublicClaimContradiction(claim) ? 10 : 0)
        - (claim?.alignment === 'positive' && !explosiveClaim ? 8 : 0);
      const teammate = bot.alignment === 'negative' && target.alignment === 'negative';
      const exposedTeammate = teammate && publicScore >= 80;
      const privateScore = bot.alignment === 'negative'
        ? teammate
          ? (exposedTeammate ? -4 : -70)
          : 10
        : 0;
      const totalScore = Math.max(0, Math.min(100, publicScore + privateScore));
      const publicReason: BotEvaluation['publicReason'] = explosiveClaim || claim?.alignment === 'negative'
        ? 'claim'
        : knowledge.pressure >= 18
          ? 'pressure'
          : knowledge.dnfs > 0
            ? 'race'
            : 'uncertain';

      return {
        target,
        publicScore,
        privateScore,
        totalScore,
        publicReason,
        shouldBusTeammate: exposedTeammate,
      };
    })
    .sort((a, b) => b.totalScore - a.totalScore);
}

function getTopEvaluation(bot: LocalPlayer, players: LocalPlayer[], suspicions: SuspicionMap, knowledge: SharedKnowledge): BotEvaluation | null {
  return evaluateBotTargets(bot, players, suspicions, knowledge)[0] ?? null;
}

function buildSuspicionMap(players: LocalPlayer[], dnfs: number): SuspicionMap {
  const next: SuspicionMap = {};

  players.filter((player) => !player.isHuman && player.isAlive).forEach((bot) => {
    next[bot.id] = {};
    players.filter((target) => target.isAlive && target.id !== bot.id).forEach((target) => {
      const dnfPressure = dnfs * 14;
      const tpDiscount = 0;
      const teammateDiscount = bot.alignment === 'negative' && target.alignment === 'negative' ? 35 : 0;
      next[bot.id][target.id] = Math.max(0, Math.min(100, 18 + dnfPressure + Math.floor(Math.random() * 35) - tpDiscount - teammateDiscount));
    });
  });

  return next;
}

function buildBotDiscussionQueue(players: LocalPlayer[], dnfs: number, suspicions: SuspicionMap, driver1DNF: boolean, driver2DNF: boolean, knowledge: SharedKnowledge, t: (key: string, params?: Record<string, unknown>) => string): DiscussionMessage[] {
  const aliveBots = shuffle(players.filter((player) => !player.isHuman && player.isAlive));

  return aliveBots.flatMap((bot, index) => {
    const evaluation = getTopEvaluation(bot, players, suspicions, knowledge);
    const suspect = evaluation?.target;
    const useDriverReference = Math.random() < 0.5 && dnfs > 0;

    let opener: string;
    if (index === 0 && bot.role !== 'TP') {
      const claimRole = botClaim(bot);
      opener = t('deduction_game.log.bot_role_claim', { role: claimCode(claimRole, botClaimAlignment(bot)) });
    } else if (bot.role === 'TC' || bot.role === 'IS' || bot.role === 'ST') {
      const driver = botClaimedDriver(bot, dnfs);
      const action = botClaimedAction(bot, t);
      opener = t('deduction_game.log.bot_action_claim', { action, driver });
    } else if (useDriverReference && dnfs === 1) {
      const dnfDriver = driver1DNF ? 1 : 2;
      opener = t(`deduction_game.log.bot_driver_ref_${(index % 2) + 1}`, { driver: dnfDriver });
    } else if (useDriverReference && dnfs === 2) {
      opener = t(`deduction_game.log.bot_both_dnf_${(index % 2) + 1}`);
    } else {
      const openerKey = dnfs === 0 ? `bot_clean_${(index % 3) + 1}` : dnfs === 1 ? `bot_one_dnf_${(index % 3) + 1}` : `bot_two_dnf_${(index % 3) + 1}`;
      opener = t(`deduction_game.log.${openerKey}`);
    }

    const followUp = suspect
      ? t(`deduction_game.log.bot_evaluation_${evaluation.publicReason}`, {
        number: suspect.number,
        confidence: evaluation.totalScore >= 70 ? t('deduction_game.log.confidence_high') : evaluation.totalScore >= 48 ? t('deduction_game.log.confidence_medium') : t('deduction_game.log.confidence_low'),
      })
      : t(`deduction_game.log.bot_uncertain_${(index % 3) + 1}`);

    const sharedTemplate = buildSharedBotTemplate(bot, suspect, evaluation, dnfs, t);

    return [{
      playerId: bot.id,
      playerNumber: bot.number,
      playerName: bot.name,
      message: opener,
      delayMs: 1800 + index * 900,
    }, {
      playerId: bot.id,
      playerNumber: bot.number,
      playerName: bot.name,
      message: followUp,
      delayMs: 5000 + index * 1200,
    }, {
      playerId: bot.id,
      playerNumber: bot.number,
      playerName: bot.name,
      message: sharedTemplate,
      delayMs: 8200 + index * 1300,
    }];
  });
}

function parseComment(players: LocalPlayer[], message: string): ParsedComment {
  const lower = message.toLowerCase();
  const target = players.find((player) => message.includes(`#${player.number}`));
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
        : undefined;

  if (actionVerb || actionDriver) return { intent: 'claim', target, claimedRole, claimedAlignment, actionDriver, actionVerb };
  if (lower.includes('trust') || lower.includes('信任')) return { intent: 'trust', target, claimedRole, claimedAlignment };
  if (lower.includes('explain') || lower.includes('why') || lower.includes('解释') || lower.includes('为什么')) return { intent: 'ask', target, claimedRole, claimedAlignment };
  if (lower.includes('abstain') || lower.includes('弃票')) return { intent: 'abstain', target, claimedRole, claimedAlignment };
  if (lower.includes('claim') || lower.includes('声明') || claimedRole) return { intent: 'claim', target, claimedRole, claimedAlignment };
  if (lower.includes('certain') || lower.includes('confidence') || lower.includes('确定') || lower.includes('自信')) return { intent: 'challenge', target, claimedRole, claimedAlignment };
  if (lower.includes('suspect') || lower.includes('suspicious') || lower.includes('怀疑') || lower.includes('可疑')) return { intent: 'suspect', target, claimedRole, claimedAlignment };

  return { intent: target ? 'suspect' : 'neutral', target, claimedRole, claimedAlignment };
}

function botClaim(bot: LocalPlayer): Role {
  if (bot.alignment === 'positive') return bot.role;
  if (bot.role === 'TP') return 'TP';
  return (['TC', 'IS', 'ST'] as Role[])[bot.number % 3];
}

function botClaimAlignment(bot: LocalPlayer): Alignment {
  return bot.alignment === 'negative' ? 'positive' : bot.alignment;
}

function botClaimedAction(bot: LocalPlayer, t: (key: string, params?: Record<string, unknown>) => string): string {
  const claimedRole = botClaim(bot);
  if (claimedRole === 'TC') return t('deduction_game.actions.protect').toLowerCase();
  if (claimedRole === 'IS') return t('deduction_game.actions.inspect').toLowerCase();
  if (claimedRole === 'ST') return t('deduction_game.actions.analyze').toLowerCase();
  return t('deduction_game.actions.no_action').toLowerCase();
}

function botClaimedDriver(bot: LocalPlayer, dnfs: number): number {
  return ((bot.number + dnfs) % 2) + 1;
}

function isExplosiveClaim(claim?: SharedKnowledge['claims'][string]): boolean {
  return claim?.alignment === 'negative' || claim?.actionVerb === 'sabotaged';
}

function alignmentCode(alignment: Alignment): '+' | '-' {
  return alignment === 'positive' ? '+' : '-';
}

function claimCode(role: Role, alignment: Alignment = 'positive'): string {
  return `${role}${alignmentCode(alignment)}`;
}

function defaultTemplateModules(intent: TemplateIntent): TemplateModule[] {
  if (['claim', 'action', 'self', 'logic', 'explain', 'world', 'abs'].includes(intent)) return ['intent'];
  if (['sus', 'attack', 'vote', 'switch'].includes(intent)) return ['intent', 'reason', 'certainty'];
  return ['intent', 'reason'];
}

function buildTemplateMessage(intent: TemplateIntent, targetNumber: number, reason: TemplateReason, certainty: TemplateCertainty, roleLabel: string, actionLabel: string, driverNumber: number, t: (key: string, params?: Record<string, unknown>) => string, modules: TemplateModule[] = defaultTemplateModules(intent)): string {
  const params = { number: targetNumber, role: roleLabel, action: actionLabel, driver: driverNumber };
  const parts = modules.map((module) => {
    if (module === 'intent') return t(`deduction_game.log.template_intent_${intent}`, params);
    if (module === 'reason') return t(`deduction_game.log.template_reason_${reason}`, params);
    return t(`deduction_game.log.template_certainty_${certainty}`, params);
  });

  return parts.join(' ');
}

function evaluationReason(evaluation: BotEvaluation | undefined): TemplateReason {
  if (!evaluation) return 'uncertain';
  if (evaluation.publicReason === 'claim') return 'claim_contradiction';
  if (evaluation.publicReason === 'pressure' || evaluation.publicReason === 'vote') return 'vote_pressure';
  if (evaluation.publicReason === 'race') return 'race_dnf';
  return 'uncertain';
}

function roleReason(role: Role): TemplateReason {
  if (role === 'TP') return 'role_tp';
  if (role === 'TC') return 'role_tc';
  if (role === 'IS') return 'role_is';
  return 'role_st';
}

function botTemplateModules(evaluation: BotEvaluation | undefined): TemplateModule[] {
  if (!evaluation) return ['intent'];
  if (evaluation.publicReason === 'uncertain') return ['intent', 'certainty'];
  if (evaluation.publicReason === 'claim') return ['intent', 'reason', 'certainty'];
  if (evaluation.totalScore >= 70) return ['intent', 'reason', 'certainty'];
  return ['intent', 'reason'];
}

function buildSharedBotTemplate(bot: LocalPlayer, suspect: LocalPlayer | undefined, evaluation: BotEvaluation | undefined, dnfs: number, t: (key: string, params?: Record<string, unknown>) => string): string {
  const targetNumber = suspect?.number ?? bot.number;
  const intentPool: TemplateIntent[] = suspect
    ? ['sus', 'attack', 'explain', 'vote', 'switch']
    : ['claim', 'action', 'world', 'def', 'self', 'abs'];
  const intent = intentPool[(bot.number + dnfs) % intentPool.length];
  const reason = evaluationReason(evaluation);
  const certainty: TemplateCertainty = (evaluation?.totalScore ?? 0) >= 70
    ? 'strong'
    : (evaluation?.totalScore ?? 0) >= 48
      ? 'medium'
      : 'weak';
  const action = botClaimedAction(bot, t);
  const driver = botClaimedDriver(bot, dnfs);

  return buildTemplateMessage(intent, targetNumber, reason, certainty, claimCode(botClaim(bot), botClaimAlignment(bot)), action, driver, t, botTemplateModules(evaluation));
}

function buildDriverDebrief(driver: 1 | 2, didDnf: boolean, sabotagedDriver: number | null, protectedDriver: number | null, t: (key: string, params?: Record<string, unknown>) => string): DiscussionMessage {
  const wasSabotaged = sabotagedDriver === driver;
  const wasProtected = protectedDriver === driver;

  if (didDnf) {
    const cause = wasSabotaged
      ? pickRandom(['mechanical', 'strategic'] as const)
      : pickRandom(['mechanical', 'personal'] as const);
    const uncertainty = wasSabotaged && !wasProtected
      ? pickRandom(['medium', 'low'] as const)
      : pickRandom(['high', 'medium'] as const);

    return {
      playerId: `driver-${driver}`,
      playerNumber: 0,
      playerName: t('deduction_game.log.driver_name', { number: driver }),
      message: t('deduction_game.log.driver_dnf_debrief', {
        cause: t(`deduction_game.log.driver_cause_${cause}`),
        uncertainty: t(`deduction_game.log.uncertainty_${uncertainty}`),
      }),
    };
  }

  const feltOff = wasSabotaged && wasProtected && Math.random() < 0.4;
  const message = feltOff
    ? t('deduction_game.log.driver_finish_suspicious')
    : t('deduction_game.log.driver_finish_clean');

  return {
    playerId: `driver-${driver}`,
    playerNumber: 0,
    playerName: t('deduction_game.log.driver_name', { number: driver }),
    message,
  };
}

function buildBotReactionQueue(players: LocalPlayer[], suspicions: SuspicionMap, knowledge: SharedKnowledge, humanPlayer: LocalPlayer, humanMessage: string, t: (key: string, params?: Record<string, unknown>) => string): DiscussionMessage[] {
  const parsed = parseComment(players, humanMessage);
  const target = parsed.target;
  const responses: DiscussionMessage[] = [];

  if (isExplosiveClaim({ alignment: parsed.claimedAlignment, actionVerb: parsed.actionVerb })) {
    responses.push(...players
      .filter((player) => !player.isHuman && player.isAlive)
      .slice(0, 2)
      .map((player, index) => ({
        playerId: player.id,
        playerNumber: player.number,
        playerName: player.name,
        message: t(`deduction_game.log.bot_explosion_${index + 1}`, { number: humanPlayer.number }),
        delayMs: 900 + index * 1600,
      })));
  } else if (target && !target.isHuman && target.isAlive && ['suspect', 'ask', 'challenge'].includes(parsed.intent)) {
    const defenseKey = target.id.charCodeAt(1) % 3 + 1;
    responses.push({
      playerId: target.id,
      playerNumber: target.number,
      playerName: target.name,
      message: t(`deduction_game.log.bot_defense_${defenseKey}`, {
        accuser: humanPlayer.number,
        role: claimCode(botClaim(target), botClaimAlignment(target)),
      }),
      delayMs: 1000 + Math.floor(Math.random() * 2500),
    });

    const botObservers = players
      .filter((player) => !player.isHuman && player.isAlive && player.id !== target.id)
      .map((player) => ({ player, evaluation: getTopEvaluation(player, players, suspicions, knowledge) }))
      .filter(({ evaluation }) => evaluation?.target.id === target.id)
      .sort((a, b) => (b.evaluation?.totalScore ?? 0) - (a.evaluation?.totalScore ?? 0));
    const observer = botObservers[0]?.player;
    if (observer) {
      responses.push({
        playerId: observer.id,
        playerNumber: observer.number,
        playerName: observer.name,
        message: t(`deduction_game.log.bot_counter_${(observer.number % 3) + 1}`, {
          accuser: humanPlayer.number,
          accused: target.number,
        }),
        delayMs: 3500 + Math.floor(Math.random() * 6500),
      });
    }
  } else if (target && parsed.intent === 'trust') {
    const responder = players
      .filter((player) => !player.isHuman && player.isAlive)
      .map((player) => ({ player, evaluation: getTopEvaluation(player, players, suspicions, knowledge) }))
      .sort((a, b) => (b.evaluation?.totalScore ?? 0) - (a.evaluation?.totalScore ?? 0))[0]?.player;
    if (responder) {
      responses.push({
        playerId: responder.id,
        playerNumber: responder.number,
        playerName: responder.name,
        message: t(`deduction_game.log.bot_ack_${(responder.number % 3) + 1}`, { number: target.number }),
        delayMs: 4500 + Math.floor(Math.random() * 6000),
      });
    }
  }

  if (responses.length === 0) {
    const uncertainBot = players.find((player) => !player.isHuman && player.isAlive);
    if (uncertainBot) {
      responses.push({
        playerId: uncertainBot.id,
        playerNumber: uncertainBot.number,
        playerName: uncertainBot.name,
        message: t(`deduction_game.log.bot_uncertain_${(uncertainBot.number % 3) + 1}`),
        delayMs: 8000 + Math.floor(Math.random() * 7000),
      });
    }
  }

  return responses.slice(0, 2);
}

function updateSuspicionFromHumanMessage(players: LocalPlayer[], suspicions: SuspicionMap, message: string): SuspicionMap {
  const mentionedNumbers: number[] = [];
  const parsed = parseComment(players, message);
  const speaker = players.find((player) => player.isHuman);
  players.forEach((player) => {
    if (!player.isHuman && message.includes(`#${player.number}`)) {
      mentionedNumbers.push(player.number);
    }
  });

  const next: SuspicionMap = JSON.parse(JSON.stringify(suspicions));
  players.filter((player) => !player.isHuman && player.isAlive).forEach((bot) => {
    next[bot.id] = next[bot.id] ?? {};

    if (speaker && isExplosiveClaim({ alignment: parsed.claimedAlignment, actionVerb: parsed.actionVerb })) {
      next[bot.id][speaker.id] = Math.max(85, next[bot.id][speaker.id] ?? 20);
    }

    mentionedNumbers.forEach((targetNumber) => {
      const target = players.find((player) => player.number === targetNumber);
      if (target && target.id !== bot.id) {
        const publicDelta = parsed.intent === 'trust' ? -10 : parsed.intent === 'claim' ? 6 : 14;
        const privateTeammateGuard = bot.alignment === 'negative' && target.alignment === 'negative' ? -18 : 0;
        next[bot.id][target.id] = Math.max(0, Math.min(100, (next[bot.id][target.id] ?? 20) + publicDelta + privateTeammateGuard));
      }
    });
  });

  return next;
}

function botVote(bot: LocalPlayer, players: LocalPlayer[], suspicions: SuspicionMap, knowledge: SharedKnowledge): string | null {
  const evaluations = evaluateBotTargets(bot, players, suspicions, knowledge);
  if (evaluations.length === 0) return null;

  const top = evaluations[0];
  const second = evaluations[1];
  const confidence = top.totalScore - (second?.totalScore ?? 0) + top.totalScore;

  if (bot.alignment === 'negative') {
    const teammates = new Set(players.filter((player) => player.alignment === 'negative' && player.id !== bot.id).map((player) => player.id));
    const bestNonTeammate = evaluations.find(({ target, totalScore }) => !teammates.has(target.id) && totalScore >= 34);
    if (top.target.alignment === 'negative' && top.shouldBusTeammate && top.totalScore >= 82) return top.target.id;
    if (bestNonTeammate) return bestNonTeammate.target.id;
    return null;
  }

  if (top.totalScore < 45 || confidence < 58) return null;
  return top.target.id;
}

function buildBotVoteMessage(bot: LocalPlayer, targetId: string | null, players: LocalPlayer[], suspicions: SuspicionMap, knowledge: SharedKnowledge, t: (key: string, params?: Record<string, unknown>) => string): DiscussionMessage {
  const target = targetId ? players.find((player) => player.id === targetId) : undefined;
  const evaluation = target ? evaluateBotTargets(bot, players, suspicions, knowledge).find((item) => item.target.id === target.id) : undefined;
  const reason = evaluationReason(evaluation);
  const certainty: TemplateCertainty = (evaluation?.totalScore ?? 0) >= 70
    ? 'strong'
    : (evaluation?.totalScore ?? 0) >= 48
      ? 'medium'
      : 'weak';
  const message = target
    ? `${buildTemplateMessage('vote', target.number, reason, certainty, claimCode(botClaim(bot), botClaimAlignment(bot)), botClaimedAction(bot, t), botClaimedDriver(bot, knowledge.dnfs), t)} ${t('deduction_game.log.bot_vote_locked', { number: target.number })}`
    : t('deduction_game.log.bot_vote_abstain');

  return {
    playerId: `vote-${bot.id}-${Date.now()}`,
    playerNumber: bot.number,
    playerName: bot.name,
    message,
  };
}

export default function DeductionGameLocal() {
  const { t } = useTranslation();
  const [playerCount, setPlayerCount] = useState(6);
  const [totalRaces, setTotalRaces] = useState(12);
  const [players, setPlayers] = useState<LocalPlayer[]>(() => makePlayers(6));
  const [status, setStatus] = useState<RoomStatus>('night_phase');
  const [round, setRound] = useState(0);
  const [boardPressure, setBoardPressure] = useState(0);
  const [races, setRaces] = useState<LocalRace[]>([]);
  const [winner, setWinner] = useState<Alignment | null>(null);
  const [selectedDriver, setSelectedDriver] = useState('1');
  const [selectedVote, setSelectedVote] = useState('');
  const [nightSelection, setNightSelection] = useState<string | null>(null);
  const [gameLog, setGameLog] = useState<DiscussionMessage[]>([]);
  const [queuedMessages, setQueuedMessages] = useState<DiscussionMessage[]>([]);
  const [humanMessage, setHumanMessage] = useState('');
  const [timer, setTimer] = useState(0);
  const [voteResults, setVoteResults] = useState<Record<string, string>>({});
  const [abstainedVotes, setAbstainedVotes] = useState<string[]>([]);
  const [botVoteQueue, setBotVoteQueue] = useState<LocalPlayer[]>([]);
  const [showVoteReveal, setShowVoteReveal] = useState(false);
  const [suspicions, setSuspicions] = useState<SuspicionMap>({});
  const [sharedKnowledge, setSharedKnowledge] = useState<SharedKnowledge>({ claims: {}, pressure: 0, dnfs: 0 });
  const [templateIntent, setTemplateIntent] = useState<TemplateIntent>('sus');
  const [templateTarget, setTemplateTarget] = useState<number | null>(null);
  const [templateReason, setTemplateReason] = useState<TemplateReason>('race_dnf');
  const [templateRole, setTemplateRole] = useState<Role>('TC');
  const [templateCertainty, setTemplateCertainty] = useState<TemplateCertainty>('medium');
  const inputRef = useRef<HTMLInputElement>(null);

  const human = players.find((player) => player.isHuman) ?? null;
  const latestRace = races[races.length - 1];
  const boardThreshold = 30;

  const templateIntents = useMemo<Array<{ value: TemplateIntent; abbr: string }>>(() => [
    { value: 'sus', abbr: 'sus' },
    { value: 'trust', abbr: 'tr' },
    { value: 'ask', abbr: 'ask' },
    { value: 'claim', abbr: 'cl' },
    { value: 'action', abbr: 'act' },
    { value: 'def', abbr: 'def' },
    { value: 'self', abbr: 'me' },
    { value: 'logic', abbr: 'log' },
    { value: 'attack', abbr: 'atk' },
    { value: 'explain', abbr: 'why' },
    { value: 'vote', abbr: 'vt' },
    { value: 'world', abbr: 'wd' },
    { value: 'switch', abbr: 'sw' },
    { value: 'abs', abbr: 'abs' },
  ], []);

  const templateReasons = useMemo<Array<{ value: TemplateReason; abbr: string }>>(() => [
    { value: 'race_dnf', abbr: 'dnf' },
    { value: 'race_clean', abbr: 'clean' },
    { value: 'claim_role', abbr: 'role' },
    { value: 'claim_action', abbr: 'act' },
    { value: 'claim_contradiction', abbr: 'conf' },
    { value: 'vote_pressure', abbr: 'press' },
    { value: 'timing_push', abbr: 'time' },
    { value: 'role_tp', abbr: 'tp' },
    { value: 'role_tc', abbr: 'tc' },
    { value: 'role_is', abbr: 'is' },
    { value: 'role_st', abbr: 'st' },
    { value: 'uncertain', abbr: 'unc' },
  ], []);

  const templateRoles = useMemo<Array<{ value: Role; abbr: string }>>(() => [
    { value: 'TP', abbr: 'TP' },
    { value: 'TC', abbr: 'TC' },
    { value: 'IS', abbr: 'IS' },
    { value: 'ST', abbr: 'ST' },
  ], []);

  const templateCertainties = useMemo<Array<{ value: TemplateCertainty; abbr: string }>>(() => [
    { value: 'weak', abbr: 'w' },
    { value: 'medium', abbr: 'm' },
    { value: 'strong', abbr: 's' },
  ], []);

  const humanActionLabel = useMemo(() => {
    if (!human) return null;
    if (human.role === 'TC') return human.alignment === 'positive' ? t('deduction_game.actions.protect') : t('deduction_game.actions.sabotage');
    if (human.role === 'IS') return t('deduction_game.actions.inspect');
    if (human.role === 'ST') return human.alignment === 'positive' ? t('deduction_game.actions.analyze') : t('deduction_game.actions.sabotage');
    return null;
  }, [human, t]);

  const nightSelectedTargetLabel = useMemo(() => {
    if (!nightSelection) return '';
    if (nightSelection === '1' || nightSelection === '2') return t('deduction_game.log.driver_name', { number: Number(nightSelection) });
    const target = players.find((player) => player.id === nightSelection);
    return target ? `#${target.number} ${target.name}` : '';
  }, [nightSelection, players, t]);

  const liveVoteCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    Object.values(voteResults).forEach((targetId) => {
      counts[targetId] = (counts[targetId] ?? 0) + 1;
    });
    return counts;
  }, [voteResults]);

  const templateTargetNumber = templateTarget ?? players.find((player) => !player.isHuman && player.isAlive)?.number ?? 1;
  const templateActionLabel = humanActionLabel?.toLowerCase() ?? t('deduction_game.actions.no_action').toLowerCase();
  const templateDriverNumber = Number(selectedDriver);
  const templateRoleLabel = claimCode(templateRole);
  const templatePreview = useMemo(() => buildTemplateMessage(
    templateIntent,
    templateTargetNumber,
    templateReason,
    templateCertainty,
    templateRoleLabel,
    templateActionLabel,
    templateDriverNumber,
    t,
  ), [t, templateActionLabel, templateCertainty, templateDriverNumber, templateIntent, templateReason, templateRoleLabel, templateTargetNumber]);

  const applyTemplate = useCallback((updates?: Partial<{ intent: TemplateIntent; target: number; reason: TemplateReason; certainty: TemplateCertainty; role: Role }>) => {
    const nextIntent = updates?.intent ?? templateIntent;
    const nextTarget = updates?.target ?? templateTargetNumber;
    const nextReason = updates?.reason ?? templateReason;
    const nextCertainty = updates?.certainty ?? templateCertainty;
    const nextRole = updates?.role ?? templateRole;

    if (updates?.intent) setTemplateIntent(updates.intent);
    if (updates?.target) setTemplateTarget(updates.target);
    if (updates?.reason) setTemplateReason(updates.reason);
    if (updates?.certainty) setTemplateCertainty(updates.certainty);
    if (updates?.role) setTemplateRole(updates.role);

    setHumanMessage(buildTemplateMessage(
      nextIntent,
      nextTarget,
      nextReason,
      nextCertainty,
      claimCode(nextRole),
      templateActionLabel,
      templateDriverNumber,
      t,
    ));
    inputRef.current?.focus();
  }, [t, templateActionLabel, templateCertainty, templateDriverNumber, templateIntent, templateReason, templateRole, templateTargetNumber]);

  const commandHint = useMemo(() => {
    const command = humanMessage.trim().toLowerCase().replace(/^\//, '');
    if (!command || command.includes(' ')) return templatePreview;

    const intent = templateIntents.find((segment) => segment.abbr.startsWith(command) || segment.value.startsWith(command));
    const reason = templateReasons.find((segment) => segment.abbr.startsWith(command) || segment.value.startsWith(command));
    const certainty = templateCertainties.find((segment) => segment.abbr.startsWith(command) || segment.value.startsWith(command));

    const role = templateRoles.find((segment) => segment.abbr.toLowerCase().startsWith(command) || segment.value.toLowerCase().startsWith(command));

    if (intent) return t('deduction_game.log.completion_hint', { command: `/${intent.abbr}`, value: t(`deduction_game.log.segment_intent_${intent.value}`) });
    if (reason) return t('deduction_game.log.completion_hint', { command: `/${reason.abbr}`, value: t(`deduction_game.log.segment_reason_${reason.value}`) });
    if (role) return t('deduction_game.log.completion_hint', { command: `/${role.abbr}`, value: t('deduction_game.log.segment_role_value', { role: role.value }) });
    if (certainty) return t('deduction_game.log.completion_hint', { command: `/${certainty.abbr}`, value: t(`deduction_game.log.segment_certainty_${certainty.value}`) });
    return templatePreview;
  }, [humanMessage, t, templateCertainties, templateIntents, templatePreview, templateReasons, templateRoles]);

  const submitBotVote = useCallback((bot: LocalPlayer) => {
    const voteTarget = botVote(bot, players, suspicions, sharedKnowledge);
    if (voteTarget) {
      setVoteResults((current) => ({ ...current, [bot.id]: voteTarget }));
    } else {
      setAbstainedVotes((current) => current.includes(bot.id) ? current : [...current, bot.id]);
    }
    setGameLog((messages) => [...messages, buildBotVoteMessage(bot, voteTarget, players, suspicions, sharedKnowledge, t)]);
  }, [players, sharedKnowledge, suspicions, t]);

  const beginVoting = useCallback(() => {
    setQueuedMessages([]);
    setTimer(25);
    setVoteResults({});
    setAbstainedVotes([]);
    setBotVoteQueue(shuffle(players.filter((player) => player.isAlive && !player.isHuman)));
    setShowVoteReveal(false);
    setStatus('voting');
  }, [players]);

  const proceedToVoteReveal = useCallback(() => {
    const remainingBots = botVoteQueue;
    const nextVotes = { ...voteResults };
    const nextAbstentions = [...abstainedVotes];

    remainingBots.forEach((bot) => {
      const hasVoted = nextVotes[bot.id] || nextAbstentions.includes(bot.id);
      if (hasVoted) return;

      const voteTarget = botVote(bot, players, suspicions, sharedKnowledge);
      if (voteTarget) nextVotes[bot.id] = voteTarget;
      else nextAbstentions.push(bot.id);
      setGameLog((messages) => [...messages, buildBotVoteMessage(bot, voteTarget, players, suspicions, sharedKnowledge, t)]);
    });

    setBotVoteQueue([]);
    setVoteResults(nextVotes);
    setAbstainedVotes(nextAbstentions);
    setTimer(0);
    setShowVoteReveal(true);
  }, [abstainedVotes, botVoteQueue, players, sharedKnowledge, suspicions, t, voteResults]);

  useEffect(() => {
    if (timer <= 0 || (status !== 'discussion' && status !== 'voting') || showVoteReveal) return;

    const interval = setInterval(() => {
      setTimer((prev) => {
        if (prev <= 1) {
          if (status === 'discussion') beginVoting();
          else if (status === 'voting') proceedToVoteReveal();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [timer, status, showVoteReveal, beginVoting, proceedToVoteReveal]);

  useEffect(() => {
    if (status !== 'discussion' || queuedMessages.length === 0) return;

    const delay = queuedMessages[0]?.delayMs ?? 3500;
    const timeout = setTimeout(() => {
      setQueuedMessages((current) => {
        const [nextMessage, ...remaining] = current;
        if (nextMessage) setGameLog((messages) => [...messages, nextMessage]);
        return remaining;
      });
    }, delay);

    return () => clearTimeout(timeout);
  }, [status, queuedMessages]);

  useEffect(() => {
    if (status !== 'voting' || showVoteReveal || botVoteQueue.length === 0) return;

    const delay = 1200 + Math.floor(Math.random() * 1400);
    const timeout = setTimeout(() => {
      setBotVoteQueue((queue) => {
        const [bot, ...remaining] = queue;
        if (!bot) return remaining;

        submitBotVote(bot);

        return remaining;
      });
    }, delay);

    return () => clearTimeout(timeout);
  }, [status, showVoteReveal, botVoteQueue, submitBotVote]);

  const restart = () => {
    setPlayers(makePlayers(playerCount));
    setStatus('night_phase');
    setRound(0);
    setBoardPressure(0);
    setRaces([]);
    setWinner(null);
    setSelectedVote('');
    setGameLog([]);
    setQueuedMessages([]);
    setHumanMessage('');
    setTimer(0);
    setVoteResults({});
    setAbstainedVotes([]);
    setBotVoteQueue([]);
    setShowVoteReveal(false);
    setSuspicions({});
    setSharedKnowledge({ claims: {}, pressure: 0, dnfs: 0 });
  };

  const confirmNightAction = () => {
    if (!nightSelection) return;

    if (human?.role === 'IS') {
      const target = players.find((player) => player.id === nightSelection);
      if (!target) return;
      setNightSelection(null);
      setGameLog((log) => [
        ...log,
        {
          playerId: 'inspector-result',
          playerNumber: human.number,
          playerName: 'IS',
          message: t('deduction_game.log.inspector_result', {
            number: target.number,
            role: claimCode(target.role, target.alignment),
          }),
        },
      ]);
      resolveRace(selectedDriver);
      return;
    }

    setSelectedDriver(nightSelection);
    setNightSelection(null);
    resolveRace(nightSelection);
  };

  const skipNight = () => {
    setNightSelection(null);
    resolveRace(selectedDriver);
  };

  const resolveRace = (driverSelection = selectedDriver) => {
    const nextRound = round + 1;
    const negativeTCs = players.filter((player) => player.isAlive && player.role === 'TC' && player.alignment === 'negative');
    const tcSabotagedDriver = negativeTCs.length > 0 ? (nextRound % 2 === 0 ? 2 : 1) : null;
    const selectedDriverNumber = (driverSelection === '1' || driverSelection === '2') ? Number(driverSelection) : Number(selectedDriver);
    const stSabotage = human?.role === 'ST' && human.alignment === 'negative' ? selectedDriverNumber : null;
    const stProtection = human?.role === 'ST' && human.alignment === 'positive' && tcSabotagedDriver !== selectedDriverNumber ? selectedDriverNumber : null;
    const sabotagedDriver = stSabotage || tcSabotagedDriver;
    const protectedDriver = human?.role === 'TC' && human.alignment === 'positive'
      ? selectedDriverNumber
      : stProtection
        ? selectedDriverNumber
        : null;

    const dnfChance = (driver: number) => {
      const sabotaged = sabotagedDriver === driver;
      const protectedTarget = protectedDriver === driver;
      return Math.max(0.08, 0.2 + (sabotaged && !protectedTarget ? 0.4 : 0) + (sabotaged && protectedTarget ? 0.1 : 0) - (!sabotaged && protectedTarget ? 0.12 : 0));
    };

    const driver1DNF = Math.random() < dnfChance(1);
    const driver2DNF = Math.random() < dnfChance(2);
    const dnfs = Number(driver1DNF) + Number(driver2DNF);
    const nextBoardPressure = boardPressure + dnfs * 5 + (dnfs === 2 ? 10 : 0);
    const driver1Status = driver1DNF ? t('deduction_game.log.driver_dnf') : t('deduction_game.log.driver_finished');
    const driver2Status = driver2DNF ? t('deduction_game.log.driver_dnf') : t('deduction_game.log.driver_finished');
    const raceAnalysis = human?.role === 'ST'
      ? human.alignment === 'negative'
        ? t('deduction_game.log.strategist_sabotage', { driver: selectedDriverNumber })
        : t(`deduction_game.log.strategist_${stProtection ? 'normal' : 'abnormal'}`, { driver: selectedDriverNumber })
      : null;
    const report = t('deduction_game.log.race_report', {
      round: nextRound,
      driver1: driver1Status,
      driver2: driver2Status,
      pressure: nextBoardPressure,
      threshold: boardThreshold,
    });
    const nextSuspicions = buildSuspicionMap(players, dnfs);
    const nextKnowledge = parsePublicKnowledge(players, gameLog, nextBoardPressure, dnfs);
    const driverDebriefs = [
      buildDriverDebrief(1, driver1DNF, sabotagedDriver, protectedDriver, t),
      buildDriverDebrief(2, driver2DNF, sabotagedDriver, protectedDriver, t),
    ];

    setRound(nextRound);
    setBoardPressure(nextBoardPressure);
    setRaces([...races, { round: nextRound, report, driver1DNF, driver2DNF }]);
    setSuspicions(nextSuspicions);
    setSharedKnowledge(nextKnowledge);
    setGameLog((log) => [
      ...log,
      { playerId: 'race-control', playerNumber: 0, playerName: t('deduction_game.log.race_control'), message: report },
      ...(raceAnalysis ? [{ playerId: 'strategist-analysis', playerNumber: human?.number ?? 0, playerName: 'ST', message: raceAnalysis }] : []),
      ...driverDebriefs,
    ]);
    setQueuedMessages(buildBotDiscussionQueue(players, dnfs, nextSuspicions, driver1DNF, driver2DNF, nextKnowledge, t));
    setSelectedVote('');
    setVoteResults({});
    setAbstainedVotes([]);
    setBotVoteQueue([]);

    if (nextBoardPressure >= boardThreshold) {
      setWinner('negative');
      setStatus('ended');
      return;
    }

    setTimer(45);
    setStatus('discussion');
  };

  const submitHumanMessage = () => {
    const trimmed = humanMessage.trim();
    if (!trimmed || !human) return;

    const nextSuspicions = updateSuspicionFromHumanMessage(players, suspicions, trimmed);
    const nextLog = [...gameLog, {
      playerId: human.id,
      playerNumber: human.number,
      playerName: human.name,
      message: trimmed,
    }];
    const nextKnowledge = parsePublicKnowledge(players, nextLog, boardPressure, sharedKnowledge.dnfs);
    setGameLog(nextLog);
    setSuspicions(nextSuspicions);
    setSharedKnowledge(nextKnowledge);
    setQueuedMessages((messages) => [...messages, ...buildBotReactionQueue(players, nextSuspicions, nextKnowledge, human, trimmed, t)]);
    setHumanMessage('');
  };

  const submitHumanVote = () => {
    if (!human) return;

    if (selectedVote) {
      setVoteResults((current) => ({ ...current, [human.id]: selectedVote }));
      setAbstainedVotes((current) => current.filter((playerId) => playerId !== human.id));
      setGameLog((messages) => [...messages, {
        playerId: `vote-${human.id}-${Date.now()}`,
        playerNumber: human.number,
        playerName: human.name,
        message: t('deduction_game.log.human_vote_locked', { number: players.find((player) => player.id === selectedVote)?.number }),
      }]);
    } else {
      setAbstainedVotes((current) => current.includes(human.id) ? current : [...current, human.id]);
      setVoteResults((current) => {
        const next = { ...current };
        delete next[human.id];
        return next;
      });
      setGameLog((messages) => [...messages, {
        playerId: `vote-${human.id}-${Date.now()}`,
        playerNumber: human.number,
        playerName: human.name,
        message: t('deduction_game.log.human_vote_abstain'),
      }]);
    }
  };

  const continueAfterVoteReveal = () => {
    const voteCounts: Record<string, number> = {};
    Object.values(voteResults).forEach((targetId) => {
      voteCounts[targetId] = (voteCounts[targetId] ?? 0) + 1;
    });

    const sortedVotes = Object.entries(voteCounts).sort((a, b) => b[1] - a[1]);
    const firedId = sortedVotes[0]?.[1] === sortedVotes[1]?.[1] ? undefined : sortedVotes[0]?.[0];
    const firedPlayer = firedId ? players.find((player) => player.id === firedId) : undefined;
    const nextPlayers = firedId
      ? players.map((player) => player.id === firedId ? { ...player, isAlive: false } : player)
      : players;
    const aliveNegatives = nextPlayers.filter((player) => player.isAlive && player.alignment === 'negative');

    setPlayers(nextPlayers);
    setRaces(races.map((race, index) => (
      index === races.length - 1 ? { ...race, fired: firedPlayer?.name ?? t('deduction_game.no_elimination') } : race
    )));
    setSelectedVote('');
    setShowVoteReveal(false);
    setVoteResults({});
    setAbstainedVotes([]);
    setBotVoteQueue([]);
    setTimer(0);

    if (aliveNegatives.length === 0) {
      setWinner('positive');
      setStatus('ended');
      return;
    }

    if (round >= totalRaces) {
      setWinner('positive');
      setStatus('ended');
      return;
    }

    setStatus('night_phase');
  };

  return (
    <div className="min-h-screen bg-neutral-900 text-white pt-20 px-4 pb-8">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-black">{t('deduction_game.title')} <span className="text-blue-400">{t('deduction_game.local')}</span></h1>
        </div>

        {round === 0 && status !== 'ended' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-neutral-800 p-4 rounded-xl border border-white/5 grid md:grid-cols-3 gap-3 items-end mb-6"
          >
            <label className="block">
              <span className="text-xs text-gray-300 mb-1 block">{t('deduction_game.lobby.players')}</span>
              <select value={playerCount} onChange={(event) => setPlayerCount(Number(event.target.value))} className="w-full bg-neutral-700 border border-white/10 p-2 rounded-lg text-sm">
                {[4, 5, 6, 7, 8].map((count) => <option key={count} value={count}>{count}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-gray-300 mb-1 block">{t('deduction_game.lobby.total_races')}</span>
              <select value={totalRaces} onChange={(event) => setTotalRaces(Number(event.target.value))} className="w-full bg-neutral-700 border border-white/10 p-2 rounded-lg text-sm">
                {[7, 10, 12, 15, 20].map((count) => <option key={count} value={count}>{count}</option>)}
              </select>
            </label>
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={restart} className="bg-gradient-to-r from-blue-600 to-blue-500 p-2 rounded-lg font-bold text-sm">
              {t('deduction_game.start_game')}
            </motion.button>
          </motion.div>
        )}

        <div className="grid md:grid-cols-[1fr_500px] gap-6">
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-neutral-800 p-3 rounded-xl border border-white/5">
                <div className="text-xs text-gray-400">{t('deduction_game.game.status')}</div>
                <div className="text-sm font-bold">{status}</div>
                {timer > 0 && (status === 'discussion' || status === 'voting') && (
                  <div className="text-xl font-bold text-purple-400">{timer}s</div>
                )}
              </div>
              <div className="bg-neutral-800 p-3 rounded-xl border border-white/5">
                <div className="text-xs text-gray-400">{t('deduction_game.game.round')}</div>
                <div className="text-sm font-bold">{round} / {totalRaces}</div>
              </div>
              <div className="bg-neutral-800 p-3 rounded-xl border border-white/5">
                <div className="text-xs text-gray-400">{t('deduction_game.game.board_pressure')}</div>
                <div className="text-sm font-bold text-red-400">{boardPressure} / {boardThreshold}</div>
              </div>
            </div>

            {latestRace && (
              <div className="bg-neutral-800 p-3 rounded-xl border border-white/5">
                <div className="flex items-center gap-2 mb-2">
                  <Flag className="w-4 h-4 text-green-400" />
                  <h3 className="font-bold text-sm">{t('deduction_game.game.latest_race')}</h3>
                </div>
                <p className="text-xs text-gray-300">{latestRace.report}</p>
                {latestRace.fired && <p className="text-xs text-red-400 mt-2">{t('deduction_game.log.fired')}: {latestRace.fired}</p>}
              </div>
            )}

            <div className="bg-neutral-800 p-4 rounded-xl border border-purple-500/30">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-purple-400" />
                  <h3 className="font-bold text-purple-400 text-sm">{t('deduction_game.log.title')}</h3>
                </div>
                {timer > 0 && !showVoteReveal && (
                  <div className="text-lg font-bold text-purple-400">{timer}s</div>
                )}
              </div>
              <div className="bg-neutral-900 rounded-lg p-3 h-80 overflow-y-auto space-y-1 mb-3 font-mono text-xs">
                {status === 'night_phase' && human?.isAlive && humanActionLabel && (
                  <div className="text-blue-300 mb-2 p-2 bg-blue-900/20 rounded">
                    <div className="font-bold mb-1">{t('deduction_game.night.hint_title')}</div>
                    <div>{t(`deduction_game.night.hint_${human.role.toLowerCase()}`, { action: humanActionLabel.toLowerCase() })}</div>
                    {human.role === 'ST' && (
                      <div className="text-xs text-blue-300/80 mt-1">{t('deduction_game.actions.strategist_help')}</div>
                    )}
                  </div>
                )}
                {gameLog.map((msg, i) => {
                  const mentionsHuman = human && msg.message.includes(`#${human.number}`);
                  return (
                    <div key={`${msg.playerId}-${i}`} className={mentionsHuman ? 'bg-yellow-900/20 px-1 rounded' : ''}>
                      <span className="text-blue-400">#{msg.playerNumber}</span>
                      <span className="text-gray-500"> {msg.playerName}: </span>
                      <span className="text-gray-300">{msg.message}</span>
                    </div>
                  );
                })}
                {queuedMessages.length > 0 && <div className="text-gray-500 italic">{t('deduction_game.log.typing')}</div>}
              </div>

              {status === 'night_phase' && human?.isAlive && (
                <>
                  {!humanActionLabel ? (
                    <>
                      <div className="bg-neutral-900 p-2 rounded-lg mb-3 text-xs text-gray-400">
                        {t('deduction_game.night.no_action')}
                      </div>
                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={skipNight}
                        className="w-full bg-gradient-to-r from-gray-600 to-gray-500 p-2 rounded-lg font-bold text-sm"
                      >
                        {t('deduction_game.night.skip')}
                      </motion.button>
                    </>
                  ) : (
                    <>
                      {nightSelection && (
                        <div className="bg-neutral-900 p-2 rounded-lg mb-3 text-xs">
                          {t('deduction_game.night.selected', {
                            target: nightSelectedTargetLabel,
                            action: humanActionLabel?.toLowerCase()
                          })}
                        </div>
                      )}
                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={confirmNightAction}
                        disabled={!nightSelection}
                        className="w-full bg-gradient-to-r from-blue-600 to-blue-500 disabled:from-gray-600 disabled:to-gray-500 p-2 rounded-lg font-bold text-sm"
                      >
                        {nightSelection ? t('deduction_game.night.confirm_action', { action: humanActionLabel?.toLowerCase() }) : t('deduction_game.night.select_prompt', { action: humanActionLabel?.toLowerCase() })}
                      </motion.button>
                    </>
                  )}
                </>
              )}

                {status === 'discussion' && (
                  <>
                    <div className="mb-3 rounded-lg border border-purple-500/20 bg-neutral-950/80 p-3 text-xs space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-gray-400">{t('deduction_game.log.template_hint')}</span>
                        <button
                          onClick={() => applyTemplate()}
                          className="text-purple-300 hover:text-purple-200"
                        >
                          {t('deduction_game.log.use_completion')}
                        </button>
                      </div>
                      <div className="text-gray-500/80 italic">{commandHint}</div>
                      <div className="grid gap-2 sm:grid-cols-5">
                        <div>
                          <div className="text-gray-500 mb-1">{t('deduction_game.log.segment_intent')}</div>
                          <div className="flex flex-wrap gap-1">
                            {templateIntents.map((segment) => (
                              <button
                                key={segment.value}
                                onClick={() => applyTemplate({ intent: segment.value })}
                                className={`px-2 py-1 rounded border ${templateIntent === segment.value ? 'bg-purple-600/40 border-purple-400 text-white' : 'bg-neutral-900 border-white/10 text-gray-300 hover:border-purple-500/50'}`}
                              >
                                /{segment.abbr}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <div className="text-gray-500 mb-1">{t('deduction_game.log.segment_target')}</div>
                          <div className="flex flex-wrap gap-1">
                            {players.filter((player) => player.isAlive && !player.isHuman).map((player) => (
                              <button
                                key={player.id}
                                onClick={() => applyTemplate({ target: player.number })}
                                className={`px-2 py-1 rounded border ${templateTargetNumber === player.number ? 'bg-blue-600/40 border-blue-400 text-white' : 'bg-neutral-900 border-white/10 text-gray-300 hover:border-blue-500/50'}`}
                              >
                                #{player.number}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <div className="text-gray-500 mb-1">{t('deduction_game.log.segment_role')}</div>
                          <div className="flex flex-wrap gap-1">
                            {templateRoles.map((segment) => (
                              <button
                                key={segment.value}
                                onClick={() => applyTemplate({ role: segment.value, reason: roleReason(segment.value) })}
                                className={`px-2 py-1 rounded border ${templateRole === segment.value ? 'bg-cyan-600/40 border-cyan-400 text-white' : 'bg-neutral-900 border-white/10 text-gray-300 hover:border-cyan-500/50'}`}
                              >
                                /{segment.abbr}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <div className="text-gray-500 mb-1">{t('deduction_game.log.segment_reason')}</div>
                          <div className="flex flex-wrap gap-1">
                            {templateReasons.map((segment) => (
                              <button
                                key={segment.value}
                                onClick={() => applyTemplate({ reason: segment.value })}
                                className={`px-2 py-1 rounded border ${templateReason === segment.value ? 'bg-amber-600/40 border-amber-400 text-white' : 'bg-neutral-900 border-white/10 text-gray-300 hover:border-amber-500/50'}`}
                              >
                                /{segment.abbr}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <div className="text-gray-500 mb-1">{t('deduction_game.log.segment_certainty')}</div>
                          <div className="flex flex-wrap gap-1">
                            {templateCertainties.map((segment) => (
                              <button
                                key={segment.value}
                                onClick={() => applyTemplate({ certainty: segment.value })}
                                className={`px-2 py-1 rounded border ${templateCertainty === segment.value ? 'bg-green-600/40 border-green-400 text-white' : 'bg-neutral-900 border-white/10 text-gray-300 hover:border-green-500/50'}`}
                              >
                                /{segment.abbr}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="relative flex gap-2 mb-3">
                      {!humanMessage && (
                        <div className="pointer-events-none absolute left-3 top-2 text-sm text-gray-500/50 truncate pr-14 max-w-[calc(100%-4rem)]">
                          {templatePreview}
                        </div>
                      )}
                      <input
                        ref={inputRef}
                        value={humanMessage}
                        onChange={(event) => {
                          const val = event.target.value;
                          const command = val.trim().toLowerCase().replace(/^\//, '');
                          const intent = templateIntents.find((segment) => segment.abbr === command || segment.value === command);
                          const reason = templateReasons.find((segment) => segment.abbr === command || segment.value === command);
                          const certainty = templateCertainties.find((segment) => segment.abbr === command || segment.value === command);

                          if (intent) {
                            applyTemplate({ intent: intent.value });
                            return;
                          }
                          if (reason) {
                            applyTemplate({ reason: reason.value });
                            return;
                          }
                          const role = templateRoles.find((segment) => segment.abbr.toLowerCase().startsWith(command) || segment.value.toLowerCase().startsWith(command));
                          if (role) {
                            applyTemplate({ role: role.value, reason: roleReason(role.value) });
                            return;
                          }
                          if (certainty) {
                            applyTemplate({ certainty: certainty.value });
                            return;
                          }
                          setHumanMessage(val);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') submitHumanMessage();
                        }}
                        placeholder={t('deduction_game.log.placeholder')}
                        className="flex-1 bg-neutral-900 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-purple-500"
                      />
                      <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }} onClick={submitHumanMessage} className="bg-purple-600 hover:bg-purple-500 px-3 rounded-lg">
                        <Send className="w-4 h-4" />
                      </motion.button>
                    </div>
                    <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={beginVoting} className="w-full bg-gradient-to-r from-purple-600 to-purple-500 p-2 rounded-lg font-bold text-sm">
                      {t('deduction_game.log.proceed_to_voting')}
                    </motion.button>
                  </>
                )}

                {status === 'voting' && human?.isAlive && !showVoteReveal && (
                  <>
                    <p className="text-xs text-gray-400 mb-3">{t('deduction_game.log.click_to_vote')}</p>
                    {selectedVote ? (
                      <div className="bg-neutral-900 p-2 rounded-lg mb-3 text-xs">
                        {t('deduction_game.log.voting_for', {
                          number: players.find(p => p.id === selectedVote)?.number,
                          name: players.find(p => p.id === selectedVote)?.name
                        })}
                      </div>
                    ) : (
                      <div className="bg-neutral-900 p-2 rounded-lg mb-3 text-xs text-gray-400">{t('deduction_game.log.abstain_hint')}</div>
                    )}
                    <div className="text-xs text-gray-400 mb-3">
                      {t('deduction_game.log.bot_votes_recorded', {
                        count: Object.keys(voteResults).filter((playerId) => players.find((player) => player.id === playerId && !player.isHuman)).length + abstainedVotes.filter((playerId) => players.find((player) => player.id === playerId && !player.isHuman)).length,
                        total: players.filter((player) => player.isAlive && !player.isHuman).length
                      })}
                    </div>
                    <div className="bg-neutral-950 rounded-lg p-2 mb-3 text-xs space-y-1">
                      <div className="text-gray-400 font-bold">{t('deduction_game.log.live_vote_tally')}</div>
                      {players.filter((player) => player.isAlive && !player.isHuman).map((player) => (
                        <div key={player.id} className="flex items-center justify-between text-gray-300">
                          <span>#{player.number} {player.name}</span>
                          <span className={liveVoteCounts[player.id] ? 'text-red-400 font-bold' : 'text-gray-600'}>{liveVoteCounts[player.id] ?? 0}</span>
                        </div>
                      ))}
                      <div className="flex items-center justify-between text-gray-300 border-t border-white/10 pt-1 mt-1">
                        <span>{t('deduction_game.log.abstained')}</span>
                        <span className={abstainedVotes.length ? 'text-yellow-400 font-bold' : 'text-gray-600'}>{abstainedVotes.length}</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={submitHumanVote} className="bg-gradient-to-r from-red-600 to-red-500 p-2 rounded-lg font-bold text-sm">
                        {t('deduction_game.log.lock_vote')}
                      </motion.button>
                      <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={proceedToVoteReveal} className="bg-gradient-to-r from-yellow-600 to-yellow-500 p-2 rounded-lg font-bold text-sm">
                        {t('deduction_game.log.reveal_now')}
                      </motion.button>
                    </div>
                  </>
                )}

                {showVoteReveal && (
                  <>
                    <h3 className="font-bold text-yellow-400 text-center mb-3 text-sm">{t('deduction_game.vote_results')}</h3>
                    <div className="bg-neutral-950 rounded-lg p-3 space-y-1 mb-3 font-mono text-xs">
                      {players.filter((player) => player.isAlive).map((voter) => {
                        const targetId = voteResults[voter.id];
                        const target = players.find((player) => player.id === targetId);
                        return (
                          <div key={voter.id} className="text-gray-300">
                            <span className="text-blue-400">#{voter.number}</span>
                            <span className="text-gray-500"> → </span>
                            <span className={target ? 'text-red-400' : 'text-gray-500'}>
                              {target ? `#${target.number} ${target.name}` : t('deduction_game.log.abstained')}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={continueAfterVoteReveal} className="w-full bg-gradient-to-r from-yellow-600 to-yellow-500 p-2 rounded-lg font-bold text-sm">
                      {t('deduction_game.log.continue')}
                    </motion.button>
                  </>
                )}
              </div>

            {status === 'ended' && (
              <div className="bg-neutral-800 p-6 rounded-xl border border-white/10 text-center">
                <div className={`inline-block px-6 py-3 rounded-xl mb-4 ${winner === 'positive' ? 'bg-gradient-to-r from-green-600 to-green-500' : 'bg-gradient-to-r from-red-600 to-red-500'}`}>
                  <h2 className="text-xl font-black text-white">{winner === 'positive' ? t('deduction_game.positive_wins') : t('deduction_game.negative_wins')}</h2>
                </div>
                <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={restart} className="bg-gradient-to-r from-blue-600 to-blue-500 px-6 py-2 rounded-xl font-bold text-sm">
                  {t('deduction_game.play_again')}
                </motion.button>
              </div>
            )}
          </div>

          <div className="space-y-4">
            {human && (
              <div className="bg-gradient-to-br from-blue-900/50 to-purple-900/50 p-4 rounded-xl border border-blue-500/30">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-gray-300">{t('deduction_game.game.your_role')}</div>
                    <div className="text-lg font-black">{claimCode(human.role, human.alignment)}</div>
                    <div className="text-xs text-blue-400 mt-1">#{human.number}</div>
                    <div className="text-xs text-gray-400 mt-1">{t(`deduction_game.roles.${human.role}`)} · {t(`deduction_game.alignment.${human.alignment}`)}</div>
                    {human.alignment === 'negative' && (
                      <div className="text-xs text-red-400 mt-2">
                        {t('deduction_game.game.teammates')}: {players.filter((p) => p.alignment === 'negative' && p.id !== human.id).map((p) => `#${p.number}`).join(', ')}
                      </div>
                    )}
                  </div>
                  <div className={`px-2 py-1 rounded-full text-xs font-bold ${human.alignment === 'positive' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                    {alignmentCode(human.alignment)}
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              {[1, 2].map((driverNum) => (
                <motion.div
                  key={`driver-${driverNum}`}
                  whileHover={status === 'night_phase' && human?.isAlive && (human.role === 'TC' || human.role === 'ST') ? { scale: 1.05 } : {}}
                  onClick={() => {
                    if (status === 'night_phase' && human?.isAlive && (human.role === 'TC' || human.role === 'ST')) {
                      setNightSelection(String(driverNum));
                    }
                  }}
                  className={`p-3 rounded-xl border transition-all ${
                    nightSelection === String(driverNum)
                      ? 'bg-blue-900/30 border-blue-500'
                      : 'bg-neutral-800 border-white/10 hover:border-blue-500/30'
                  } ${status === 'night_phase' && human?.isAlive && (human.role === 'TC' || human.role === 'ST') ? 'cursor-pointer' : ''}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold bg-gradient-to-br from-green-600 to-green-500">
                      D{driverNum}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-xs">{t('deduction_game.log.driver_name', { number: driverNum })}</div>
                      <div className="text-xs text-green-400">{t('deduction_game.game.driver')}</div>
                    </div>
                  </div>
                </motion.div>
              ))}
              {players.map((player) => (
                <motion.div
                  key={player.id}
                  whileHover={status === 'night_phase' && human?.isAlive && human.role === 'IS' && player.isAlive && player.id !== human.id ? { scale: 1.05 } : status === 'voting' && human?.isAlive && player.isAlive && player.id !== human.id ? { scale: 1.05 } : {}}
                  onClick={() => {
                    if (status === 'night_phase' && human?.isAlive && human.role === 'IS' && player.isAlive && player.id !== human.id) {
                      setNightSelection(player.id);
                      return;
                    }
                    if (status === 'voting' && human?.isAlive && player.isAlive && player.id !== human.id) {
                      setSelectedVote(player.id);
                    }
                  }}
                  className={`p-3 rounded-xl border transition-all ${
                    player.isAlive
                      ? nightSelection === player.id
                        ? 'bg-blue-900/30 border-blue-500'
                        : selectedVote === player.id
                          ? 'bg-red-900/30 border-red-500'
                          : 'bg-neutral-800 border-white/10 hover:border-blue-500/30'
                      : 'bg-neutral-900/50 border-white/5 opacity-40'
                  } ${(status === 'night_phase' && human?.isAlive && human.role === 'IS' && player.isAlive && player.id !== human.id) || (status === 'voting' && human?.isAlive && player.isAlive && player.id !== human.id) ? 'cursor-pointer' : ''}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                      player.isHuman ? 'bg-gradient-to-br from-blue-500 to-purple-500' : 'bg-gradient-to-br from-gray-600 to-gray-500'
                    }`}>
                      {player.number}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-xs truncate">{player.name}</div>
                      {player.role === 'TP' && <div className="text-xs text-yellow-400">TP</div>}
                    </div>
                  </div>
                  {!player.isAlive && (
                    <div className="text-xs text-red-400 mt-1">
                      {t('deduction_game.game.fired')} - {alignmentCode(player.alignment)}
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
