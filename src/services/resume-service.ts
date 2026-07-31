import type {
  ParsedResume,
  ResumeAnalysis,
  EnhancedResume,
  ResumeReport,
  ResumeData,
} from "@/types/resume";

import { join } from "path";
import { pathToFileURL } from "url";
import { createHash } from "crypto";
import { mkdir, writeFile, readFile, readdir, rm } from "fs/promises";

import "@/lib/pdf-polyfill";

import { localEngine } from "@/lib/local-ai";
import { geminiEngine } from "@/lib/gemini-ai";
import { enhanceTextItemsWithAI, type EnhancementItem } from "@/lib/resume-enhancement";
import { extractResumeStructureWithAI, ResumeExtractionError } from "@/lib/resume-extraction";
import { supabase } from "@/lib/db";
import { pushProgress, signalProcessingDone } from "@/lib/sse-queue";
import { sessionService } from "@/services/session-service";

export class ResumeService {
  private static instance: ResumeService;
  private cache = new Map<string, any>();

  static getInstance(): ResumeService {
    if (!ResumeService.instance) {
      ResumeService.instance = new ResumeService();
    }
    return ResumeService.instance;
  }

  async processResume(file: File, jdText?: string, jdId?: string, rmEmail?: string, forceReplace?: boolean): Promise<any> {
    return this.queueResumeProcessing(file, jdText, jdId, rmEmail, forceReplace);
  }

  async processResumeSync(file: File, jdText?: string, jdId?: string, rmEmail?: string, forceReplace?: boolean): Promise<ResumeData> {
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const fileHash = this.computeFileHash(fileBuffer);
    
    let existingResume = await this.findResumeByHash(fileHash);
    if (!existingResume && file.name && rmEmail) {
      existingResume = await this.findResumeByFilename(file.name, rmEmail);
    }

    if (existingResume && existingResume.status === "completed" && !forceReplace) {
      if (jdId || rmEmail) {
        let updated = false;
        if (existingResume.report) {
          if (jdId && existingResume.report.jdId !== jdId) {
            existingResume.report.jdId = jdId;
            updated = true;
          }
          if (rmEmail && existingResume.report.rmEmail !== rmEmail) {
            existingResume.report.rmEmail = rmEmail;
            updated = true;
          }
        }
        if (updated) {
          await this.saveResumeRow(existingResume);
        }
      }
      return existingResume;
    }

    const id = (existingResume && forceReplace) ? existingResume.id : crypto.randomUUID();

    if (existingResume && forceReplace) {
      try {
        await supabase.from('interview_questions').delete().eq('resume_id', id);
        await supabase.from('interview_attempts').delete().eq('resume_id', id);
      } catch (err) {
        console.error("Failed to delete interview questions or attempts during forceReplace:", err);
      }
    }

    const resume: ResumeData = {
      id,
      filename: file.name,
      originalText: "",
      fileHash,
      fileBase64: fileBuffer.toString('base64'),
      parsed: {} as ParsedResume,
      analysis: {} as ResumeAnalysis,
      enhanced: {} as EnhancedResume,
      report: {} as ResumeReport,
      createdAt: new Date(),
      updatedAt: new Date(),
      status: "processing",
    };

    this.cache.set(id, resume);
    resume.filePath = await this.saveFileBuffer(fileBuffer, id, file.name);
    await this.saveResumeRow(resume);

    await this.completeResumeProcessing(resume, fileBuffer, jdText, jdId, rmEmail);
    return resume;
  }

  async queueResumeProcessing(file: File, jdText?: string, jdId?: string, rmEmail?: string, forceReplace?: boolean): Promise<ResumeData> {
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const fileHash = this.computeFileHash(fileBuffer);
    
    let existingResume = await this.findResumeByHash(fileHash);
    if (!existingResume && file.name && rmEmail) {
      existingResume = await this.findResumeByFilename(file.name, rmEmail);
    }

    if (existingResume && !forceReplace) {
      if (jdId || rmEmail) {
        let updated = false;
        if (existingResume.report) {
          if (jdId && existingResume.report.jdId !== jdId) {
            existingResume.report.jdId = jdId;
            updated = true;
          }
          if (rmEmail && existingResume.report.rmEmail !== rmEmail) {
            existingResume.report.rmEmail = rmEmail;
            updated = true;
          }
        }
        if (updated) {
          await this.saveResumeRow(existingResume);
        }
      }
      return existingResume;
    }

    const id = (existingResume && forceReplace) ? existingResume.id : crypto.randomUUID();

    if (existingResume && forceReplace) {
      try {
        await supabase.from('interview_questions').delete().eq('resume_id', id);
        await supabase.from('interview_attempts').delete().eq('resume_id', id);
      } catch (err) {
        console.error("Failed to delete interview questions or attempts during forceReplace:", err);
      }
    }

    const resume: ResumeData = {
      id,
      filename: file.name,
      originalText: "",
      fileHash,
      fileBase64: fileBuffer.toString('base64'),
      parsed: {} as ParsedResume,
      analysis: {} as ResumeAnalysis,
      enhanced: {} as EnhancedResume,
      report: {} as ResumeReport,
      createdAt: new Date(),
      updatedAt: new Date(),
      status: "processing",
    };

    this.cache.set(id, resume);
    resume.filePath = await this.saveFileBuffer(fileBuffer, id, file.name);
    await this.saveResumeRow(resume);
    pushProgress(id, { step: "started", message: "Processing started…" });

    this.completeResumeProcessing(resume, fileBuffer, jdText, jdId, rmEmail).catch((error: any) => {
      console.error("Background resume processing failed:", error);
    });

    return resume;
  }

  private async completeResumeProcessing(
    resume: ResumeData,
    fileBuffer: Buffer,
    jdText?: string,
    jdId?: string,
    rmEmail?: string
  ) {
    try {
      const text = await this.extractTextFromBuffer(fileBuffer);

      resume.originalText = text;

      pushProgress(resume.id, {
        step: "parsing",
        message: "Extracting skills, education & experience with AI…",
      });

      let parsed;
      try {
        parsed = await extractResumeStructureWithAI(text);
      } catch (extractionError: any) {
        // AI extraction is always tried first, across the full Copilot ->
        // Groq -> Gemini -> Ollama chain. Only if every provider fails do we
        // fall back to the regex/heuristic parser below, purely so an AI
        // outage doesn't block resume processing entirely. This is clearly
        // flagged via parsed.extractionSource = "fallback" for transparency.
        console.warn(
          "AI resume extraction failed on all providers; using last-resort regex fallback parser.",
          extractionError instanceof ResumeExtractionError ? extractionError.message : extractionError
        );
        pushProgress(resume.id, {
          step: "parsing",
          message: "AI extraction unavailable — using fallback parser…",
        });
        parsed = this.parseStructure(text);
      }

      resume.parsed = parsed;
      pushProgress(resume.id, { step: "parsing", message: "Structure parsed successfully." });

      let analysis: any;
      try {
        pushProgress(resume.id, {
          step: "analysis-gemini",
          message: "Running AI analysis…",
        });
        analysis = await geminiEngine.analyzeResume(text, parsed, jdText);
        analysis.isLocal = false;
      } catch (geminiError: any) {
        console.warn(
          "Gemini Engine failed (likely rate limit/quota), falling back to local engine:",
          geminiError.message
        );
        pushProgress(resume.id, {
          step: "analysis-local",
          message: "AI unavailable — running Rule-based analysis.",
        });
        analysis = null;
      }

      if (!analysis) {
        analysis = localEngine.analyzeResume(text, parsed, jdText);
        analysis.isLocal = true;
      }
      resume.analysis = analysis;
      pushProgress(resume.id, { step: "analysis-done", message: "Scoring complete." });

      const enhanced = await this.enhanceResume(parsed, analysis, jdText);
      resume.enhanced = enhanced;
      pushProgress(resume.id, { step: "enhancing", message: "Generating suggestions." });

      const report = this.generateReport(parsed, analysis, enhanced);
      if (jdId) report.jdId = jdId;
      if (rmEmail) report.rmEmail = rmEmail;
      resume.report = report;
      pushProgress(resume.id, { step: "report", message: "Finalising report." });

      resume.status = "completed";
      resume.updatedAt = new Date();
      pushProgress(resume.id, { step: "done", message: "Processing complete." });
    } catch (error: any) {
      console.error("Resume processing failed:", error);
      resume.status = "failed";
      resume.updatedAt = new Date();
      pushProgress(resume.id, {
        step: "error",
        message: error.message || "Processing failed.",
      });
    }

    await this.saveResumeRow(resume);
    signalProcessingDone(resume.id);
  }

  async extractTextFromBuffer(buffer: Buffer): Promise<string> {
    // Detect format from buffer header / magic bytes — cheaper than relying on filename
    const isPdf = buffer[0] === 0x25 && buffer[1] === 0x50;
    const isZip = buffer[0] === 0x50 && buffer[1] === 0x4b;
    if (isPdf) return this.extractPDFBuffer(buffer);
    if (isZip) return this.extractDOCXBuffer(buffer);
    return buffer.toString("utf8");
  }

  // ── Buffer-backed extractors (no File → arrayBuffer() re-reads) ──────────

  private async extractPDFBuffer(buffer: Buffer): Promise<string> {
    if (!buffer || buffer.length === 0) {
      throw new Error("Cannot parse empty PDF buffer.");
    }

    const pdfParseModule = require("pdf-parse");

    if (typeof pdfParseModule.PDFParse === "function") {
      const parser = new pdfParseModule.PDFParse({ data: buffer });
      try {
        const result = await parser.getText();
        return result?.text || "";
      } finally {
        if (typeof parser.destroy === "function") await parser.destroy();
      }
    }

    if (typeof pdfParseModule.default === "function") {
      const data = await pdfParseModule.default(buffer);
      return data.text || "";
    }

    if (typeof pdfParseModule === "function") {
      const data = await pdfParseModule(buffer);
      return data.text || "";
    }

    throw new Error(
      `Invalid pdf-parse module format: ${Object.keys(pdfParseModule).join(", ")}`
    );
  }

  private async extractDOCXBuffer(buffer: Buffer): Promise<string> {
    try {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      return result.value || "";
    } catch (error: any) {
      throw new Error(
        `DOCX parsing failed: ${error?.message || "Unknown error"}`
      );
    }
  }

  // ── File persistence ───────────────────────────────────────────────────────

  private getUploadsRoot() {
    return process.env.VERCEL === "1" ? "/tmp" : join(process.cwd(), "uploads");
  }

  private async saveFileBuffer(
    buffer: Buffer,
    id: string,
    filename: string
  ): Promise<string> {
    try {
      await supabase.storage.createBucket('resumes', { public: true });
    } catch (e) {}

    const safeName = filename.replace(/[\\/:*?"<>|]+/g, "_");
    const storagePath = `${id}-${safeName}`;

    const { error } = await supabase.storage
      .from('resumes')
      .upload(storagePath, buffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (error) {
      console.error("Failed to upload file to Supabase Storage:", error.message);
      throw new Error(`Failed to upload file to Supabase Storage: ${error.message}`);
    }

    return storagePath;
  }

  private computeFileHash(buffer: Buffer): string {
    return createHash("sha256").update(buffer).digest("hex");
  }

  private async findResumeByHash(hash: string): Promise<any | null> {
    try {
      const { data, error } = await supabase
        .from('resumes')
        .select('id')
        .eq('file_hash', hash)
        .order('created_at', { ascending: false });
        
      if (!error && data && data.length > 0) {
        return await this.getCachedResume(data[0].id);
      }
    } catch (e) {
      console.error("Failed to query resume by hash from DB:", e);
    }
    return null;
  }

  async findResumeByFilename(filename: string, rmEmail: string): Promise<any | null> {
    let rows: any[] = [];
    try {
      const { data, error } = await supabase
        .from('resumes')
        .select('*')
        .eq('filename', filename)
        .order('created_at', { ascending: false });

      if (!error && data) {
        rows = data;
      }
    } catch (e) {
      console.error("Failed to find resume by filename:", e);
    }

    if (rows.length === 0) {
      const localResumes = await this.ensureResumesJson();
      rows = localResumes.filter(r => r.filename === filename);
    }

    for (const row of rows) {
      const report = row.report ? (typeof row.report === 'object' ? row.report : JSON.parse(row.report)) : {};
      if (report.rmEmail?.toLowerCase().trim() === rmEmail.toLowerCase().trim()) {
        return this.mapRowToResume(row);
      }
    }
    return null;
  }

  private async clearResumeUploads() {
    try {
      const { data: filesList } = await supabase.storage.from('resumes').list('');
      if (filesList && filesList.length > 0) {
        const names = filesList.map(f => f.name);
        await supabase.storage.from('resumes').remove(names);
      }
    } catch (e) {
      console.error("Failed to clear resumes from Supabase Storage:", e);
    }
  }

  private async clearResumeTable() {
    const attempts = [
      () => supabase.from('resumes').delete().neq('id', ''),
      () => supabase.from('resumes').delete().not('id', 'is', null),
      () => supabase.from('resumes').delete(),
    ];

    let lastError: any = null;
    for (const attempt of attempts) {
      const { error } = await attempt();
      if (!error) {
        return;
      }
      lastError = error;
    }

    console.error('Failed to clear resumes table:', lastError);
    throw new Error('Failed to clear resume records from database');
  }

  async clearAllResumes(): Promise<void> {
    this.cache.clear();
    await this.clearResumeUploads();
    try {
      await this.saveResumesJson([]);
    } catch (e) {}
    await this.clearResumeTable();
  }

  async deleteResumeById(id: string): Promise<void> {
    this.cache.delete(id);
    await this.removeResumeFiles(id);
    await this.deleteResumeRow(id);
    try {
      await sessionService.deleteSessionByResumeId(id);
    } catch (sessionErr) {
      console.error("Failed to delete candidate session during resume deletion:", sessionErr);
    }
  }

  private async removeResumeFiles(id: string): Promise<void> {
    try {
      const { data: filesList } = await supabase.storage.from('resumes').list('');
      if (filesList) {
        const matching = filesList.filter(f => f.name.startsWith(`${id}-`)).map(f => f.name);
        if (matching.length > 0) {
          await supabase.storage.from('resumes').remove(matching);
        }
      }
    } catch (error) {
      console.error("Failed to remove resume files from Supabase Storage:", error);
    }
  }

  private async deleteResumeRow(id: string): Promise<void> {
    // Delete from child tables referencing resume_id first, to prevent foreign key constraint violations
    try {
      await supabase.from('interview_questions').delete().eq('resume_id', id);
    } catch (e) {}
    try {
      await supabase.from('interview_attempts').delete().eq('resume_id', id);
    } catch (e) {}
    try {
      await supabase.from('resumes').delete().eq('id', id);
    } catch (e) {}

    // Delete from local backup
    try {
      const localResumes = await this.ensureResumesJson();
      const filtered = localResumes.filter(r => r.id !== id);
      await this.saveResumesJson(filtered);
    } catch (localErr) {
      console.error("Failed to delete local resume backup:", localErr);
    }
  }

  /**
   * Finds a "date range" in a line of resume text, e.g. "Jan 2020 - Mar 2022",
   * "2019-2023", "06/2021 to Present". Adapted from a notebook-based approach,
   * corrected to use proper separator alternation and returning structured
   * start/end/current fields instead of a raw regex match.
   */
  private extractDurationRange(line: string): { raw: string; start: string; end: string; current: boolean } | null {
    const MONTH = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
    const MONTH_YEAR = `${MONTH}\\.?\\s+\\d{4}`;
    const NUMERIC_DATE = `\\d{1,2}[\\/\\-]\\d{4}`;
    const YEAR = `\\b(?:19|20)\\d{2}\\b`;
    const START = `(?:${MONTH_YEAR}|${NUMERIC_DATE}|${YEAR})`;
    const ONGOING = "(?:present|current|now|ongoing)";
    const END = `(?:${MONTH_YEAR}|${NUMERIC_DATE}|${YEAR}|${ONGOING})`;
    const SEP = "(?:-|–|—|to|through)";

    const regex = new RegExp(`${START}\\s*${SEP}\\s*${END}`, "i");
    const match = line.match(regex);
    if (!match) return null;

    const raw = match[0];
    const sepSplit = raw.split(new RegExp(`\\s*${SEP}\\s*`, "i"));
    const start = sepSplit[0]?.trim() || "";
    const end = sepSplit[1]?.trim() || "";
    const current = new RegExp(ONGOING, "i").test(end);

    return { raw, start, end, current };
  }

  private matchHeader(line: string): string | null {
    const clean = line.replace(/[•*\-\u2022\s]+/g, " ").trim().toLowerCase();
    if (clean.length === 0 || clean.length > 40) return null;

    const mappings: Record<string, string[]> = {
      summary: ["profile summary", "summary", "profile", "professional summary", "objective", "career objective", "about me", "about"],
      experience: ["experience", "professional experience", "work experience", "employment", "employment history", "work history", "internships", "internship", "internship experience", "professional history"],
      education: ["education", "academic background", "academic profile", "academics", "education details", "academic details"],
      skills: ["skills", "technical skills", "core competencies", "key skills", "expertise", "skills tools", "technologies"],
      projects: ["projects", "academic projects", "personal projects", "selected projects"],
      certifications: ["certifications", "certification", "licenses certifications", "credentials"],
      publications: ["publications", "publication", "research publications", "papers"],
      languages: ["languages", "language proficiency", "languages known", "spoken languages"],
    };

    // Handles compound headers like "Work Experience & Internships" — every
    // &/and/,-separated chunk must be a known synonym for the SAME category.
    const parts = clean.split(/\s*(?:&|\/|,|\band\b)\s*/).map((p) => p.trim()).filter(Boolean);
    for (const [name, keywords] of Object.entries(mappings)) {
      if (keywords.includes(clean)) return name;
      if (parts.length > 1 && parts.every((p) => keywords.includes(p))) return name;
    }
    return null;
  }

  /**
   * Last-resort regex/heuristic resume parser — used ONLY when
   * extractResumeStructureWithAI() (src/lib/resume-extraction.ts) fails after
   * exhausting the full Copilot -> Groq -> Gemini -> Ollama provider chain.
   * AI extraction is always attempted first and is strongly preferred; this
   * exists purely so an AI outage doesn't block resume processing entirely.
   *
   * Section splitting/header matching mirrors the AI path's structure.
   * Personal-info, education, and duration extraction are adapted from a
   * proven regex-based approach (name-pattern detection with address
   * exclusion, keyword-triggered multi-entry accumulation for education,
   * broad month/year duration matching) rather than naive line-position
   * guessing, to keep this fallback as accurate as a non-LLM parser can be.
   */
  private parseStructure(text: string): ParsedResume {
    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const boundaries: Array<{
      name: string;
      lineIndex: number;
    }> = [];

    lines.forEach((line, idx) => {
      const sectionName = this.matchHeader(line);
      if (sectionName) {
        const lastBoundary = boundaries[boundaries.length - 1];
        if (!lastBoundary || lastBoundary.lineIndex !== idx) {
          boundaries.push({
            name: sectionName,
            lineIndex: idx,
          });
        }
      }
    });

    boundaries.sort((a, b) => a.lineIndex - b.lineIndex);

    const sections: Record<string, string> = {};
    for (let i = 0; i < boundaries.length; i++) {
      const currentB = boundaries[i];
      const nextB = boundaries[i + 1];
      const start = currentB.lineIndex + 1;
      const end = nextB ? nextB.lineIndex : lines.length;
      const content = lines.slice(start, end).join("\n").trim();
      
      if (sections[currentB.name]) {
        sections[currentB.name] += "\n" + content;
      } else {
        sections[currentB.name] = content;
      }
    }

    return {
      personal: this.extractPersonalInfo(lines),

      summary: sections["summary"] || "",

      experience: this.parseExperience(sections["experience"] || ""),

      education: this.parseEducation(sections["education"] || ""),

      skills: this.extractSkillsFromText(text, sections["languages"] || ""),

      projects: this.parseProjects(sections["projects"] || ""),

      certifications: sections["certifications"]
        ? sections["certifications"].split("\n").filter(Boolean).map(line => ({
            id: crypto.randomUUID(),
            name: line.replace(/[•*\-]/g, "").trim(),
            issuer: "Self",
            date: ""
          }))
        : [],

      achievements: [],

      leadership: [],

      extractionSource: "fallback",

      sections: boundaries.map((b, idx) => {
        const nextB = boundaries[idx + 1];
        const start = b.lineIndex + 1;
        const end = nextB ? nextB.lineIndex : lines.length;
        const content = lines.slice(start, end).join("\n").trim();
        return {
          name: b.name,
          confidence: 0.9,
          startIndex: b.lineIndex,
          endIndex: end,
          content: content,
        };
      }),
    };
  }

  private extractPersonalInfo(lines: string[]) {
    const top = lines.slice(0, 20).join("\n");
    const opening = lines.slice(0, 8).join(" ").slice(0, 200);

    const email =
      top.match(/[\w.-]+@[\w.-]+\.\w+/)?.[0] || "";

    const phone =
      top.match(
        /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3,5}\)?[-.\s]?\d{3,5}[-.\s]?\d{4}/
      )?.[0] || "";

    const linkedin =
      top.match(/linkedin\.com\/in\/[\w-]+/i)?.[0] || "";

    const github =
      top.match(/github\.com\/[\w-]+/i)?.[0] || "";

    // Name detection: a resume's first line is usually the candidate's name,
    // but not always (templates sometimes lead with a title/rule/logo text).
    // Prefer it only if it actually looks like a name (2-4 capitalized
    // words, no digits/@ symbol); otherwise scan the opening text for a
    // Firstname Lastname pattern, excluding obvious address words.
    const looksLikeName = (s: string) => {
      const clean = s.replace(/[•*\-]/g, "").trim();
      if (!clean || clean.length > 60) return false;
      if (/[@\d]/.test(clean)) return false;
      const nonNamePhrases = ["curriculum vitae", "resume", "cv", "bio data", "biodata", "personal information", "profile"];
      if (nonNamePhrases.includes(clean.toLowerCase())) return false;
      const words = clean.split(/\s+/);
      if (words.length < 2 || words.length > 4) return false;
      return words.every((w) => /^[A-Z][a-zA-Z.'-]*$/.test(w));
    };

    const addressWords = ["apartment", "road", "street", "complex", "avenue", "block", "sector", "floor", "nagar", "colony", "house", "lane"];

    let fullName = "";
    if (lines[0] && looksLikeName(lines[0])) {
      fullName = lines[0].replace(/[•*\-]/g, "").trim();
    } else {
      const nameMatch = opening.match(/\b[A-Z][a-z]+\s[A-Z][a-z]+(\s[A-Z][a-z]+)?\b/);
      if (nameMatch && !addressWords.some((w) => nameMatch[0].toLowerCase().includes(w))) {
        fullName = nameMatch[0].trim();
      } else {
        fullName = lines[0]?.replace(/[•*\-]/g, "").trim() || "";
      }
    }

    // Title: first line after the name that isn't obviously contact info.
    let title = "";
    for (let i = 1; i < Math.min(lines.length, 6); i++) {
      const candidate = lines[i]?.trim() || "";
      if (!candidate) continue;
      if (/[\w.-]+@[\w.-]+\.\w+/.test(candidate)) continue;
      if (/\d{3,}/.test(candidate)) continue;
      if (/linkedin\.com|github\.com/i.test(candidate)) continue;
      title = candidate;
      break;
    }

    return {
      fullName,

      email,

      phone,

      linkedin: linkedin
        ? `https://${linkedin}`
        : "",

      github: github
        ? `https://${github}`
        : "",

      title,
    };
  }

  private getSectionContent(
    lines: string[],
    boundaries: any[],
    name: string
  ): string {
    const start =
      boundaries.find((b) => b.name === name)
        ?.lineIndex ?? -1;

    if (start === -1) {
      return "";
    }

    const nextBoundary = boundaries.find(
      (b) => b.lineIndex > start
    );

    const end = nextBoundary
      ? nextBoundary.lineIndex
      : lines.length;

    return lines
      .slice(start + 1, end)
      .join("\n")
      .trim();
  }

  private parseExperience(content: string): any[] {
    if (!content) {
      return [];
    }

    const expLines = content
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const experiences: any[] = [];
    let current: any = null;

    const dateRangeRegex = /(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+)?\b(19|20)\d{2}\s*(?:-|–|—|to)\s*(?:(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+)?\b(19|20)\d{2}|Present|Current)\b/i;

    expLines.forEach((line) => {
      const hasDate = dateRangeRegex.test(line);

      if (hasDate) {
        if (current) {
          experiences.push(current);
        }

        const dateMatch = line.match(dateRangeRegex);
        let startDate = "";
        let endDate = "";
        let isPresent = false;
        if (dateMatch) {
          const rangeStr = dateMatch[0];
          const parts = rangeStr.split(/\s*(?:-|–|—|to)\s*/i);
          startDate = parts[0]?.trim() || "";
          endDate = parts[1]?.trim() || "";
          isPresent = /Present|Current/i.test(endDate);
        }

        const cleanLine = line.replace(dateRangeRegex, "").replace(/\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s*$/i, "").trim();
        // Split position and company by separators
        const parts = cleanLine.split(/\s*(?:—|–|\s-\s|@|\bat\b)\s*/);
        let position = cleanLine;
        let company = "";
        if (parts.length >= 2) {
          position = parts[0].trim();
          company = parts[1].trim();
          if (parts.length > 2) {
            company += ", " + parts.slice(2).join(", ");
          }
        }

        // Clean trailing/leading separators or punctuation from position & company
        position = position.replace(/^[•*\-\s,]+|[•*\-\s,]+$/g, "").trim();
        company = company.replace(/^[•*\-\s,]+|[•*\-\s,]+$/g, "").trim();

        current = {
          id: crypto.randomUUID(),
          company,
          position,
          startDate,
          endDate,
          current: isPresent,
          description: "",
          bulletPoints: [],
          technologies: [],
        };

        return;
      }

      if (
        line.startsWith("•") ||
        line.startsWith("-") ||
        line.startsWith("*")
      ) {
        current?.bulletPoints.push({
          id: crypto.randomUUID(),
          text: line.replace(/^[•*\-]\s*/, ""),
          impact: "medium",
          issues: [],
        });

        return;
      }

      if (current) {
        current.description += `${line} `;
      }
    });

    if (current) {
      experiences.push(current);
    }

    return experiences;
  }

  private parseEducation(content: string): any[] {
    if (!content) {
      return [];
    }

    const lines = content
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const degreeKeywords = /\b(bachelor|master|b\.?\s?tech|m\.?\s?tech|b\.?\s?sc|m\.?\s?sc|b\.?e\.?|m\.?e\.?|mba|ph\.?d|associate|diploma|degree|b\.?\s?a\.?|m\.?\s?a\.?|b\.?\s?com|m\.?\s?com)\b/i;
    const institutionKeywords = /\b(university|college|institute|school|academy|polytechnic)\b/i;
    const scoreKeywords = /\b(gpa|cgpa|percentage|score)\b/i;

    const educationInfo: any[] = [];
    let current: any = null;

    const finalizeCurrent = () => {
      if (current) educationInfo.push(current);
      current = null;
    };

    for (const line of lines) {
      // Mirrors the notebook's guard against an "Interests" section bleeding
      // into Education when a resume has no blank line between them.
      if (/\binterests?\b/i.test(line)) continue;

      const clean = line.replace(/^[•*\-]\s*/, "").trim();
      const duration = this.extractDurationRange(line);

      if (degreeKeywords.test(line)) {
        finalizeCurrent();
        current = {
          id: crypto.randomUUID(),
          institution: "",
          degree: clean,
          field: "",
          location: "",
          graduationDate: duration ? (duration.current ? "Present" : duration.end || duration.raw) : "",
          gpa: "",
          honors: [] as string[],
        };
        continue;
      }

      if (!current) {
        // No degree line seen yet, but an institution line came first.
        if (institutionKeywords.test(line)) {
          current = {
            id: crypto.randomUUID(),
            institution: clean,
            degree: "",
            field: "",
            location: "",
            graduationDate: "",
            gpa: "",
            honors: [] as string[],
          };
        }
        continue;
      }

      if (institutionKeywords.test(line) && !current.institution) {
        current.institution = clean;
        continue;
      }

      if (scoreKeywords.test(line)) {
        const scoreMatch = line.match(/(\d+(\.\d+)?\s*%)|(\d+(\.\d+)?\s*\/\s*\d+(\.\d+)?)|(?:cgpa|gpa)[:\s]*([\d.]+)/i);
        current.gpa = scoreMatch ? scoreMatch[0].trim() : clean;
        continue;
      }

      if (duration && !current.graduationDate) {
        current.graduationDate = duration.current ? "Present" : duration.end || duration.raw;
        continue;
      }
    }

    finalizeCurrent();

    // Fallback: if nothing matched any keyword (e.g. a terse one-line-per-entry
    // resume), don't return an empty list — treat each remaining line as a
    // minimal entry so we never silently drop education info entirely.
    if (educationInfo.length === 0) {
      return lines
        .filter((line) => !/\binterests?\b/i.test(line))
        .map((line) => {
          const duration = this.extractDurationRange(line);
          return {
            id: crypto.randomUUID(),
            institution: line.split(",")[0]?.trim() || "",
            degree: line.replace(/^[•*\-]\s*/, "").trim(),
            field: "",
            location: "",
            graduationDate: duration ? (duration.current ? "Present" : duration.end || duration.raw) : (line.match(/\b(19|20)\d{2}\b/)?.[0] || ""),
            gpa: "",
            honors: [] as string[],
          };
        });
    }

    return educationInfo;
  }

  private parseProjects(content: string): any[] {
    if (!content) {
      return [];
    }

    const projects: any[] = [];
    let current: any = null;

    content
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        const isBullet =
          line.startsWith("•") ||
          line.startsWith("-") ||
          line.startsWith("*");

        if (!isBullet) {
          if (current) {
            projects.push(current);
          }

          // Split name and year/desc if present
          const parts = line.split(/\s*(?:—|–|\s-\s)\s*/);
          const name = parts[0].trim();

          current = {
            id: crypto.randomUUID(),
            name,
            description: line,
            technologies: [],
            bulletPoints: [],
          };

          return;
        }

        current?.bulletPoints.push(
          line.replace(/^[•*\-]\s*/, "")
        );
      });

    if (current) {
      projects.push(current);
    }

    return projects;
  }

  private extractSkillsFromText(text: string, languagesSectionText: string = "") {
    const lower = text.toLowerCase();

    const techSkills = [
      "javascript", "typescript", "python", "react", "vue", "angular", "node",
      "express", "java", "spring", "c#", ".net", "go", "rust", "php", "docker",
      "kubernetes", "aws", "azure", "gcp", "postgresql", "mongodb", "mysql",
      "redis", "git", "ci/cd", "html", "css", "sass", "webpack", "linux", "bash",
    ];

    const toolSkills = [
      "git", "docker", "jira", "confluence", "jenkins", "github actions", "gitlab ci",
      "kubernetes", "terraform", "ansible", "figma", "postman", "slack", "trello",
      "asana", "notion", "servicenow", "splunk", "grafana", "prometheus", "datadog",
    ];

    const softSkillKeywords = [
      "communication", "leadership", "teamwork", "problem-solving", "problem solving",
      "collaboration", "adaptability", "critical thinking", "time management",
      "mentoring", "stakeholder management", "conflict resolution", "creativity",
    ];

    // Spoken/written languages — distinct from programming languages above.
    // Checked against a dedicated Languages section when the resume has one
    // (more reliable), falling back to a full-text scan otherwise.
    const languageKeywords = [
      "english", "spanish", "french", "german", "hindi", "tamil", "telugu",
      "kannada", "malayalam", "marathi", "bengali", "gujarati", "punjabi",
      "urdu", "mandarin", "chinese", "japanese", "korean", "portuguese",
      "italian", "russian", "arabic", "dutch", "turkish", "vietnamese",
      "thai", "polish", "swedish", "greek",
    ];
    const languageScanText = (languagesSectionText || text).toLowerCase();
    const languages = languageKeywords
      .filter((lang) => new RegExp(`\\b${lang}\\b`, "i").test(languageScanText))
      .map((lang) => lang.charAt(0).toUpperCase() + lang.slice(1));

    return {
      technical: techSkills.filter((skill) => lower.includes(skill)),
      soft: softSkillKeywords.filter((skill) => lower.includes(skill)),
      tools: toolSkills.filter((skill) => lower.includes(skill)),
      languages,
      other: [],
    };
  }

  private async enhanceResume(
    parsed: ParsedResume,
    analysis: any,
    jdText?: string
  ): Promise<EnhancedResume> {
    // Gather every bullet point (experience + projects) plus the summary into one flat
    // list, so the whole resume's enhancement is a SINGLE batched LLM call rather than
    // one call per bullet point.
    const items: EnhancementItem[] = [];
    if (parsed.summary) {
      items.push({ id: "__summary__", text: parsed.summary });
    }
    parsed.experience.forEach((exp: any) => {
      exp.bulletPoints.forEach((bp: any, idx: number) => {
        items.push({ id: `exp::${exp.id}::${idx}`, text: bp.text });
      });
    });
    parsed.projects.forEach((proj: any) => {
      proj.bulletPoints.forEach((bp: string, idx: number) => {
        items.push({ id: `proj::${proj.id}::${idx}`, text: bp });
      });
    });

    const enhancedTextById = await enhanceTextItemsWithAI(items, {
      jdText,
      targetRoles: analysis?.targetRoles,
    });

    const enhanced: EnhancedResume = {
      summary: parsed.summary
        ? (enhancedTextById.get("__summary__") || localEngine.rewriteSummary(parsed.summary))
        : "",

      experience: {},

      projects: {},

      skills: {
        added:
          analysis.keywordAnalysis
            ?.suggestedKeywords || [],

        removed: [],

        reorganized: true,
      },

      suggestions:
        (analysis.isLocal ? localEngine.generateSuggestions(analysis) : geminiEngine.generateSuggestions(analysis)),
    };

    parsed.experience.forEach((exp: any) => {
      enhanced.experience[exp.id] = {
        bulletPoints: exp.bulletPoints.map(
          (bp: any, idx: number) => {
            const improved =
              enhancedTextById.get(`exp::${exp.id}::${idx}`) ||
              localEngine.enhanceBulletPoint(bp.text, "");

            return {
              original: bp.text,

              enhanced: improved,

              changes: this.detectChanges(
                bp.text,
                improved
              ),
            };
          }
        ),
      };
    });

    parsed.projects.forEach((proj: any) => {
      enhanced.projects[proj.id] = {
        description: proj.description,

        bulletPoints: proj.bulletPoints.map(
          (bp: string, idx: number) => ({
            original: bp,

            enhanced:
              enhancedTextById.get(`proj::${proj.id}::${idx}`) ||
              localEngine.enhanceBulletPoint(bp, ""),
          })
        ),
      };
    });

    return enhanced;
  }

  private detectChanges(
    original: string,
    enhanced: string
  ): string[] {
    const changes: string[] = [];

    if (enhanced.length > original.length) {
      changes.push("Improved wording");
    }

    if (
      (enhanced.match(/\d+/g) || []).length >
      (original.match(/\d+/g) || []).length
    ) {
      changes.push("Added metrics");
    }

    return changes;
  }

  generateReport(
    parsed: ParsedResume,
    analysis: any,
    enhanced: any
  ): ResumeReport {
    const score = analysis.overallScore || 50;

    const hiringConfidence = analysis.hiringConfidence || (
      score >= 85
        ? "very-high"
        : score >= 70
        ? "high"
        : score >= 50
        ? "medium"
        : "low"
    );

    return {
      executiveSummary:
        analysis.executiveSummary || this.getExecutive(score, parsed),

      recruiterInsights:
        this.getInsights(analysis),

      hiringConfidence,

      industryFit:
        analysis.industryFit || this.getIndustryFit(parsed),

      targetRoles:
        analysis.targetRoles || this.getRoles(parsed),

      priorityImprovements:
        (analysis.isLocal ? localEngine.generateSuggestions(analysis) : geminiEngine.generateSuggestions(analysis))
          .slice(0, 5)
          .map((s: any, i: number) => ({
            rank: i + 1,

            category: s.section,

            title:
              s.description.split(".")[0],

            description: s.description,

            effort: "medium",

            impact:
              s.priority === "high"
                ? "high"
                : "medium",
          })),

      visualMetrics: {
        overallScore: score,

        atsScore: analysis.atsScore || 50,

        radarData: [
          {
            subject: "Content",
            value:
              analysis.scores?.clarity || 50,
            fullMark: 100,
          },
          {
            subject: "Format",
            value:
              analysis.scores?.formatting ||
              50,
            fullMark: 100,
          },
          {
            subject: "ATS",
            value:
              analysis.atsScore || 50,
            fullMark: 100,
          },
          {
            subject: "Impact",
            value:
              analysis.impactScore || 50,
            fullMark: 100,
          },
          {
            subject: "Technical",
            value:
              analysis.technicalScore ||
              50,
            fullMark: 100,
          },
        ],

        scoreHistory: [],

        topSkills:
          parsed.skills.technical
            .slice(0, 5)
            .map((name: string, i: number) => ({
              name,
              score: Math.max(50, 100 - i * 10),
            })),
      },
      suitability: analysis.suitability || (analysis.jdMatchScore !== undefined && analysis.jdMatchScore >= 40 ? "suitable" : "unsuitable"),
      jdMatchScore: analysis.jdMatchScore !== undefined ? analysis.jdMatchScore : null,
      jdMatchRationale: analysis.jdMatchRationale || null,
    };
  }

  private getExecutive(score: number, parsed: ParsedResume): string {
    const techSkills = parsed.skills?.technical || [];
    const topSkills = techSkills.slice(0, 3).join(", ");
    
    if (score >= 80) {
      if (topSkills) {
        return `A highly proficient professional with a strong background in ${topSkills}. The profile demonstrates clear quantifiable impact and exceptional capabilities.`;
      }
      return "Strong resume with well-structured experience and quantifiable achievements.";
    }

    if (score >= 60) {
      if (topSkills) {
        return `A capable professional skilled in ${topSkills}. The resume has a good foundation but could benefit from stronger action verbs and clearer metrics.`;
      }
      return "Good resume foundation but improvements to quantifiable impact and wording are recommended.";
    }

    return "Resume requires significant optimization, specifically around measurable outcomes and formatting.";
  }

  private getInsights(analysis: any): string[] {
    const insights: string[] = [
      `Resume Score: ${analysis.overallScore || 0}/100`,
    ];

    if (analysis.scores?.actionVerbs < 60) {
      insights.push(
        "Use stronger action verbs."
      );
    }

    if (analysis.scores?.measurability < 50) {
      insights.push(
        "Add measurable achievements."
      );
    }

    if (analysis.atsScore < 70) {
      insights.push(
        "Improve ATS formatting."
      );
    }

    return insights;
  }

  private getIndustryFit(parsed: ParsedResume) {
    const tech =
      parsed.skills.technical.map((t: string) =>
        t.toLowerCase()
      );

    const fits = [
      {
        industry: "Software Development",

        matchScore:
          tech.filter((t) =>
            [
              "javascript",
              "python",
              "react",
              "node",
            ].includes(t)
          ).length * 25,

        rationale:
          "Strong software development stack",
      },

      {
        industry: "Cloud / DevOps",

        matchScore:
          tech.filter((t) =>
            [
              "aws",
              "docker",
              "kubernetes",
              "ci/cd",
            ].includes(t)
          ).length * 25,

        rationale:
          "Strong infrastructure skills",
      },

      {
        industry: "Data Engineering",

        matchScore:
          tech.filter((t) =>
            [
              "python",
              "sql",
              "etl",
              "analytics",
            ].includes(t)
          ).length * 25,

        rationale:
          "Strong data engineering skillset",
      },
    ];

    return fits
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, 3);
  }

  private getRoles(parsed: ParsedResume): string[] {
    const skills = [
      ...(parsed.skills.technical || []),
      ...(parsed.skills.soft || []),
      ...(parsed.skills.tools || []),
      ...(parsed.skills.languages || []),
      ...(parsed.skills.other || [])
    ].map((t: string) => t.toLowerCase());

    const titleLower = parsed.personal?.title?.toLowerCase() || "";
    const expTitles = parsed.experience.map((e: any) => e.position.toLowerCase()).join(" ");

    const roleDefinitions = [
      { role: "Frontend Developer", keywords: ["react", "vue", "angular", "html", "css", "javascript", "typescript", "frontend", "ui", "web"] },
      { role: "Backend Developer", keywords: ["node", "python", "java", "spring", "c#", ".net", "go", "ruby", "django", "flask", "backend", "api", "database", "sql", "postgresql", "mysql", "mongodb"] },
      { role: "Full Stack Developer", keywords: ["react", "node", "python", "java", "vue", "angular", "full stack", "fullstack", "javascript", "typescript"] },
      { role: "Machine Learning Engineer", keywords: ["machine learning", "ml", "pytorch", "tensorflow", "model", "deep learning", "nlp", "computer vision"] },
      { role: "AI Engineer", keywords: ["ai", "artificial intelligence", "openai", "llm", "langchain", "prompt", "transformer", "hugging face", "agent"] },
      { role: "RAG Specialist", keywords: ["rag", "pinecone", "vector", "qdrant", "chroma", "retrieval", "embedding"] },
      { role: "Data Scientist", keywords: ["python", "r", "machine learning", "ml", "ai", "pandas", "numpy", "tensorflow", "pytorch", "data science", "statistics", "data analysis"] },
      { role: "Data Engineer", keywords: ["python", "sql", "etl", "spark", "hadoop", "kafka", "data pipeline", "airflow", "aws", "gcp"] },
      { role: "DevOps Engineer", keywords: ["docker", "kubernetes", "aws", "azure", "gcp", "ci/cd", "jenkins", "terraform", "ansible", "linux", "bash", "devops"] },
      { role: "UI/UX Designer", keywords: ["figma", "sketch", "adobe", "ui", "ux", "wireframe", "prototype", "user experience", "user interface", "design"] },
      { role: "Product Manager", keywords: ["product", "roadmap", "agile", "scrum", "jira", "stakeholder", "strategy", "product management", "market research"] }
    ];

    const scoredRoles = roleDefinitions.map(def => {
      let score = 0;
      let matchedKeywords = 0;

      def.keywords.forEach(kw => {
        if (skills.some(s => s.includes(kw))) {
          score += 10;
          matchedKeywords++;
        }
        if (titleLower.includes(kw)) score += 25;
        if (expTitles.includes(kw)) score += 10;
      });

      if (def.role === "Full Stack Developer") {
        const hasFront = skills.some(s => ["react", "vue", "angular", "html", "css"].includes(s));
        const hasBack = skills.some(s => ["node", "python", "java", "sql", "database", "api"].includes(s));
        if (!hasFront || !hasBack) score = 0;
      }

      return { role: def.role, score, matchedKeywords };
    });

    const topRoles = scoredRoles
      .filter(r => r.score > 0 && r.matchedKeywords >= 1)
      .sort((a, b) => b.score - a.score);

    const totalYears = parsed.experience.length * 1.5; // Rough estimate
    
    const result = topRoles.slice(0, 3).map(r => {
      let finalRole = r.role;
      if (totalYears >= 5 && !finalRole.includes("Manager") && !finalRole.includes("Specialist")) {
        finalRole = `Senior ${finalRole}`;
      }
      return finalRole;
    });

    if (result.some(r => r.includes("AI")) && result.some(r => r.includes("Full Stack"))) {
      result.unshift("Full-Stack AI Developer");
    }

    return result.length > 0 ? Array.from(new Set(result)).slice(0, 4) : ["Professional"];
  }

  private getResumesJsonPath() {
    return join(this.getUploadsRoot(), "resumes.json");
  }

  private async ensureResumesJson(): Promise<any[]> {
    const path = this.getResumesJsonPath();
    try {
      const raw = await readFile(path, "utf8");
      return JSON.parse(raw);
    } catch (e: any) {
      if (e.code === "ENOENT") {
        return [];
      }
      console.error("Failed to read local resumes index:", e);
      return [];
    }
  }

  private async saveResumesJson(resumes: any[]) {
    const path = this.getResumesJsonPath();
    await mkdir(this.getUploadsRoot(), { recursive: true });
    await writeFile(path, JSON.stringify(resumes, null, 2), "utf8");
  }

  async saveResumeRow(resume: ResumeData): Promise<void> {
    this.cache.set(resume.id, resume);
    
    const row = {
      id: resume.id,
      filename: resume.filename || "unknown",
      text_content: resume.originalText || "",
      parsed: resume.parsed || null,
      analysis: resume.analysis || null,
      enhanced: resume.enhanced || null,
      report: resume.report || null,
      error: resume.error || null,
      file_hash: resume.fileHash || null,
      file_base64: resume.fileBase64 || null,
      created_at: resume.createdAt?.toISOString() || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    let dbError: any = null;
    try {
      const { error } = await supabase.from("resumes").upsert({
        id: row.id,
        filename: row.filename,
        text_content: row.text_content,
        parsed: row.parsed ? JSON.stringify(row.parsed) : null,
        analysis: row.analysis ? JSON.stringify(row.analysis) : null,
        enhanced: row.enhanced ? JSON.stringify(row.enhanced) : null,
        report: row.report ? JSON.stringify(row.report) : null,
        error: row.error,
        file_hash: row.file_hash,
        file_base64: row.file_base64,
      });
      dbError = error;
    } catch (e) {
      dbError = e;
    }

    if (dbError) {
      console.error("⚠️ [DB] Failed to save resume to Supabase:", dbError.message || dbError);
    }

  }

  private async loadResumeFromDisk(id: string): Promise<any> {
    let row: any = null;
    try {
      const { data, error } = await supabase.from('resumes').select('*').eq('id', id).single();
      if (!error && data) {
        row = data;
      }
    } catch (e) {}

    if (!row) return null;

    const resume: ResumeData = {
      id: row.id,
      filename: row.filename,
      originalText: row.text_content || row.originalText || "",
      parsed: row.parsed ? (typeof row.parsed === 'string' ? JSON.parse(row.parsed) : row.parsed) : undefined,
      analysis: row.analysis ? (typeof row.analysis === 'string' ? JSON.parse(row.analysis) : row.analysis) : undefined,
      enhanced: row.enhanced ? (typeof row.enhanced === 'string' ? JSON.parse(row.enhanced) : row.enhanced) : undefined,
      report: row.report ? (typeof row.report === 'string' ? JSON.parse(row.report) : row.report) : undefined,
      error: row.error || undefined,
      fileHash: row.file_hash || row.fileHash || undefined,
      fileBase64: row.file_base64 || row.fileBase64 || undefined,
      createdAt: row.created_at ? new Date(row.created_at) : new Date(),
      updatedAt: row.updated_at ? new Date(row.updated_at) : new Date(),
      status: row.error ? "failed" : "completed"
    };
    
    this.cache.set(id, resume);
    return resume;
  }

  async getCachedResume(id: string, forceFresh = false): Promise<any> {
    if (!forceFresh) {
      const cached = this.cache.get(id);
      if (cached) {
        return cached;
      }
    }
    return this.loadResumeFromDisk(id);
  }

  async getAllResumes(): Promise<ResumeData[]> {
    let rows: any[] = [];
    try {
      const { data, error } = await supabase.from('resumes').select('id, filename, parsed, analysis, enhanced, report, error, created_at, file_hash').order('created_at', { ascending: false });
      if (!error && data) {
        rows = data;
      } else if (error) {
        console.warn("Failed to fetch resumes from Supabase, falling back to local storage:", error.message);
        rows = await this.ensureResumesJson();
      }
    } catch (e) {
      console.warn("Failed to fetch resumes from Supabase (exception), falling back to local storage:", e);
      try {
        rows = await this.ensureResumesJson();
      } catch (localErr) {}
    }

    if (rows.length === 0) {
      try {
        rows = await this.ensureResumesJson();
      } catch (e) {}
    }

    return rows.map((row: any) => this.mapRowToResume(row));
  }

  private mapRowToResume(row: any): ResumeData {
    return {
      id: row.id,
      filename: row.filename || 'unknown',
      originalText: row.text_content || '',
      parsed: row.parsed ? (typeof row.parsed === 'object' ? row.parsed : JSON.parse(row.parsed)) : ({} as any),
      analysis: row.analysis ? (typeof row.analysis === 'object' ? row.analysis : JSON.parse(row.analysis)) : ({} as any),
      enhanced: row.enhanced ? (typeof row.enhanced === 'object' ? row.enhanced : JSON.parse(row.enhanced)) : ({} as any),
      report: row.report ? (typeof row.report === 'object' ? row.report : JSON.parse(row.report)) : ({} as any),
      error: row.error || undefined,
      fileHash: row.file_hash || undefined,
      fileBase64: row.file_base64 || undefined,
      createdAt: row.created_at ? new Date(row.created_at) : new Date(),
      updatedAt: row.updated_at ? new Date(row.updated_at) : (row.created_at ? new Date(row.created_at) : new Date()),
      status: row.error ? 'failed' : 'completed',
    };
  }
}

// Next.js Hot Module Replacement singleton protection
const globalForResumeService = globalThis as unknown as {
  resumeServiceInstance: ResumeService;
};

export const resumeService =
  globalForResumeService.resumeServiceInstance ||
  ResumeService.getInstance();

if (process.env.NODE_ENV !== "production") {
  globalForResumeService.resumeServiceInstance = resumeService;
}
