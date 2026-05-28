import type { Role } from '@/types/deduction';
import type { TemplateCertainty, TemplateIntent, TemplateReason, TemplateSide } from './types';

export type CommandActionVerb = 'protected' | 'sabotaged' | 'analyzed' | 'inspected' | 'ejected' | 'learned';
export type CommandTarget = { kind: 'player'; value: number } | { kind: 'driver'; value: 1 | 2 };

export type DeductionCommandState = {
  intent?: TemplateIntent;
  target?: number;
  reason?: TemplateReason;
  certainty?: TemplateCertainty;
  role?: Role;
  side?: TemplateSide;
  action?: CommandActionVerb;
  actionTarget?: CommandTarget;
  notes?: string[];
};

export type DeductionCommandSuggestion = {
  value: string;
  label: string;
  detail: string;
  replacement: string;
};

export type DeductionCommandParseResult = {
  isCommand: boolean;
  complete: boolean;
  valid: boolean;
  state: DeductionCommandState;
  suggestions: DeductionCommandSuggestion[];
  error?: string;
};

type IntentSpec = { value: TemplateIntent; aliases: string[]; needsTarget?: boolean; allowsRole?: boolean; allowsReason?: boolean; allowsCertainty?: boolean };
type Registry = {
  playerNumbers: number[];
  intents: IntentSpec[];
  reasons: Array<{ value: TemplateReason; aliases: string[] }>;
  certainties: Array<{ value: TemplateCertainty; aliases: string[] }>;
  actions: Array<{ value: CommandActionVerb; aliases: string[] }>;
};

const intents: IntentSpec[] = [
  { value: 'sus', aliases: ['sus', 's'], needsTarget: true, allowsReason: true, allowsCertainty: true, allowsRole: true },
  { value: 'trust', aliases: ['trust', 'tr'], needsTarget: true, allowsReason: true, allowsCertainty: true, allowsRole: true },
  { value: 'ask', aliases: ['ask', 'q'], needsTarget: true, allowsReason: true },
  { value: 'claim', aliases: ['claim', 'cl'], allowsRole: true, allowsReason: true },
  { value: 'action', aliases: ['action', 'act'], allowsRole: true, allowsReason: true },
  { value: 'attack', aliases: ['challenge', 'cc'], needsTarget: true, allowsReason: true, allowsCertainty: true, allowsRole: true },
  { value: 'switch', aliases: ['switch', 'sw'], needsTarget: true, allowsReason: true, allowsCertainty: true },
  { value: 'abs', aliases: ['abs', 'abstain'], allowsReason: true },
  { value: 'read', aliases: ['read', 'rd'], needsTarget: true, allowsReason: true, allowsCertainty: true, allowsRole: true },
];

const reasons: Registry['reasons'] = [
  { value: 'race_dnf', aliases: ['dnf', 'race_dnf', 'atk'] },
  { value: 'race_clean', aliases: ['clean', 'race_clean', 'not_sus', 'checked'] },
  { value: 'claim_role', aliases: ['role', 'claim_role'] },
  { value: 'claim_action', aliases: ['act', 'claim_action'] },
  { value: 'claim_contradiction', aliases: ['conf', 'contradiction', 'claim_contradiction'] },
  { value: 'vote_pressure', aliases: ['press', 'vote_pressure'] },
  { value: 'timing_push', aliases: ['time', 'late', 'late_claim', 'timing_push'] },
  { value: 'driver_signal', aliases: ['drv', 'driver', 'driver_signal'] },
  { value: 'counterclaim', aliases: ['cc', 'counterclaim'] },
  { value: 'claim_pressure', aliases: ['clm', 'claim_pressure'] },
  { value: 'protective_claim', aliases: ['prt', 'protective_claim'] },
  { value: 'uncertain', aliases: ['unc', 'uncertain'] },
];

const certainties: Registry['certainties'] = [
  { value: 'weak', aliases: ['w', 'weak'] },
  { value: 'medium', aliases: ['m', 'med', 'medium'] },
  { value: 'strong', aliases: ['s', 'strong'] },
];

const actions: Registry['actions'] = [
  { value: 'protected', aliases: ['protect', 'protected', 'prot'] },
  { value: 'sabotaged', aliases: ['sabotage', 'sabotaged', 'sab'] },
  { value: 'analyzed', aliases: ['analyze', 'analyzed', 'ana'] },
  { value: 'inspected', aliases: ['inspect', 'inspected', 'sense'] },
  { value: 'ejected', aliases: ['eject', 'ejected', 'expel'] },
  { value: 'learned', aliases: ['learn', 'learned', 'know'] },
];

export function isDeductionCommandInput(input: string): boolean {
  return input.trim().startsWith('/');
}

export function createCommandRegistry(playerNumbers: number[]): Registry {
  return { playerNumbers, intents, reasons, certainties, actions };
}

function tokenValue(token: string): string {
  return token.replace(/^\+/, '').replace(/^(r|reason|c|cert|role|a|action|t|target):/i, '').toLowerCase();
}

function parseTarget(token: string): CommandTarget | undefined {
  const value = tokenValue(token);
  const playerMatch = value.match(/^#?(\d+)$/);
  if (playerMatch) return { kind: 'player', value: Number(playerMatch[1]) };
  const driverMatch = value.match(/^d(?:river)?([12])$/);
  if (driverMatch) return { kind: 'driver', value: Number(driverMatch[1]) as 1 | 2 };
  return undefined;
}

function parseRoleSide(token: string): { role?: Role; side?: TemplateSide } | undefined {
  const value = tokenValue(token).toUpperCase();
  const match = value.match(/^(TP|TC|IS|ST)([+\-?])?$/);
  if (!match) return undefined;
  return {
    role: match[1] as Role,
    side: match[2] === '+' ? 'positive' : match[2] === '-' ? 'negative' : match[2] === '?' ? 'unknown' : undefined,
  };
}

function findByAlias<T extends { aliases: string[] }>(items: T[], token: string): T | undefined {
  const value = tokenValue(token);
  return items.find((item) => item.aliases.includes(value));
}

function hasConflict<T>(current: T | undefined, next: T): boolean {
  return current !== undefined && current !== next;
}

function extractBracketNotes(body: string): { body: string; notes: string[]; openBracket: boolean } {
  const notes: string[] = [];
  let cleaned = '';
  let index = 0;
  let openBracket = false;

  while (index < body.length) {
    const char = body[index];
    if (char === '(') {
      const end = body.indexOf(')', index + 1);
      if (end === -1) {
        openBracket = true;
        break;
      }
      const note = body.slice(index + 1, end).trim();
      if (note) notes.push(note);
      index = end + 1;
      continue;
    }
    cleaned += char;
    index += 1;
  }

  cleaned += body.slice(index);
  return { body: cleaned.replace(/\s+/g, ' ').trim(), notes, openBracket };
}

function commandText(tokens: string[], replacement: string): string {
  return `/${[...tokens.slice(0, -1), replacement].filter(Boolean).join(' ')}`;
}

function buildSuggestions(tokens: string[], registry: Registry, state: DeductionCommandState): DeductionCommandSuggestion[] {
  const current = tokenValue(tokens[tokens.length - 1] ?? '');
  const baseTokens = tokens.length ? tokens : [''];
  const candidates: DeductionCommandSuggestion[] = [];

  if (tokens.length <= 1) {
    registry.intents.forEach((intent) => {
      intent.aliases.forEach((alias) => {
        if (!current || alias.startsWith(current)) candidates.push({ value: alias, label: `/${alias}`, detail: intent.value, replacement: commandText(baseTokens, alias) });
      });
    });
    return candidates.slice(0, 8);
  }

  registry.playerNumbers.forEach((number) => {
    const value = `#${number}`;
    if (!state.target && value.startsWith(current)) candidates.push({ value, label: value, detail: 'player target', replacement: commandText(baseTokens, value) });
  });

  if (!state.actionTarget) {
    ['d1', 'd2'].forEach((value) => {
      if (value.startsWith(current)) candidates.push({ value, label: value, detail: 'driver target', replacement: commandText(baseTokens, value) });
    });
  }

  if (!state.role) {
    ['TP', 'TC', 'IS', 'ST'].forEach((role) => {
      ['+', '-', '?', ''].forEach((side) => {
        const value = `${role}${side}`;
        if (value.toLowerCase().startsWith(current)) candidates.push({ value, label: value, detail: 'role/side', replacement: commandText(baseTokens, value) });
      });
    });
  }

  registry.actions.forEach((action) => {
    action.aliases.forEach((alias) => {
      if (!state.action && alias.startsWith(current)) candidates.push({ value: alias, label: alias, detail: action.value, replacement: commandText(baseTokens, alias) });
    });
  });

  registry.reasons.forEach((reason) => {
    reason.aliases.forEach((alias) => {
      const value = `(${alias})`;
      if (!state.reason && value.toLowerCase().startsWith(current)) candidates.push({ value, label: value, detail: reason.value, replacement: commandText(baseTokens, value) });
    });
  });

  registry.certainties.forEach((certainty) => {
    certainty.aliases.forEach((alias) => {
      const value = `(${alias})`;
      if (!state.certainty && value.toLowerCase().startsWith(current)) candidates.push({ value, label: value, detail: certainty.value, replacement: commandText(baseTokens, value) });
    });
  });

  if (current.startsWith('(') && !current.includes(')')) {
    ['(checked)', '(clean)', '(atk 2)'].forEach((value) => {
      candidates.push({ value, label: value, detail: 'note', replacement: commandText(baseTokens, value) });
    });
  }

  return candidates.slice(0, 8);
}

function applyBracketNote(note: string, registry: Registry, state: DeductionCommandState): DeductionCommandParseResult | null {
  const parts = note.split(/\s+/).filter(Boolean);
  const head = parts[0] ?? '';
  const reason = findByAlias(registry.reasons, head);
  const certainty = findByAlias(registry.certainties, head);
  const action = findByAlias(registry.actions, head);
  const roleSide = parseRoleSide(head);
  const actionTarget = parts[1] ? parseTarget(parts[1]) : undefined;

  if (reason) {
    state.reason = reason.value;
    if (actionTarget?.kind === 'driver' && !state.actionTarget) state.actionTarget = actionTarget;
    return null;
  }
  if (certainty) {
    if (hasConflict(state.certainty, certainty.value)) return { isCommand: true, complete: false, valid: false, state, suggestions: [], error: `Conflicting certainty: (${note})` };
    state.certainty = certainty.value;
    return null;
  }
  if (action) {
    if (hasConflict(state.action, action.value)) return { isCommand: true, complete: false, valid: false, state, suggestions: [], error: `Conflicting action: (${note})` };
    state.action = action.value;
    if (actionTarget?.kind === 'driver' && !state.actionTarget) state.actionTarget = actionTarget;
    return null;
  }
  if (roleSide) {
    if (hasConflict(state.role, roleSide.role)) return { isCommand: true, complete: false, valid: false, state, suggestions: [], error: `Conflicting role: (${note})` };
    state.role = roleSide.role;
    if (roleSide.side) {
      if (hasConflict(state.side, roleSide.side)) return { isCommand: true, complete: false, valid: false, state, suggestions: [], error: `Conflicting side: (${note})` };
      state.side = roleSide.side;
    }
    return null;
  }
  return { isCommand: true, complete: false, valid: false, state, suggestions: [], error: `Unknown bracket note: (${note})` };
}

function buildBracketSuggestions(input: string, registry: Registry): DeductionCommandSuggestion[] {
  const current = input.slice(input.lastIndexOf('(')).toLowerCase();
  const prefix = input.slice(0, input.lastIndexOf('('));
  const candidates: DeductionCommandSuggestion[] = [];
  const add = (value: string, detail: string) => {
    if (value.toLowerCase().startsWith(current)) candidates.push({ value, label: value, detail, replacement: `${prefix}${value}` });
  };

  registry.reasons.forEach((reason) => reason.aliases.forEach((alias) => add(`(${alias})`, reason.value)));
  registry.certainties.forEach((certainty) => certainty.aliases.forEach((alias) => add(`(${alias})`, certainty.value)));
  ['(checked)', '(clean)', '(atk 2)'].forEach((value) => add(value, 'note'));
  return candidates.slice(0, 8);
}

export function parseDeductionCommand(input: string, registry: Registry): DeductionCommandParseResult {
  const trimmed = input.trim();
  if (!isDeductionCommandInput(trimmed)) return { isCommand: false, complete: false, valid: true, state: {}, suggestions: [] };

  const body = trimmed.slice(1);
  const { body: strippedBody, notes, openBracket } = extractBracketNotes(body);
  const tokens = strippedBody.split(/\s+/).filter(Boolean);
  const state: DeductionCommandState = { notes };
  const first = tokens[0] ?? '';
  const intent = findByAlias(registry.intents, first);

  if (openBracket) {
    return { isCommand: true, complete: false, valid: true, state, suggestions: buildBracketSuggestions(trimmed, registry), error: 'Close the bracket' };
  }

  if (!first || !intent) {
    return { isCommand: true, complete: false, valid: false, state, suggestions: buildSuggestions(tokens.length ? tokens : [''], registry, state), error: first ? `Unknown command: ${first}` : 'Choose a command' };
  }

  state.intent = intent.value;

  for (const token of tokens.slice(1)) {
    const roleSide = parseRoleSide(token);
    const target = parseTarget(token);
    const action = findByAlias(registry.actions, token);

    if (roleSide) {
      if (hasConflict(state.role, roleSide.role)) return { isCommand: true, complete: false, valid: false, state, suggestions: [], error: `Conflicting role: ${token}` };
      state.role = roleSide.role;
      if (roleSide.side) {
        if (hasConflict(state.side, roleSide.side)) return { isCommand: true, complete: false, valid: false, state, suggestions: [], error: `Conflicting side: ${token}` };
        state.side = roleSide.side;
      }
    } else if (target) {
      if (target.kind === 'player') {
        if (!registry.playerNumbers.includes(target.value)) return { isCommand: true, complete: false, valid: false, state, suggestions: [], error: `Unknown player target: ${token}` };
        if (hasConflict(state.target, target.value)) return { isCommand: true, complete: false, valid: false, state, suggestions: [], error: `Conflicting target: ${token}` };
        state.target = target.value;
      } else {
        if (state.actionTarget && (state.actionTarget.kind !== target.kind || state.actionTarget.value !== target.value)) return { isCommand: true, complete: false, valid: false, state, suggestions: [], error: `Conflicting action target: ${token}` };
        state.actionTarget = target;
      }
    } else if (action) {
      if (hasConflict(state.action, action.value)) return { isCommand: true, complete: false, valid: false, state, suggestions: [], error: `Conflicting action: ${token}` };
      state.action = action.value;
    } else {
      return { isCommand: true, complete: false, valid: false, state, suggestions: buildSuggestions(tokens, registry, state), error: `Unknown token: ${token}` };
    }
  }

  for (const note of notes) {
    const error = applyBracketNote(note, registry, state);
    if (error) return error;
  }

  const suggestions = buildSuggestions(tokens, registry, state);
  if (intent.needsTarget && !state.target) return { isCommand: true, complete: false, valid: true, state, suggestions, error: 'Choose a player target' };
  if (state.intent === 'action' && !state.action) return { isCommand: true, complete: false, valid: true, state, suggestions, error: 'Choose an action' };
  if (state.intent === 'action' && !state.actionTarget) return { isCommand: true, complete: false, valid: true, state, suggestions, error: 'Choose an action target' };
  if (state.intent === 'claim' && !state.role) return { isCommand: true, complete: false, valid: true, state, suggestions, error: 'Choose a role' };

  return { isCommand: true, complete: true, valid: true, state, suggestions };
}

export function runDeductionCommandSmokeCases(): { total: number; passed: number; failed: number; failures: Array<{ input: string; error: string }> } {
  const registry = createCommandRegistry([1, 2, 3, 4, 5, 6]);
  const cases = [
    { input: '/sus #3', complete: true, valid: true },
    { input: '/trust #4', complete: true, valid: true },
    { input: '/ask #2', complete: true, valid: true },
    { input: '/claim ST+', complete: true, valid: true },
    { input: '/claim IS-', complete: true, valid: true },
    { input: '/action protected d1', complete: true, valid: true },
    { input: '/action sabotaged d2', complete: true, valid: true },
    { input: '/sus #3 (late_claim) (strong)', complete: true, valid: true },
    { input: '/trust 5 (checked)', complete: true, valid: true },
    { input: '/sus 4 IS- (atk 2) (clean)', complete: true, valid: true },
    { input: '/wat #3', complete: false, valid: false },
    { input: '/sus', complete: false, valid: true },
    { input: '/sus #3 #4', complete: false, valid: false },
    { input: '/claim ST+ TP-', complete: false, valid: false },
    { input: '/action protected', complete: false, valid: true },
    { input: '/sus #3 (checked', complete: false, valid: true },
    { input: '/sus #3 r:late_claim', complete: false, valid: false },
  ];
  const failures = cases.flatMap((testCase) => {
    const result = parseDeductionCommand(testCase.input, registry);
    if (result.complete === testCase.complete && result.valid === testCase.valid) return [];
    return [{ input: testCase.input, error: `expected complete=${testCase.complete} valid=${testCase.valid}, got complete=${result.complete} valid=${result.valid} (${result.error ?? 'no error'})` }];
  });
  return { total: cases.length, passed: cases.length - failures.length, failed: failures.length, failures };
}
