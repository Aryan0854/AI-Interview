import { supabase } from '@/lib/db';
import { resumeService } from '@/services/resume-service';
import { geminiEngine } from '@/lib/gemini-ai';
import { join } from 'path';
import { readFile } from 'fs/promises';
import { interviewCSVService } from '@/services/interview-csv-service';

const getUploadsRoot = () => {
  return process.env.VERCEL === "1" ? "/tmp" : join(process.cwd(), "uploads");
};

const getJdsJsonPath = () => {
  return join(getUploadsRoot(), "job_descriptions.json");
};

const getJdPath = () => {
  return join(getUploadsRoot(), "job_description.txt");
};

async function getJobDescriptionText(jdId?: string): Promise<string> {
  // 1. Try to find by ID in Supabase Database
  if (jdId) {
    try {
      const { data: dbJd, error: dbError } = await supabase
        .from('job_descriptions')
        .select('jd_text')
        .eq('id', jdId)
        .single();
      if (!dbError && dbJd?.jd_text) {
        return dbJd.jd_text;
      }
    } catch (dbErr) {
      console.error("Error fetching JD from Supabase in InterviewService:", dbErr);
    }
  }

  // 2. Fallback to local job_descriptions.json search
  if (jdId) {
    try {
      const jsonPath = getJdsJsonPath();
      const raw = await readFile(jsonPath, "utf8");
      const jds = JSON.parse(raw);
      const matched = jds.find((j: any) => j.id === jdId);
      if (matched && matched.jdText) {
        return matched.jdText;
      }
    } catch (err: any) {
      if (err.code !== "ENOENT") {
        console.error("Error reading job_descriptions.json:", err);
      }
    }
  }

  // 3. Fallback to job_description.txt
  try {
    const txtPath = getJdPath();
    const txt = await readFile(txtPath, "utf8");
    if (txt && txt.trim()) {
      return txt.trim();
    }
  } catch (err: any) {
    if (err.code !== "ENOENT") {
      console.error("Error reading job_description.txt:", err);
    }
  }

  // 4. Fallback to any JD from the local JSON list
  try {
    const jsonPath = getJdsJsonPath();
    const raw = await readFile(jsonPath, "utf8");
    const jds = JSON.parse(raw);
    if (jds && jds.length > 0) {
      return jds[0].jdText || "";
    }
  } catch (err) {}

  return "";
}

function isDefaultTemplateOrEmpty(answer: string): boolean {
  const normalized = answer.replace(/\s+/g, '').toLowerCase();
  
  // Define normalized templates
  const normalizedTemplates = [
    // Javascript
    "//javascriptcodetemplatefunctionsolution(){//writeyourcodeherereturn;}".replace(/\s+/g, '').toLowerCase(),
    "functionsolution(){//writeyourcodeherereturn;}".replace(/\s+/g, '').toLowerCase(),
    // Typescript
    "//typescriptcodetemplatefunctionsolution():void{//writeyourcodeherereturn;}".replace(/\s+/g, '').toLowerCase(),
    "functionsolution():void{//writeyourcodeherereturn;}".replace(/\s+/g, '').toLowerCase(),
    // Python
    "#pythoncodetemplatedefsolution():#writeyourcodeherepass".replace(/\s+/g, '').toLowerCase(),
    "defsolution():#writeyourcodeherepass".replace(/\s+/g, '').toLowerCase(),
    "defsolution():pass".replace(/\s+/g, '').toLowerCase(),
    // C++
    "//c++codetemplate#include<iostream>usingnamespacestd;voidsolution(){//writeyourcodehere}".replace(/\s+/g, '').toLowerCase(),
    "voidsolution(){//writeyourcodehere}".replace(/\s+/g, '').toLowerCase(),
    // Java
    "//javacodetemplatepublicclasssolution{publicstaticsoidsolution(){//writeyourcodehere}}".replace(/\s+/g, '').toLowerCase(),
    "publicclasssolution{publicstaticsoidsolution(){//writeyourcodehere}}".replace(/\s+/g, '').toLowerCase(),
    "publicclasssolution{publicstaticsoidmain(string[]args){}}".replace(/\s+/g, '').toLowerCase()
  ];
  
  if (normalizedTemplates.includes(normalized)) {
    return true;
  }
  
  // Strip all comments (both // and /* */ and # comments) and check if anything substantial remains
  const cleanCode = answer
    .replace(/\/\*[\s\S]*?\*\//g, "") // remove block comments
    .replace(/\/\/.*/g, "")          // remove single line // comments
    .replace(/#.*/g, "")            // remove single line # comments
    .replace(/\s+/g, "");           // remove whitespace
    
  // Substantial code should be more than just standard boilerplate structures
  const boilerplates = [
    "functionsolution(){return;}",
    "functionsolution():void{return;}",
    "defsolution():pass",
    "defsolution():",
    "voidsolution(){}",
    "publicclasssolution{publicstaticsoidsolution(){}}"
  ];
  
  if (cleanCode.length === 0 || boilerplates.includes(cleanCode)) {
    return true;
  }
  
  return false;
}

function isWrongLanguageForCoding(question: string, answer: string): boolean {
  const qLower = question.toLowerCase();
  const aLower = answer.toLowerCase();
  
  // If javascript/typescript is requested but code contains python patterns
  if (qLower.includes("javascript") || qLower.includes("typescript")) {
    const hasPythonDef = /def\s+\w+\s*\(/.test(answer);
    const hasPythonComments = /#\s*(python|code|template)/i.test(answer);
    if (hasPythonDef || hasPythonComments) {
      return true;
    }
  }
  
  // If python is requested but code contains javascript/typescript patterns
  if (qLower.includes("python")) {
    const hasJsFunction = /function\s+\w+\s*\(/.test(answer);
    const hasJsComments = /\/\/\s*(javascript|typescript|code|template)/i.test(answer);
    if (hasJsFunction || hasJsComments) {
      return true;
    }
  }
  
  return false;
}

function getHeuristicEvaluation(questionIndex: number, question: string, answer: string): { score: number; feedback: string } | null {
  const trimmed = answer.trim();
  const isCoding = question.startsWith("Coding Challenge:");
  
  // 1. Check for completely empty response
  if (trimmed === "" || trimmed === "-") {
    return {
      score: 0,
      feedback: isCoding 
        ? "No code solution was provided." 
        : "No response was provided."
    };
  }

  // 2. Normalize for low effort check
  const normalizedText = trimmed.toLowerCase().replace(/[']/g, "").replace(/[^a-z0-9]/g, "");
  const normalizedQuestion = question.toLowerCase().replace(/[^a-z0-9]/g, "");

  // 3. Check if verbal answer is repeating the question / instructions
  if (!isCoding && normalizedQuestion.includes(normalizedText) && normalizedText.length > 10) {
    return {
      score: 1,
      feedback: "Answer is invalid as it only repeats the question or prompt instructions."
    };
  }

  // 4. Check for low quality / skip phrases
  const lowQualityPhrases = ["dontknow", "idontknow", "noidea", "notsure", "na", "none", "nothing", "skip", "skype"];
  if (!isCoding) {
    const wordCount = trimmed.split(/\s+/).filter(w => w.length > 0).length;
    if (lowQualityPhrases.includes(normalizedText) || wordCount <= 2) {
      return {
        score: 1,
        feedback: `Answer is too brief, off-topic, or indicates a lack of response ("${trimmed}").`
      };
    }
  }

  // 5. For coding challenges:
  if (isCoding) {
    // Check template or boilerplate
    if (isDefaultTemplateOrEmpty(answer)) {
      return {
        score: 1,
        feedback: "Code solution was not attempted; only the default template boilerplate was submitted."
      };
    }
    
    // Check wrong language
    if (isWrongLanguageForCoding(question, answer)) {
      return {
        score: 1,
        feedback: "The template/code for the wrong programming language was submitted, and no solution was provided in the requested language."
      };
    }

    // Check extremely short code (e.g. less than 15 chars)
    if (trimmed.length < 15) {
      return {
        score: 1,
        feedback: "Code solution is too brief or incomplete to be evaluated."
      };
    }
  }

  return null;
}

export class InterviewService {
  private static instance: InterviewService;

  static getInstance(): InterviewService {
    if (!InterviewService.instance) {
      InterviewService.instance = new InterviewService();
    }
    return InterviewService.instance;
  }

  async getQuestions(resumeId: string): Promise<string[]> {
    // Check if questions already exist for this resume
    const { data: existing, error } = await supabase
      .from('interview_questions')
      .select('question_text')
      .eq('resume_id', resumeId)
      .order('question_index', { ascending: true });

    const resume = await resumeService.getCachedResume(resumeId);
    const hasConfig = !!resume?.report?.interviewConfig;

    if (existing && existing.length > 0) {
      const questionsList = existing.map(row => row.question_text);
      if (!hasConfig && questionsList.length < 17) {
        // Upgrade legacy questions sets to 17 questions (15 verbal + 2 coding)
        const diff = 17 - questionsList.length;
        const fallbackCoding1 = `Coding Challenge: Write a function in JavaScript to check if a string is a palindrome. The function should ignore case and non-alphanumeric characters. Include examples and edge case handling.`;
        const fallbackCoding2 = `Coding Challenge: Write a function in JavaScript that takes an array of integers and a target sum, and returns an array of indices of the two numbers that add up to the target sum (Two Sum problem).`;
        
        const extraQuestions = [fallbackCoding1, fallbackCoding2].slice(2 - diff);
        const upgradedQuestions = [...questionsList, ...extraQuestions];
        
        const insertData = extraQuestions.map((q, idx) => ({
          resume_id: resumeId,
          question_index: questionsList.length + idx,
          question_text: q
        }));
        
        await supabase.from('interview_questions').insert(insertData);
        return upgradedQuestions;
      }
      return questionsList;
    }

    // Generate new questions
    return this.generateQuestions(resumeId);
  }

  private async generateQuestions(resumeId: string): Promise<string[]> {
    const resume = await resumeService.getCachedResume(resumeId);
    if (!resume) {
      throw new Error("Resume not found");
    }

    const config = resume.report?.interviewConfig || {
      interviewType: 'technical',
      sections: {
        overlapping: 8,
        gap: 3,
        projects: 4,
        coding: 2
      }
    };

    const interviewType = config.interviewType || "technical";
    const includeTech = interviewType === "technical" || interviewType === "both";
    const includeNonTech = interviewType === "non-technical" || interviewType === "both";
    const jdText = await getJobDescriptionText(resume.report?.jdId);

    let questions: string[] = [];

    const mapQuestionObjects = (raw: any[]): string[] =>
      raw.map((qObj: any) => {
        if (typeof qObj === "string") return qObj;
        if (qObj && typeof qObj === "object" && typeof qObj.question === "string") {
          return qObj.question;
        }
        throw new Error("Invalid question object format");
      });

    // Use Gemini if available
    try {
      if (includeTech) {
        const sections = config.sections || { overlapping: 8, gap: 3, projects: 4, coding: 2 };
        const overlappingCount = sections.overlapping !== undefined ? Number(sections.overlapping) : 8;
        const gapCount = sections.gap !== undefined ? Number(sections.gap) : 3;
        const projectsCount = sections.projects !== undefined ? Number(sections.projects) : 4;
        const codingCount = sections.coding !== undefined ? Number(sections.coding) : 2;
        const totalVerbalCount = overlappingCount + gapCount + projectsCount;

        const verbalPrompt = `
        You are an elite technical interviewer. Your goal is to generate ${totalVerbalCount} highly specific, exclusively technical verbal interview questions tailored to the candidate's CV/Resume and the provided Job Description (JD).

        Job Description (JD):
        ${jdText || "No JD specified. Generate questions focusing on candidate's primary skills and experience."}

        Resume Profile (CV):
        ${JSON.stringify(resume.parsed, null, 2)}
        
        Target Roles:
        ${JSON.stringify(resume.report?.targetRoles || [])}

        CRITICAL QUESTION GENERATION RULES:
        1. EXPERIENCE-LEVEL ALIGNMENT:
           - Carefully analyze the JD and CV to identify the seniority level (e.g. Intern, Graduate, Junior/L1, Mid-Level/L2, Senior/L3+, Lead, Manager).
           - Adjust question complexity, technical depth, and scenarios accordingly. Do NOT ask high-level architecture or management strategy questions to a junior/intern, and do NOT ask simple trivia or basic syntax questions to a senior/lead.

        2. DISTRIBUTION RULES (MUST EQUAL EXACTLY ${totalVerbalCount} QUESTIONS):
           - Overlapping Competencies (JD+CV Match): Generate ${overlappingCount} questions focused on technologies, tools, and practices found in both the candidate's CV and the JD.
           - JD-Specific / Gap Assessment (JD Skill): Generate ${gapCount} questions focusing on key requirements in the JD that are NOT explicitly mentioned in the candidate's CV. Frame these as gap-assessment or transferability questions.
           - CV-Specific Projects/Experience (CV Skill): Generate ${projectsCount} questions exploring technical details and optimization of projects listed in the CV.

        3. SIMULATION STYLE (SCENARIOS & PROBLEM-SOLVING):
           - Avoid generic definition/trivia questions (e.g., "What is React state?").
           - Focus on scenarios, system design tailored to their level, real-world troubleshooting, code optimization, and engineering trade-offs (e.g., "In your React project, how did you handle X issue when Y occurred?").

        4. OUTPUT FORMAT:
           - Return ONLY a JSON array of exactly ${totalVerbalCount} objects.
           - Do not include any explanation or commentary.
           - Follow this JSON schema exactly:
           [
             {
               "question": "The question string",
               "difficulty": "Easy" | "Medium" | "Hard",
               "source": "JD+CV Match" | "JD Skill" | "CV Skill",
               "skill": "React Hooks / SQL Indexing / Docker CI",
               "expectedPoints": [
                 "Expected key technical point 1 that the candidate should mention in a strong answer",
                 "Expected key technical point 2..."
               ]
             }
           ]
         `;

        const rawVerbal = await geminiEngine.generateText(verbalPrompt);
        if (!Array.isArray(rawVerbal) || rawVerbal.length !== totalVerbalCount) {
          throw new Error(`Invalid format: expected ${totalVerbalCount} questions in verbal array`);
        }

        let rawCoding: any[] = [];
        if (codingCount > 0) {
          const codingPrompt = `
          You are an elite technical interviewer. Your goal is to generate ${codingCount} hands-on, practical coding challenges tailored to the candidate's CV/Resume and the provided Job Description (JD).

          Job Description (JD):
          ${jdText || "No JD specified. Generate coding challenges focusing on candidate's primary programming language."}

          Resume Profile (CV):
          ${JSON.stringify(resume.parsed, null, 2)}

          CRITICAL CODING CHALLENGE RULES:
          1. EXPERIENCE-LEVEL ALIGNMENT:
             - Carefully analyze the JD and CV to identify the seniority level.
             - Make sure the coding challenges strictly align with the candidate's seniority level.
             - The challenges MUST be actual programming tasks (e.g., "Write a function that...") that require writing code to solve a specific problem. Do NOT ask conceptual, theoretical, system design, or verbal questions.

          2. PROGRAMMING LANGUAGE:
             - Infer the candidate's primary language from the JD/CV.
             - Supported IDE languages: JavaScript, TypeScript, Python, C++, Java.
             - Prefer TypeScript when the CV/JD emphasizes TypeScript / Angular / NestJS / typed frontend work.
             - Prefer JavaScript when the CV/JD emphasizes JavaScript / Node / React without TypeScript.
             - Explicitly name the target language in the challenge text (e.g. "Write a function in TypeScript..." or "Write a function in JavaScript...").
             - Use a starter signature matching that language (TypeScript: \`function solution(): void { ... }\`, JavaScript: \`function solution() { ... }\`, Python: \`def solution():\`, etc.).

          3. STRUCTURED PROBLEM STATEMENT:
             - The question text MUST contain:
               - A clear description of the problem.
               - The expected input and output.
               - Constraints (e.g., time complexity, memory, input size).
               - At least 2 examples with inputs and expected outputs.
               - A starter function signature matching the named language.
             - The question text MUST start with 'Coding Challenge: '.

          4. OUTPUT FORMAT:
             - Return ONLY a JSON array of exactly ${codingCount} objects.
             - Do not include any explanation or commentary.
             - Follow this JSON schema exactly:
             [
               {
                 "question": "Coding Challenge: The detailed problem description with named language, signature, inputs/outputs, constraints, and examples",
                 "difficulty": "Easy" | "Medium" | "Hard",
                 "source": "JD+CV Match",
                 "skill": "Algorithms / Data Structures / Coding",
                 "expectedPoints": [
                   "Expected solution logic, optimization, or edge case handling"
                 ]
               }
             ]
           `;

          rawCoding = await geminiEngine.generateText(codingPrompt);
          if (!Array.isArray(rawCoding) || rawCoding.length !== codingCount) {
            throw new Error(`Invalid format: expected ${codingCount} challenges in coding array`);
          }
        }

        questions.push(...mapQuestionObjects([...rawVerbal, ...rawCoding]));
      }

      if (includeNonTech) {
        const sections = config.sections || { behavioral: 5, leadership: 5, softskills: 5 };
        const behavioralCount = sections.behavioral !== undefined ? Number(sections.behavioral) : 5;
        const leadershipCount = sections.leadership !== undefined ? Number(sections.leadership) : 5;
        const softskillsCount = sections.softskills !== undefined ? Number(sections.softskills) : 5;
        const totalNonTechCount = behavioralCount + leadershipCount + softskillsCount;

        const nonTechPrompt = `
        You are an elite HR interviewer. Your goal is to generate ${totalNonTechCount} highly professional non-technical verbal interview questions tailored to the candidate's CV/Resume and the provided Job Description (JD).

        Job Description (JD):
        ${jdText || "No JD specified."}

        Resume Profile (CV):
        ${JSON.stringify(resume.parsed, null, 2)}

        CRITICAL QUESTION GENERATION RULES:
        1. EXPERIENCE-LEVEL ALIGNMENT:
           - Adjust question scenarios and expectations to candidate seniority (e.g., leadership and strategy for seniors, adaptability and teamwork for juniors).

        2. DISTRIBUTION RULES (MUST EQUAL EXACTLY ${totalNonTechCount} QUESTIONS):
           - Behavioral Competencies: Generate ${behavioralCount} questions focused on past behavior, conflict resolution, working under pressure, and lessons learned.
           - Leadership & Collaboration: Generate ${leadershipCount} questions focusing on leading initiatives, teamwork, mentoring, and cross-functional communication.
           - Problem Solving & Soft Skills: Generate ${softskillsCount} questions assessing soft skills, critical thinking, adaptability, and client/stakeholder communication.

        3. SIMULATION STYLE (SCENARIOS & BEHAVIORAL):
           - Frame questions as behavioral/situational prompts (e.g., "Tell me about a time when...", "How would you handle a situation where...").

        4. OUTPUT FORMAT:
           - Return ONLY a JSON array of exactly ${totalNonTechCount} objects.
           - Do not include any explanation or commentary.
           - Follow this JSON schema exactly:
           [
             {
               "question": "The question string",
               "difficulty": "Easy" | "Medium" | "Hard",
               "source": "Behavioral" | "Leadership" | "Soft Skills",
               "skill": "Conflict Resolution / Time Management / Client Communication",
               "expectedPoints": [
                 "Expected key situational/behavioral point 1 that the candidate should mention in a strong answer",
                 "Expected key point 2..."
               ]
             }
           ]
        `;

        const rawNonTech = await geminiEngine.generateText(nonTechPrompt);
        if (!Array.isArray(rawNonTech) || rawNonTech.length !== totalNonTechCount) {
          throw new Error(`Invalid format: expected ${totalNonTechCount} questions in non-technical array`);
        }

        questions.push(...mapQuestionObjects(rawNonTech));
      }

      if (!questions.length) {
        throw new Error("No questions generated for the selected assessment focus.");
      }
    } catch (err) {
      console.warn("Failed to generate questions with AI, falling back to dynamic defaults.", err);
      questions = [];

      if (includeTech) {
        const sections = config.sections || { overlapping: 8, gap: 3, projects: 4, coding: 2 };
        const overlappingCount = sections.overlapping !== undefined ? Number(sections.overlapping) : 8;
        const gapCount = sections.gap !== undefined ? Number(sections.gap) : 3;
        const projectsCount = sections.projects !== undefined ? Number(sections.projects) : 4;
        const codingCount = sections.coding !== undefined ? Number(sections.coding) : 2;

        const cvSkills = resume.parsed?.skills?.technical || [];
        const cvTools = resume.parsed?.skills?.tools || [];
        const cvProjects = resume.parsed?.projects || [];
        const allSkills = [...cvSkills, ...cvTools];
        
        let primarySkill = 'JavaScript';
        let secondarySkill = 'React';
        let tertiarySkill = 'SQL';
        let fallbackProject = 'a recent project';

        if (jdText) {
          const lowerJd = jdText.toLowerCase();
          const overlap = allSkills.filter(skill => lowerJd.includes(skill.toLowerCase()));
          if (overlap.length > 0) primarySkill = overlap[0];
          if (overlap.length > 1) secondarySkill = overlap[1];
          if (overlap.length > 2) tertiarySkill = overlap[2];
        } else {
          if (allSkills.length > 0) primarySkill = allSkills[0];
          if (allSkills.length > 1) secondarySkill = allSkills[1];
          if (allSkills.length > 2) tertiarySkill = allSkills[2];
        }

        if (cvProjects.length > 0) {
          fallbackProject = cvProjects[0].name || fallbackProject;
        }

        const defaultVerbalList = [
          `Can you explain a challenging scenario you faced while working on ${fallbackProject}?`,
          `How does ${primarySkill} handle memory management and concurrency in production environments?`,
          `What are the most common performance bottlenecks you've encountered with ${primarySkill} and how did you resolve them?`,
          `Describe a time you had to optimize a slow database query or search process. What was the underlying issue?`,
          `How do you ensure the code quality, unit testing, and scalability of the features you write?`,
          `Can you explain the architecture of a complex system you built or contributed to using ${secondarySkill}?`,
          `How would you design a scalable microservices architecture or component structure using ${secondarySkill} for a high-traffic app?`,
          `Explain the concept of CI/CD and how you've implemented or interacted with it for ${primarySkill} deployments.`,
          `What design patterns do you most frequently use in ${primarySkill} and why?`,
          `How do you approach debugging a critical production issue where logging is minimal or absent?`,
          `Explain how you handle global or local state management and consistency in a large application using ${secondarySkill}.`,
          `What security vulnerabilities do you proactively look for when writing or reviewing code in ${primarySkill}?`,
          `Describe how you would approach migrating a legacy feature or application using ${tertiarySkill} to a modern stack.`,
          `Describe your approach to containerizing an application using Docker. What are the benefits of multi-stage builds?`,
          `How do you handle secrets management and environment configurations securely in a cloud deployment?`
        ];

        const totalVerbalNeeded = overlappingCount + gapCount + projectsCount;
        for (let i = 0; i < totalVerbalNeeded; i++) {
          questions.push(defaultVerbalList[i % defaultVerbalList.length]);
        }

        const codingChallengesList = [
          `Coding Challenge: Write a function in JavaScript to check if a string is a palindrome. The function should ignore case and non-alphanumeric characters. Include examples and edge case handling.`,
          `Coding Challenge: Write a function in JavaScript that takes an array of integers and a target sum, and returns an array of indices of the two numbers that add up to the target sum (Two Sum problem).`
        ];

        for (let i = 0; i < codingCount; i++) {
          questions.push(codingChallengesList[i % codingChallengesList.length]);
        }
      }

      if (includeNonTech) {
        const sections = config.sections || { behavioral: 5, leadership: 5, softskills: 5 };
        const behavioralCount = sections.behavioral !== undefined ? Number(sections.behavioral) : 5;
        const leadershipCount = sections.leadership !== undefined ? Number(sections.leadership) : 5;
        const softskillsCount = sections.softskills !== undefined ? Number(sections.softskills) : 5;

        const defaultBehavioralList = [
          `Describe a time when you had to work with a difficult team member or client. How did you resolve the situation?`,
          `Explain a time when you made a mistake on a project. How did you address it and what did you learn?`,
          `Describe a situation where you had to quickly adapt to a major change at work (e.g., new tool, team restructure).`,
          `How do you prioritize your tasks when handling multiple deadlines or high-pressure projects?`,
          `What motivates you in your professional career, and how do you align it with company goals?`
        ];

        const defaultLeadershipList = [
          `Can you share an experience where you led a project or initiative? What was the outcome?`,
          `How do you handle constructive feedback or disagreement with a supervisor's decision?`,
          `Describe a time when you went above and beyond your standard job responsibilities to deliver a project.`,
          `How do you mentor junior team members or share knowledge across your team?`,
          `Describe a time you had to persuade stakeholders to adopt your proposed design or plan.`
        ];

        const defaultSoftSkillsList = [
          `Describe a time you solved a complex problem. What steps did you take to find the solution?`,
          `How do you explain technical or complex concepts to non-technical stakeholders or team members?`,
          `How do you handle ambiguous requirements when starting a new task or project?`,
          `Describe how you build trust and maintain strong relationships with your cross-functional partners.`,
          `What strategies do you use to manage your time and avoid burnout during busy quarters?`
        ];

        for (let i = 0; i < behavioralCount; i++) {
          questions.push(defaultBehavioralList[i % defaultBehavioralList.length]);
        }
        for (let i = 0; i < leadershipCount; i++) {
          questions.push(defaultLeadershipList[i % defaultLeadershipList.length]);
        }
        for (let i = 0; i < softskillsCount; i++) {
          questions.push(defaultSoftSkillsList[i % defaultSoftSkillsList.length]);
        }
      }
    }

    // Save generated questions to DB
    const insertData = questions.map((q, i) => ({
      resume_id: resumeId,
      question_index: i,
      question_text: q
    }));
    const { error } = await supabase.from('interview_questions').insert(insertData);
    if (error) console.error("Error inserting questions:", error);

    return questions;
  }

  async evaluateAnswer(resumeId: string, questionIndex: number, question: string, answer: string): Promise<void> {
    let score = 5;
    let feedback = "Answer recorded.";

    // Run strict heuristic pre-checks
    const heuristic = getHeuristicEvaluation(questionIndex, question, answer);
    if (heuristic) {
      score = heuristic.score;
      feedback = heuristic.feedback;
    } else {
      try {
        const resume = await resumeService.getCachedResume(resumeId);
        const jdText = resume ? await getJobDescriptionText(resume.report?.jdId) : "";

        const isCoding = question.startsWith("Coding Challenge:");

        const prompt = isCoding ? `
        You are an elite technical interviewer and expert code reviewer.
        Evaluate the candidate's code submission for a practical coding challenge during an assessment.
        
        Context details to align expectations:
        - Job Description (JD):
        ${jdText || "Not specified."}
        
        - Candidate's CV / Experience Level:
        ${resume ? JSON.stringify(resume.parsed, null, 2) : "Not specified."}
        
        Coding Challenge Asked: "${question}"
        Candidate's Submitted Code Solution:
        \`\`\`
        ${answer}
        \`\`\`

        EVALUATION INSTRUCTIONS:
        1. Rate the code solution on a scale from 1 to 10. Be extremely critical.
        2. Assign a score of 0 or 1 for empty code, default template boilerplates, code in the wrong language (e.g. Python code for a JavaScript challenge), or code that only contains comments/stubs.
        3. Grade expectations based on the candidate's seniority / experience level (e.g. expect clean code, optimization, time/space complexity analysis, and edge cases from senior candidates; focus on logic correctness and syntax from juniors).
        4. Review code correctness, logical correctness, efficiency (Big O time/space complexity), and formatting.
        5. Provide detailed constructive feedback (1-2 sentences) outlining what the candidate did well, any bug/edge-case gaps, and how the code could be optimized.
        
        Return ONLY a JSON object:
        {
          "score": 8,
          "feedback": "Detailed constructive feedback on code correctness and quality..."
        }
        ` : `
        You are an elite technical interviewer evaluating a candidate's verbal response during an interview assessment.
        
        Context details to align expectations:
        - Job Description (JD):
        ${jdText || "Not specified."}
        
        - Candidate's CV / Professional Experience:
        ${resume ? JSON.stringify(resume.parsed, null, 2) : "Not specified."}
        
        - Target Roles:
        ${resume ? JSON.stringify(resume.report?.targetRoles || []) : "Not specified."}

        Question asked: "${question}"
        Candidate's Answer: "${answer}"

        EVALUATION INSTRUCTIONS:
        1. Rate the candidate's answer on a scale from 1 to 10. Be extremely critical and do not inflate scores.
        2. Assign a score of 0 or 1 for empty answers, one-word/two-word replies (e.g. "Skype", "none", "-"), off-topic replies, or responses that only repeat the question text/instructions.
        3. Align your expectations to the candidate's experience level (e.g. grade expectations differently for Intern vs. Senior).
        4. Verify the technical accuracy, depth, and relevance of the answer.
        5. Provide constructive, concise feedback (1-2 sentences) explaining the score and any key details that were missing or could be improved.
        
        Return ONLY a JSON object:
        {
          "score": 8,
          "feedback": "Concise feedback here..."
        }
        `;
        
        const result = await geminiEngine.generateText(prompt);
        if (result && typeof result.score === 'number' && typeof result.feedback === 'string') {
          score = result.score;
          feedback = result.feedback;
        }
      } catch (err) {
        console.warn("Failed to evaluate answer with AI, using fallback.", err);
        // Fallback heuristics
        if (question.startsWith("Coding Challenge:")) {
          if (answer.trim().length > 100) {
            score = 7;
            feedback = "Code solution submitted. Basic structure and logic appear complete.";
          } else {
            score = 3;
            feedback = "Code solution was too brief or incomplete.";
          }
        } else {
          if (answer.trim().length > 150) {
            score = 8;
            feedback = "Detailed answer provided. Ensure your points remain concise and relevant.";
          } else if (answer.trim().length > 50) {
            score = 6;
            feedback = "Acceptable answer, but could benefit from more specific technical details.";
          } else {
            score = 3;
            feedback = "Answer was too brief. Try to use the STAR method to provide complete examples.";
          }
        }
      }
    }

    const { error: insertError } = await supabase.from('interview_attempts').insert({
      resume_id: resumeId,
      question_index: questionIndex,
      question_text: question,
      candidate_answer: answer,
      mock_score: score,
      mock_feedback: feedback
    });
    if (insertError) {
      console.error("Error inserting attempt:", insertError);
    } else {
      // Auto-sync interview results to CSV
      interviewCSVService.syncAllInterviewsToCSV().catch(err => {
        console.error("Failed to sync interviews to CSV in background:", err);
      });
    }
  }

  private async clearTable(tableName: string): Promise<void> {
    const attempts = [
      () => supabase.from(tableName).delete().neq('id', ''),
      () => supabase.from(tableName).delete().not('id', 'is', null),
      () => supabase.from(tableName).delete(),
    ];

    let lastError: any = null;
    for (const attempt of attempts) {
      const { error } = await attempt();
      if (!error) {
        return;
      }
      lastError = error;
    }

    console.error(`Failed to clear ${tableName}:`, lastError);
    throw new Error(`Failed to clear ${tableName}`);
  }

  async clearAllInterviewData(): Promise<void> {
    await this.clearTable('interview_questions');
    await this.clearTable('interview_attempts');
  }
}

// Next.js Hot Module Replacement singleton protection
const globalForInterviewService = globalThis as unknown as {
  interviewServiceInstance: InterviewService;
};

export const interviewService =
  globalForInterviewService.interviewServiceInstance ||
  InterviewService.getInstance();

if (process.env.NODE_ENV !== "production") {
  globalForInterviewService.interviewServiceInstance = interviewService;
}
