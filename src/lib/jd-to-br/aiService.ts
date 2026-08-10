import { OpenAI } from 'openai';

// Predefined mock datasets for sample workspace documents
const MOCK_L1_L2_JD = {
  job_title: "L1/L2 Application Support Engineer",
  department: "Technical",
  experience: "2-5 years",
  support_level: "L1/L2",
  employment_type: "Full Time",
  shift_timing: "Rotational / 24x7",
  skills: ["SQL", "Linux", "Windows", "Shell scripting", "APIs"],
  monitoring_tools: ["Splunk", "Datadog"],
  cloud_platforms: ["AWS"],
  soft_skills: ["Communication", "Problem solving", "Teamwork"],
  responsibilities: ["Incident management", "Troubleshooting", "Monitoring", "RCA", "Ticketing support"],
  tools: ["ServiceNow", "Jira"],
  metrics: ["SLA adherence", "MTTR"]
};

const MOCK_L2_PRODUCTION_JD = {
  job_title: "L2 Production Support Engineer",
  department: "Technical",
  experience: "3-6 years",
  support_level: "L2",
  employment_type: "Full Time",
  shift_timing: "Rotational",
  skills: ["SQL", "Linux", "Unix", "Shell scripting", "API Testing", "Python"],
  monitoring_tools: ["Splunk", "Datadog", "AppDynamics"],
  cloud_platforms: ["AWS", "Azure"],
  soft_skills: ["Stakeholder management", "Communication", "Problem solving"],
  responsibilities: ["Incident management", "RCA", "Troubleshooting", "Production deployment support", "Batch job support"],
  tools: ["Jira", "ServiceNow", "Autosys"],
  metrics: ["SLA adherence", "MTTR", "Incident resolution rate"]
};

/**
 * Extracts structured JD details from raw text
 * @param rawText - The document raw text
 * @returns Structured JSON object
 */
export const extractJdDetails = async (rawText: string, filename?: string): Promise<any> => {
  const apiKey = process.env.OPENAI_API_KEY;
  const isMockKey = !apiKey || apiKey.includes('your-openai') || apiKey === 'mock-key-value-for-startup';

  if (isMockKey) {
    console.log('[AI] OpenAI API key is missing or placeholder. Running Mock Fallback parsing.');
    return runMockFallback(rawText, filename);
  }

  try {
    const openai = new OpenAI({ apiKey });
    
    console.log('[AI] Calling OpenAI API for JD structured extraction...');
    const prompt = `
You are an expert HR Recruiting and AI Parsing system. Analyze the following Job Description text and extract structured information.

Provide your response in EXACT JSON format. Map and normalize skills. Detect duplicates. Do not include any markdown backticks (\`\`\`) or "json" prefix. The response must be a single, clean JSON object matching the schema below:

{
  "job_title": "Clean, official job title (e.g. L2 Production Support Engineer)",
  "department": "Department type if mentioned, e.g. Technical, Delivery (default to 'Technical')",
  "experience": "Experience range, e.g., 2-5 years",
  "support_level": "Identify Support Level: L1, L2, L3, L1/L2, etc. (default if not found: null)",
  "employment_type": "e.g., Full Time, Contract, Onsite, Hybrid",
  "shift_timing": "e.g., 24x7, Rotational, Day Shift, Irving TX Onsite",
  "skills": ["Array of technical skills. Look for SQL, PostgreSQL, Oracle, MySQL, Linux, Windows, Python, Shell scripting, APIs, Microservices, Kafka, Spring, Java, Devops, CCNA, CSS, Hibernate, HTML, JavaScript, React JS, Restful, Spring Boot, Spring Framework, Spring boot microservice, J2EE, Spring boot microservice, Kafka, Rabbit MQ, Reactive programming, JBPM, Cassandra DB, Postgress DB, Oracle DB, Network Security, Internet protocols, Junipe/Cisco, Cisco Certified Network Associate (CCNA) etc."],
  "monitoring_tools": ["Array of tools like: Splunk, Dynatrace, AppDynamics, Datadog, Prometheus, Grafana, ELK"],
  "cloud_platforms": ["Array of platforms like: AWS, Azure, GCP"],
  "soft_skills": ["Array of soft skills like: Communication, Problem solving, Stakeholder management, Leadership, Teamwork"],
  "responsibilities": ["Array of core responsibilities like: Incident management, RCA, Monitoring, Troubleshooting, Deployment support, Batch job support, Release activities, Data fixes, Configuration changes, On-call rotations"],
  "tools": ["Array of tools like: Jira, ServiceNow, Remedy, Control-M, Autosys, Atlassian JIRA, Rally, TFS, Version One, Docker, Kubernetes, Nginx, Tomcat, Git"],
  "metrics": ["Array of service metrics like: SLA adherence, MTTR, Incident resolution rate, Incident resolution"]
}

Normalize extracted items to standard capitalizations.

Job Description Text:
-------------------------------------------
${rawText}
-------------------------------------------
`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a precise HR parsing model returning structured JSON only.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
      response_format: { type: "json_object" }
    });

    const parsedJson = JSON.parse(response.choices[0].message.content || '{}');
    console.log('[AI] OpenAI structured extraction completed successfully!');
    return parsedJson;
  } catch (err: any) {
    console.error('[AI] OpenAI API extraction failed, using regex fallback:', err.message);
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

  // Ensure default lists if empty
  if (extracted.skills.length === 0) extracted.skills = ['SQL', 'Unix'];
  if (extracted.soft_skills.length === 0) extracted.soft_skills = ['Communication', 'Problem solving'];
  if (extracted.responsibilities.length === 0) extracted.responsibilities = ['Troubleshooting', 'Monitoring'];
  if (extracted.tools.length === 0) extracted.tools = ['Jira', 'ServiceNow'];
  if (extracted.metrics.length === 0) extracted.metrics = ['SLA adherence'];

  return extracted;
};
export { runMockFallback };
