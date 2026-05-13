import type { Alignment, Role } from '@/types/deduction';

export type BotPersonalityType = 'aggressive' | 'cautious' | 'balanced' | 'chaotic';

export interface LocalPlayer {
  id: string;
  number: number;
  name: string;
  role: Role;
  alignment: Alignment;
  isAlive: boolean;
  isHuman: boolean;
  personality?: BotPersonalityType;
}

export interface LocalRace {
  round: number;
  report: string;
  driver1DNF: boolean;
  driver2DNF: boolean;
  fired?: string;
}

export interface DiscussionMessage {
  playerId: string;
  playerNumber: number;
  playerName: string;
  message: string;
  delayMs?: number;
}

export type SuspicionMap = Record<string, Record<string, number>>;

export type ActionVerb = 'protected' | 'sabotaged' | 'analyzed' | 'inspected' | 'ejected' | 'learned';

export interface RevealClaim {
  speakerId: string;
  targetId: string;
  role: Role;
  alignment?: Alignment;
  actionVerb: 'inspected' | 'learned';
  credible: boolean;
  contested: boolean;
}

export interface BotEvaluation {
  target: LocalPlayer;
  publicScore: number;
  privateScore: number;
  totalScore: number;
  publicReason: 'race' | 'claim' | 'pressure' | 'vote' | 'uncertain';
  shouldBusTeammate: boolean;
}

export interface SharedKnowledge {
  claims: Record<string, { role?: Role; alignment?: Alignment; actionVerb?: ActionVerb; actionDriver?: number }>;
  revealClaims: RevealClaim[];
  pressure: number;
  dnfs: number;
  entropy?: number;
}

export interface BotPrivateKnowledge {
  inspectedPlayers: Record<string, { role: Role; alignment: Alignment; action?: 'inspected' | 'ejected' }>;
  knownRoles: Record<string, { role: Role; alignment?: Alignment }>;
  inferences: Record<string, number>;
}

export type CommentIntent = 'suspect' | 'trust' | 'ask' | 'abstain' | 'claim' | 'challenge' | 'neutral';

export type TemplateIntent = 'sus' | 'trust' | 'ask' | 'claim' | 'action' | 'def' | 'self' | 'logic' | 'attack' | 'explain' | 'vote' | 'world' | 'switch' | 'abs' | 'ig' | 'nig' | 'read';

export type TemplateReason = 'race_dnf' | 'race_clean' | 'claim_role' | 'claim_action' | 'claim_contradiction' | 'vote_pressure' | 'timing_push' | 'role_tp' | 'role_tc' | 'role_is' | 'role_st' | 'anomalous_attack' | 'speech_evasion' | 'uncertain' | 'role_mismatch' | 'driver_signal' | 'counterclaim' | 'claim_pressure' | 'protective_claim';

export type TemplateCertainty = 'weak' | 'medium' | 'strong';

export type TemplateModule = 'intent' | 'reason' | 'certainty';

export type TemplateSide = 'unknown' | 'positive' | 'negative';

export type InspectorNightMode = 'sense' | 'eject';

export type RoleCertaintyMap = Record<string, Record<string, Partial<Record<Role, number>>>>;

export interface ParsedComment {
  intent: CommentIntent;
  target: LocalPlayer | null;
  claimedRole?: Role;
  claimedAlignment?: Alignment;
  revealedRole?: Role;
  revealedAlignment?: Alignment;
  actionVerb?: ActionVerb;
  actionDriver?: number;
  isSelfClaim?: boolean;
}
