export interface ResumeData {
  id: string;
  filename: string;
  originalText: string;
  filePath?: string;
  fileHash?: string;
  fileBase64?: string;
  parsed: ParsedResume;
  analysis: ResumeAnalysis;
  enhanced: EnhancedResume;
  report: ResumeReport;
  createdAt: Date;
  updatedAt: Date;
  status: "processing" | "completed" | "failed";
  error?: string;
}

export interface ParsedResume {
  personal: PersonalInfo;
  summary?: string;
  experience: WorkExperience[];
  education: Education[];
  skills: SkillSection;
  projects: Project[];
  certifications: Certification[];
  achievements: Achievement[];
  leadership: Leadership[];
  sections: ResumeSection[];
}

export interface PersonalInfo {
  fullName?: string;
  email?: string;
  phone?: string;
  location?: string;
  linkedin?: string;
  github?: string;
  website?: string;
  title?: string;
}

export interface WorkExperience {
  id: string;
  company: string;
  position: string;
  location?: string;
  startDate: string;
  endDate?: string;
  current: boolean;
  description: string;
  bulletPoints: BulletPoint[];
  technologies: string[];
}

export interface BulletPoint {
  id: string;
  text: string;
  impact?: "low" | "medium" | "high";
  issues?: string[];
  enhanced?: string;
}

export interface Education {
  id: string;
  institution: string;
  degree: string;
  field?: string;
  location?: string;
  graduationDate: string;
  gpa?: string;
  honors?: string[];
}

export interface SkillSection {
  technical: string[];
  soft: string[];
  tools: string[];
  languages: string[];
  other: string[];
}

export interface Project {
  id: string;
  name: string;
  description: string;
  technologies: string[];
  url?: string;
  bulletPoints: string[];
}

export interface Certification {
  id: string;
  name: string;
  issuer: string;
  date: string;
  expiry?: string;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  context?: string;
}

export interface Leadership {
  id: string;
  role: string;
  organization: string;
  duration: string;
  description: string;
}

export interface ResumeSection {
  name: string;
  confidence: number;
  startIndex: number;
  endIndex: number;
  content: string;
}

export interface ResumeAnalysis {
  overallScore: number;
  atsScore: number;
  technicalScore: number;
  communicationScore: number;
  projectQualityScore: number;
  impactScore: number;
  scores: ScoreBreakdown;
  weaknesses: Weakness[];
  strengths: Strength[];
  readability: ReadabilityMetrics;
  keywordAnalysis: KeywordAnalysis;
  isLocal?: boolean;
}

export interface ScoreBreakdown {
  actionVerbs: number;
  measurability: number;
  formatting: number;
  clarity: number;
  consistency: number;
  keywordOptimization: number;
}

export interface Weakness {
  category: "content" | "format" | "ats" | "grammar" | "impact";
  severity: "low" | "medium" | "high" | "critical";
  location: string;
  description: string;
  suggestion: string;
  examples?: string[];
}

export interface Strength {
  category: string;
  description: string;
  impact: "low" | "medium" | "high";
}

export interface ReadabilityMetrics {
  fleschReadingEase: number;
  averageSentenceLength: number;
  passiveVoiceCount: number;
  jargonCount: number;
  readingTime: number;
}

export interface KeywordAnalysis {
  matchedKeywords: string[];
  missingKeywords: string[];
  overusedKeywords: string[];
  industryRelevance: number;
  suggestedKeywords: string[];
}

export interface EnhancedResume {
  summary?: string;
  experience: { [workId: string]: { bulletPoints: { original: string; enhanced: string; changes: string[]; }[]; }; };
  projects: { [projectId: string]: { description?: string; bulletPoints: { original: string; enhanced: string; }[]; }; };
  skills: { added: string[]; removed: string[]; reorganized: boolean; };
  suggestions: EnhancementSuggestion[];
}

export interface EnhancementSuggestion {
  type: "add" | "remove" | "modify";
  section: string;
  priority: "high" | "medium" | "low";
  description: string;
  rationale: string;
}

export interface ResumeReport {
  executiveSummary: string;
  recruiterInsights: string[];
  hiringConfidence: "low" | "medium" | "high" | "very-high";
  industryFit: IndustryFit[];
  targetRoles: string[];
  priorityImprovements: PriorityImprovement[];
  visualMetrics: VisualMetrics;
  suitability?: "suitable" | "unsuitable";
  jdMatchScore?: number | null;
  jdMatchRationale?: string | null;
  jdId?: string;
  rmEmail?: string;
  proctoring?: {
    warningCount: number;
    autoSubmitted: boolean;
    violations: Array<{
      type: string;
      timestamp: string;
      warningCount: number;
    }>;
  };
  interviewSession?: any;
}

export interface IndustryFit {
  industry: string;
  matchScore: number;
  rationale: string;
}

export interface PriorityImprovement {
  rank: number;
  category: string;
  title: string;
  description: string;
  effort: "low" | "medium" | "high";
  impact: "low" | "medium" | "high";
}

export interface VisualMetrics {
  overallScore: number;
  atsScore: number;
  radarData: RadarDatum[];
  scoreHistory: ScoreHistory[];
  topSkills: { name: string; score: number }[];
}

export interface RadarDatum {
  subject: string;
  value: number;
  fullMark: number;
}

export interface ScoreHistory {
  date: string;
  score: number;
}
