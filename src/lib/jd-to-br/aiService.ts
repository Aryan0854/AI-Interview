import { generateAIText } from "@/lib/ai-providers";

/**
 * Extracts structured JD details from raw text.
 *
 * This is a data-EXTRACTION task (pulling specific fields out of a specific document
 * that was actually provided), not a scoring/judgment task — so per the project's AI
 * usage policy, extraction tasks use the LLM as the PRIMARY method, same as resume
 * parsing and interview grading elsewhere in the app. The LLM is explicitly instructed
 * to extract ONLY what is actually present in the supplied JD text — never to infer,
 * assume, or fabricate a skill/tool/requirement that isn't there — so what comes back
 * is grounded in the source document, not general background knowledge about what a
 * typical JD "usually" contains.
 *
 * FAILSAFE: if every configured LLM provider fails (rate limit, network, no key
 * configured), this falls back to the deterministic regex/keyword parser
 * (runMockFallback) so JD processing never hard-fails — just with less nuanced
 * extraction than the LLM would produce.
 *
 * Set JD_EXTRACTION_FORCE_LOCAL=true in .env.local to skip the LLM entirely and always
 * use the deterministic parser (e.g. for a fully offline/zero-cost deployment).
 *
 * @param rawText - The document raw text
 * @returns Structured JSON object
 */
export const extractJdDetails = async (rawText: string, filename?: string): Promise<any> => {
  if (process.env.JD_EXTRACTION_FORCE_LOCAL === "true") {
    return runMockFallback(rawText, filename);
  }

  try {
    console.log('[AI] Calling configured AI provider for JD structured extraction...');
    const prompt = `
You are a precise document-extraction system. Extract structured information from the Job Description text below.

CRITICAL EXTRACTION RULE: Extract ONLY information that is explicitly present in the JD text provided below. Do not infer, assume, guess, or fill in a typical/common value for any field that isn't actually stated in the text — if a field genuinely isn't mentioned, return an empty string or empty array for it rather than a plausible-sounding default. This must be a faithful extraction of the source document, not a general description of what a role like this usually involves.

Provide your response in EXACT JSON format. Map and normalize skills you find to standard capitalization. Detect and remove duplicates. Do not include any markdown backticks (\`\`\`) or "json" prefix. The response must be a single, clean JSON object matching the schema below:

{
  "job_title": "Clean, official job title exactly as stated or clearly implied in the text (e.g. L2 Production Support Engineer)",
  "department": "Department type ONLY if explicitly mentioned in the text, e.g. Technical, Delivery (leave empty if not stated)",
  "experience": "Experience range EXACTLY as stated in the text, e.g., 2-5 years",
  "support_level": "Support Level ONLY if explicitly stated: L1, L2, L3, L1/L2, etc. (null if not found in the text)",
  "employment_type": "e.g., Full Time, Contract, Onsite, Hybrid — only if stated",
  "shift_timing": "e.g., 24x7, Rotational, Day Shift, Irving TX Onsite — only if stated",
  "skills": ["Array of technical skills ACTUALLY MENTIONED in the text. Common examples to recognize if present: SQL, PostgreSQL, Oracle, MySQL, Linux, Windows, Python, Shell scripting, APIs, Microservices, Kafka, Spring, Java, Devops, CCNA, CSS, Hibernate, HTML, JavaScript, React JS, Restful, Spring Boot, Spring Framework, J2EE, Rabbit MQ, Reactive programming, JBPM, Cassandra DB, Postgres DB, Oracle DB, Network Security, Internet protocols, Cisco/Juniper, CCNA — but ONLY include ones that actually appear in the JD text, do not add ones from this list that aren't mentioned."],
  "monitoring_tools": ["Tools actually mentioned, e.g.: Splunk, Dynatrace, AppDynamics, Datadog, Prometheus, Grafana, ELK — only if present in the text"],
  "cloud_platforms": ["Platforms actually mentioned, e.g.: AWS, Azure, GCP — only if present in the text"],
  "soft_skills": ["Soft skills actually mentioned, e.g.: Communication, Problem solving, Stakeholder management, Leadership, Teamwork — only if present in the text"],
  "responsibilities": ["Core responsibilities actually described in the text, e.g.: Incident management, RCA, Monitoring, Troubleshooting, Deployment support, Batch job support, Release activities, Data fixes, Configuration changes, On-call rotations"],
  "tools": ["Tools actually mentioned in the text, e.g.: Jira, ServiceNow, Remedy, Control-M, Autosys, Rally, TFS, Docker, Kubernetes, Nginx, Tomcat, Git"],
  "metrics": ["Service metrics actually mentioned in the text, e.g.: SLA adherence, MTTR, Incident resolution rate"]
}

Job Description Text (this is the ONLY source of truth — extract from this text only):
-------------------------------------------
${rawText}
-------------------------------------------
Return ONLY the raw JSON object, with no markdown formatting.
`;

    const textResponse = await generateAIText(prompt);
    const cleaned = textResponse.replace(/```json/gi, '').replace(/```/g, '').trim();
    const parsedJson = JSON.parse(cleaned);
    console.log('[AI] AI-grounded structured extraction completed successfully!');
    return parsedJson;
  } catch (err: any) {
    console.error('[AI] AI extraction failed, using deterministic regex fallback:', err.message);
    return runMockFallback(rawText, filename);
  }
};

/**
 * Regex and keyword scanning to extract features dynamically from JD raw text
 */
const runMockFallback = (text: string, filename?: string): any => {
  const lowercaseText = text.toLowerCase();

  console.log('[AI] Running dynamic keyword scanning fallback parser.');
  
  // Extract Job Title
  let job_title = 'Software Engineer';
  const titleMatch = text.match(/(Job Title|Title|Designation)\s*:\s*([^\r\n]+)/i);
  if (titleMatch) {
    job_title = titleMatch[2].trim();
  } else {
    const firstLine = text.split('\n')[0].trim();
    if (firstLine && firstLine.length < 60) {
      job_title = firstLine.replace(/^(Job Title|Title|Position|Role)\s*:\s*/i, '');
    }
  }

  // Extract Experience
  let experience = '3+ years';
  const expMatch = text.match(/(\d+\s*(?:-|to|\+|–|—)?\s*\d*)\s*(years|yrs|year|yr)/i);
  if (expMatch) {
    experience = expMatch[0].trim();
  }

  // Support level
  let support_level: string | null = null;
  if (lowercaseText.includes('l1') && lowercaseText.includes('l2')) support_level = 'L1/L2';
  else if (lowercaseText.includes('l3')) support_level = 'L3';
  else if (lowercaseText.includes('l2')) support_level = 'L2';
  else if (lowercaseText.includes('l1')) support_level = 'L1';

  const keywords: { [key: string]: string[] } = {
    skills: ['sql', 'postgresql', 'oracle', 'mysql', 'linux', 'windows', 'unix', 'python', 'shell scripting', 'apis', 'microservices', 'kafka', 'java', 'springboot', 'javascript', 'html', 'css', 'react', 'angular', 'hibernate', 'spring boot'],
    monitoring_tools: ['splunk', 'dynatrace', 'appdynamics', 'datadog', 'prometheus', 'grafana', 'elk'],
    cloud_platforms: ['aws', 'azure', 'gcp', 'gds'],
    soft_skills: ['communication', 'problem solving', 'stakeholder management', 'teamwork', 'leadership'],
    responsibilities: ['incident management', 'rca', 'root cause analysis', 'monitoring', 'troubleshooting', 'deployment support', 'batch job support', 'on-call rotations', 'release activities'],
    tools: ['jira', 'servicenow', 'remedy', 'control-m', 'autosys', 'docker', 'kubernetes', 'nginx', 'tomcat', 'git'],
    metrics: ['sla adherence', 'mttr', 'incident resolution rate', 'sla']
  };

  const extracted: any = {
    job_title,
    department: 'Technical',
    experience,
    support_level,
    employment_type: lowercaseText.includes('contract') ? 'Contract' : 'Full Time',
    shift_timing: lowercaseText.includes('rotational') ? 'Rotational' : lowercaseText.includes('24x7') ? '24x7' : 'Day Shift',
    skills: [] as string[],
    monitoring_tools: [] as string[],
    cloud_platforms: [] as string[],
    soft_skills: [] as string[],
    responsibilities: [] as string[],
    tools: [] as string[],
    metrics: [] as string[]
  };

  for (const [category, words] of Object.entries(keywords)) {
    for (const word of words) {
      const regex = new RegExp(`\\b${word}\\b`, 'i');
      if (regex.test(lowercaseText)) {
        const cleanName = word
          .split(' ')
          .map(w => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ')
          .replace('Sql', 'SQL')
          .replace('Apis', 'APIs')
          .replace('Rca', 'RCA')
          .replace('Mttr', 'MTTR')
          .replace('Sla', 'SLA')
          .replace('Gcp', 'GCP')
          .replace('Aws', 'AWS')
          .replace('Postgresql', 'PostgreSQL')
          .replace('Servicenow', 'ServiceNow');
        
        extracted[category].push(cleanName);
      }
    }
  }

  return extracted;
};
export { runMockFallback };
