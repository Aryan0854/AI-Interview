/**
 * Recruiter-style BR/JD vs profile matching.
 * Score is not raw chip coverage: job family, stack sides, evidence strength,
 * and table-stakes skills (Git, HTML, …) decide rank and the 60% qualified line.
 */

const CANONICAL_ALIASES: Record<string, string> = {
  js: "javascript",
  javascript: "javascript",
  typescript: "typescript",
  ts: "typescript",
  python: "python",
  py: "python",
  java: "java",
  "c++": "c++",
  cpp: "c++",
  "c#": "c#",
  csharp: "c#",
  golang: "go",
  go: "go",
  node: "node.js",
  nodejs: "node.js",
  "node.js": "node.js",
  react: "react",
  reactjs: "react",
  angular: "angular",
  vue: "vue",
  vuejs: "vue",
  "next.js": "next.js",
  nextjs: "next.js",
  express: "express",
  django: "django",
  flask: "flask",
  spring: "spring",
  springboot: "spring",
  "spring boot": "spring",
  sql: "sql",
  postgresql: "postgresql",
  postgres: "postgresql",
  oracle: "oracle",
  mysql: "mysql",
  "sql server": "sql server",
  mssql: "sql server",
  mongodb: "mongodb",
  mongo: "mongodb",
  redis: "redis",
  aws: "aws",
  "amazon web services": "aws",
  azure: "azure",
  azue: "azure",
  gcp: "gcp",
  "google cloud": "gcp",
  docker: "docker",
  kubernetes: "kubernetes",
  k8s: "kubernetes",
  jenkins: "jenkins",
  jekins: "jenkins",
  terraform: "terraform",
  ansible: "ansible",
  "ci/cd": "ci/cd",
  cicd: "ci/cd",
  "ci-cd": "ci/cd",
  git: "git",
  github: "github",
  gitlab: "gitlab",
  linux: "linux",
  unix: "unix",
  windows: "windows",
  bash: "bash",
  shell: "bash",
  powershell: "powershell",
  splunk: "splunk",
  datadog: "datadog",
  dynatrace: "dynatrace",
  servicenow: "servicenow",
  "service now": "servicenow",
  jira: "jira",
  selenium: "selenium",
  playwright: "playwright",
  cypress: "cypress",
  cyress: "cypress",
  postman: "postman",
  kafka: "kafka",
  rest: "rest",
  api: "api",
  apis: "api",
  microservices: "microservices",
  hibernate: "hibernate",
  html: "html",
  css: "css",
  cyberark: "cyberark",
  tibco: "tibco",
  mulesoft: "mulesoft",
  "mule soft": "mulesoft",
  cmm: "cmm",
  cmg: "cmg",
  mme: "mme",
  paco: "paco",
  nokia: "nokia",
  "cloud mobility manager": "cmm",
  "cloud mobile gateway": "cmg",
};

const RELATED_EQUIVALENCE: Record<string, string[]> = {
  unix: ["linux"],
  linux: ["unix"],
};

const WEAK_BODY_SKILLS = new Set([
  "api", "testing", "automation", "architecture", "git", "html", "css", "rest",
]);

/** Skills that must not move rank or the 60% line (table stakes / noise). */
const TABLE_STAKES_SKILLS = new Set([
  "git", "github", "gitlab", "html", "css", "rest", "api",
]);

const FE_FRAMEWORKS = new Set(["react", "angular", "vue", "next.js"]);
const BE_LANGUAGES = new Set([
  "java", "python", "node.js", "c#", "go", "spring", "django", "flask", "express",
]);

const STOP_WORDS = new Set([
  "to", "and", "the", "for", "in", "of", "on", "with", "at", "by", "from", "an", "is", "as",
  "end", "be", "or", "exp", "year", "years", "total", "skills", "skill", "basics", "basic",
  "etc", "ex", "eg", "employee", "general", "role", "manager", "engineer", "project", "team",
  "support", "experience", "mandatory", "required", "plus", "strong", "hands", "using",
]);

const PHRASE_CANONICALS = Object.keys(CANONICAL_ALIASES)
  .filter((k) => k.includes(" ") || k.includes(".") || k.includes("/") || k.length > 3)
  .sort((a, b) => b.length - a.length);

export type JobFamily =
  | "qa"
  | "support"
  | "manager"
  | "frontend"
  | "backend"
  | "fullstack"
  | "ai"
  | "devops"
  | "engineering"
  | "other";

export type FamilyRelation = "match" | "adjacent" | "mismatch";

export type MatchDecision = "interview" | "screen" | "hold" | "reject";

export type SkillMatchStatus = "strong" | "solid" | "weak" | "missing";

export type SkillBreakdownItem = {
  skill: string;
  status: SkillMatchStatus;
  credit: number;
  years: number | null;
  evidence: string;
  scoring: boolean;
  foundAs: string;
};

export type ScoreParts = {
  coveragePct: number;
  familyScore: number;
  stackScore: number;
  levelScore: number;
  years: number | null;
  grade: number | null;
  weighted: {
    coverage: number;
    family: number;
    stack: number;
    level: number;
  };
};

export type SkillMatchResult = {
  score: number;
  matchingSkills: string[];
  matchedCount: number;
  requiredCount: number;
  decision: MatchDecision;
  rationale: string;
  familyRelation: FamilyRelation;
  personFamily: JobFamily;
  jdFamily: JobFamily;
  skillBreakdown: SkillBreakdownItem[];
  bonusSkills: string[];
  scoreParts: ScoreParts;
};

const EMPTY_SCORE_PARTS: ScoreParts = {
  coveragePct: 0,
  familyScore: 0,
  stackScore: 0,
  levelScore: 0,
  years: null,
  grade: null,
  weighted: { coverage: 0, family: 0, stack: 0, level: 0 },
};

function emptyMatch(rationale = "No skills or requirement text to score."): SkillMatchResult {
  return {
    score: 0,
    matchingSkills: [],
    matchedCount: 0,
    requiredCount: 0,
    decision: "reject",
    rationale,
    familyRelation: "mismatch",
    personFamily: "other",
    jdFamily: "other",
    skillBreakdown: [],
    bonusSkills: [],
    scoreParts: EMPTY_SCORE_PARTS,
  };
}

function escapeRe(s: string): string {
  return s.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
}

/** Collapse "Java script" / "java-script" so it cannot also count as Java. */
function normalizeProfileText(text: string): string {
  return String(text || "")
    .replace(/\bjava[\s_-]*scripts?\b/gi, "javascript")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function hasPhrase(haystack: string, needle: string): boolean {
  if (!needle) return false;
  const escaped = escapeRe(needle.toLowerCase());
  if (needle.toLowerCase() === "java") {
    return new RegExp(`(^|[^a-zA-Z0-9_#+])java(?![\\s_-]*script)([^a-zA-Z0-9_#+]|$)`, "i").test(haystack);
  }
  if (needle.toLowerCase() === "react") {
    return new RegExp(`(^|[^a-zA-Z0-9_#+])react(?!\\s*native)([^a-zA-Z0-9_#+]|$)`, "i").test(haystack);
  }
  const re = new RegExp(`(^|[^a-zA-Z0-9_#+])${escaped}([^a-zA-Z0-9_#+]|$)`, "i");
  return re.test(haystack);
}

function canonicalizeToken(raw: string): string {
  const t = raw.toLowerCase().replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (CANONICAL_ALIASES[t]) return CANONICAL_ALIASES[t];
  const compact = t.replace(/[\s._-]/g, "");
  if (CANONICAL_ALIASES[compact]) return CANONICAL_ALIASES[compact];
  return t;
}

function splitSkillList(line: string): string[] {
  return line
    .split(/[,;|/]+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 2 && !STOP_WORDS.has(s.toLowerCase()));
}

function acronymsFrom(phrase: string): string[] {
  const found: string[] = [];
  const paren = phrase.match(/\(([A-Za-z0-9+/#]{2,})\)/g) || [];
  for (const p of paren) found.push(p.replace(/[()]/g, ""));
  return found;
}

function aliasesForSkill(skill: string, minLen = 1): string[] {
  const canon = canonicalizeToken(skill) || skill.toLowerCase();
  const aliases = Object.entries(CANONICAL_ALIASES)
    .filter(([, v]) => v === canon)
    .map(([k]) => k);
  return Array.from(new Set([canon, skill.toLowerCase(), ...aliases])).filter((a) => a.length >= minLen);
}

export function parseJdRequirements(jdText: string): {
  title: string;
  mandatoryRaw: string[];
  required: string[];
} {
  const text = String(jdText || "").trim();
  const titleMatch = text.match(/Job Title:\s*(.+?)(?:\n|Mandatory Skills:|$)/i);
  const title = titleMatch?.[1]?.replace(/\s+/g, " ").trim() || "";

  const mandLines = [...text.matchAll(/Mandatory Skills:\s*([^\n]+)/gi)].map((m) =>
    splitSkillList(m[1].split("\n")[0])
  );
  const mandatoryRaw =
    mandLines.length === 0
      ? []
      : mandLines.reduce((best, line) => {
          if (line.length < 3) return best;
          if (best.length === 0) return line;
          return line.length <= best.length ? line : best;
        }, mandLines[mandLines.length - 1]);

  const requiredSet: string[] = [];
  const pushReq = (raw: string) => {
    const canon = canonicalizeToken(raw);
    const key = canon || raw.toLowerCase();
    if (key.length < 2) return;
    if (!requiredSet.includes(key)) requiredSet.push(key);
    for (const acr of acronymsFrom(raw)) {
      const ac = canonicalizeToken(acr);
      if (ac && !requiredSet.includes(ac)) requiredSet.push(ac);
    }
  };

  if (mandatoryRaw.length > 0) {
    for (const item of mandatoryRaw) pushReq(item);
  } else {
    const lower = normalizeProfileText(text);
    for (const phrase of PHRASE_CANONICALS) {
      if (hasPhrase(lower, phrase)) pushReq(CANONICAL_ALIASES[phrase] || phrase);
    }
    const filtered = requiredSet.filter((s) => !WEAK_BODY_SKILLS.has(s) && !TABLE_STAKES_SKILLS.has(s));
    if (filtered.length >= 2) {
      return { title, mandatoryRaw, required: filtered };
    }
  }

  return { title, mandatoryRaw, required: requiredSet };
}

function collectEmployeeSkills(employeeText: string): { canonical: Set<string>; raw: string } {
  const raw = normalizeProfileText(employeeText);
  const canonical = new Set<string>();
  for (const phrase of PHRASE_CANONICALS) {
    if (hasPhrase(raw, phrase)) canonical.add(CANONICAL_ALIASES[phrase] || phrase);
  }
  const parts = splitSkillList(raw.replace(/\n/g, ","));
  for (const part of parts) {
    const canon = canonicalizeToken(part);
    if (canon) canonical.add(canon);
    for (const acr of acronymsFrom(part)) {
      const ac = canonicalizeToken(acr);
      if (ac) canonical.add(ac);
    }
  }
  for (const [alias, canon] of Object.entries(CANONICAL_ALIASES)) {
    if (alias.length >= 3 && hasPhrase(raw, alias)) canonical.add(canon);
  }
  return { canonical, raw };
}

function employeeHasSkill(emp: { canonical: Set<string>; raw: string }, required: string): boolean {
  const canon = canonicalizeToken(required);
  if (emp.canonical.has(required) || emp.canonical.has(canon)) return true;
  const related = RELATED_EQUIVALENCE[canon] || RELATED_EQUIVALENCE[required] || [];
  if (related.some((r) => emp.canonical.has(r))) return true;
  if (hasPhrase(emp.raw, required) || (canon && hasPhrase(emp.raw, canon))) return true;
  return false;
}

function isWeakMention(raw: string, skill: string): boolean {
  const hedge = "basic|basics|beginner|familiar|exposure|learning|elementary";
  for (const alias of aliasesForSkill(skill, 3)) {
    const a = escapeRe(alias);
    const after = new RegExp(`\\b${a}\\b.{0,20}\\b(${hedge})\\b`, "i");
    const before = new RegExp(`\\b(${hedge})\\b.{0,24}\\b${a}\\b`, "i");
    const dashed = new RegExp(`\\b${a}\\s*[-–]\\s*(${hedge})\\b`, "i");
    if (after.test(raw) || before.test(raw) || dashed.test(raw)) return true;
  }
  return false;
}

function skillCredit(emp: { canonical: Set<string>; raw: string }, required: string): number {
  if (!employeeHasSkill(emp, required)) return 0;
  if (isWeakMention(emp.raw, required)) return 0.25;
  const yearsNear = skillYearsHint(emp.raw, required);
  if (yearsNear >= 4) return 1;
  if (yearsNear >= 2) return 0.9;
  return 0.75;
}

function skillYearsHint(raw: string, skill: string): number {
  for (const alias of aliasesForSkill(skill, 3)) {
    const a = escapeRe(alias);
    const m = raw.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*\\+?\\s*years?[^.]{0,40}\\b${a}\\b`, "i"))
      || raw.match(new RegExp(`\\b${a}\\b[^.]{0,40}(\\d+(?:\\.\\d+)?)\\s*\\+?\\s*years?`, "i"));
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n)) return n;
    }
  }
  return 0;
}

function findMatchedAlias(emp: { canonical: Set<string>; raw: string }, required: string): string {
  const canon = canonicalizeToken(required) || required.toLowerCase();
  const aliases = aliasesForSkill(required, 2).sort((a, b) => b.length - a.length);
  for (const alias of aliases) {
    if (!hasPhrase(emp.raw, alias)) continue;
    if (alias.length > canon.length && (alias.includes(" ") || alias.includes(".") || alias.includes("-"))) {
      return alias
        .split(/[\s._-]+/)
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(" ");
    }
    return prettySkill(canonicalizeToken(alias) || alias);
  }
  const related = RELATED_EQUIVALENCE[canon] || RELATED_EQUIVALENCE[required] || [];
  for (const r of related) {
    if (emp.canonical.has(r) || hasPhrase(emp.raw, r)) return prettySkill(r);
  }
  return "";
}

function describeSkillMatch(
  emp: { canonical: Set<string>; raw: string },
  required: string,
  credit: number
): SkillBreakdownItem {
  const canon = canonicalizeToken(required) || required.toLowerCase();
  const scoring = !TABLE_STAKES_SKILLS.has(canon);
  const yearsHint = skillYearsHint(emp.raw, required);
  const years = yearsHint > 0 ? yearsHint : null;
  const foundAs = findMatchedAlias(emp, required);
  const related = RELATED_EQUIVALENCE[canon] || [];
  const viaRelated = related.find((r) => emp.canonical.has(r) || hasPhrase(emp.raw, r));
  const present = employeeHasSkill(emp, required);

  let status: SkillMatchStatus = "missing";
  if (credit >= 0.9) status = "strong";
  else if (credit >= 0.7) status = "solid";
  else if (credit > 0 || present) status = "weak";

  const bits: string[] = [];
  if (!present) {
    bits.push("Not found in this profile");
  } else if (isWeakMention(emp.raw, required)) {
    bits.push(foundAs ? `Only a weak mention as ${foundAs}` : "Only a weak mention");
  } else if (viaRelated && prettySkill(viaRelated).toLowerCase() !== prettySkill(canon).toLowerCase()) {
    bits.push(`Counted via ${prettySkill(viaRelated)} (treated as equivalent)`);
  } else if (foundAs && foundAs.toLowerCase() !== prettySkill(canon).toLowerCase()) {
    bits.push(`Matched as ${foundAs}`);
  } else {
    bits.push("Found in profile skills");
  }
  if (years != null) bits.push(`${years}+ years nearby in the profile`);
  if (!scoring) {
    bits.push(present ? "Table-stakes — does not change the fit score" : "Table-stakes if present — does not change the fit score");
  }

  return {
    skill: prettySkill(canon),
    status,
    credit,
    years,
    evidence: bits.join(". ") + ".",
    scoring,
    foundAs,
  };
}

function prettySkill(s: string): string {
  const special: Record<string, string> = {
    "node.js": "Node.js",
    "next.js": "Next.js",
    "ci/cd": "CI/CD",
    "c++": "C++",
    "c#": "C#",
    "sql server": "SQL Server",
    javascript: "JavaScript",
    typescript: "TypeScript",
    postgresql: "PostgreSQL",
    servicenow: "ServiceNow",
    mongodb: "MongoDB",
    mysql: "MySQL",
    aws: "AWS",
    gcp: "GCP",
    html: "HTML",
    css: "CSS",
    git: "Git",
    sql: "SQL",
    rest: "REST",
    api: "API",
  };
  if (special[s]) return special[s];
  if (s.length <= 4) return s.toUpperCase();
  return s.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

export function extractJdDisplaySkills(jdText: string): string[] {
  const { mandatoryRaw, required } = parseJdRequirements(jdText);
  const labels =
    mandatoryRaw.length > 0
      ? mandatoryRaw.map((s) => prettySkill(canonicalizeToken(s) || s.toLowerCase()))
      : required.map(prettySkill);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const label of labels) {
    const key = label.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(label);
  }
  return unique;
}

/** Recruiter fit at or above this is treated as qualified / suitable. */
export const QUALIFIED_COVERAGE_PERCENT = 60;

export function employeeMatchText(emp: {
  skills?: string | null;
  product?: string | null;
  designation?: string | null;
  department?: string | null;
  role?: string | null;
  grade?: string | null;
}): string {
  const skip = new Set(["", "general", "employee", "beginner"]);
  return [emp.skills, emp.product, emp.designation, emp.role, emp.grade]
    .map((v) => String(v || "").trim())
    .filter((v) => v && !skip.has(v.toLowerCase()))
    .join(", ");
}

export function candidateMatchText(row: {
  filename?: string | null;
  originalText?: string | null;
  parsed?: {
    personal?: { title?: string | null; fullName?: string | null };
    summary?: string | null;
    skills?: {
      technical?: string[];
      tools?: string[];
      languages?: string[];
      other?: string[];
    };
    experience?: Array<{
      position?: string | null;
      company?: string | null;
      description?: string | null;
      technologies?: string[];
      bulletPoints?: Array<{ text?: string | null }>;
    }>;
    projects?: Array<{
      name?: string | null;
      technologies?: string[];
      description?: string | null;
    }>;
  };
}): string {
  const skills = row?.parsed?.skills;
  const experience = row?.parsed?.experience || [];
  const projects = row?.parsed?.projects || [];
  const parts = [
    row?.parsed?.personal?.fullName,
    row?.parsed?.personal?.title,
    row?.filename,
    row?.parsed?.summary,
    ...(skills?.technical || []),
    ...(skills?.tools || []),
    ...(skills?.languages || []),
    ...(skills?.other || []),
    ...experience.flatMap((job) => [
      job.position,
      job.company,
      job.description,
      ...(job.technologies || []),
      ...(job.bulletPoints || []).map((b) => b.text),
    ]),
    ...projects.flatMap((p) => [p.name, p.description, ...(p.technologies || [])]),
    String(row?.originalText || "").slice(0, 4000),
  ];
  return parts
    .map((v) => String(v || "").trim())
    .filter(Boolean)
    .join(", ");
}

function inferJobFamily(text: string, title = ""): JobFamily {
  const blob = `${title} ${text}`.toLowerCase();

  if (
    /\b(technical manager|engineering manager|program manager|delivery manager|director|vice president|\bvp\b|head of|e6|e7|e8|e9)\b/.test(blob)
    && !/\b(tech(?:nical)? lead|team lead)\b/.test(title.toLowerCase())
  ) {
    if (/\b(manager|director|head of|\bvp\b)\b/.test(blob)) return "manager";
  }
  if (/\b(technical manager|engineering manager)\b/.test(blob)) return "manager";

  if (
    /\b(technical architect|solution architect|java architect|senior technical architect|associate principal|principal consultant)\b/.test(blob)
  ) {
    return "manager";
  }

  if (
    /\b(test lead|test engineer|qa\b|sdet|quality analyst|software test|qa automation|playwright|selenium|cypress|manual testing)\b/.test(blob)
  ) {
    return "qa";
  }

  if (
    /\b(production support|application support|\bl1\b|\bl2\b|\bl3\b|service desk|incident manager|major incident|noc\b)\b/.test(blob)
  ) {
    return "support";
  }

  const hasFe = [...FE_FRAMEWORKS].some((s) => hasPhrase(blob, s));
  const hasBeLang = [...BE_LANGUAGES].some((s) => hasPhrase(blob, s));
  const hasBeBeyondNode = [...BE_LANGUAGES]
    .filter((s) => s !== "node.js" && s !== "express")
    .some((s) => hasPhrase(blob, s));
  const hasBe = hasBeLang && hasBeBeyondNode;
  const nodeOnlyBe = hasBeLang && !hasBeBeyondNode;
  const fullstackPhrase = /\bfull[\s-]*stack\b/.test(blob);
  const frontendPhrase = /\b(frontend|front-end|ui developer|react developer)\b/.test(blob);
  const backendPhrase = /\b(backend|back-end|java developer|spring boot)\b/.test(blob);
  const aiPhrase = /\b(agentic|genai|gen ai|generative ai|langchain|langgraph|llm|machine learning)\b/.test(blob);
  const devopsPhrase = /\b(devops|sre\b|kubernetes|site reliability)\b/.test(blob);

  const icBuilder =
    /\b(software engineer|full[\s-]*stack|frontend|front-end|backend|developer)\b/.test(blob)
    && !/\b(architect|principal consultant|associate principal|technical manager|jbpm|pega)\b/.test(blob);

  if (fullstackPhrase) return "fullstack";
  if (hasFe && hasBe && icBuilder) return "fullstack";
  if (hasFe && hasBe) return "engineering";
  if (aiPhrase && !hasFe && !backendPhrase && !fullstackPhrase) return "ai";
  if (frontendPhrase || (hasFe && !hasBe) || (hasFe && nodeOnlyBe)) return "frontend";
  if (backendPhrase || (hasBe && !hasFe)) return "backend";
  if (aiPhrase) return "ai";
  if (devopsPhrase && !hasFe) return "devops";
  if (/\b(software engineer|developer|technical lead|tech lead)\b/.test(blob)) return "engineering";
  return "other";
}

function familyAlignment(jdFamily: JobFamily, personFamily: JobFamily): { score: number; relation: FamilyRelation } {
  if (jdFamily === personFamily) return { score: 100, relation: "match" };

  const adjacent: Record<string, JobFamily[]> = {
    fullstack: ["engineering", "frontend", "backend", "devops"],
    engineering: ["fullstack", "frontend", "backend", "devops", "ai"],
    frontend: ["fullstack", "engineering"],
    backend: ["fullstack", "engineering", "devops", "ai"],
    devops: ["backend", "engineering", "fullstack"],
    ai: ["backend", "engineering"],
    qa: [],
    support: [],
    manager: [],
    other: ["engineering", "fullstack"],
  };

  const mismatchPairs: Array<[JobFamily, JobFamily]> = [
    ["qa", "fullstack"], ["qa", "engineering"], ["qa", "frontend"], ["qa", "backend"],
    ["support", "fullstack"], ["support", "engineering"], ["support", "frontend"], ["support", "backend"],
    ["manager", "fullstack"], ["manager", "engineering"], ["manager", "frontend"], ["manager", "backend"],
    ["qa", "support"],
  ];

  if (
    mismatchPairs.some(([a, b]) => (jdFamily === a && personFamily === b) || (jdFamily === b && personFamily === a))
    || personFamily === "qa" && ["fullstack", "engineering", "frontend", "backend"].includes(jdFamily)
    || personFamily === "manager" && ["fullstack", "engineering", "frontend", "backend", "qa", "support"].includes(jdFamily)
    || personFamily === "support" && ["fullstack", "engineering", "frontend", "backend"].includes(jdFamily)
  ) {
    return { score: personFamily === "qa" ? 8 : personFamily === "manager" ? 15 : 12, relation: "mismatch" };
  }

  if ((adjacent[jdFamily] || []).includes(personFamily)) {
    const score =
      (jdFamily === "fullstack" && personFamily === "backend") ? 72
      : (jdFamily === "fullstack" && personFamily === "frontend") ? 68
      : (jdFamily === "fullstack" && personFamily === "engineering") ? 80
      : 60;
    return { score, relation: "adjacent" };
  }

  return { score: 35, relation: "adjacent" };
}

function parseYears(text: string): number | null {
  const m = String(text || "").match(/(\d+(?:\.\d+)?)\s*\+?\s*years?\s+of\s+exp/i)
    || String(text || "").match(/(\d+(?:\.\d+)?)\s*\+?\s*years?\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function parseGrade(text: string): number | null {
  const m = String(text || "").match(/\be([1-9])\b/i);
  return m ? Number(m[1]) : null;
}

function jdIsIcBuilder(title: string): boolean {
  const t = title.toLowerCase();
  if (/\b(manager|director|head|vp)\b/.test(t)) return false;
  return /\b(engineer|developer|programmer|analyst)\b/.test(t) && !/\b(test engineer|support engineer)\b/.test(t)
    || /\bfull[\s-]*stack\b/.test(t);
}

function levelFit(profileText: string, jdTitle: string, personFamily: JobFamily): number {
  const grade = parseGrade(profileText);
  const years = parseYears(profileText);
  const ic = jdIsIcBuilder(jdTitle);

  if (personFamily === "manager" && ic) return 20;
  if (personFamily === "qa" && ic) return 25;

  let score = 80;
  if (ic) {
    if (grade != null) {
      if (grade <= 3) score = 95;
      else if (grade === 4) score = 78;
      else if (grade === 5) score = 70;
      else score = 25;
    }
    if (/\b(senior technical lead|technical lead|tech lead)\b/.test(profileText) && !/\blead\b/.test(jdTitle.toLowerCase())) {
      score = Math.min(score, 72);
    }
  }

  if (years != null && years < 3 && ic) score = Math.min(score, 45);
  if (years != null && years >= 12 && ic && !/\b(lead|senior|principal|staff)\b/.test(jdTitle.toLowerCase())) {
    score = Math.min(score, 60);
  }
  return score;
}

function stackFit(
  jdFamily: JobFamily,
  required: string[],
  credits: Map<string, number>,
): number {
  if (jdFamily !== "fullstack") return 70;
  const reqFe = required.filter((s) => FE_FRAMEWORKS.has(s));
  const reqBe = required.filter((s) => BE_LANGUAGES.has(s));
  const hasFe = reqFe.length === 0 || reqFe.some((s) => (credits.get(s) || 0) >= 0.7);
  const hasBe = reqBe.length === 0 || reqBe.some((s) => (credits.get(s) || 0) >= 0.7);
  if (hasFe && hasBe) return 100;
  if (hasFe || hasBe) return 50;
  return 15;
}

function decide(score: number, relation: FamilyRelation, coveragePct: number, stack: number, jdFamily: JobFamily): MatchDecision {
  if (relation === "mismatch") return "reject";
  const fullstackComplete = jdFamily !== "fullstack" || stack === 100;
  if (score >= 70 && relation === "match" && coveragePct >= 70 && fullstackComplete) return "interview";
  if (score >= QUALIFIED_COVERAGE_PERCENT && coveragePct >= 50 && fullstackComplete) return "screen";
  if (score >= 40) return "hold";
  return "reject";
}

export function calculateSkillMatch(
  employeeSkills: string,
  jdSkills: string
): SkillMatchResult {
  if (!employeeSkills?.trim() || !jdSkills?.trim()) {
    return emptyMatch();
  }

  const parsed = parseJdRequirements(jdSkills);
  const required = parsed.required;
  if (required.length === 0) {
    return emptyMatch("No required JD skills to score against.");
  }

  const scoringRequired = required.filter((s) => !TABLE_STAKES_SKILLS.has(s));
  const scoredSkills = scoringRequired.length > 0 ? scoringRequired : required;

  const emp = collectEmployeeSkills(employeeSkills);
  const jdFamily = inferJobFamily(jdSkills, parsed.title);
  const personFamily = inferJobFamily(employeeSkills);
  const alignment = familyAlignment(jdFamily, personFamily);

  const credits = new Map<string, number>();
  const matchedFull: string[] = [];
  for (const req of scoredSkills) {
    const credit = skillCredit(emp, req);
    credits.set(req, credit);
    if (credit >= 0.7) matchedFull.push(req);
  }

  const coverage = scoredSkills.reduce((sum, s) => sum + (credits.get(s) || 0), 0) / scoredSkills.length;
  const coveragePct = coverage * 100;
  const stack = stackFit(jdFamily, scoredSkills, credits);
  const level = levelFit(emp.raw, parsed.title, personFamily);

  let score = Math.round(
    0.45 * coveragePct +
    0.30 * alignment.score +
    0.15 * stack +
    0.10 * level
  );

  const years = parseYears(emp.raw);
  if (alignment.relation === "mismatch") {
    score = Math.min(score, 28);
  } else if (jdFamily === "fullstack" && stack < 100) {
    score = Math.min(score, 58);
    if (years != null && years < 3) score = Math.min(score, 38);
  }
  if (jdFamily === "fullstack" && personFamily === "ai") {
    score = Math.min(score, 36);
  }
  if (coveragePct < 50) {
    score = Math.min(score, 58);
  }
  if (coveragePct < 35) {
    score = Math.min(score, 48);
  }

  score = Math.max(0, Math.min(100, score));

  const matchingSkills: string[] = [];
  const seenMatch = new Set<string>();
  for (const label of matchedFull.map(prettySkill)) {
    const key = label.toLowerCase();
    if (!key || seenMatch.has(key)) continue;
    seenMatch.add(key);
    matchingSkills.push(label);
  }

  const decision = decide(score, alignment.relation, coveragePct, stack, jdFamily);
  const missingCore = scoredSkills.filter((s) => (credits.get(s) || 0) < 0.7).map(prettySkill);
  const rationaleParts = [
    `${decision === "screen" ? "Screen" : decision === "interview" ? "Interview" : decision === "hold" ? "Hold" : "Reject"} as ${personFamily} for a ${jdFamily} req`,
    matchingSkills.length
      ? `solid hits: ${matchingSkills.join(", ")}`
      : "no solid required-skill hits",
  ];
  if (missingCore.length) rationaleParts.push(`missing or weak: ${missingCore.join(", ")}`);
  if (alignment.relation === "mismatch") {
    rationaleParts.push("job family does not match this requirement");
  } else if (jdFamily === "fullstack" && stack <= 50) {
    rationaleParts.push("only one side of the stack");
  }

  const breakdownSeen = new Set<string>();
  const skillBreakdown: SkillBreakdownItem[] = [];
  const orderedReq = [
    ...scoredSkills,
    ...required.filter((s) => !scoredSkills.includes(s)),
  ];
  for (const req of orderedReq) {
    const key = (canonicalizeToken(req) || req).toLowerCase();
    if (!key || breakdownSeen.has(key)) continue;
    breakdownSeen.add(key);
    const credit = credits.has(req) ? credits.get(req) || 0 : skillCredit(emp, req);
    skillBreakdown.push(describeSkillMatch(emp, req, credit));
  }

  const requiredCanon = new Set(required.map((s) => canonicalizeToken(s) || s));
  const knownSkills = new Set(Object.values(CANONICAL_ALIASES));
  const bonusSkills: string[] = [];
  const bonusSeen = new Set<string>();
  for (const skill of emp.canonical) {
    if (!knownSkills.has(skill)) continue;
    if (requiredCanon.has(skill) || TABLE_STAKES_SKILLS.has(skill)) continue;
    const label = prettySkill(skill);
    const k = label.toLowerCase();
    if (!k || bonusSeen.has(k)) continue;
    bonusSeen.add(k);
    bonusSkills.push(label);
  }
  bonusSkills.sort((a, b) => a.localeCompare(b));

  const scoreParts: ScoreParts = {
    coveragePct: Math.round(coveragePct),
    familyScore: alignment.score,
    stackScore: stack,
    levelScore: level,
    years,
    grade: parseGrade(emp.raw),
    weighted: {
      coverage: Math.round(0.45 * coveragePct),
      family: Math.round(0.30 * alignment.score),
      stack: Math.round(0.15 * stack),
      level: Math.round(0.10 * level),
    },
  };

  return {
    score,
    matchingSkills,
    matchedCount: matchedFull.length,
    requiredCount: scoredSkills.length,
    decision,
    rationale: `${rationaleParts.join(". ")}.`,
    familyRelation: alignment.relation,
    personFamily,
    jdFamily,
    skillBreakdown,
    bonusSkills: bonusSkills.slice(0, 16),
    scoreParts,
  };
}
