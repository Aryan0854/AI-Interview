import crypto from "crypto";
import { generateAIText } from "@/lib/ai-providers";
import type {
  ParsedResume,
  PersonalInfo,
  WorkExperience,
  Education,
  SkillSection,
  Project,
  Certification,
  Achievement,
  Leadership,
} from "@/types/resume";

/**
 * Thrown when AI resume-structure extraction cannot be completed after trying
 * every configured provider (Copilot, Groq, Gemini, Ollama) and a retry pass.
 *
 * Callers MUST treat this as a hard failure — never catch it and substitute a
 * regex/heuristic guess for skills, education, or experience. A resume that
 * can't be reliably read by AI should be reported as failed to the user
 * (with an option to retry), not silently populated with incorrect data.
 */
export class ResumeExtractionError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "ResumeExtractionError";
  }
}

function buildExtractionPrompt(text: string): string {
  return `
You are a meticulous resume-parsing engine. Extract structured information from the resume text below.

CRITICAL ACCURACY RULES:
- Only include information that is EXPLICITLY present in the resume text. Never invent, infer, guess, or "fill in" a plausible-sounding value for anything that isn't actually written there.
- If a field is not present anywhere in the resume, return it as an empty string "" (for text fields) or an empty array [] (for list fields). An empty/missing value is always preferable to a fabricated one.
- Copy dates, names, and titles exactly as written in the source text — do not reformat, translate, or "correct" them.
- Every skill you list (technical, soft, or tool) must be explicitly named in the resume text, or unambiguously evidenced by a specific project/role description. Do not add generic or commonly-expected skills that aren't actually mentioned.
- "current" for a work experience entry is true only if its end date literally says "Present", "Current", "Ongoing", or is genuinely open-ended in the text.

Resume text:
"""
${text.substring(0, 15000)}
"""

Return ONLY a raw JSON object, no markdown formatting, no commentary, matching EXACTLY this structure:
{
  "personal": {
    "fullName": "",
    "email": "",
    "phone": "",
    "location": "",
    "linkedin": "",
    "github": "",
    "website": "",
    "title": ""
  },
  "summary": "",
  "experience": [
    {
      "company": "",
      "position": "",
      "location": "",
      "startDate": "",
      "endDate": "",
      "current": false,
      "description": "",
      "bulletPoints": [""],
      "technologies": [""]
    }
  ],
  "education": [
    {
      "institution": "",
      "degree": "",
      "field": "",
      "location": "",
      "graduationDate": "",
      "gpa": "",
      "honors": [""]
    }
  ],
  "skills": {
    "technical": [""],
    "soft": [""],
    "tools": [""],
    "languages": [""],
    "other": [""]
  },
  "projects": [
    {
      "name": "",
      "description": "",
      "technologies": [""],
      "url": "",
      "bulletPoints": [""]
    }
  ],
  "certifications": [
    { "name": "", "issuer": "", "date": "", "expiry": "" }
  ],
  "achievements": [
    { "title": "", "description": "", "context": "" }
  ],
  "leadership": [
    { "role": "", "organization": "", "duration": "", "description": "" }
  ]
}

Omit entries entirely (leave the array empty) for sections that don't appear in the resume — do not fabricate placeholder entries.`.trim();
}

function asStringArray(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return val.filter((v) => typeof v === "string" && v.trim().length > 0).map((v) => (v as string).trim());
}

function asString(val: unknown): string {
  return typeof val === "string" ? val.trim() : "";
}

function normalizePersonal(raw: any): PersonalInfo {
  const p = raw && typeof raw === "object" ? raw : {};
  return {
    fullName: asString(p.fullName),
    email: asString(p.email),
    phone: asString(p.phone),
    location: asString(p.location),
    linkedin: asString(p.linkedin),
    github: asString(p.github),
    website: asString(p.website),
    title: asString(p.title),
  };
}

function normalizeExperience(raw: any): WorkExperience[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e) => e && typeof e === "object")
    .map((e: any) => ({
      id: crypto.randomUUID(),
      company: asString(e.company),
      position: asString(e.position),
      location: asString(e.location),
      startDate: asString(e.startDate),
      endDate: asString(e.endDate),
      current: Boolean(e.current),
      description: asString(e.description),
      bulletPoints: asStringArray(e.bulletPoints).map((text) => ({
        id: crypto.randomUUID(),
        text,
      })),
      technologies: asStringArray(e.technologies),
    }))
    // Drop entries the model returned with no substantive content at all.
    .filter((e) => e.company || e.position || e.description || e.bulletPoints.length > 0);
}

function normalizeEducation(raw: any): Education[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e) => e && typeof e === "object")
    .map((e: any) => ({
      id: crypto.randomUUID(),
      institution: asString(e.institution),
      degree: asString(e.degree),
      field: asString(e.field),
      location: asString(e.location),
      graduationDate: asString(e.graduationDate),
      gpa: asString(e.gpa),
      honors: asStringArray(e.honors),
    }))
    .filter((e) => e.institution || e.degree);
}

function normalizeSkills(raw: any): SkillSection {
  const s = raw && typeof raw === "object" ? raw : {};
  return {
    technical: asStringArray(s.technical),
    soft: asStringArray(s.soft),
    tools: asStringArray(s.tools),
    languages: asStringArray(s.languages),
    other: asStringArray(s.other),
  };
}

function normalizeProjects(raw: any): Project[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p) => p && typeof p === "object")
    .map((p: any) => ({
      id: crypto.randomUUID(),
      name: asString(p.name),
      description: asString(p.description),
      technologies: asStringArray(p.technologies),
      url: asString(p.url),
      bulletPoints: asStringArray(p.bulletPoints),
    }))
    .filter((p) => p.name || p.description);
}

function normalizeCertifications(raw: any): Certification[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c) => c && typeof c === "object")
    .map((c: any) => ({
      id: crypto.randomUUID(),
      name: asString(c.name),
      issuer: asString(c.issuer),
      date: asString(c.date),
      expiry: asString(c.expiry),
    }))
    .filter((c) => c.name);
}

function normalizeAchievements(raw: any): Achievement[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a) => a && typeof a === "object")
    .map((a: any) => ({
      id: crypto.randomUUID(),
      title: asString(a.title),
      description: asString(a.description),
      context: asString(a.context),
    }))
    .filter((a) => a.title || a.description);
}

function normalizeLeadership(raw: any): Leadership[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((l) => l && typeof l === "object")
    .map((l: any) => ({
      id: crypto.randomUUID(),
      role: asString(l.role),
      organization: asString(l.organization),
      duration: asString(l.duration),
      description: asString(l.description),
    }))
    .filter((l) => l.role || l.organization);
}

function normalizeParsedResume(raw: any): ParsedResume {
  if (!raw || typeof raw !== "object") {
    throw new ResumeExtractionError("AI extraction returned a non-object response.");
  }

  return {
    personal: normalizePersonal(raw.personal),
    summary: asString(raw.summary),
    experience: normalizeExperience(raw.experience),
    education: normalizeEducation(raw.education),
    skills: normalizeSkills(raw.skills),
    projects: normalizeProjects(raw.projects),
    certifications: normalizeCertifications(raw.certifications),
    achievements: normalizeAchievements(raw.achievements),
    leadership: normalizeLeadership(raw.leadership),
    // Free-text section boundaries (used only for optional UI display) aren't
    // requested from the LLM — they're not load-bearing for scoring/matching.
    sections: [],
    extractionSource: "ai",
  };
}

function extractJsonObject(raw: string): any {
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in AI response.");
  }
  return JSON.parse(cleaned.substring(start, end + 1));
}

/**
 * Extracts the full structured resume (personal info, summary, experience,
 * education, skills, projects, certifications, achievements, leadership)
 * using the configured LLM provider chain (Copilot -> Groq -> Gemini ->
 * Ollama — see src/lib/ai-providers). Every provider is tried before this
 * gives up; a second full pass is attempted if the first response can't be
 * parsed as valid JSON (a transient formatting slip, not a data problem).
 *
 * On total failure this throws ResumeExtractionError. Callers must NOT catch
 * this and substitute a regex/heuristic parse — an unreadable resume should
 * be reported as a failed upload, never silently filled with guessed data.
 */
export async function extractResumeStructureWithAI(text: string): Promise<ParsedResume> {
  if (!text || !text.trim()) {
    throw new ResumeExtractionError("Resume text is empty — nothing to extract.");
  }

  const prompt = buildExtractionPrompt(text);
  let lastErr: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await generateAIText(prompt);
      const json = extractJsonObject(raw);
      return normalizeParsedResume(json);
    } catch (err) {
      lastErr = err;
      console.warn(`Resume structure extraction attempt ${attempt + 1}/2 failed:`, err);
    }
  }

  throw new ResumeExtractionError(
    "AI resume extraction failed after trying every configured provider (Copilot, Groq, Gemini, Ollama) and a retry. Refusing to fall back to guessed or incorrect data.",
    lastErr
  );
}
