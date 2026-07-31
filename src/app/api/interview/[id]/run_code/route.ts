export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { geminiEngine } from '@/lib/gemini-ai';
import { checkEmptyGate, detectLanguageMismatch, applyLanguagePenalty, runLocalMockEvaluator, LANGUAGE_MISMATCH_PENALTY } from '@/lib/code-eval-fallback';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: resumeId } = await params;
    const body = await request.json();
    const { question, language, code } = body;

    if (!question || !language || !code) {
      return NextResponse.json({ error: 'Missing required fields: question, language, code' }, { status: 400 });
    }

    const emptyGate = checkEmptyGate(code);
    if (emptyGate) return NextResponse.json(emptyGate);

    const mismatch = detectLanguageMismatch(language, code);

    const prompt = `
You are a code execution simulator and grader. Evaluate this submission against the problem below, in whatever language it is actually written in — always attempt execution, never refuse.

Problem: "${question}"
Declared language: ${language}
Code:
\`\`\`
${code}
\`\`\`

STEPS:
1. Generate exactly 3 test cases (standard input, alternate bounds, edge case).
2. Trace the code's actual execution against each; record real output as "actual", compare to "expected", set "passed".
3. Score 0-10 based on how many test cases pass and overall code quality/correctness. Base this ONLY on whether the logic is correct, not on which language it's written in.

Return ONLY this JSON, no markdown:
{"compiles": true, "error": null, "testCases": [{"name": "...", "input": "...", "expected": "...", "actual": "...", "passed": true}], "score": 0}
`;

    try {
      const result = await geminiEngine.generateText(prompt);
      const testCases = Array.isArray(result?.testCases) ? result.testCases : [];
      const passed = testCases.filter((t: any) => t.passed).length;
      const baseScore = testCases.length > 0 ? Math.round((passed / testCases.length) * 10) : Math.max(0, Math.min(10, Number(result?.score) || 0));
      const score = applyLanguagePenalty(baseScore, mismatch);
      return NextResponse.json({
        compiles: result?.compiles !== false,
        error: mismatch ? `${result?.error || ''} (${LANGUAGE_MISMATCH_PENALTY}-point language mismatch penalty applied)`.trim() : result?.error || null,
        testCases,
        score,
      });
    } catch (err) {
      console.warn("AI code evaluation failed, using local fallback.", err);
      return NextResponse.json(runLocalMockEvaluator(question, language, code));
    }
  } catch (err: any) {
    console.error("Error evaluating code:", err);
    return NextResponse.json({ compiles: false, error: err.message || 'Unknown execution error', testCases: [], score: 0 }, { status: 500 });
  }
}
