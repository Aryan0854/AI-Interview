import { supabase } from '@/lib/db';
import { resumeService } from '@/services/resume-service';
import { geminiEngine } from '@/lib/gemini-ai';
import { join } from 'path';
import { readFile } from 'fs/promises';
import { interviewCSVService } from '@/services/interview-csv-service';
import { gradeAnswer, synthesizeRubricFromQuestion, type GradingRubric } from '@/lib/answer-grading';
import { checkEmptyGate, detectLanguageMismatch, applyLanguagePenalty, runLocalMockEvaluator, LANGUAGE_MISMATCH_PENALTY } from '@/lib/code-eval-fallback';
import { generateAIText } from '@/lib/ai-providers';

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

/**
 * The coding-answer evaluator (unlike the interactive "Run" simulator) doesn't receive
 * an explicit language field from the client — only the question and the submitted code.
 * This pulls the intended language out of the question text itself, which every
 * generated coding challenge names explicitly (see the coding-challenge prompt in
 * generateQuestions). Defaults to "javascript" (the dynamic-fallback question set's
 * language) when nothing is detected, rather than skipping the syntax gate entirely.
 */
function inferLanguageFromQuestion(question: string): string {
  const lower = question.toLowerCase();
  if (lower.includes("typescript")) return "typescript";
  if (lower.includes("javascript") || lower.includes("js ") || lower.includes("node")) return "javascript";
  if (lower.includes("python")) return "python";
  if (lower.includes("java") && !lower.includes("javascript")) return "java";
  if (lower.includes("c++") || lower.includes("cpp")) return "cpp";
  return "javascript";
}

/**
 * The fully-static (no per-candidate interpolation) fallback question banks used when
 * AI generation fails. Hoisted to module scope so getQuestions() can recognize a cached
 * question set as "this was a fallback batch" purely from its content — which matters
 * for rows already sitting in the database from before generation_source existed, since
 * a schema migration can't retroactively label historical rows.
 *
 * (The tech-track verbal fallback list is NOT included here because it interpolates the
 * candidate's actual skills per-question, so its exact text varies — for that one,
 * generation_source is the only reliable signal, which is fine since it only matters for
 * batches generated after this fix shipped.)
 */
const STATIC_FALLBACK_CODING_QUESTIONS = [
  `Coding Challenge: Write a function in JavaScript to check if a string is a palindrome. The function should ignore case and non-alphanumeric characters. Include examples and edge case handling.`,
  `Coding Challenge: Write a function in JavaScript that takes an array of integers and a target sum, and returns an array of indices of the two numbers that add up to the target sum (Two Sum problem).`
];

const STATIC_FALLBACK_BEHAVIORAL_QUESTIONS = [
  `Describe a time when you had to work with a difficult team member or client. How did you resolve the situation?`,
  `Explain a time when you made a mistake on a project. How did you address it and what did you learn?`,
  `Describe a situation where you had to quickly adapt to a major change at work (e.g., new tool, team restructure).`,
  `How do you prioritize your tasks when handling multiple deadlines or high-pressure projects?`,
  `What motivates you in your professional career, and how do you align it with company goals?`
];

const STATIC_FALLBACK_LEADERSHIP_QUESTIONS = [
  `Can you share an experience where you led a project or initiative? What was the outcome?`,
  `How do you handle constructive feedback or disagreement with a supervisor's decision?`,
  `Describe a time when you went above and beyond your standard job responsibilities to deliver a project.`,
  `How do you mentor junior team members or share knowledge across your team?`,
  `Describe a time you had to persuade stakeholders to adopt your proposed design or plan.`
];

const STATIC_FALLBACK_SOFTSKILLS_QUESTIONS = [
  `Describe a time you solved a complex problem. What steps did you take to find the solution?`,
  `How do you explain technical or complex concepts to non-technical stakeholders or team members?`,
  `How do you handle ambiguous requirements when starting a new task or project?`,
  `Describe how you build trust and maintain strong relationships with your cross-functional partners.`,
  `What strategies do you use to manage your time and avoid burnout during busy quarters?`
];

const KNOWN_STATIC_FALLBACK_QUESTIONS = new Set([
  ...STATIC_FALLBACK_CODING_QUESTIONS,
  ...STATIC_FALLBACK_BEHAVIORAL_QUESTIONS,
  ...STATIC_FALLBACK_LEADERSHIP_QUESTIONS,
  ...STATIC_FALLBACK_SOFTSKILLS_QUESTIONS,
]);

function isKnownStaticFallbackQuestion(text: string): boolean {
  return KNOWN_STATIC_FALLBACK_QUESTIONS.has(text);
}

// Accepts a small model returning slightly more/fewer items than requested instead of
// hard-failing the whole batch — truncates if over, accepts if reasonably close, only
// rejects if the response is empty or far short of what was asked for.
function acceptGenerated(arr: any, requested: number): any[] {
  if (!Array.isArray(arr) || arr.length === 0) throw new Error(`Expected ${requested} items, got none`);
  if (arr.length > requested) return arr.slice(0, requested);
  if (arr.length < Math.ceil(requested * 0.6)) throw new Error(`Expected ~${requested} items, got only ${arr.length}`);
  return arr;
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
    // Check if questions already exist for this resume. generation_source may not exist
    // yet if migration-v5.sql hasn't been applied — retry without it rather than letting
    // the whole query error out (Postgres errors on selecting a genuinely nonexistent
    // column, it doesn't just return null for it).
    let { data: existing, error } = await supabase
      .from('interview_questions')
      .select('question_text, generation_source')
      .eq('resume_id', resumeId)
      .order('question_index', { ascending: true });

    if (error) {
      console.warn("Select with generation_source failed (migration-v5.sql likely not applied), retrying without it:", error.message);
      const retry = await supabase
        .from('interview_questions')
        .select('question_text')
        .eq('resume_id', resumeId)
        .order('question_index', { ascending: true });
      existing = retry.data as any;
      error = retry.error;
    }

    const resume = await resumeService.getCachedResume(resumeId);
    const hasConfig = !!resume?.report?.interviewConfig;

    if (existing && existing.length > 0) {
      // A cached set is treated as a stale fallback batch — worth clearing and retrying
      // — if EITHER: (a) it's tagged generation_source='fallback' (batches generated
      // after this fix shipped), OR (b) every question text in it matches the known
      // static fallback banks by content (catches rows already sitting in the database
      // from before generation_source existed, which a schema migration alone can't
      // retroactively fix).
      const isStaleFallback =
        existing.every((row: any) => row.generation_source === 'fallback') ||
        existing.every((row: any) => isKnownStaticFallbackQuestion(row.question_text));
      if (isStaleFallback) {
        console.warn(`Cached questions for resume ${resumeId} were from a fallback generation — clearing and retrying with the configured AI provider.`);
        await supabase.from('interview_questions').delete().eq('resume_id', resumeId);
        return this.generateQuestions(resumeId);
      }

      const questionsList = existing.map((row: any) => row.question_text);
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

    const isTech = config.interviewType === 'technical';
    const jdText = await getJobDescriptionText(resume.report?.jdId);

    let questions: string[] = [];
    let rubrics: (GradingRubric | null)[] = [];
    let generationSource: 'ai' | 'fallback' = 'ai';

    // Use Gemini if available
    try {
      if (isTech) {
        const sections = config.sections || { overlapping: 8, gap: 3, projects: 4, coding: 2 };
        const overlappingCount = sections.overlapping !== undefined ? Number(sections.overlapping) : 8;
        const gapCount = sections.gap !== undefined ? Number(sections.gap) : 3;
        const projectsCount = sections.projects !== undefined ? Number(sections.projects) : 4;
        const codingCount = sections.coding !== undefined ? Number(sections.coding) : 2;
        const totalVerbalCount = overlappingCount + gapCount + projectsCount;

        const verbalPrompt = `Generate exactly ${totalVerbalCount} technical interview questions for this specific candidate. Every question MUST reference an actual technology, project, or requirement named in the CV or JD below — never a generic question that could apply to any candidate.

JD: ${jdText || "None provided — base questions on the candidate's primary skills and experience below."}
CV: ${JSON.stringify(resume.parsed)}
Target roles: ${JSON.stringify(resume.report?.targetRoles || [])}

Rules:
- Match difficulty to the candidate's seniority (inferred from CV/JD). No trivia for seniors, no architecture questions for juniors.
- ${overlappingCount} questions on skills/tools present in BOTH the CV and JD.
- ${gapCount} questions on JD requirements NOT in the CV (gap/transferability assessment).
- ${projectsCount} questions probing specific projects/experience actually listed in the CV.
- Scenario/troubleshooting/trade-off framing, not dictionary definitions.

Return ONLY a JSON array of exactly ${totalVerbalCount} objects, no commentary:
[{"question": "...", "difficulty": "Easy"|"Medium"|"Hard", "source": "JD+CV Match"|"JD Skill"|"CV Skill", "skill": "...", "expectedPoints": ["key point a strong answer must cover"]}]`;

        const rawVerbal = acceptGenerated(await geminiEngine.generateText(verbalPrompt), totalVerbalCount);

        let rawCoding: any[] = [];
        if (codingCount > 0) {
          const codingPrompt = `Generate exactly ${codingCount} hands-on coding challenges for this candidate, matched to their seniority and primary language from the CV/JD below.

JD: ${jdText || "None provided — base challenges on the candidate's primary programming language."}
CV: ${JSON.stringify(resume.parsed)}

Rules:
- Real programming tasks only ("write a function that...") — no theory/design/verbal questions.
- Each question text must start with "Coding Challenge: " and include: problem description, expected input/output, constraints, 2+ examples, a starter function signature.

Return ONLY a JSON array of exactly ${codingCount} objects, no commentary:
[{"question": "Coding Challenge: ...", "difficulty": "Easy"|"Medium"|"Hard", "source": "JD+CV Match", "skill": "...", "expectedPoints": ["expected solution logic/edge cases"]}]`;

          rawCoding = acceptGenerated(await geminiEngine.generateText(codingPrompt), codingCount);
        }

        const rawQuestions = [...rawVerbal, ...rawCoding];
        questions = rawQuestions.map((qObj: any) => {
          if (typeof qObj === 'string') return qObj;
          if (qObj && typeof qObj === 'object' && typeof qObj.question === 'string') {
            return qObj.question;
          }
          throw new Error("Invalid question object format");
        });
        rubrics = rawQuestions.map((qObj: any): GradingRubric | null => {
          if (qObj && typeof qObj === 'object' && Array.isArray(qObj.expectedPoints)) {
            return { keyConcepts: qObj.expectedPoints, skill: qObj.skill, difficulty: qObj.difficulty };
          }
          return null;
        });
      } else {
        // Non-technical Interview
        const sections = config.sections || { behavioral: 5, leadership: 5, softskills: 5 };
        const behavioralCount = sections.behavioral !== undefined ? Number(sections.behavioral) : 5;
        const leadershipCount = sections.leadership !== undefined ? Number(sections.leadership) : 5;
        const softskillsCount = sections.softskills !== undefined ? Number(sections.softskills) : 5;
        const totalNonTechCount = behavioralCount + leadershipCount + softskillsCount;

        const nonTechPrompt = `Generate exactly ${totalNonTechCount} behavioral/HR interview questions for this specific candidate. Every question MUST tie back to actual roles, companies, or projects named in the CV below, or a real requirement in the JD — never a generic question that could apply to anyone.

JD: ${jdText || "None provided."}
CV: ${JSON.stringify(resume.parsed)}

Rules:
- Match tone/expectations to seniority (leadership/strategy for seniors, adaptability/teamwork for juniors).
- ${behavioralCount} questions: past behavior, conflict resolution, pressure, lessons learned — reference their actual work history.
- ${leadershipCount} questions: leading initiatives, teamwork, mentoring, cross-functional work — reference their actual roles.
- ${softskillsCount} questions: critical thinking, adaptability, stakeholder communication — reference their actual context.
- Situational framing ("Tell me about a time when...", "How would you handle...").

Return ONLY a JSON array of exactly ${totalNonTechCount} objects, no commentary:
[{"question": "...", "difficulty": "Easy"|"Medium"|"Hard", "source": "Behavioral"|"Leadership"|"Soft Skills", "skill": "...", "expectedPoints": ["key point a strong answer must cover"]}]`;

        const rawNonTech = acceptGenerated(await geminiEngine.generateText(nonTechPrompt), totalNonTechCount);

        questions = rawNonTech.map((qObj: any) => {
          if (typeof qObj === 'string') return qObj;
          if (qObj && typeof qObj === 'object' && typeof qObj.question === 'string') {
            return qObj.question;
          }
          throw new Error("Invalid question object format");
        });
        rubrics = rawNonTech.map((qObj: any): GradingRubric | null => {
          if (qObj && typeof qObj === 'object' && Array.isArray(qObj.expectedPoints)) {
            return { keyConcepts: qObj.expectedPoints, skill: qObj.skill, difficulty: qObj.difficulty };
          }
          return null;
        });
      }
    } catch (err) {
      console.warn("Failed to generate questions with AI, falling back to dynamic defaults.", err);
      generationSource = 'fallback';
      
      if (isTech) {
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

        // Slice/repeat verbal list to match count
        const totalVerbalNeeded = overlappingCount + gapCount + projectsCount;
        for (let i = 0; i < totalVerbalNeeded; i++) {
          questions.push(defaultVerbalList[i % defaultVerbalList.length]);
        }

        // Coding challenges list
        const codingChallengesList = STATIC_FALLBACK_CODING_QUESTIONS;

        for (let i = 0; i < codingCount; i++) {
          questions.push(codingChallengesList[i % codingChallengesList.length]);
        }
      } else {
        // Non-technical fallbacks
        const sections = config.sections || { behavioral: 5, leadership: 5, softskills: 5 };
        const behavioralCount = sections.behavioral !== undefined ? Number(sections.behavioral) : 5;
        const leadershipCount = sections.leadership !== undefined ? Number(sections.leadership) : 5;
        const softskillsCount = sections.softskills !== undefined ? Number(sections.softskills) : 5;

        const defaultBehavioralList = STATIC_FALLBACK_BEHAVIORAL_QUESTIONS;
        const defaultLeadershipList = STATIC_FALLBACK_LEADERSHIP_QUESTIONS;
        const defaultSoftSkillsList = STATIC_FALLBACK_SOFTSKILLS_QUESTIONS;

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

    if (generationSource === 'fallback') {
      // This is intentionally loud (not just console.warn buried in normal logs): every
      // candidate who hits this gets a generic, non-personalized question set instead of
      // one tailored to their actual resume/JD, and — because getQuestions() caches
      // whatever gets inserted below — this result will be served to that SAME resume on
      // every future interview attempt too, until the stale rows are cleared. See
      // generation_source handling in getQuestions().
      console.error(
        `[INTERVIEW QUESTIONS FELL BACK TO STATIC DEFAULTS] resumeId=${resumeId} — the configured AI provider (AI_PROVIDER=${process.env.AI_PROVIDER || 'gemini'}) failed to generate questions. Check the "Failed to generate questions with AI" warning above this line for the actual error. These fallback questions are being cached and will be reused for this resume until the stale interview_questions rows are cleared.`
      );
    }

    // Save generated questions to DB, alongside a grading rubric ("answer key") for each
    // question — this is generated by the SAME LLM call as the question itself (zero
    // extra cost), and is what lets both the primary LLM grader and the local fallback
    // grader mark answers against a real, consistent standard instead of guessing.
    //
    // generation_source is tagged 'ai' or 'fallback' so getQuestions() can tell a
    // genuine cached question set apart from a stale fallback set and retry instead of
    // permanently serving generic defaults to a resume that hit a transient AI failure.
    const insertData = questions.map((q, i) => ({
      resume_id: resumeId,
      question_index: i,
      question_text: q,
      grading_rubric: rubrics[i] || synthesizeRubricFromQuestion(q),
      generation_source: generationSource,
    }));
    let { error } = await supabase.from('interview_questions').insert(insertData);
    if (error) {
      // grading_rubric/generation_source columns may not exist yet (migration-v5.sql not
      // applied) — degrade gracefully rather than losing the whole question set.
      console.warn("Insert with grading_rubric/generation_source failed, retrying without them:", error.message);
      const legacyInsertData = questions.map((q, i) => ({
        resume_id: resumeId,
        question_index: i,
        question_text: q,
      }));
      const retry = await supabase.from('interview_questions').insert(legacyInsertData);
      if (retry.error) console.error("Error inserting questions:", retry.error);
    }

    return questions;
  }

  /**
   * Fetches the stored grading rubric ("answer key") for a specific question, if one
   * exists. Falls back to synthesizing a lightweight rubric from the question text
   * itself when no stored rubric is available (e.g. a legacy question from before this
   * feature existed) — so grading always has something concrete to grade against.
   */
  private async getRubricForQuestion(resumeId: string, questionIndex: number, question: string): Promise<GradingRubric> {
    try {
      const { data, error } = await supabase
        .from('interview_questions')
        .select('grading_rubric')
        .eq('resume_id', resumeId)
        .eq('question_index', questionIndex)
        .maybeSingle();
      if (!error && data?.grading_rubric && typeof data.grading_rubric === 'object') {
        const rubric = data.grading_rubric as GradingRubric;
        if (Array.isArray(rubric.keyConcepts) && rubric.keyConcepts.length > 0) {
          return rubric;
        }
      }
    } catch (err) {
      console.warn("Could not fetch stored grading rubric, synthesizing from question text.", err);
    }
    return synthesizeRubricFromQuestion(question);
  }

  async evaluateAnswer(resumeId: string, questionIndex: number, question: string, answer: string): Promise<void> {
    let score = 5;
    let feedback = "Answer recorded.";
    let breakdown: import('@/lib/answer-grading').RubricScoreBreakdown | null = null;

    // Zero-cost disqualification pre-checks: empty / boilerplate / repeats-the-question /
    // wrong-language submissions. These are mechanical certainties, not really "grading" —
    // a blank or templated submission deserves the same rock-bottom score regardless of
    // which grading method would otherwise be used, so this stays a cheap early exit.
    const heuristic = getHeuristicEvaluation(questionIndex, question, answer);
    if (heuristic) {
      score = heuristic.score;
      feedback = heuristic.feedback;
    } else {
      const isCoding = question.startsWith("Coding Challenge:");
      const resume = await resumeService.getCachedResume(resumeId);
      const jdText = resume ? await getJobDescriptionText(resume.report?.jdId) : "";

      if (isCoding) {
        const inferredLanguage = inferLanguageFromQuestion(question);
        const emptyGate = checkEmptyGate(answer);
        if (emptyGate) {
          score = 0;
          feedback = emptyGate.error || "No code submitted.";
        } else {
          const mismatch = detectLanguageMismatch(inferredLanguage, answer);
          try {
            const prompt = `
You are a code grader. Evaluate this coding answer against 3 test cases you generate, in whatever language it is actually written — always attempt evaluation, never refuse due to language.

Job Description: ${jdText || "Not specified."}
Candidate level: ${resume ? JSON.stringify(resume.parsed, null, 2) : "Not specified."}
Question: "${question}"
Code:
\`\`\`
${answer}
\`\`\`

Generate 3 test cases, trace real execution, record actual vs expected, set passed. Score correctness/efficiency/quality based on the code's logic only, not its language.

Return ONLY: {"testCases": [{"name": "...", "expected": "...", "actual": "...", "passed": true}], "feedback": "1-2 sentences on correctness, gaps, and optimization."}
`;
            const result = await geminiEngine.generateText(prompt);
            const testCases = Array.isArray(result?.testCases) ? result.testCases : [];
            const passed = testCases.filter((t: any) => t.passed).length;
            const baseScore = testCases.length > 0 ? Math.round((passed / testCases.length) * 10) : 5;
            score = applyLanguagePenalty(baseScore, mismatch);
            feedback = (result?.feedback || `${passed}/${testCases.length} test cases passed.`) + (mismatch ? ` (${LANGUAGE_MISMATCH_PENALTY}-point language mismatch penalty applied.)` : "");
          } catch (err) {
            console.warn("Failed to evaluate coding answer with AI, using local pattern-matching fallback.", err);
            const fallback = runLocalMockEvaluator(question, inferredLanguage, answer);
            score = fallback.score;
            feedback = `Evaluated via automated fallback grader (AI unavailable): ${fallback.testCases.filter((t: any) => t.passed).length}/${fallback.testCases.length} checks passed.`;
          }
        }
      } else {
        // Verbal answers: rubric-based grading (Understanding/Relation +2, Keywords +4,
        // Reasoning +2, Clarity +2) against the "answer key" generated alongside the
        // question — LLM primary, deterministic rubric fallback on LLM failure.
        const rubric = await this.getRubricForQuestion(resumeId, questionIndex, question);
        breakdown = await gradeAnswer(question, answer, rubric, {
          jdText,
          resumeSummary: resume ? JSON.stringify(resume.parsed) : undefined,
          targetRoles: resume?.report?.targetRoles,
        });
        score = breakdown.total;
        feedback = breakdown.feedback;
      }
    }

    const insertPayload: any = {
      resume_id: resumeId,
      question_index: questionIndex,
      question_text: question,
      candidate_answer: answer,
      mock_score: score,
      mock_feedback: feedback,
    };
    if (breakdown) {
      insertPayload.score_breakdown = breakdown;
    }

    let { error: insertError } = await supabase.from('interview_attempts').insert(insertPayload);
    if (insertError && breakdown) {
      // score_breakdown column may not exist yet (migration-v4.sql not applied) —
      // degrade gracefully rather than losing the candidate's answer/score entirely.
      console.warn("Insert with score_breakdown failed, retrying without it:", insertError.message);
      const { score_breakdown, ...legacyPayload } = insertPayload;
      const retry = await supabase.from('interview_attempts').insert(legacyPayload);
      insertError = retry.error;
    }
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

  /**
   * Synthesizes a single, holistic recruiter-facing summary across the whole completed
   * interview — cross-question strengths/weaknesses, standout or concerning answers, and
   * an overall recommendation lean. This is ONE LLM call per completed interview (not
   * per-question), triggered once at conclude(), synthesizing the per-question
   * scores/feedback that were already recorded rather than re-grading anything.
   *
   * Failsafe: if the LLM is unavailable, falls back to a deterministic aggregate summary
   * built from the recorded scores (average, strongest/weakest questions) — still useful,
   * just without the narrative synthesis.
   */
  async generateOverallFeedback(resumeId: string): Promise<void> {
    const { data: attempts, error } = await supabase
      .from('interview_attempts')
      .select('question_index, question_text, mock_score, mock_feedback, score_breakdown')
      .eq('resume_id', resumeId)
      .order('question_index', { ascending: true });

    if (error || !attempts || attempts.length === 0) {
      return;
    }

    const scores = attempts.map((a: any) => a.mock_score).filter((s: any) => typeof s === 'number');
    const averageScore = scores.length > 0 ? scores.reduce((a: number, b: number) => a + b, 0) / scores.length : 0;

    let overallFeedback: any;
    try {
      const prompt = `
You are a senior technical recruiter writing a final, holistic interview assessment summary for a hiring manager, based on a completed interview's per-question scores and feedback below. Do not re-grade individual answers — synthesize an overall picture.

Per-question results (JSON):
${JSON.stringify(attempts.map((a: any) => ({
  question: a.question_text,
  score: a.mock_score,
  feedback: a.mock_feedback,
})), null, 2)}

Average score across all questions: ${averageScore.toFixed(1)} / 10

Return ONLY a raw JSON object with this exact structure:
{
  "overallSummary": "3-4 sentence holistic narrative summary of the candidate's interview performance.",
  "keyStrengths": ["specific strength observed across multiple answers"],
  "keyWeaknesses": ["specific weakness or gap observed across multiple answers"],
  "standoutAnswers": ["brief note on any particularly strong or particularly concerning specific answer, with the question referenced"],
  "recommendation": "Strong Hire | Hire | Lean Hire | Lean No Hire | No Hire",
  "recommendationRationale": "1-2 sentence justification for the recommendation lean, grounded in the scores/feedback above."
}
`;
      const raw = await generateAIText(prompt);
      const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
      overallFeedback = JSON.parse(cleaned);
      overallFeedback.gradedBy = "llm";
    } catch (err) {
      console.warn("LLM overall interview feedback synthesis failed, using deterministic aggregate summary.", err);
      const sorted = [...attempts].sort((a: any, b: any) => (a.mock_score ?? 0) - (b.mock_score ?? 0));
      const weakest = sorted[0];
      const strongest = sorted[sorted.length - 1];
      overallFeedback = {
        overallSummary: `The candidate averaged ${averageScore.toFixed(1)}/10 across ${attempts.length} questions.`,
        keyStrengths: strongest ? [`Strongest response to: "${strongest.question_text}" (${strongest.mock_score}/10) — ${strongest.mock_feedback || ""}`] : [],
        keyWeaknesses: weakest ? [`Weakest response to: "${weakest.question_text}" (${weakest.mock_score}/10) — ${weakest.mock_feedback || ""}`] : [],
        standoutAnswers: [],
        recommendation: averageScore >= 8 ? "Strong Hire" : averageScore >= 6.5 ? "Hire" : averageScore >= 5 ? "Lean Hire" : averageScore >= 3.5 ? "Lean No Hire" : "No Hire",
        recommendationRationale: "Automated aggregate recommendation based on average score (AI synthesis was unavailable for this interview).",
        gradedBy: "local-aggregate",
      };
    }

    try {
      const resume = await resumeService.getCachedResume(resumeId, true);
      if (resume) {
        resume.report = resume.report || {};
        resume.report.interviewFeedback = overallFeedback;
        await resumeService.saveResumeRow(resume);
      }
    } catch (err) {
      console.error("Failed to persist overall interview feedback:", err);
    }
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
