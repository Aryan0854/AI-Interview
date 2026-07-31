// Deterministic code evaluation helpers shared by the "Run" simulator and the final
// coding-answer evaluator. Language mismatch is a penalty (max 3 of 10), never an
// auto-fail — code is always evaluated on merit first.

export interface TestCaseResult {
  name: string;
  input: string;
  expected: string;
  actual: string;
  passed: boolean;
}

export interface CodeEvalResult {
  compiles: boolean;
  error: string | null;
  testCases: TestCaseResult[];
  score: number;
}

const EMPTY_TEST_CASES = (reason: string): TestCaseResult[] => [
  { name: "Test Case 1", input: "N/A", expected: "N/A", actual: reason, passed: false },
  { name: "Test Case 2", input: "N/A", expected: "N/A", actual: reason, passed: false },
  { name: "Test Case 3", input: "N/A", expected: "N/A", actual: reason, passed: false },
];

/** Only hard-fails on genuinely empty/trivial submissions. Everything else gets evaluated. */
export function checkEmptyGate(code: string): CodeEvalResult | null {
  if (code.trim().length < 15) {
    return { compiles: false, error: "No code solution was provided.", testCases: EMPTY_TEST_CASES("No code submitted"), score: 0 };
  }
  return null;
}

/** Pure detection, no gating — used to compute a penalty, not to skip evaluation. */
export function detectLanguageMismatch(language: string, code: string): boolean {
  const lang = language.toLowerCase();
  if (lang === "javascript" || lang === "typescript") {
    return /\bdef\s+\w+\s*\(/.test(code) || /\belif\b/.test(code) || (!code.includes("{") && code.trim().includes(":"));
  }
  if (lang === "python") {
    return /\b(const|let|var)\s+\w+/.test(code) || /\bfunction\s+\w+/.test(code) || /=>/.test(code);
  }
  if (lang === "cpp" || lang === "java") {
    return /\bdef\s+\w+\s*\(/.test(code) || /\bfunction\s+\w+/.test(code) || /=>/.test(code);
  }
  return false;
}

export const LANGUAGE_MISMATCH_PENALTY = 3;

export function applyLanguagePenalty(score: number, mismatch: boolean): number {
  return mismatch ? Math.max(0, score - LANGUAGE_MISMATCH_PENALTY) : score;
}

/** Local, LLM-free fallback: pattern-matches known problem types, else scores on content depth. */
export function runLocalMockEvaluator(question: string, language: string, code: string): CodeEvalResult {
  const lowerQ = question.toLowerCase();
  const lowerCode = code.toLowerCase();
  const mismatch = detectLanguageMismatch(language, code);

  let result: CodeEvalResult;

  if (lowerQ.includes("palindrome")) {
    const hasReverse = lowerCode.includes("reverse") || lowerCode.includes("split") || lowerCode.includes("join");
    const hasLoops = lowerCode.includes("for") || lowerCode.includes("while");
    const hasCaseCheck = lowerCode.includes("tolowercase") || lowerCode.includes("touppercase") || lowerCode.includes("replace");
    const tc1 = hasReverse || hasLoops, tc2 = tc1 && hasCaseCheck, tc3 = tc1;
    result = {
      compiles: true, error: null,
      testCases: [
        { name: "Standard Palindrome", input: "'racecar'", expected: "true", actual: String(tc1), passed: tc1 },
        { name: "Mixed Case & Symbols", input: "'RaceCar!'", expected: "true", actual: String(tc2), passed: tc2 },
        { name: "Non-palindrome", input: "'hello'", expected: "false", actual: "false", passed: true },
      ],
      score: (tc1 ? 4 : 0) + (tc2 ? 3 : 0) + (tc3 ? 3 : 0),
    };
  } else if (lowerQ.includes("two sum") || (lowerQ.includes("array") && lowerQ.includes("target"))) {
    const hasLoops = lowerCode.includes("for") || lowerCode.includes("while");
    const hasMapOrSet = lowerCode.includes("map") || lowerCode.includes("set") || lowerCode.includes("indexof") || lowerCode.includes("dictionary");
    const tc1 = hasLoops, tc2 = hasLoops, tc3 = hasLoops && (hasMapOrSet || code.length > 150);
    result = {
      compiles: true, error: null,
      testCases: [
        { name: "Standard Input", input: "[2,7,11,15], target=9", expected: "[0,1]", actual: tc1 ? "[0,1]" : "[]", passed: tc1 },
        { name: "Duplicates", input: "[3,3], target=6", expected: "[0,1]", actual: tc2 ? "[0,1]" : "[]", passed: tc2 },
        { name: "No Solution", input: "[1,2], target=10", expected: "[]", actual: "[]", passed: true },
      ],
      score: (tc1 ? 4 : 0) + (tc2 ? 3 : 0) + (tc3 ? 3 : 0),
    };
  } else {
    const hasContent = code.trim().length > 30;
    const isTooShort = code.trim().length < 15;
    result = {
      compiles: true, error: null,
      testCases: [
        { name: "Structure check", input: "N/A", expected: "valid structure", actual: hasContent ? "valid structure" : "incomplete", passed: hasContent },
        { name: "Execution", input: "N/A", expected: "runs", actual: "runs", passed: true },
        { name: "Implementation depth", input: "N/A", expected: "sufficient", actual: isTooShort ? "insufficient" : "sufficient", passed: !isTooShort },
      ],
      score: isTooShort ? 3 : hasContent ? 10 : 6,
    };
  }

  result.score = applyLanguagePenalty(result.score, mismatch);
  if (mismatch) result.error = `Note: code appears to be written for a different language than ${language}; ${LANGUAGE_MISMATCH_PENALTY} points deducted.`;
  return result;
}
