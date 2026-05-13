import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Flag, AlertTriangle, Send } from 'lucide-react';
import { assignRoles, getNegativeCount, BOT_PERSONALITIES } from '@/config/deductionGame';
import type { Alignment, Role, RoomStatus } from '@/types/deduction';
import Manual from './deduction/Manual';
import DevPanel from './deduction/DevPanel';
import { shuffle, pickRandom } from './deduction/utils';
import { parseComment, parsePublicKnowledge, buildSuspicionMap, evaluateBotTargets, getTopEvaluation, buildRoleCertaintyMap, isExplosiveClaim, hasPublicClaimContradiction, countRoleClaims, updateSuspicionsAfterDeath, isAtRiskOfElimination, findStrategicTarget, derivePublicSuspicions } from './deduction/gameLogic';
import type { LocalPlayer, LocalRace, DiscussionMessage, SuspicionMap, SharedKnowledge, BotPrivateKnowledge, TemplateIntent, TemplateReason, TemplateCertainty, TemplateModule, TemplateSide, InspectorNightMode, BotPersonalityType, BotEvaluation } from './deduction/types';

type TemplateActionVerb = 'protected' | 'sabotaged' | 'analyzed' | 'inspected' | 'ejected' | 'learned';
type TemplateTarget = { kind: 'player'; value: number; label: string } | { kind: 'driver'; value: number; label: string } | { kind: 'all'; value: 0; label: string };

const botNames = ['Vega', 'Orion', 'Nova', 'Apex', 'Rift', 'Pulse', 'Echo', 'Blitz'];

function makePlayers(count: number, observerMode: boolean = false): LocalPlayer[] {
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
  const humanSeat = observerMode ? -1 : Math.floor(Math.random() * count);
  const shuffledIds = shuffle(Array.from({ length: count }, (_, i) => `p${i}`));
  const shuffledBotNames = shuffle(botNames).slice(0, observerMode ? count : Math.max(0, count - 1));
  const personalities: BotPersonalityType[] = ['aggressive', 'cautious', 'balanced', 'chaotic'];
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
      personality: isHuman ? undefined : pickRandom(personalities),
    };
  });
}

function shouldRevealIsResult(bot: LocalPlayer, result: { role: Role; alignment?: Alignment; action?: 'inspected' | 'ejected' }, suspicions: SuspicionMap, knowledge: SharedKnowledge): boolean {
  const selfSuspicion = Object.values(suspicions)
    .map((row) => row[bot.id])
    .filter((value): value is number => value !== undefined);
  const avgSelfSuspicion = selfSuspicion.length > 0
    ? selfSuspicion.reduce((sum, value) => sum + value, 0) / selfSuspicion.length
    : 20;
  const isClaimCount = countRoleClaims(knowledge, 'IS');
  const globalIsPressure = isClaimCount > 1 || Object.values(knowledge.claims).some((claim) => claim.role === 'IS' && claim.alignment === 'negative');

  const action = result.action ?? 'inspected';
  if (bot.alignment === 'negative') {
    if (action === 'ejected' && result.alignment === 'negative') return Math.random() < 0.18;
    return result.alignment === 'positive' && Math.random() < 0.35;
  }
  if (action === 'ejected' && result.alignment === 'positive') return Math.random() < 0.12;
  if (action === 'ejected' && result.alignment === 'negative') return globalIsPressure && avgSelfSuspicion >= 55 ? Math.random() < 0.7 : Math.random() < 0.96;
  if (globalIsPressure && avgSelfSuspicion >= 45) return result.alignment === 'negative' ? Math.random() < 0.55 : Math.random() < 0.25;
  if (avgSelfSuspicion >= 65) return result.alignment === 'negative' ? Math.random() < 0.45 : Math.random() < 0.15;
  return result.alignment === 'negative' ? Math.random() < 0.92 : Math.random() < 0.72;
}

function buildIsResultMessage(bot: LocalPlayer, targetId: string, result: { role: Role; alignment?: Alignment; action?: 'inspected' | 'ejected' }, players: LocalPlayer[], t: (key: string, params?: Record<string, unknown>) => string): string | null {
  const target = players.find((player) => player.id === targetId);
  if (!target) return null;
  const alignment = result.alignment ?? target.alignment;
  const actionKey = result.action === 'ejected' ? 'bot_is_eject_claim' : 'bot_is_result_claim';
  return t(`deduction_game.log.${actionKey}`, {
    number: target.number,
    role: claimCode(result.role, alignment),
  });
}

function buildBotDiscussionQueue(players: LocalPlayer[], dnfs: number, suspicions: SuspicionMap, driver1DNF: boolean, driver2DNF: boolean, knowledge: SharedKnowledge, log: DiscussionMessage[], t: (key: string, params?: Record<string, unknown>) => string, privateKnowledge: Record<string, BotPrivateKnowledge> = {}): DiscussionMessage[] {
  const aliveBots = shuffle(players.filter((player) => !player.isHuman && player.isAlive));

  return aliveBots.flatMap((bot, index) => {
    const riskAssessment = isAtRiskOfElimination(bot, suspicions, players);
    const evaluation = getTopEvaluation(bot, players, suspicions, knowledge, log);
    const suspect = evaluation?.target;
    const useDriverReference = Math.random() < 0.5 && dnfs > 0;

    const messages: DiscussionMessage[] = [];
    const inspectedEntry = Object.entries(privateKnowledge[bot.id]?.inspectedPlayers ?? {})[0];
    if (inspectedEntry && shouldRevealIsResult(bot, inspectedEntry[1], suspicions, knowledge)) {
      const resultMessage = buildIsResultMessage(bot, inspectedEntry[0], inspectedEntry[1], players, t);
      if (resultMessage) {
        messages.push({
          playerId: bot.id,
          playerNumber: bot.number,
          playerName: bot.name,
          message: resultMessage,
          delayMs: inspectedEntry[1].alignment === 'negative' ? 500 + index * 160 : 900 + index * 260,
        });
      }
    }

    if (riskAssessment.atRisk && Math.random() < 0.7) {
      const strategicTarget = findStrategicTarget(bot, players, suspicions, knowledge);
      if (strategicTarget) {
        const deflectionReason: TemplateReason = knowledge.claims[strategicTarget.id]?.role ? 'claim_contradiction' : dnfs > 0 ? 'race_dnf' : 'uncertain';
        messages.push({
          playerId: bot.id,
          playerNumber: bot.number,
          playerName: bot.name,
          message: buildTemplateMessage('attack', strategicTarget.number, deflectionReason, 'strong', claimCode(botClaim(bot), 'negative'), botClaimedAction(bot, t), 0, t),
          delayMs: 450 + index * 180,
        });
      }
    }

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

    const sharedTemplate = buildSharedBotTemplate(bot, suspect, evaluation, knowledge, dnfs, t);

    messages.push({
      playerId: bot.id,
      playerNumber: bot.number,
      playerName: bot.name,
      message: opener,
      delayMs: confidenceDelay(evaluation, 1800, 900, index),
    }, {
      playerId: bot.id,
      playerNumber: bot.number,
      playerName: bot.name,
      message: followUp,
      delayMs: confidenceDelay(evaluation, 5000, 1200, index + 1),
    }, {
      playerId: bot.id,
      playerNumber: bot.number,
      playerName: bot.name,
      message: sharedTemplate,
      delayMs: confidenceDelay(evaluation, 8200, 1300, index + 2),
    });

    return messages;
  });
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

function alignmentCode(alignment: Alignment): '+' | '-' {
  return alignment === 'positive' ? '+' : '-';
}

function claimCode(role: Role, alignment?: Alignment): string {
  return alignment ? `${role}${alignmentCode(alignment)}` : role;
}

function sideToAlignment(side: TemplateSide): Alignment | undefined {
  if (side === 'positive') return 'positive';
  if (side === 'negative') return 'negative';
  return undefined;
}

function intentNeedsTarget(intent: TemplateIntent): boolean {
  return ['sus', 'trust', 'ask', 'def', 'attack', 'explain', 'vote', 'world', 'switch'].includes(intent);
}

function intentUsesRole(intent: TemplateIntent): boolean {
  return ['claim', 'self', 'sus', 'trust', 'def', 'attack', 'explain', 'world', 'ig', 'nig', 'read'].includes(intent);
}

function intentUsesReason(): boolean {
  return true;
}

function intentUsesCertainty(intent: TemplateIntent): boolean {
  return intent !== 'action';
}

function actionLabel(action: TemplateActionVerb, t: (key: string, params?: Record<string, unknown>) => string): string {
  if (action === 'protected') return t('deduction_game.actions.protect').toLowerCase();
  if (action === 'sabotaged') return t('deduction_game.actions.sabotage').toLowerCase();
  if (action === 'analyzed') return t('deduction_game.actions.analyze').toLowerCase();
  if (action === 'inspected') return t('deduction_game.actions.sense').toLowerCase();
  if (action === 'ejected') return t('deduction_game.actions.eject').toLowerCase();
  return t('deduction_game.actions.know_all').toLowerCase();
}

function isDriverAction(action: TemplateActionVerb): boolean {
  return action === 'protected' || action === 'sabotaged' || action === 'analyzed';
}

function isRevealAction(action: TemplateActionVerb): boolean {
  return action === 'inspected' || action === 'learned';
}

function revealCode(role: Role, side: TemplateSide): string {
  if (side === 'positive') return `${role}+`;
  if (side === 'negative') return `${role}-`;
  return `${role}?`;
}

function buildActionTargetLabel(target: TemplateTarget, t: (key: string, params?: Record<string, unknown>) => string): string {
  if (target.kind === 'driver') return t('deduction_game.log.driver_name', { number: target.value });
  return target.label;
}

function defaultTemplateModules(): TemplateModule[] {
  return ['intent'];
}

function roleLabelWithPolarity(roleLabel: string, intent: TemplateIntent): string {
  if (['sus', 'attack', 'vote', 'switch'].includes(intent)) {
    return roleLabel.replace(/[+-]$/, '') + '-';
  }
  if (['trust', 'def'].includes(intent)) {
    return roleLabel.replace(/[+-]$/, '') + '+';
  }
  return roleLabel;
}

function buildTemplateMessage(intent: TemplateIntent, targetNumber: number, reason: TemplateReason | null, certainty: TemplateCertainty | null, roleLabel: string, actionLabelText: string, driverNumber: number, t: (key: string, params?: Record<string, unknown>) => string, modules: TemplateModule[] = defaultTemplateModules(), actionTargetLabel?: string, revealLabel?: string): string {
  const reasonParams = { number: targetNumber, role: roleLabelWithPolarity(roleLabel, intent), reveal: revealLabel ?? roleLabel, action: actionLabelText, target: actionTargetLabel ?? t('deduction_game.log.driver_name', { number: driverNumber }), driver: driverNumber, intent: t(`deduction_game.log.segment_intent_${intent}`) };
  const parts = modules.flatMap((module) => {
    if (module === 'intent') {
      const actionKey = intent === 'action' && revealLabel ? 'template_intent_action_reveal' : `template_intent_${intent}`;
      return [t(`deduction_game.log.${actionKey}`, reasonParams)];
    }
    if (module === 'reason' && reason) {
      const specificReason = t(`deduction_game.log.template_reason_${intent}_${reason}`, reasonParams);
      return [specificReason === `deduction_game.log.template_reason_${intent}_${reason}` ? t(`deduction_game.log.template_reason_${reason}`, reasonParams) : specificReason];
    }
    if (module === 'certainty' && certainty) return [t(`deduction_game.log.template_certainty_${certainty}`, reasonParams)];
    return [];
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

function botTemplateModules(evaluation: BotEvaluation | undefined): TemplateModule[] {
  if (!evaluation) return ['intent'];
  if (evaluation.totalScore >= 82) return ['intent', 'reason', 'certainty'];
  if (evaluation.publicReason === 'uncertain') return ['intent', 'certainty'];
  if (evaluation.publicReason === 'claim') return ['intent', 'reason', 'certainty'];
  if (evaluation.totalScore >= 70) return ['intent', 'reason', 'certainty'];
  return ['intent', 'reason'];
}

function confidenceDelay(evaluation: BotEvaluation | undefined, baseMs: number, indexMs: number, index = 0): number {
  const score = evaluation?.totalScore ?? 0;
  if (score >= 82) return 450 + index * 180;
  if (score >= 70) return 900 + index * 280;
  if (score >= 58) return Math.max(1200, baseMs * 0.45 + index * Math.min(indexMs, 350));
  return baseMs + index * indexMs;
}

function roleReasonForClaim(claim?: SharedKnowledge['claims'][string], fallback: TemplateReason = 'uncertain'): TemplateReason {
  if (!claim) return fallback;
  if (hasPublicClaimContradiction(claim)) return 'role_mismatch';
  if (claim.actionVerb === 'protected') return 'protective_claim';
  if (claim.actionVerb || claim.actionDriver) return 'driver_signal';
  if (claim.role) return 'claim_role';
  return fallback;
}

function intentForAlignmentRead(alignment: Alignment | undefined, fallback: TemplateIntent): TemplateIntent {
  if (alignment === 'positive') return 'trust';
  if (alignment === 'negative') return 'sus';
  return fallback;
}

function buildSharedBotTemplate(bot: LocalPlayer, suspect: LocalPlayer | undefined, evaluation: BotEvaluation | undefined, knowledge: SharedKnowledge, dnfs: number, t: (key: string, params?: Record<string, unknown>) => string): string {
  const targetNumber = suspect?.number ?? bot.number;
  const targetClaim = suspect ? knowledge.claims[suspect.id] : undefined;
  const intentPool: TemplateIntent[] = suspect
    ? ['sus', 'attack', 'explain', 'vote', 'switch']
    : ['claim', 'action', 'world', 'def', 'self', 'abs'];
  const baseIntent = intentPool[(bot.number + dnfs) % intentPool.length];
  const intent = intentForAlignmentRead(targetClaim?.alignment, baseIntent);
  const reason = roleReasonForClaim(targetClaim, evaluationReason(evaluation));
  const certainty: TemplateCertainty = (evaluation?.totalScore ?? 0) >= 70
    ? 'strong'
    : (evaluation?.totalScore ?? 0) >= 48
      ? 'medium'
      : 'weak';
  const action = botClaimedAction(bot, t);
  const driver = botClaimedDriver(bot, dnfs);
  const roleForRead = suspect ? suspect.role : botClaim(bot);

  return buildTemplateMessage(intent, targetNumber, reason, certainty, claimCode(roleForRead, intent === 'trust' ? 'positive' : intent === 'sus' || intent === 'attack' || intent === 'vote' || intent === 'switch' ? 'negative' : botClaimAlignment(bot)), action, driver, t, botTemplateModules(evaluation));
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

function shouldBotReactToExplosion(bot: LocalPlayer, log: DiscussionMessage[], humanPlayer: LocalPlayer, knowledge: SharedKnowledge): boolean {
  if (!bot.personality) return true;

  const { aggression } = BOT_PERSONALITIES[bot.personality];
  const humanMessages = log.filter((msg) => msg.playerId === humanPlayer.id);
  const recentContradiction = humanMessages.length >= 2 && humanMessages.length <= 3;

  const hasStrongEvidence = knowledge.claims[humanPlayer.id]?.alignment === 'negative' ||
                            knowledge.pressure >= 18 ||
                            knowledge.dnfs > 2;

  if (hasStrongEvidence) return Math.random() < 0.85 + aggression * 0.15;

  const temporalModifier = recentContradiction ? -0.3 : 0;
  const reactionProbability = Math.max(0.1, Math.min(0.95, aggression + temporalModifier));

  return Math.random() < reactionProbability;
}

function buildBotReactionQueue(players: LocalPlayer[], suspicions: SuspicionMap, knowledge: SharedKnowledge, log: DiscussionMessage[], humanPlayer: LocalPlayer, humanMessage: string, t: (key: string, params?: Record<string, unknown>) => string): DiscussionMessage[] {
  const parsed = parseComment(players, humanMessage);
  const target = parsed.target;
  const responses: DiscussionMessage[] = [];

  const suspiciousClaim = parsed.claimedAlignment === 'positive' && (parsed.intent === 'suspect' || parsed.intent === 'challenge');

  if (suspiciousClaim && target) {
    const suspiciousBots = players
      .filter((p) => !p.isHuman && p.isAlive)
      .slice(0, 2);

    responses.push(...suspiciousBots.map((bot, index) => ({
      playerId: bot.id,
      playerNumber: bot.number,
      playerName: bot.name,
      message: t(`deduction_game.log.bot_suspicious_claim_${(index % 2) + 1}`, { number: humanPlayer.number }),
      delayMs: 1200 + index * 1800,
    })));

    return responses;
  }

  if (isExplosiveClaim({ alignment: parsed.claimedAlignment, actionVerb: parsed.actionVerb })) {
    const reactingBots = players
      .filter((player) => !player.isHuman && player.isAlive)
      .filter((bot) => shouldBotReactToExplosion(bot, log, humanPlayer, knowledge))
      .slice(0, 2);

    responses.push(...reactingBots.map((player, index) => ({
      playerId: player.id,
      playerNumber: player.number,
      playerName: player.name,
      message: t(`deduction_game.log.bot_explosion_${index + 1}`, { number: humanPlayer.number }),
      delayMs: 900 + index * 1600,
    })));
  } else if (target && !target.isHuman && target.isAlive && ['suspect', 'ask', 'challenge'].includes(parsed.intent)) {
    const accuserAttacks = log.filter((msg) => {
      if (msg.playerId !== humanPlayer.id) return false;
      const p = parseComment(players, msg.message);
      return p.intent === 'suspect' || p.intent === 'challenge';
    });
    const accuserAttackedLowSus = accuserAttacks.some((msg) => {
      const p = parseComment(players, msg.message);
      return p.target && (suspicions[target.id]?.[p.target.id] ?? 50) < 35;
    });
    const accuserHasNoConcreteClaimYet = !knowledge.claims[humanPlayer.id]?.role && !knowledge.claims[humanPlayer.id]?.actionVerb;
    const defenseReason: TemplateReason = accuserAttackedLowSus ? 'anomalous_attack' : accuserHasNoConcreteClaimYet ? 'speech_evasion' : 'claim_role';

    responses.push({
      playerId: target.id,
      playerNumber: target.number,
      playerName: target.name,
      message: buildTemplateMessage('def', humanPlayer.number, defenseReason, 'medium', claimCode(botClaim(target), botClaimAlignment(target)), botClaimedAction(target, t), 0, t),
      delayMs: 1000 + Math.floor(Math.random() * 2500),
    });

    const targetEval = getTopEvaluation(target, players, suspicions, knowledge, log);
    const shouldCounterAccuse = Math.random() < 0.6 && (accuserAttackedLowSus || accuserHasNoConcreteClaimYet || (targetEval && targetEval.totalScore < 45));
    if (shouldCounterAccuse) {
      const counterReason: TemplateReason = accuserAttackedLowSus ? 'anomalous_attack' : accuserHasNoConcreteClaimYet ? 'speech_evasion' : 'uncertain';
      responses.push({
        playerId: target.id,
        playerNumber: target.number,
        playerName: target.name,
        message: buildTemplateMessage('attack', humanPlayer.number, counterReason, 'medium', claimCode(botClaim(target), 'negative'), botClaimedAction(target, t), 0, t),
        delayMs: targetEval && targetEval.totalScore >= 70 ? 650 : 1600 + Math.floor(Math.random() * 900),
      });
    }

    const botObservers = players
      .filter((player) => !player.isHuman && player.isAlive && player.id !== target.id)
      .map((player) => ({ player, evaluation: getTopEvaluation(player, players, suspicions, knowledge, log) }))
      .filter(({ evaluation }) => evaluation?.target.id === target.id)
      .sort((a, b) => (b.evaluation?.totalScore ?? 0) - (a.evaluation?.totalScore ?? 0));
    const observerItem = botObservers[0];
    const observer = observerItem?.player;
    if (observer) {
      responses.push({
        playerId: observer.id,
        playerNumber: observer.number,
        playerName: observer.name,
        message: t(`deduction_game.log.bot_counter_${(observer.number % 3) + 1}`, {
          accuser: humanPlayer.number,
          accused: target.number,
        }),
        delayMs: (observerItem.evaluation?.totalScore ?? 0) >= 70 ? 800 : 2200 + Math.floor(Math.random() * 2200),
      });
    }
  } else if (target && parsed.intent === 'trust') {
    const responder = players
      .filter((player) => !player.isHuman && player.isAlive)
      .map((player) => ({ player, evaluation: getTopEvaluation(player, players, suspicions, knowledge, log) }))
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

function botVote(bot: LocalPlayer, players: LocalPlayer[], suspicions: SuspicionMap, knowledge: SharedKnowledge, log: DiscussionMessage[], botPrivateKnowledge?: Record<string, BotPrivateKnowledge>): string | null {
  const evaluations = evaluateBotTargets(bot, players, suspicions, knowledge, log, botPrivateKnowledge);
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

function buildBotVoteMessage(bot: LocalPlayer, targetId: string | null, players: LocalPlayer[], suspicions: SuspicionMap, knowledge: SharedKnowledge, log: DiscussionMessage[], t: (key: string, params?: Record<string, unknown>) => string, botPrivateKnowledge?: Record<string, BotPrivateKnowledge>): DiscussionMessage {
  const target = targetId ? players.find((player) => player.id === targetId) : undefined;
  const evaluation = target ? evaluateBotTargets(bot, players, suspicions, knowledge, log, botPrivateKnowledge).find((item) => item.target.id === target.id) : undefined;
  const reason = evaluationReason(evaluation);
  const certainty: TemplateCertainty = (evaluation?.totalScore ?? 0) >= 70
    ? 'strong'
    : (evaluation?.totalScore ?? 0) >= 48
      ? 'medium'
      : 'weak';
  const message = target
    ? `${buildTemplateMessage('vote', target.number, reason, certainty, claimCode(target.role, 'negative'), botClaimedAction(bot, t), botClaimedDriver(bot, knowledge.dnfs), t)} ${t('deduction_game.log.bot_vote_locked', { number: target.number })}`
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
  const [players, setPlayers] = useState<LocalPlayer[]>(() => makePlayers(6, false));
  const [status, setStatus] = useState<RoomStatus>('night_phase');
  const [round, setRound] = useState(0);
  const [boardPressure, setBoardPressure] = useState(0);
  const [races, setRaces] = useState<LocalRace[]>([]);
  const [winner, setWinner] = useState<Alignment | null>(null);
  const [selectedDriver, setSelectedDriver] = useState('1');
  const [selectedVote, setSelectedVote] = useState('');
  const [nightSelection, setNightSelection] = useState<string | null>(null);
  const [inspectorNightMode, setInspectorNightMode] = useState<InspectorNightMode>('sense');
  const [gameLog, setGameLog] = useState<DiscussionMessage[]>([]);
  const [queuedMessages, setQueuedMessages] = useState<DiscussionMessage[]>([]);
  const [humanMessage, setHumanMessage] = useState('');
  const [timer, setTimer] = useState(0);
  const [voteResults, setVoteResults] = useState<Record<string, string>>({});
  const [abstainedVotes, setAbstainedVotes] = useState<string[]>([]);
  const [botVoteQueue, setBotVoteQueue] = useState<LocalPlayer[]>([]);
  const [showVoteReveal, setShowVoteReveal] = useState(false);
  const [suspicions, setSuspicions] = useState<SuspicionMap>({});
  const [baseSuspicions, setBaseSuspicions] = useState<SuspicionMap>({});
  const [sharedKnowledge, setSharedKnowledge] = useState<SharedKnowledge>({ claims: {}, revealClaims: [], pressure: 0, dnfs: 0 });
  const [botPrivateKnowledge, setBotPrivateKnowledge] = useState<Record<string, BotPrivateKnowledge>>({});
  const [templateIntent, setTemplateIntent] = useState<TemplateIntent | null>(null);
  const [templateTarget, setTemplateTarget] = useState<number | null>(null);
  const [templateReason, setTemplateReason] = useState<TemplateReason | null>(null);
  const [templateRole, setTemplateRole] = useState<Role>('TC');
  const [templateSide, setTemplateSide] = useState<TemplateSide>('unknown');
  const [templateAction, setTemplateAction] = useState<TemplateActionVerb>('inspected');
  const [templateActionTarget, setTemplateActionTarget] = useState<TemplateTarget | null>(null);
  const [templateCertainty, setTemplateCertainty] = useState<TemplateCertainty | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [showDev, setShowDev] = useState(false);
  const [observerMode, setObserverMode] = useState(false);
  const [botNightActions, setBotNightActions] = useState<Record<string, { action: string; target?: string; targetName?: string }>>({});
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
    { value: 'read', abbr: 'rd' },
    { value: 'def', abbr: 'def' },
    { value: 'self', abbr: 'me' },
    { value: 'logic', abbr: 'log' },
    { value: 'attack', abbr: 'atk' },
    { value: 'explain', abbr: 'why' },
    { value: 'vote', abbr: 'vt' },
    { value: 'world', abbr: 'wd' },
    { value: 'switch', abbr: 'sw' },
    { value: 'abs', abbr: 'abs' },
    { value: 'ig', abbr: 'ig' },
    { value: 'nig', abbr: 'nig' },
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
    { value: 'anomalous_attack', abbr: 'atk' },
    { value: 'speech_evasion', abbr: 'eva' },
    { value: 'role_mismatch', abbr: 'mis' },
    { value: 'driver_signal', abbr: 'drv' },
    { value: 'counterclaim', abbr: 'cc' },
    { value: 'claim_pressure', abbr: 'clm' },
    { value: 'protective_claim', abbr: 'prt' },
    { value: 'uncertain', abbr: 'unc' },
  ], []);

  const templateRoles = useMemo<Array<{ value: Role; abbr: string }>>(() => [
    { value: 'TP', abbr: 'TP' },
    { value: 'TC', abbr: 'TC' },
    { value: 'IS', abbr: 'IS' },
    { value: 'ST', abbr: 'ST' },
  ], []);

  const templateActions = useMemo<Array<{ value: TemplateActionVerb; abbr: string }>>(() => [
    { value: 'inspected', abbr: 'sense' },
    { value: 'ejected', abbr: 'expel' },
    { value: 'protected', abbr: 'prot' },
    { value: 'sabotaged', abbr: 'sab' },
    { value: 'analyzed', abbr: 'ana' },
    { value: 'learned', abbr: 'know' },
  ], []);

  const templateSides = useMemo<Array<{ value: TemplateSide; abbr: string }>>(() => [
    { value: 'unknown', abbr: '?' },
    { value: 'positive', abbr: '+' },
    { value: 'negative', abbr: '-' },
  ], []);

  const templateCertainties = useMemo<Array<{ value: TemplateCertainty; abbr: string }>>(() => [
    { value: 'weak', abbr: 'w' },
    { value: 'medium', abbr: 'm' },
    { value: 'strong', abbr: 's' },
  ], []);

  const humanActionLabel = useMemo(() => {
    if (!human) return null;
    if (human.role === 'TP') return human.alignment === 'negative' ? t('deduction_game.actions.eject') : null;
    if (human.role === 'TC') return human.alignment === 'positive' ? t('deduction_game.actions.protect') : t('deduction_game.actions.sabotage');
    if (human.role === 'IS') return inspectorNightMode === 'sense' ? t('deduction_game.actions.sense') : t('deduction_game.actions.eject');
    if (human.role === 'ST') return human.alignment === 'positive' ? t('deduction_game.actions.analyze') : t('deduction_game.actions.sabotage');
    return null;
  }, [human, inspectorNightMode, t]);

  const nightSelectedTargetLabel = useMemo(() => {
    if (!nightSelection) return '';
    if (nightSelection === '1' || nightSelection === '2') return t('deduction_game.log.driver_name', { number: Number(nightSelection) });
    const target = players.find((player) => player.id === nightSelection);
    return target ? `#${target.number} ${target.name}` : '';
  }, [nightSelection, players, t]);

  const templateTargets = useMemo<TemplateTarget[]>(() => [
    { kind: 'driver', value: 1, label: t('deduction_game.log.driver_name', { number: 1 }) },
    { kind: 'driver', value: 2, label: t('deduction_game.log.driver_name', { number: 2 }) },
    ...players.filter((player) => player.isAlive).map((player) => ({ kind: 'player' as const, value: player.number, label: `#${player.number} ${player.name}` })),
  ], [players, t]);

  const filteredTemplateTargets = useMemo(() => {
    if (isDriverAction(templateAction)) return templateTargets.filter((target) => target.kind === 'driver');
    return templateTargets.filter((target) => target.kind === 'player');
  }, [templateAction, templateTargets]);

  const liveVoteCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    Object.values(voteResults).forEach((targetId) => {
      counts[targetId] = (counts[targetId] ?? 0) + 1;
    });
    return counts;
  }, [voteResults]);

  const selectedTemplateIntent = templateIntent ?? 'sus';
  const templateTargetNumber = templateTarget ?? players.find((player) => !player.isHuman && player.isAlive)?.number ?? 1;
  const selectedActionTarget = useMemo<TemplateTarget>(() => (
    templateActionTarget && filteredTemplateTargets.some((target) => target.kind === templateActionTarget.kind && target.value === templateActionTarget.value)
      ? templateActionTarget
      : filteredTemplateTargets[0] ?? { kind: 'driver', value: 1, label: t('deduction_game.log.driver_name', { number: 1 }) }
  ), [filteredTemplateTargets, t, templateActionTarget]);
  const templateActionLabel = actionLabel(templateAction, t);
  const templateActionTargetLabel = buildActionTargetLabel(selectedActionTarget, t);
  const templateDriverNumber = selectedActionTarget.kind === 'driver' ? selectedActionTarget.value : Number(selectedDriver);
  const templateRoleLabel = claimCode(templateRole, sideToAlignment(templateSide));
  const baseTemplatePreview = useMemo(() => buildTemplateMessage(
    selectedTemplateIntent,
    templateTargetNumber,
    templateReason,
    templateCertainty,
    templateRoleLabel,
    templateActionLabel,
    templateDriverNumber,
    t,
    ['intent', ...(templateReason ? ['reason' as const] : []), ...(templateCertainty && selectedTemplateIntent !== 'action' ? ['certainty' as const] : [])],
    templateActionTargetLabel,
    isRevealAction(templateAction) ? revealCode(templateRole, templateSide) : undefined,
  ), [t, templateAction, templateActionLabel, templateActionTargetLabel, templateCertainty, templateDriverNumber, templateRole, templateSide, selectedTemplateIntent, templateReason, templateRoleLabel, templateTargetNumber]);

  const templatePreview = templateIntent ? baseTemplatePreview : t('deduction_game.log.step_choose_intent');

  const roleCertainty = useMemo(
    () => buildRoleCertaintyMap(players, sharedKnowledge),
    [players, sharedKnowledge],
  );

  useEffect(() => {
    if (Object.keys(baseSuspicions).length === 0) return;
    setSuspicions(derivePublicSuspicions(players, gameLog, sharedKnowledge, baseSuspicions, botPrivateKnowledge));
  }, [baseSuspicions, botPrivateKnowledge, gameLog, players, sharedKnowledge]);

  const applyTemplate = useCallback((updates?: Partial<{ intent: TemplateIntent; target: number; reason: TemplateReason; certainty: TemplateCertainty; role: Role; side: TemplateSide; action: TemplateActionVerb; actionTarget: TemplateTarget }>) => {
    const nextIntent = updates?.intent ?? selectedTemplateIntent;
    const nextTarget = updates?.target ?? templateTargetNumber;
    const nextReason = updates?.reason ?? templateReason;
    const nextCertainty = updates?.certainty ?? templateCertainty;
    const nextRole = updates?.role ?? templateRole;
    const nextSide = updates?.side ?? templateSide;
    const nextAction = updates?.action ?? templateAction;
    const validTargets = isDriverAction(nextAction)
      ? templateTargets.filter((target) => target.kind === 'driver')
      : templateTargets.filter((target) => target.kind === 'player');
    const requestedActionTarget = updates?.actionTarget ?? templateActionTarget;
    const nextActionTarget = requestedActionTarget && validTargets.some((target) => target.kind === requestedActionTarget.kind && target.value === requestedActionTarget.value)
      ? requestedActionTarget
      : validTargets[0] ?? selectedActionTarget;
    const nextActionTargetLabel = buildActionTargetLabel(nextActionTarget, t);
    const nextDriver = nextActionTarget.kind === 'driver' ? nextActionTarget.value : templateDriverNumber;

    if (updates?.intent) setTemplateIntent(updates.intent);
    if (updates?.target) setTemplateTarget(updates.target);
    if (updates?.reason) setTemplateReason(updates.reason);
    if (updates?.certainty) setTemplateCertainty(updates.certainty);
    if (updates?.role) setTemplateRole(updates.role);
    if (updates?.side) setTemplateSide(updates.side);
    if (updates?.action) setTemplateAction(updates.action);
    if (updates?.action || updates?.actionTarget) setTemplateActionTarget(nextActionTarget);

    setHumanMessage(buildTemplateMessage(
      nextIntent,
      nextTarget,
      nextReason,
      nextIntent === 'action' ? null : nextCertainty,
      claimCode(nextRole, sideToAlignment(nextSide)),
      actionLabel(nextAction, t),
      nextDriver,
      t,
      ['intent', ...(nextReason ? ['reason' as const] : []), ...(nextCertainty && nextIntent !== 'action' ? ['certainty' as const] : [])],
      nextActionTargetLabel,
      isRevealAction(nextAction) ? revealCode(nextRole, nextSide) : undefined,
    ));
    inputRef.current?.focus();
  }, [t, selectedActionTarget, templateAction, templateActionTarget, templateCertainty, templateDriverNumber, selectedTemplateIntent, templateReason, templateRole, templateSide, templateTargetNumber, templateTargets]);

  const templateStepHint = useMemo(() => {
    if (!templateIntent) return t('deduction_game.log.step_choose_intent');
    if (templateIntent === 'action' && !templateActionTarget) return t('deduction_game.log.step_choose_action_target');
    if (intentNeedsTarget(templateIntent) && !templateTarget) return t('deduction_game.log.step_choose_target');
    return t('deduction_game.log.step_append_optional');
  }, [t, templateIntent, templateTarget, templateActionTarget]);

  const commandHint = useMemo(() => {
    const command = humanMessage.trim().toLowerCase().replace(/^\//, '');
    if (!command || command.includes(' ')) return templatePreview;

    const intent = templateIntents.find((segment) => segment.abbr.startsWith(command) || segment.value.startsWith(command));
    const action = templateActions.find((segment) => segment.abbr.startsWith(command) || segment.value.startsWith(command));
    const reason = templateReasons.find((segment) => segment.abbr.startsWith(command) || segment.value.startsWith(command));
    const certainty = templateCertainties.find((segment) => segment.abbr.startsWith(command) || segment.value.startsWith(command));

    const role = templateRoles.find((segment) => segment.abbr.toLowerCase().startsWith(command) || segment.value.toLowerCase().startsWith(command));
    const side = templateSides.find((segment) => segment.abbr === command || segment.value.startsWith(command));

    if (intent) return t('deduction_game.log.completion_hint', { command: `/${intent.abbr}`, value: t(`deduction_game.log.segment_intent_${intent.value}`) });
    if (action) return t('deduction_game.log.completion_hint', { command: `/${action.abbr}`, value: actionLabel(action.value, t) });
    if (reason) return t('deduction_game.log.completion_hint', { command: `/${reason.abbr}`, value: t(`deduction_game.log.segment_reason_${reason.value}`) });
    if (role) return t('deduction_game.log.completion_hint', { command: `/${role.abbr}`, value: t('deduction_game.log.segment_role_value', { role: role.value }) });
    if (side) return t('deduction_game.log.completion_hint', { command: `/${side.abbr}`, value: t(`deduction_game.alignment.${side.value === 'unknown' ? 'positive' : side.value}`) });
    if (certainty) return t('deduction_game.log.completion_hint', { command: `/${certainty.abbr}`, value: t(`deduction_game.log.segment_certainty_${certainty.value}`) });
    return templatePreview;
  }, [humanMessage, t, templateActions, templateCertainties, templateIntents, templatePreview, templateReasons, templateRoles, templateSides]);

  const showTemplateTarget = templateIntent ? intentNeedsTarget(templateIntent) : false;
  const showTemplateAction = templateIntent === 'action';
  const showTemplateActionTarget = templateIntent === 'action';
  const showTemplateReveal = templateIntent === 'action' && isRevealAction(templateAction);
  const showTemplateRole = templateIntent ? (showTemplateReveal || (intentUsesRole(templateIntent) && (!showTemplateTarget || Boolean(templateTarget)))) : false;
  const showTemplateSide = showTemplateRole;
  const showTemplateReason = templateIntent ? intentUsesReason() && (!showTemplateTarget || Boolean(templateTarget)) : false;
  const showTemplateCertainty = templateIntent ? intentUsesCertainty(templateIntent) && (!showTemplateTarget || Boolean(templateTarget)) : false;

  const submitBotVote = useCallback((bot: LocalPlayer) => {
    const voteTarget = botVote(bot, players, suspicions, sharedKnowledge, gameLog, botPrivateKnowledge);
    if (voteTarget) {
      setVoteResults((current) => ({ ...current, [bot.id]: voteTarget }));
    } else {
      setAbstainedVotes((current) => current.includes(bot.id) ? current : [...current, bot.id]);
    }
    setGameLog((messages) => [...messages, buildBotVoteMessage(bot, voteTarget, players, suspicions, sharedKnowledge, gameLog, t, botPrivateKnowledge)]);
  }, [botPrivateKnowledge, gameLog, players, sharedKnowledge, suspicions, t]);

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

      const voteTarget = botVote(bot, players, suspicions, sharedKnowledge, gameLog, botPrivateKnowledge);
      if (voteTarget) nextVotes[bot.id] = voteTarget;
      else nextAbstentions.push(bot.id);
      setGameLog((messages) => [...messages, buildBotVoteMessage(bot, voteTarget, players, suspicions, sharedKnowledge, messages, t, botPrivateKnowledge)]);
    });

    setBotVoteQueue([]);
    setVoteResults(nextVotes);
    setAbstainedVotes(nextAbstentions);
    setTimer(0);
    setShowVoteReveal(true);
  }, [abstainedVotes, botPrivateKnowledge, botVoteQueue, gameLog, players, sharedKnowledge, suspicions, t, voteResults]);

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
        if (nextMessage) {
          setGameLog((messages) => {
            const nextLog = [...messages, nextMessage];
            setSharedKnowledge(parsePublicKnowledge(players, nextLog, boardPressure, sharedKnowledge.dnfs));
            return nextLog;
          });
        }
        return remaining;
      });
    }, delay);

    return () => clearTimeout(timeout);
  }, [boardPressure, players, sharedKnowledge.dnfs, status, queuedMessages]);

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

  useEffect(() => {
    if (!observerMode || status !== 'discussion' || queuedMessages.length > 0) return;

    const aliveBots = players.filter((p) => !p.isHuman && p.isAlive);
    if (aliveBots.length === 0) return;

    const speakingBot = pickRandom(aliveBots);
    const evals = evaluateBotTargets(speakingBot, players, suspicions, sharedKnowledge, gameLog, botPrivateKnowledge);
    const topTarget = evals[0];

    if (!topTarget) return;

    const intent: TemplateIntent = topTarget.totalScore >= 60 ? 'sus' : topTarget.totalScore <= 30 ? 'trust' : 'ask';
    const botClaim = { role: topTarget.target.role, alignment: intent === 'trust' ? 'positive' as Alignment : 'negative' as Alignment };
    const reason: TemplateReason = topTarget.publicReason === 'claim' ? 'claim_role' : topTarget.publicReason === 'race' ? 'race_dnf' : 'uncertain';

    const message = buildTemplateMessage(intent, topTarget.target.number, reason, 'medium', claimCode(botClaim.role, botClaim.alignment), '', 0, t);

    const timeout = setTimeout(() => {
      setGameLog((log) => [...log, {
        playerId: speakingBot.id,
        playerNumber: speakingBot.number,
        playerName: speakingBot.name,
        message,
      }]);
    }, 2000 + Math.random() * 3000);

    return () => clearTimeout(timeout);
  }, [observerMode, status, queuedMessages, players, suspicions, sharedKnowledge, gameLog, botPrivateKnowledge, t]);

  useEffect(() => {
    if (!observerMode || status !== 'discussion' || timer > 0) return;

    const timeout = setTimeout(() => beginVoting(), 1000);
    return () => clearTimeout(timeout);
  }, [observerMode, status, timer, beginVoting]);

  useEffect(() => {
    if (!observerMode || status !== 'voting' || showVoteReveal) return;

    const aliveBots = players.filter((p) => !p.isHuman && p.isAlive);
    const unvotedBots = aliveBots.filter((bot) => !voteResults[bot.id] && !abstainedVotes.includes(bot.id));

    if (unvotedBots.length === 0 && timer === 0) {
      const timeout = setTimeout(() => proceedToVoteReveal(), 1000);
      return () => clearTimeout(timeout);
    }
  }, [observerMode, status, showVoteReveal, players, voteResults, abstainedVotes, timer, proceedToVoteReveal]);

  const restart = () => {
    setPlayers(makePlayers(playerCount, observerMode));
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
    setInspectorNightMode('sense');
    setSuspicions({});
    setBaseSuspicions({});
    setSharedKnowledge({ claims: {}, revealClaims: [], pressure: 0, dnfs: 0 });
    setBotPrivateKnowledge({});
  };

  const performBotNightActions = useCallback((): Record<string, BotPrivateKnowledge> => {
    const bots = players.filter((p) => !p.isHuman && p.isAlive);
    const nextKnowledge: Record<string, BotPrivateKnowledge> = {};
    const nightActions: Record<string, { action: string; target?: string; targetName?: string }> = {};

    bots.forEach((bot) => {
      nextKnowledge[bot.id] = { inspectedPlayers: {}, knownRoles: {}, inferences: {} };

      if (bot.role === 'TP' && bot.alignment === 'positive') {
        players.forEach((p) => {
          if (p.id !== bot.id) {
            nextKnowledge[bot.id].knownRoles[p.id] = { role: p.role };
          }
        });
        nightActions[bot.id] = { action: 'Learned all roles' };
      }

      if (bot.role === 'IS') {
        const targets = players.filter((p) => p.isAlive && p.id !== bot.id);
        if (targets.length > 0) {
          const evals = evaluateBotTargets(bot, players, suspicions, sharedKnowledge, gameLog);
          const sorted = evals.sort((a, b) => b.totalScore - a.totalScore);
          const top = sorted[0];
          const shouldEject = bot.alignment === 'positive'
            ? (top?.totalScore ?? 0) >= 86 && Math.random() < 0.72
            : Math.random() < 0.28;
          const target = shouldEject
            ? (bot.alignment === 'negative'
              ? (targets.find((player) => player.alignment === 'positive') ?? top?.target)
              : top?.target)
            : sorted[Math.floor(Math.random() * Math.min(3, sorted.length))]?.target;
          if (target) {
            nextKnowledge[bot.id].inspectedPlayers[target.id] = { role: target.role, alignment: target.alignment, action: shouldEject ? 'ejected' : 'inspected' };
            nightActions[bot.id] = {
              action: shouldEject ? 'Ejected' : 'Inspected',
              target: target.id,
              targetName: `#${target.number} (${target.role}${target.alignment === 'positive' ? '+' : '-'})`,
            };
          }
        }
      }

      if (bot.role === 'TC') {
        const driver = round % 2 === 0 ? '2' : '1';
        if (bot.alignment === 'negative') {
          nightActions[bot.id] = { action: 'Sabotaged', targetName: `Driver ${driver}` };
        } else {
          nightActions[bot.id] = { action: 'Protected', targetName: `Driver ${driver}` };
        }
      }

      if (bot.role === 'ST') {
        const targets = players.filter((p) => p.isAlive && p.id !== bot.id);
        if (targets.length > 0) {
          const driver = bot.alignment === 'negative'
            ? (Math.random() < 0.5 ? '1' : '2')
            : (round % 2 === 0 ? '1' : '2');
          if (bot.alignment === 'negative') {
            nightActions[bot.id] = { action: 'Sabotaged', targetName: `Driver ${driver}` };
          } else {
            nightActions[bot.id] = { action: 'Protected', targetName: `Driver ${driver}` };
          }
        }
      }
    });

    setBotPrivateKnowledge(nextKnowledge);
    setBotNightActions(nightActions);
    return nextKnowledge;
  }, [players, suspicions, sharedKnowledge, gameLog, round]);

  useEffect(() => {
    if (status === 'night_phase' && round > 0) {
      performBotNightActions();
    }
  }, [status, round, performBotNightActions]);

  const updateBotInferences = useCallback((driver1DNF: boolean, driver2DNF: boolean, selectedDriverNumber: number) => {
    setBotPrivateKnowledge((prev) => {
      const next = { ...prev };
      players.filter((p) => !p.isHuman && p.isAlive).forEach((bot) => {
        if (!next[bot.id]) next[bot.id] = { inspectedPlayers: {}, knownRoles: {}, inferences: {} };

        if (bot.role === 'ST' && bot.alignment === 'positive') {
          const dnfOccurred = driver1DNF || driver2DNF;
          const botDidNotSabotage = selectedDriverNumber !== 1 && selectedDriverNumber !== 2;
          if (dnfOccurred && botDidNotSabotage) {
            players.filter((p) => p.role === 'TC' && p.id !== bot.id).forEach((tc) => {
              next[bot.id].inferences[tc.id] = (next[bot.id].inferences[tc.id] ?? 0) + 15;
            });
          }
        }

        if (bot.role === 'TC' && bot.alignment === 'positive') {
          const protectedDriver = selectedDriverNumber;
          const protectedDNF = (protectedDriver === 1 && driver1DNF) || (protectedDriver === 2 && driver2DNF);
          if (protectedDNF) {
            players.filter((p) => p.role === 'ST' && p.id !== bot.id).forEach((st) => {
              next[bot.id].inferences[st.id] = (next[bot.id].inferences[st.id] ?? 0) + 15;
            });
          }
        }
      });
      return next;
    });
  }, [players]);

  const confirmNightAction = () => {
    if (!nightSelection) return;

    if (human?.role === 'TP' && human.alignment === 'negative') {
      const target = players.find((player) => player.id === nightSelection);
      if (!target) return;
      setNightSelection(null);
      setPlayers((current) => current.map((player) => player.id === target.id ? { ...player, isAlive: false } : player));
      setGameLog((log) => [
        ...log,
        {
          playerId: 'principal-eject-result',
          playerNumber: human.number,
          playerName: 'TP',
          message: t('deduction_game.log.principal_eject_result', {
            number: target.number,
            role: claimCode(target.role, target.alignment),
          }),
        },
      ]);
      resolveRace(selectedDriver);
      return;
    }

    if (human?.role === 'IS') {
      const target = players.find((player) => player.id === nightSelection);
      if (!target) return;
      setNightSelection(null);

      if (inspectorNightMode === 'eject') {
        setPlayers((current) => current.map((player) => player.id === target.id ? { ...player, isAlive: false } : player));
        setGameLog((log) => [
          ...log,
          {
            playerId: 'inspector-eject-result',
            playerNumber: human.number,
            playerName: 'IS',
            message: t('deduction_game.log.inspector_eject_result', {
              number: target.number,
              role: claimCode(target.role, target.alignment),
            }),
          },
        ]);
      } else {
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
      }

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

  const resolveRace = useCallback((driverSelection = selectedDriver, immediateBotKnowledge: Record<string, BotPrivateKnowledge> = botPrivateKnowledge) => {
    const actingPlayers = ((human?.role === 'IS' && inspectorNightMode === 'eject') || (human?.role === 'TP' && human.alignment === 'negative')) && nightSelection
      ? players.map((player) => player.id === nightSelection ? { ...player, isAlive: false } : player)
      : players;
    const nextRound = round + 1;
    const negativeTCs = actingPlayers.filter((player) => player.isAlive && player.role === 'TC' && player.alignment === 'negative');
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
    const nextKnowledge = parsePublicKnowledge(actingPlayers, gameLog, nextBoardPressure, dnfs);
    const nextBaseSuspicions = buildSuspicionMap(actingPlayers, dnfs);
    const nextSuspicions = derivePublicSuspicions(actingPlayers, gameLog, nextKnowledge, nextBaseSuspicions, immediateBotKnowledge);
    const driverDebriefs = [
      buildDriverDebrief(1, driver1DNF, sabotagedDriver, protectedDriver, t),
      buildDriverDebrief(2, driver2DNF, sabotagedDriver, protectedDriver, t),
    ];

    updateBotInferences(driver1DNF, driver2DNF, selectedDriverNumber);

    setRound(nextRound);
    setBoardPressure(nextBoardPressure);
    setRaces([...races, { round: nextRound, report, driver1DNF, driver2DNF }]);
    setBaseSuspicions(nextBaseSuspicions);
    setSuspicions(nextSuspicions);
    setSharedKnowledge(nextKnowledge);
    setGameLog((log) => {
      const updatedLog = [
        ...log,
        { playerId: 'race-control', playerNumber: 0, playerName: t('deduction_game.log.race_control'), message: report },
        ...(raceAnalysis ? [{ playerId: 'strategist-analysis', playerNumber: human?.number ?? 0, playerName: 'ST', message: raceAnalysis }] : []),
        ...driverDebriefs,
      ];
      setQueuedMessages(buildBotDiscussionQueue(actingPlayers, dnfs, nextSuspicions, driver1DNF, driver2DNF, nextKnowledge, updatedLog, t, immediateBotKnowledge));
      return updatedLog;
    });
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
  }, [boardPressure, boardThreshold, botPrivateKnowledge, gameLog, human, inspectorNightMode, nightSelection, players, races, round, selectedDriver, t, updateBotInferences]);

  useEffect(() => {
    if (!observerMode || status !== 'night_phase') return;

    const timeout = setTimeout(() => {
      const randomDriver = Math.random() < 0.5 ? '1' : '2';
      const nextKnowledge = performBotNightActions();
      resolveRace(randomDriver, nextKnowledge);
    }, 3000);

    return () => clearTimeout(timeout);
  }, [observerMode, status, round, performBotNightActions, resolveRace]);

  const submitHumanMessage = () => {
    const trimmed = humanMessage.trim();
    if (!trimmed || !human) return;

    const nextLog = [...gameLog, {
      playerId: human.id,
      playerNumber: human.number,
      playerName: human.name,
      message: trimmed,
    }];
    const nextKnowledge = parsePublicKnowledge(players, nextLog, boardPressure, sharedKnowledge.dnfs);
    setGameLog(nextLog);
    setSharedKnowledge(nextKnowledge);
    setQueuedMessages((messages) => [...messages, ...buildBotReactionQueue(players, suspicions, nextKnowledge, nextLog, human, trimmed, t)]);
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
    const alivePositives = nextPlayers.filter((player) => player.isAlive && player.alignment === 'positive');

    if (firedPlayer) {
      const updatedBaseSuspicions = updateSuspicionsAfterDeath(firedPlayer, voteResults, baseSuspicions, gameLog, sharedKnowledge, nextPlayers);
      setBaseSuspicions(updatedBaseSuspicions);
      setSuspicions(derivePublicSuspicions(nextPlayers, gameLog, sharedKnowledge, updatedBaseSuspicions, botPrivateKnowledge));
    }

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

    if (alivePositives.length <= aliveNegatives.length) {
      setWinner('negative');
      setStatus('ended');
      return;
    }

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
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-black">{t('deduction_game.title')} <span className="text-blue-400">{t('deduction_game.local')}</span></h1>
          <div className="flex gap-2">
            <button onClick={() => setObserverMode((v) => !v)} className={`px-3 py-1 rounded text-xs font-mono border ${observerMode ? 'bg-cyan-600/30 border-cyan-400 text-cyan-300' : 'bg-neutral-800 border-white/10 text-gray-400 hover:border-cyan-500/40'}`}>Observer</button>
            <button onClick={() => setShowDev((v) => !v)} className={`px-3 py-1 rounded text-xs font-mono border ${showDev ? 'bg-amber-600/30 border-amber-400 text-amber-300' : 'bg-neutral-800 border-white/10 text-gray-400 hover:border-amber-500/40'}`}>Dev</button>
            <button onClick={() => setShowManual(true)} className="px-3 py-1 rounded text-xs font-mono border bg-neutral-800 border-white/10 text-gray-400 hover:border-purple-500/40">?</button>
          </div>
        </div>

        {showManual && <Manual onClose={() => setShowManual(false)} />}

        {showDev && <DevPanel players={players} suspicions={suspicions} sharedKnowledge={sharedKnowledge} gameLog={gameLog} botPrivateKnowledge={botPrivateKnowledge} roleCertainty={roleCertainty} evaluateBotTargets={evaluateBotTargets} />}

        {round === 0 && status !== 'ended' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-neutral-800 p-4 rounded-xl border border-white/5 grid md:grid-cols-3 gap-3 items-end mb-6"
          >
            <label className="block">
              <span className="text-xs text-gray-300 mb-1 block">{t('deduction_game.lobby.players')}</span>
              <select value={playerCount} onChange={(event) => setPlayerCount(Number(event.target.value))} className="w-full bg-neutral-700 border border-white/10 p-2 rounded-lg text-sm">
                {[4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].map((count) => <option key={count} value={count}>{count}</option>)}
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
                {status === 'night_phase' && observerMode && Object.keys(botNightActions).length > 0 && (
                  <div className="text-cyan-300 mb-2 p-2 bg-cyan-900/20 rounded border border-cyan-500/30">
                    <div className="font-bold mb-2">Observer: Bot Night Actions</div>
                    {players.filter(p => !p.isHuman && p.isAlive).map(bot => {
                      const action = botNightActions[bot.id];
                      if (!action) return null;
                      return (
                        <div key={bot.id} className="text-xs mb-1">
                          <span className="text-cyan-400">#{bot.number} {bot.name}</span>
                          <span className="text-gray-400"> ({bot.role}{bot.alignment === 'positive' ? '+' : '-'}): </span>
                          <span className="text-cyan-200">{action.action}</span>
                          {action.targetName && <span className="text-yellow-300"> → {action.targetName}</span>}
                        </div>
                      );
                    })}
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
                      {human.role === 'IS' && (
                        <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
                          <button
                            onClick={() => {
                              setInspectorNightMode('sense');
                              setNightSelection(null);
                            }}
                            className={`rounded-lg border p-2 ${inspectorNightMode === 'sense' ? 'border-blue-400 bg-blue-600/30 text-white' : 'border-white/10 bg-neutral-900 text-gray-300'}`}
                          >
                            {t('deduction_game.actions.sense')}
                          </button>
                          <button
                            onClick={() => {
                              setInspectorNightMode('eject');
                              setNightSelection(null);
                            }}
                            className={`rounded-lg border p-2 ${inspectorNightMode === 'eject' ? 'border-red-400 bg-red-600/30 text-white' : 'border-white/10 bg-neutral-900 text-gray-300'}`}
                          >
                            {t('deduction_game.actions.eject')}
                          </button>
                        </div>
                      )}
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
                      <div className="text-gray-500/80 italic">{templateStepHint} {commandHint}</div>
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
                        {showTemplateAction && (
                        <div>
                          <div className="text-gray-500 mb-1">{t('deduction_game.log.segment_action')}</div>
                          <div className="flex flex-wrap gap-1">
                            {templateActions.map((segment) => (
                              <button
                                key={segment.value}
                                onClick={() => applyTemplate({ action: segment.value })}
                                className={`px-2 py-1 rounded border ${templateAction === segment.value ? 'bg-rose-600/40 border-rose-400 text-white' : 'bg-neutral-900 border-white/10 text-gray-300 hover:border-rose-500/50'}`}
                              >
                                /{segment.abbr}
                              </button>
                            ))}
                          </div>
                        </div>
                        )}
                        {showTemplateActionTarget && (
                        <div>
                          <div className="text-gray-500 mb-1">{t('deduction_game.log.segment_action_target')}</div>
                          <div className="flex flex-wrap gap-1">
                            {filteredTemplateTargets.map((target) => (
                              <button
                                key={`${target.kind}-${target.value}`}
                                onClick={() => applyTemplate({ actionTarget: target })}
                                className={`px-2 py-1 rounded border ${selectedActionTarget.kind === target.kind && selectedActionTarget.value === target.value ? 'bg-blue-600/40 border-blue-400 text-white' : 'bg-neutral-900 border-white/10 text-gray-300 hover:border-blue-500/50'}`}
                              >
                                {target.kind === 'driver' ? `D${target.value}` : target.kind === 'all' ? t('deduction_game.actions.all_players_short') : `#${target.value}`}
                              </button>
                            ))}
                          </div>
                        </div>
                        )}
                        {showTemplateTarget && (
                        <div>
                          <div className="text-gray-500 mb-1">{t('deduction_game.log.segment_target_required')}</div>
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
                        )}
                        {showTemplateRole && (
                        <div>
                          <div className="text-gray-500 mb-1">{t('deduction_game.log.segment_role')}</div>
                          <div className="flex flex-wrap gap-1">
                            {templateRoles.map((segment) => (
                              <button
                                key={segment.value}
                                onClick={() => applyTemplate({ role: segment.value })}
                                className={`px-2 py-1 rounded border ${templateRole === segment.value ? 'bg-cyan-600/40 border-cyan-400 text-white' : 'bg-neutral-900 border-white/10 text-gray-300 hover:border-cyan-500/50'}`}
                              >
                                /{segment.abbr}
                              </button>
                            ))}
                          </div>
                        </div>
                        )}
                        {showTemplateSide && (
                        <div>
                          <div className="text-gray-500 mb-1">{t('deduction_game.log.segment_side')}</div>
                          <div className="flex flex-wrap gap-1">
                            {templateSides.map((segment) => (
                              <button
                                key={segment.value}
                                onClick={() => applyTemplate({ side: segment.value })}
                                className={`px-2 py-1 rounded border ${templateSide === segment.value ? 'bg-fuchsia-600/40 border-fuchsia-400 text-white' : 'bg-neutral-900 border-white/10 text-gray-300 hover:border-fuchsia-500/50'}`}
                              >
                                /{segment.abbr}
                              </button>
                            ))}
                          </div>
                        </div>
                        )}
                        {showTemplateReason && (
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
                        )}
                        {showTemplateCertainty && (
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
                        )}
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
                          const action = templateActions.find((segment) => segment.abbr === command || segment.value === command);
                          const reason = templateReasons.find((segment) => segment.abbr === command || segment.value === command);
                          const certainty = templateCertainties.find((segment) => segment.abbr === command || segment.value === command);

                          if (intent) {
                            applyTemplate({ intent: intent.value });
                            return;
                          }
                          if (action) {
                            applyTemplate({ intent: 'action', action: action.value });
                            return;
                          }
                          if (reason) {
                            applyTemplate({ reason: reason.value });
                            return;
                          }
                          const role = templateRoles.find((segment) => segment.abbr.toLowerCase().startsWith(command) || segment.value.toLowerCase().startsWith(command));
                          const side = templateSides.find((segment) => segment.abbr === command || segment.value === command);
                          if (role) {
                            applyTemplate({ role: role.value });
                            return;
                          }
                          if (side) {
                            applyTemplate({ side: side.value });
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
                        {t('deduction_game.game.teammates')}: {players.filter((p) => p.alignment === 'negative' && p.id !== human.id).map((p) => `#${p.number} ${p.role}`).join(', ')}
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
                  whileHover={status === 'night_phase' && human?.isAlive && ((human.role === 'IS' || (human.role === 'TP' && human.alignment === 'negative')) && player.isAlive && player.id !== human.id) ? { scale: 1.05 } : status === 'voting' && human?.isAlive && player.isAlive && player.id !== human.id ? { scale: 1.05 } : {}}
                  onClick={() => {
                    if (status === 'night_phase' && human?.isAlive && (human.role === 'IS' || (human.role === 'TP' && human.alignment === 'negative')) && player.isAlive && player.id !== human.id) {
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
                  } ${(status === 'night_phase' && human?.isAlive && (human.role === 'IS' || (human.role === 'TP' && human.alignment === 'negative')) && player.isAlive && player.id !== human.id) || (status === 'voting' && human?.isAlive && player.isAlive && player.id !== human.id) ? 'cursor-pointer' : ''}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                      player.isHuman ? 'bg-gradient-to-br from-blue-500 to-purple-500' : 'bg-gradient-to-br from-gray-600 to-gray-500'
                    }`}>
                      {player.number}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-xs truncate">{player.name}</div>
                      {status === 'night_phase' && human?.role === 'TP' && human.alignment === 'positive' && <div className="text-xs text-yellow-400">{player.role}</div>}
                      {player.isHuman && player.role === 'TP' && <div className="text-xs text-yellow-400">TP</div>}
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
