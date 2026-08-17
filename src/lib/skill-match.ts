/**
 * Local BR/JD vs employee matching. No API keys.
 * Score = % of the job's required skills found on the employee (true coverage).
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

const STOP_WORDS = new Set([
  "to", "and", "the", "for", "in", "of", "on", "with", "at", "by", "from", "an", "is", "as",
  "end", "be", "or", "exp", "year", "years", "total", "skills", "skill", "basics", "basic",
  "etc", "ex", "eg", "employee", "general", "role", "manager", "engineer", "project", "team",
  "support", "experience", "mandatory", "required", "plus", "strong", "hands", "using",
]);

const PHRASE_CANONICALS = Object.keys(CANONICAL_ALIASES)
  .filter((k) => k.includes(" ") || k.includes(".") || k.includes("/") || k.length > 3)
  .sort((a, b) => b.length - a.length);

function escapeRe(s: string): string {
  return s.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
}

function hasPhrase(haystack: string, needle: string): boolean {
  if (!needle) return false;
  const escaped = escapeRe(needle.toLowerCase());
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

export function parseJdRequirements(jdText: string): {
  title: string;
  mandatoryRaw: string[];
  required: string[];
} {
  const text = String(jdText || "").trim();
  const titleMatch = text.match(/Job Title:\s*(.+?)(?:\n|Mandatory Skills:|$)/i);
  const title = titleMatch?.[1]?.replace(/\s+/g, " ").trim() || "";

  const mandMatch = text.match(/Mandatory Skills:\s*([^\n]+)/i);
  const mandatoryRaw = mandMatch?.[1] ? splitSkillList(mandMatch[1].split("\n")[0]) : [];

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
    const lower = text.toLowerCase();
    for (const phrase of PHRASE_CANONICALS) {
      if (hasPhrase(lower, phrase)) pushReq(CANONICAL_ALIASES[phrase] || phrase);
    }
    const filtered = requiredSet.filter((s) => !WEAK_BODY_SKILLS.has(s));
    if (filtered.length >= 2) {
      return { title, mandatoryRaw, required: filtered };
    }
  }

  return { title, mandatoryRaw, required: requiredSet };
}

function collectEmployeeSkills(employeeText: string): { canonical: Set<string>; raw: string } {
  const raw = String(employeeText || "").toLowerCase();
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

/** Coverage % at or above this is treated as qualified / suitable. */
export const QUALIFIED_COVERAGE_PERCENT = 60;

export function employeeMatchText(emp: {
  skills?: string | null;
  product?: string | null;
  designation?: string | null;
  department?: string | null;
  role?: string | null;
}): string {
  const skip = new Set(["", "general", "employee", "beginner"]);
  return [emp.skills, emp.product, emp.designation, emp.role]
    .map((v) => String(v || "").trim())
    .filter((v) => v && !skip.has(v.toLowerCase()))
    .join(", ");
}

export function candidateMatchText(row: {
  parsed?: {
    personal?: { title?: string | null };
    summary?: string | null;
    skills?: {
      technical?: string[];
      tools?: string[];
      languages?: string[];
      other?: string[];
    };
    experience?: Array<{
      position?: string | null;
      technologies?: string[];
    }>;
  };
}): string {
  const skills = row?.parsed?.skills;
  const experience = row?.parsed?.experience || [];
  const parts = [
    ...(skills?.technical || []),
    ...(skills?.tools || []),
    ...(skills?.languages || []),
    ...(skills?.other || []),
    row?.parsed?.personal?.title,
    row?.parsed?.summary,
    ...experience.flatMap((job) => [job.position, ...(job.technologies || [])]),
  ];
  return parts
    .map((v) => String(v || "").trim())
    .filter(Boolean)
    .join(", ");
}

export function calculateSkillMatch(
  employeeSkills: string,
  jdSkills: string
): { score: number; matchingSkills: string[]; matchedCount: number; requiredCount: number } {
  if (!employeeSkills?.trim() || !jdSkills?.trim()) {
    return { score: 0, matchingSkills: [], matchedCount: 0, requiredCount: 0 };
  }

  const parsed = parseJdRequirements(jdSkills);
  const required = parsed.required;
  if (required.length === 0) {
    return { score: 0, matchingSkills: [], matchedCount: 0, requiredCount: 0 };
  }

  const emp = collectEmployeeSkills(employeeSkills);
  const matched: string[] = [];
  for (const req of required) {
    if (employeeHasSkill(emp, req)) matched.push(req);
  }

  const coverage = matched.length / required.length;
  const score = Math.round(coverage * 100);
  const matchingSkills: string[] = [];
  const seenMatch = new Set<string>();
  for (const label of matched.map(prettySkill)) {
    const key = label.toLowerCase();
    if (!key || seenMatch.has(key)) continue;
    seenMatch.add(key);
    matchingSkills.push(label);
  }

  return {
    score,
    matchingSkills,
    matchedCount: matched.length,
    requiredCount: required.length,
  };
}
