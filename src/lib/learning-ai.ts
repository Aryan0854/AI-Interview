/**
 * Gemini-backed helper for the learning portal.
 *
 * All prompt strings are defined here — never in the UI — so they stay
 * out of the client bundle and out of source-control diffs in other files.
 */
import { geminiEngine } from "./gemini-ai";
import crypto from "crypto";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type AnalyzeResultInput = {
  topic: string;
  accuracy: number;
  total: number;
  correct: number;
  wrongQuestions: string[];
};

/* ------------------------------------------------------------------ */
/* Generic gateway                                                     */
/* ------------------------------------------------------------------ */

function _parse(text: string): any {
  return JSON.parse(
    text
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim()
  );
}

async function call(prompt: string, schema?: any): Promise<any> {
  try {
    const raw: any = await geminiEngine.generateText(prompt);
    return typeof raw === "string" ? _parse(raw) : raw;
  } catch (rawErr: any) {
    // Try once more with stripped schema
    const stripped = prompt.replace(/```json\n?/gi, "").replace(/```/g, "").trim();
    try {
      const onceMore: any = await geminiEngine.generateText(stripped);
      return typeof onceMore === "string" ? _parse(onceMore) : onceMore;
    } catch {
      throw rawErr;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export async function askGemini(
  action: string,
  payload: any,
  signal?: AbortSignal
): Promise<string> {
  switch (action) {
    case "generate_questions":
      return generateQuestions(
        payload.subject  ?? "",
        payload.topic    ?? "",
        payload.difficulty ?? "medium",
        payload.count    ?? 15,
        payload.profile ?? "",
        payload.skill_level ?? "beginner",
        signal
      );

    case "analyse_results":
      return analyseResults(payload as AnalyzeResultInput);

    default:
      throw new Error(`Unknown learning-ai action: ${action}`);
  }
}

/* ------------------------------------------------------------------ */
/* 1. question generation                                              */
/* ------------------------------------------------------------------ */

async function generateQuestions(
  subject: string,
  topic:   string,
  difficulty: string,
  count:   number,
  profile: string,
  skill_level: string,
  signal?: AbortSignal
): Promise<string> {
  const id8 = crypto.randomUUID().slice(0, 8);

  const prompt = `
You are an expert technical examiner. A unique exam session ID is "${id8}".

Generate ${count} distinct ${skill_level}-level multiple-choice questions for
the topic "${topic}" within the subject "${subject}".

Employee profile hints: ${profile || "none provided"}.

Rules
- Every question must be completely different; do NOT duplicate any concept covered by other questions in this same session.
- Distribute cognitive difficulty: roughly 40 % easy, 40 % medium, 20 % hard.
- Prefer practical, scenario-driven questions over rote memorisation.
- Avoid excessive length — each question body should be 1-3 sentences.
- Label the difficulty of each question as "easy", "medium", or "hard".

Return ONLY a JSON array of objects with this schema:
[
  {
    "question": "…",
    "options": ["option A","option B","option C","option D"],
    "correctIndex": 0,
    "explanation": "...why the correct answer is correct...",
    "difficulty": "easy|medium|hard"
  }
]

Do NOT use markdown. ${count} objects exactly.`.trim();

  const raw: any = await geminiEngine.generateText(prompt);
  if (Array.isArray(raw)) {
    return JSON.stringify(raw);
  }
  return _parse(raw);
}

/* ------------------------------------------------------------------ */
/* 2. result analysis                                                  */
/* ------------------------------------------------------------------ */

async function analyseResults({ topic, accuracy, total, correct, wrongQuestions }: AnalyzeResultInput): Promise<string> {
  const prompt = `
You are an AI exam-coach. An employee just completed a ${topic} quiz.

Results:
- Score: ${correct}/${total} (${accuracy}%)
- Wrong answers were on: ${wrongQuestions.join(", ") || "n/a"}

Write a concise 60-120 word personalised analysis in this exact JSON format:
{
  "summary": "1-2 sentences on overall performance",
  "strengths": ["..."],
  "weaknesses": ["..."],
  "next_steps": ["actionable study tip 1", "actionable study tip 2"],
  "continue_message": "Encouraging one-liner"
}

Return raw JSON only, no markdown.`.trim();

  const raw: any = await geminiEngine.generateText(prompt);
  if (typeof raw === "string") {
    try { return JSON.parse(raw.replace(/```json/gi, "").replace(/```/g, "").trim()); }
    catch { return raw; }
  }
  return JSON.stringify(raw);
}
