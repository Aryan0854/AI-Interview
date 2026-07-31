import { generateAIText } from "@/lib/ai-providers";

/**
 * Rubric-based answer grading, used for every verbal/text interview answer.
 *
 * RUBRIC (fixed, out of 10 — matches how a human grader would mark a short-answer
 * exam response against a marking scheme):
 *   - Understanding / Relation   : 0-2  (does the answer address what was actually asked?)
 *   - Keywords                  : 0-4  (coverage of the key concepts a strong answer needs)
 *   - Reasoning                 : 0-2  (does the candidate explain WHY/HOW, not just state facts?)
 *   - Clarity                   : 0-2  (is it well-structured, readable, non-rambling?)
 *
 * PRIMARY grader: the configured LLM (Gemini/Groq/Ollama/Copilot), given the exact
 * rubric plus the "answer key" (key concepts + model answer) generated alongside the
 * question — this keeps the LLM grading grounded and consistent, the same way a human
 * grader marks against a rubric sheet rather than free-associating a score.
 *
 * FAILSAFE grader (used only if every LLM call fails): a fully local, deterministic
 * implementation of the SAME rubric — not a length-based guess. It grades against the
 * same stored answer key (key-concept coverage, topical-relevance overlap, reasoning /
 * discourse-marker detection, and sentence-structure clarity checks), which is what
 * makes it dependable rather than arbitrary: even without a live model, there is still
 * a marking scheme to grade against, the same way a substitute teacher can grade from
 * an answer key left behind by the original teacher.
 */

export interface GradingRubric {
  /** Key concepts/terms a strong answer should include (the "answer key"). */
  keyConcepts: string[];
  /** Short (1-3 sentence) description of what a strong answer looks like. */
  modelAnswer?: string;
  /** Optional metadata carried through from question generation. */
  skill?: string;
  difficulty?: string;
}

export interface RubricScoreBreakdown {
  understanding: number; // 0-2
  keywords: number;      // 0-4
  reasoning: number;     // 0-2
  clarity: number;       // 0-2
  total: number;         // 0-10, always == sum of the above (recomputed, never trusted blindly)
  matchedConcepts: string[];
  missingConcepts: string[];
  feedback: string;
  gradedBy: "llm" | "local-rubric";
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

/* ------------------------------------------------------------------ */
/* Lightweight fallback rubric synthesis                               */
/* ------------------------------------------------------------------ */

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with", "at", "by",
  "from", "as", "is", "are", "was", "were", "be", "been", "being", "how", "what", "why",
  "when", "where", "which", "who", "your", "you", "did", "do", "does", "explain", "describe",
  "can", "could", "would", "should", "this", "that", "it", "its", "their", "them", "have", "has",
]);

/**
 * Used only when a question has no stored grading_rubric (e.g. a legacy question
 * generated before this feature existed, or the dynamic no-AI question fallback).
 * Pulls salient terms directly out of the question text as a best-effort answer key
 * — weaker than an LLM-authored rubric, but still grounded in the actual question
 * rather than nothing at all.
 */
export function synthesizeRubricFromQuestion(question: string): GradingRubric {
  const words = question
    .replace(/coding challenge:/i, "")
    .split(/[^a-zA-Z0-9+#.]+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w.toLowerCase()));

  // Prefer capitalized/technical-looking tokens (likely proper nouns / tech terms),
  // then fill in with the remaining longer words if there aren't enough.
  const capitalized = words.filter((w) => /[A-Z]/.test(w) || /\d/.test(w));
  const rest = words.filter((w) => !capitalized.includes(w));
  const keyConcepts = Array.from(new Set([...capitalized, ...rest])).slice(0, 8);

  return { keyConcepts };
}

/* ------------------------------------------------------------------ */
/* PRIMARY: LLM grading against the explicit rubric                    */
/* ------------------------------------------------------------------ */

export async function gradeAnswerWithLLM(
  question: string,
  answer: string,
  rubric: GradingRubric,
  context: { jdText?: string; resumeSummary?: string; targetRoles?: string[] }
): Promise<RubricScoreBreakdown> {
  const prompt = `
You are an expert interviewer grading a candidate's answer, the same way a strict but fair teacher grades a short-answer exam response against a marking scheme.

Context:
- Job Description: ${context.jdText || "Not specified."}
- Candidate's Experience Level / CV Summary: ${context.resumeSummary || "Not specified."}
- Target Roles: ${JSON.stringify(context.targetRoles || [])}

Question Asked: "${question}"
Candidate's Answer: "${answer}"

Answer Key (what a strong answer should cover):
- Key concepts expected: ${JSON.stringify(rubric.keyConcepts)}
${rubric.modelAnswer ? `- Model answer summary: ${rubric.modelAnswer}` : ""}

GRADE STRICTLY AGAINST THIS FIXED RUBRIC (total = 10 points):
1. Understanding / Relation (0-2 points): Does the answer actually address what was asked, and relate correctly to the question's subject? 0 = off-topic/irrelevant, 1 = partially relevant, 2 = fully on-topic and correctly framed.
2. Keywords (0-4 points): How many of the expected key concepts above (or clear paraphrases/synonyms of them) does the answer demonstrate CORRECT understanding of? For technical concepts, a factually wrong statement about a concept counts as NOT covering it, even if the term is mentioned — accuracy matters, not just presence. Score proportionally.
3. Reasoning (0-2 points): Does the candidate explain WHY or HOW, showing genuine reasoning/justification/trade-off awareness — not just a list of facts or buzzwords? 0 = no reasoning, 1 = some reasoning, 2 = clear, sound reasoning.
4. Clarity (0-2 points): Is the answer well-structured, coherent, and easy to follow? 0 = rambling/incoherent, 1 = mostly clear, 2 = clear and well-organized.

Be extremely critical and do not inflate scores — a generic or vague answer should score low on Keywords and Reasoning even if it is well-written. Calibrate expectations to the candidate's apparent seniority level.

Return ONLY a raw JSON object with this exact structure:
{
  "understanding": 2,
  "keywords": 3,
  "reasoning": 1,
  "clarity": 2,
  "matchedConcepts": ["concept the answer actually covered"],
  "missingConcepts": ["expected concept the answer did not cover"],
  "feedback": "2-3 sentences of concrete, specific feedback referencing what was strong and what was missing, written the way a teacher would annotate an answer sheet."
}
`;

  const raw = await generateAIText(prompt);
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const parsed = JSON.parse(cleaned);

  const understanding = clamp(parsed.understanding, 0, 2);
  const keywords = clamp(parsed.keywords, 0, 4);
  const reasoning = clamp(parsed.reasoning, 0, 2);
  const clarity = clamp(parsed.clarity, 0, 2);

  return {
    understanding,
    keywords,
    reasoning,
    clarity,
    // Recomputed server-side rather than trusting a model-reported total — a grading
    // system shouldn't let an LLM's arithmetic mistake silently become the record of truth.
    total: understanding + keywords + reasoning + clarity,
    matchedConcepts: Array.isArray(parsed.matchedConcepts) ? parsed.matchedConcepts : [],
    missingConcepts: Array.isArray(parsed.missingConcepts) ? parsed.missingConcepts : [],
    feedback: typeof parsed.feedback === "string" && parsed.feedback.trim()
      ? parsed.feedback.trim()
      : "Answer graded against the expected rubric.",
    gradedBy: "llm",
  };
}

/* ------------------------------------------------------------------ */
/* FAILSAFE: fully local, deterministic rubric grading                 */
/* ------------------------------------------------------------------ */

const REASONING_MARKERS = [
  "because", "therefore", "since", "as a result", "which means", "this means",
  "so that", "in order to", "due to", "as a consequence", "for example", "for instance",
  "such as", "this allows", "this ensures", "which allows", "which ensures", "consequently",
  "the reason", "that way", "in this way",
];

const FILLER_WORDS = ["basically", "actually", "literally", "just", "stuff", "things", "kind of", "sort of"];

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenize(text: string): string[] {
  return normalize(text).split(" ").filter((w) => w.length > 0);
}

/** Very small stem-lite normalizer so "testing"/"tested"/"tests" match "test". */
function stem(word: string): string {
  return word.replace(/(ing|ings|ed|es|s)$/i, "");
}

function scoreKeywords(answer: string, keyConcepts: string[]): { score: number; matched: string[]; missing: string[] } {
  if (keyConcepts.length === 0) {
    return { score: 2, matched: [], missing: [] }; // no answer key available — partial credit, can't penalize fairly
  }
  const answerTokensStemmed = new Set(tokenize(answer).map(stem));
  const matched: string[] = [];
  const missing: string[] = [];

  for (const concept of keyConcepts) {
    const conceptTokens = tokenize(concept).map(stem).filter((t) => t.length > 1);
    if (conceptTokens.length === 0) continue;
    const hit = conceptTokens.some((t) => answerTokensStemmed.has(t)) || normalize(answer).includes(normalize(concept));
    if (hit) matched.push(concept);
    else missing.push(concept);
  }

  const coverage = matched.length / keyConcepts.length;
  return { score: clamp(coverage * 4, 0, 4), matched, missing };
}

function scoreUnderstanding(question: string, answer: string): number {
  const qTokens = new Set(tokenize(question).filter((w) => !STOP_WORDS.has(w) && w.length > 2));
  const aTokens = new Set(tokenize(answer).filter((w) => !STOP_WORDS.has(w) && w.length > 2));
  if (qTokens.size === 0) return 1;

  let overlap = 0;
  qTokens.forEach((t) => {
    if (aTokens.has(t) || aTokens.has(stem(t))) overlap++;
  });
  const relevance = overlap / qTokens.size;

  const substantial = tokenize(answer).length >= 12;
  if (!substantial) return relevance > 0.15 ? 1 : 0;
  if (relevance >= 0.25) return 2;
  if (relevance >= 0.08) return 1;
  return 0;
}

function scoreReasoning(answer: string): number {
  const lower = answer.toLowerCase();
  const markerHits = REASONING_MARKERS.filter((m) => lower.includes(m)).length;
  const sentenceCount = answer.split(/[.!?]+/).filter((s) => s.trim().length > 0).length;

  if (markerHits >= 2) return 2;
  if (markerHits === 1) return 2;
  if (sentenceCount >= 3) return 1; // multi-sentence structure suggests some elaboration even without explicit markers
  return 0;
}

function scoreClarity(answer: string): number {
  const sentences = answer.split(/[.!?]+/).map((s) => s.trim()).filter((s) => s.length > 0);
  if (sentences.length === 0) return 0;

  let penalties = 0;

  const lower = answer.toLowerCase();
  const fillerCount = FILLER_WORDS.reduce((count, word) => {
    const matches = lower.match(new RegExp(`\\b${word}\\b`, "g"));
    return count + (matches ? matches.length : 0);
  }, 0);
  if (fillerCount >= 3) penalties++;

  const avgSentenceLen = tokenize(answer).length / sentences.length;
  if (avgSentenceLen > 45 || avgSentenceLen < 3) penalties++; // run-on or fragment-only

  const properCapsRatio = sentences.filter((s) => /^[A-Z0-9]/.test(s.trim())).length / sentences.length;
  if (properCapsRatio < 0.5 && sentences.length > 1) penalties++;

  if (penalties === 0) return 2;
  if (penalties === 1) return 1;
  return 0;
}

export function gradeAnswerLocally(question: string, answer: string, rubric: GradingRubric): RubricScoreBreakdown {
  const { score: keywords, matched, missing } = scoreKeywords(answer, rubric.keyConcepts);
  const understanding = scoreUnderstanding(question, answer);
  const reasoning = scoreReasoning(answer);
  const clarity = scoreClarity(answer);
  const total = understanding + keywords + reasoning + clarity;

  const feedbackParts: string[] = [];
  if (missing.length > 0) {
    feedbackParts.push(`The answer didn't clearly cover: ${missing.slice(0, 4).join(", ")}.`);
  }
  if (reasoning < 2) {
    feedbackParts.push("Explaining the reasoning behind the answer (the 'why' or 'how', not just stating facts) would strengthen it.");
  }
  if (clarity < 2) {
    feedbackParts.push("Structuring the answer into clearer, well-formed sentences would improve readability.");
  }
  if (feedbackParts.length === 0) {
    feedbackParts.push("Answer covers the expected concepts with reasonable clarity and reasoning.");
  }

  return {
    understanding,
    keywords,
    reasoning,
    clarity,
    total,
    matchedConcepts: matched,
    missingConcepts: missing,
    feedback: feedbackParts.join(" ") + " (Graded by the automated rubric fallback — the AI grading service was unavailable for this answer.)",
    gradedBy: "local-rubric",
  };
}

/* ------------------------------------------------------------------ */
/* Entry point: try the LLM, fail over to the local rubric grader      */
/* ------------------------------------------------------------------ */

export async function gradeAnswer(
  question: string,
  answer: string,
  rubric: GradingRubric,
  context: { jdText?: string; resumeSummary?: string; targetRoles?: string[] }
): Promise<RubricScoreBreakdown> {
  try {
    return await gradeAnswerWithLLM(question, answer, rubric, context);
  } catch (err) {
    console.warn("LLM answer grading failed, using local rubric fallback.", err);
    return gradeAnswerLocally(question, answer, rubric);
  }
}
