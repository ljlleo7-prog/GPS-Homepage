import type { Alignment, Role } from '@/types/deduction';
import { parseComment } from './gameLogic';
import type { ActionVerb, CommentIntent, LocalPlayer, ParsedComment } from './types';

type SmokeTag = 'zh' | 'en' | 'mixed' | 'slang' | 'negation' | 'contrast' | 'reported' | 'claim' | 'action' | 'ask';

type ExpectedParsed = {
  intent?: CommentIntent;
  targetNumber?: number | null;
  claimedRole?: Role;
  claimedAlignment?: Alignment;
  revealedRole?: Role;
  revealedAlignment?: Alignment;
  actionVerb?: ActionVerb;
  actionDriver?: number;
  isSelfClaim?: boolean;
};

type SmokeCase = {
  id: string;
  input: string;
  tags: SmokeTag[];
  expected: ExpectedParsed;
  forbid?: ExpectedParsed;
};

type SmokeFailure = {
  id: string;
  input: string;
  reasons: string[];
  parsed: ExpectedParsed;
};

export type DeductionParserSmokeResult = {
  total: number;
  passed: number;
  failed: number;
  failures: SmokeFailure[];
};

const smokePlayers: LocalPlayer[] = Array.from({ length: 6 }, (_, index) => ({
  id: `p${index + 1}`,
  number: index + 1,
  name: `Player ${index + 1}`,
  role: 'TP',
  alignment: 'positive',
  isAlive: true,
  isHuman: index === 0,
}));

const cases: SmokeCase[] = [
  { id: 'slang-u-sus', input: 'u sus #3', tags: ['en', 'slang'], expected: { intent: 'suspect', targetNumber: 3 } },
  { id: 'slang-bruh-sus', input: 'bruh #4 kinda sus', tags: ['en', 'slang'], expected: { intent: 'suspect', targetNumber: 4 } },
  { id: 'zh-direct-sus', input: '我觉得 #3 很可疑', tags: ['zh'], expected: { intent: 'suspect', targetNumber: 3 } },
  { id: 'zh-weird', input: '#3 不太对劲', tags: ['zh'], expected: { intent: 'suspect', targetNumber: 3 } },
  { id: 'zh-negated-sus', input: '我不觉得 #3 可疑', tags: ['zh', 'negation'], expected: { intent: 'trust', targetNumber: 3 }, forbid: { intent: 'suspect', targetNumber: 3 } },
  { id: 'en-negated-sus', input: '#3 is not sus', tags: ['en', 'negation'], expected: { intent: 'trust', targetNumber: 3 }, forbid: { intent: 'suspect', targetNumber: 3 } },
  { id: 'zh-contrast', input: '不是 #2，是 #4', tags: ['zh', 'contrast'], expected: { intent: 'suspect', targetNumber: 4 }, forbid: { targetNumber: 2 } },
  { id: 'en-contrast-vote', input: 'not #2, vote #5', tags: ['en', 'contrast'], expected: { intent: 'suspect', targetNumber: 5 }, forbid: { targetNumber: 2 } },
  { id: 'en-reported-role', input: '#2 said #3 is TC-', tags: ['en', 'reported'], expected: { targetNumber: 3, revealedRole: 'TC', revealedAlignment: 'negative', isSelfClaim: false }, forbid: { isSelfClaim: true } },
  { id: 'zh-reported-imposter', input: '听 #2 说 #3 是内鬼', tags: ['zh', 'reported'], expected: { intent: 'suspect', targetNumber: 3, revealedAlignment: 'negative', isSelfClaim: false }, forbid: { isSelfClaim: true } },
  { id: 'slang-counterclaim', input: '我 cc #5', tags: ['mixed', 'slang'], expected: { intent: 'challenge', targetNumber: 5 } },
  { id: 'zh-fake-claim', input: '#5 悍跳 TC', tags: ['zh', 'claim'], expected: { intent: 'challenge', targetNumber: 5, claimedRole: 'TC', isSelfClaim: false }, forbid: { isSelfClaim: true } },
  { id: 'zh-inspector-reveal', input: '我跳 IS，昨晚查了 #4 是内鬼', tags: ['zh', 'claim', 'action'], expected: { intent: 'claim', targetNumber: 4, claimedRole: 'IS', revealedAlignment: 'negative', actionVerb: 'inspected', isSelfClaim: true } },
  { id: 'zh-self-role', input: '我是 TP+', tags: ['zh', 'claim'], expected: { intent: 'claim', targetNumber: null, claimedRole: 'TP', claimedAlignment: 'positive', isSelfClaim: true } },
  { id: 'en-negated-role', input: 'i am not TC-', tags: ['en', 'negation', 'claim'], expected: { isSelfClaim: false }, forbid: { claimedAlignment: 'negative', isSelfClaim: true } },
  { id: 'zh-dont-vote', input: '别投 #3，他像好人', tags: ['zh', 'negation'], expected: { intent: 'trust', targetNumber: 3 }, forbid: { intent: 'suspect', targetNumber: 3 } },
  { id: 'zh-soft-protect', input: '保一下 #6', tags: ['zh', 'slang'], expected: { intent: 'trust', targetNumber: 6 } },
  { id: 'zh-side-with', input: '站边 #2', tags: ['zh', 'slang'], expected: { intent: 'trust', targetNumber: 2 } },
  { id: 'zh-faking-good', input: '#4 装好人', tags: ['zh'], expected: { intent: 'suspect', targetNumber: 4 } },
  { id: 'zh-disbelieve-claim', input: '#4 说自己是 TP，但我不信', tags: ['zh', 'reported', 'claim'], expected: { intent: 'challenge', targetNumber: 4, claimedRole: 'TP', isSelfClaim: false }, forbid: { isSelfClaim: true } },
  { id: 'zh-protect-driver', input: '我保护了车手1', tags: ['zh', 'action'], expected: { intent: 'claim', actionVerb: 'protected', actionDriver: 1, isSelfClaim: true } },
  { id: 'zh-negated-protect-driver', input: '我没保护车手1', tags: ['zh', 'negation', 'action'], expected: { actionVerb: undefined, actionDriver: undefined }, forbid: { actionVerb: 'protected', actionDriver: 1 } },
  { id: 'en-inspect-reveal', input: 'i inspected #2 ST+', tags: ['en', 'action'], expected: { intent: 'claim', targetNumber: 2, revealedRole: 'ST', revealedAlignment: 'positive', actionVerb: 'inspected', isSelfClaim: true } },
  { id: 'en-question-are-you', input: 'Are you #4?', tags: ['en', 'mixed'], expected: { intent: 'ask', targetNumber: 4, isSelfClaim: false } },
  { id: 'en-question-what-do-you-think', input: 'What do you think #2 is thinking?', tags: ['en', 'mixed'], expected: { intent: 'ask', targetNumber: 2, isSelfClaim: false } },
  { id: 'en-negated-involved', input: "#5 isn't involved in this at all.", tags: ['en', 'negation'], expected: { intent: 'trust', targetNumber: 5, isSelfClaim: false }, forbid: { intent: 'suspect', targetNumber: 5 } },
  { id: 'zh-negated-involved', input: '我不认为 #6 是坏, 我觉得 #1 是 ST-', tags: ['zh', 'negation', 'claim'], expected: { intent: 'trust', targetNumber: 6, isSelfClaim: false }, forbid: { intent: 'suspect', targetNumber: 6 } },
  { id: 'zh-role-alignment-claim', input: '我是#IS,负面!', tags: ['zh', 'claim'], expected: { intent: 'claim', targetNumber: null, claimedRole: 'IS', claimedAlignment: 'negative', isSelfClaim: true } },
  { id: 'en-learned-from', input: 'I learned it from #6.', tags: ['en', 'action'], expected: { intent: 'claim', targetNumber: 6, actionVerb: 'learned', isSelfClaim: true } },
  { id: 'en-reported-accusation', input: "#1 said, 'I'm not behind this, #4 is.'", tags: ['en', 'reported'], expected: { intent: 'suspect', targetNumber: 4, isSelfClaim: false }, forbid: { isSelfClaim: true } },
  { id: 'zh-question-killer', input: '#6 是不是杀手?', tags: ['zh', 'ask'], expected: { intent: 'ask', targetNumber: 6, isSelfClaim: false } },
  { id: 'en-negated-suspicious', input: "I don't think #3 is suspicious.", tags: ['en', 'negation'], expected: { intent: 'trust', targetNumber: 3, isSelfClaim: false }, forbid: { intent: 'suspect', targetNumber: 3 } },
  { id: 'en-st-protected', input: 'I am ST+ and protected driver 1', tags: ['en', 'claim', 'action'], expected: { intent: 'claim', claimedRole: 'ST', claimedAlignment: 'positive', actionVerb: 'protected', actionDriver: 1, isSelfClaim: true } },
  { id: 'en-st-sabotaged', input: 'I am ST- and sabotaged driver 2', tags: ['en', 'claim', 'action'], expected: { intent: 'claim', claimedRole: 'ST', claimedAlignment: 'negative', actionVerb: 'sabotaged', actionDriver: 2, isSelfClaim: true } },
];

function snapshot(parsed: ParsedComment): ExpectedParsed {
  return {
    intent: parsed.intent,
    targetNumber: parsed.target?.number ?? null,
    claimedRole: parsed.claimedRole,
    claimedAlignment: parsed.claimedAlignment,
    revealedRole: parsed.revealedRole,
    revealedAlignment: parsed.revealedAlignment,
    actionVerb: parsed.actionVerb,
    actionDriver: parsed.actionDriver,
    isSelfClaim: parsed.isSelfClaim,
  };
}

function matches(actual: ExpectedParsed, expected: ExpectedParsed): string[] {
  return Object.entries(expected).flatMap(([key, value]) => {
    const actualValue = actual[key as keyof ExpectedParsed];
    return actualValue === value ? [] : [`expected ${key}=${String(value)}, got ${String(actualValue)}`];
  });
}

function violatesForbid(actual: ExpectedParsed, forbid?: ExpectedParsed): string[] {
  if (!forbid) return [];
  const entries = Object.entries(forbid);
  if (!entries.length) return [];
  const matched = entries.every(([key, value]) => actual[key as keyof ExpectedParsed] === value);
  return matched ? [`forbidden combination matched: ${entries.map(([key, value]) => `${key}=${String(value)}`).join(', ')}`] : [];
}

function inversionFailures(testCase: SmokeCase, actual: ExpectedParsed): string[] {
  const failures: string[] = [];
  if (testCase.tags.includes('negation') && testCase.forbid?.intent && testCase.forbid.intent === actual.intent && testCase.forbid.targetNumber === actual.targetNumber) {
    failures.push('negated stance inverted into forbidden intent');
  }
  if (testCase.tags.includes('reported') && actual.isSelfClaim) {
    failures.push('reported speech became a self-claim');
  }
  if (testCase.tags.includes('contrast') && testCase.forbid?.targetNumber === actual.targetNumber) {
    failures.push('contrast resolved to negated target');
  }
  if (testCase.tags.includes('negation') && testCase.forbid?.actionVerb && testCase.forbid.actionVerb === actual.actionVerb) {
    failures.push('negated action produced forbidden action verb');
  }
  return failures;
}

export function runDeductionParserSmokeCases(): DeductionParserSmokeResult {
  const failures = cases.flatMap((testCase) => {
    const parsed = snapshot(parseComment(smokePlayers, testCase.input));
    const reasons = [
      ...matches(parsed, testCase.expected),
      ...violatesForbid(parsed, testCase.forbid),
      ...inversionFailures(testCase, parsed),
    ];
    return reasons.length ? [{ id: testCase.id, input: testCase.input, reasons, parsed }] : [];
  });

  return {
    total: cases.length,
    passed: cases.length - failures.length,
    failed: failures.length,
    failures,
  };
}
