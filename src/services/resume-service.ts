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
      const parsed = this.parseStructure(text);
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

      const enhanced = this.enhanceResume(parsed, analysis);
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

  private matchHeader(line: string): string | null {
    const clean = line.replace(/[•*\-\u2022\s]+/g, " ").trim().toLowerCase();
    if (clean.length === 0 || clean.length > 40) return null;

    const mappings = [
      { name: "summary", patterns: [/^(?:profile\s+summary|summary|profile|professional\s+summary|objective|career\s+objective|about\s+me|about)$/] },
      { name: "experience", patterns: [/^(?:experience|professional\s+experience|work\s+experience|employment|employment\s+history|work\s+history|internships?|internship\s+experience|professional\s+history)$/] },
      { name: "education", patterns: [/^(?:education|academic\s+background|academic\s+profile|academics?|education\s+details?|academic\s+details?)$/] },
      { name: "skills", patterns: [/^(?:skills|technical\s+skills|core\s+competencies|key\s+skills|expertise|skills\s+&\s+tools|technologies)$/] },
      { name: "projects", patterns: [/^(?:projects|academic\s+projects|personal\s+projects|selected\s+projects)$/] },
      { name: "certifications", patterns: [/^(?:certifications?|licenses\s+&\s+certifications?|credentials?)$/] },
      { name: "publications", patterns: [/^(?:publications?|research\s+publications?|papers)$/] }
    ];

    for (const mapping of mappings) {
      if (mapping.patterns.some(p => p.test(clean))) {
        return mapping.name;
      }
    }
    return null;
  }

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

      skills: this.extractSkillsFromText(text),

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

    return {
      fullName:
        lines[0]
          ?.replace(/[•*\-]/g, "")
          .trim() || "",

      email,

      phone,

      linkedin: linkedin
        ? `https://${linkedin}`
        : "",

      github: github
        ? `https://${github}`
        : "",

      title: lines[1]?.trim() || "",
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

    return content
      .split("\n")
      .filter(Boolean)
      .map((line) => ({
        id: crypto.randomUUID(),
        institution: line.split(",")[0]?.trim() || "",
        degree: line.trim(),
        graduationDate: line.match(/\b(19|20)\d{2}\b/)?.[0] || "",
      }));
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

  private extractSkillsFromText(text: string) {
    const lower = text.toLowerCase();

    const techSkills = [
      "javascript",
      "typescript",
      "python",
      "react",
      "vue",
      "angular",
      "node",
      "express",
      "java",
      "spring",
      "c#",
      ".net",
      "go",
      "rust",
      "php",
      "docker",
      "kubernetes",
      "aws",
      "azure",
      "gcp",
      "postgresql",
      "mongodb",
      "mysql",
      "redis",
      "git",
      "ci/cd",
      "html",
      "css",
      "sass",
      "webpack",
      "linux",
      "bash",
    ];

    return {
      technical: techSkills.filter((skill) =>
        lower.includes(skill)
      ),

      soft: [
        "communication",
        "leadership",
        "teamwork",
        "problem-solving",
      ],

      tools: ["git", "docker", "jira"],

      languages: [],

      other: [],
    };
  }

  private enhanceResume(
    parsed: ParsedResume,
    analysis: any
  ): EnhancedResume {
    const enhanced: EnhancedResume = {
      summary: parsed.summary
        ? localEngine.rewriteSummary(parsed.summary)
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
          (bp: any) => {
            const improved =
              localEngine.enhanceBulletPoint(
                bp.text,
                ""
              );

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
          (bp: string) => ({
            original: bp,

            enhanced:
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
