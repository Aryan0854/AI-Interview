/**
 * JD vs employee-pool skill matching. Used by admin API and dashboard.
 */

const COMMON_TECH_SKILLS = [
  "javascript", "typescript", "python", "java", "c++", "c#", "c", "ruby", "golang", "php", "rust", "swift", "kotlin", "perl", "r", "scala",
  "react", "angular", "vue", "next.js", "nextjs", "nuxt", "node.js", "nodejs", "express", "django", "flask", "spring", "springboot", "asp.net", "laravel", "rails",
  "sql", "postgresql", "postgres", "oracle", "mysql", "sql server", "sqlite", "mongodb", "mongo", "redis", "cassandra", "dynamodb", "mariadb",
  "aws", "amazon web services", "azure", "gcp", "google cloud", "docker", "kubernetes", "k8s", "jenkins", "ansible", "terraform", "ci/cd", "cicd", "git", "github", "gitlab",
  "linux", "windows", "unix", "ubuntu", "centos", "redhat", "red hat", "debian", "macos", "shell", "bash", "powershell",
  "splunk", "datadog", "dynatrace", "appdynamics", "new relic", "prometheus", "grafana", "elk", "elasticsearch", "jira", "confluence", "servicenow", "service now",
  "manual testing", "automation", "selenium", "postman", "jmeter", "cucumber", "testing",
  "microservices", "api", "apis", "rest", "graphql", "soap", "kafka", "rabbitmq", "architecture", "incident management",
  "cmm", "cmg", "ncc", "npc", "sdl", "nds", "aaa", "udm", "hlr", "hss", "epc", "mme", "sgw", "pgw", "lte", "5g", "4g", "ims", "volte", "sip", "diameter", "gtp",
  "paco", "nokia", "cloud mobility manager", "cloud mobile gateway",
];

const STOP_WORDS = new Set([
  "to", "and", "the", "for", "in", "of", "on", "with", "at", "by", "from", "an", "is", "as", "end", "be", "or",
  "exp", "year", "years", "total", "skills", "basics", "basic", "etc", "ex", "eg", "employee", "general", "role",
  "manager", "engineer", "project", "team", "support",
]);

function extractCatalogSkills(text: string): string[] {
  const lower = text.toLowerCase();
  const found = new Set<string>();
  for (const skill of COMMON_TECH_SKILLS) {
    const escaped = skill.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
    const regex = new RegExp(`(^|[^a-zA-Z0-9_#+])(${escaped})([^a-zA-Z0-9_#+]|$)`, "i");
    if (!regex.test(lower)) continue;
    if (skill === "postgres") found.add("postgresql");
    else if (skill === "nodejs") found.add("node.js");
    else if (skill === "nextjs") found.add("next.js");
    else if (skill === "amazon web services") found.add("aws");
    else if (skill === "google cloud") found.add("gcp");
    else if (skill === "servicenow") found.add("service now");
    else if (skill === "red hat") found.add("redhat");
    else if (skill === "apis") found.add("api");
    else if (skill === "nds") found.add("sdl");
    else found.add(skill);
  }
  return Array.from(found);
}

function tokenizeProfile(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[,;+\n/|()]+/)
    .flatMap((part) => part.split(/\s+/))
    .map((s) => s.replace(/[^a-z0-9#+.-]/g, "").trim())
    .filter((s) => s.length >= 3 && !STOP_WORDS.has(s));
}

function prettySkill(s: string): string {
  if (s === s.toUpperCase() || s.length <= 4) return s.toUpperCase();
  return s.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

export function employeeMatchText(emp: {
  skills?: string | null;
  product?: string | null;
  designation?: string | null;
  department?: string | null;
  role?: string | null;
}): string {
  const skip = new Set(["", "general", "employee", "beginner"]);
  return [emp.skills, emp.product, emp.designation, emp.role, emp.department]
    .map((v) => String(v || "").trim())
    .filter((v) => v && !skip.has(v.toLowerCase()))
    .join(", ");
}

export function calculateSkillMatch(
  employeeSkills: string,
  jdSkills: string
): { score: number; matchingSkills: string[] } {
  if (!employeeSkills?.trim() || !jdSkills?.trim()) {
    return { score: 0, matchingSkills: [] };
  }

  const empCatalog = extractCatalogSkills(employeeSkills);
  const jdCatalog = extractCatalogSkills(jdSkills);
  const catalogMatches = empCatalog.filter((skill) => jdCatalog.includes(skill));

  const empTokens = tokenizeProfile(employeeSkills);
  const jdLower = jdSkills.toLowerCase();
  const tokenMatches: string[] = [];
  for (const token of empTokens) {
    if (catalogMatches.includes(token)) continue;
    const escaped = token.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
    const regex = new RegExp(`(^|[^a-zA-Z0-9_#+])(${escaped})([^a-zA-Z0-9_#+]|$)`, "i");
    if (regex.test(jdLower)) tokenMatches.push(token);
  }

  const unique = Array.from(new Set([...catalogMatches, ...tokenMatches]));
  if (unique.length === 0) {
    return { score: 0, matchingSkills: [] };
  }

  const jdSignal = Math.max(jdCatalog.length, 4);
  const divisor = Math.min(8, jdSignal);
  let score = Math.min(100, Math.round((unique.length / divisor) * 100));

  const domainKeys = new Set([
    "cmm", "cmg", "ncc", "npc", "sdl", "aaa", "udm", "hlr", "hss", "epc", "mme", "paco", "nokia",
  ]);
  const domainHits = unique.filter((s) => domainKeys.has(s.toLowerCase()));
  if (domainHits.length > 0) {
    score = Math.min(100, Math.max(score, 55 + Math.min(30, domainHits.length * 10)));
  }

  return {
    score,
    matchingSkills: unique.map(prettySkill),
  };
}
