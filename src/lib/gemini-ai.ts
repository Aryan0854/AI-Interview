import { GoogleGenerativeAI } from "@google/generative-ai";
import type { ParsedResume } from "@/types/resume";

export class GeminiAIEngine {
  private ai: GoogleGenerativeAI | null = null;
  private model: any = null;
  private initialized: boolean = false;

  constructor() {
    // Don't initialize in constructor - use lazy initialization instead
  }

  private ensureInitialized() {
    if (this.initialized) return;
    
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      this.ai = new GoogleGenerativeAI(apiKey);
      this.model = this.ai.getGenerativeModel({
        model: "gemini-2.0-flash",
      });
    } else {
      console.warn("GEMINI_API_KEY is not set.");
    }
    
    this.initialized = true;
  }

  async analyzeResume(text: string, parsed: ParsedResume, jdText?: string): Promise<any> {
    this.ensureInitialized();
    if (!this.model) {
      throw new Error("GEMINI_API_KEY is not configured on the server.");
    }

    const isJDMatch = !!jdText && jdText.trim().length > 0;

    const prompt = isJDMatch ? `
    You are a principal technical recruiter and an elite CV-to-Job-Description matching engine.
    Perform a highly precise, critical, and objective evaluation of the candidate's suitability for the provided Job Description (JD).
    
    Job Description:
    ${jdText}
    
    Resume Text:
    ${text.substring(0, 10000)} // Truncate to save tokens, preserving full context

    Parsed Structure:
    ${JSON.stringify(parsed, null, 2)}

    RIGOROUS EVALUATION CRITERIA:
    1. CORE VS. PREFERRED SKILLS:
       - Must-Have (Core) Skills: Identify the primary required technologies and qualifications in the JD.
       - Nice-to-Have (Secondary) Skills: Identify optional or preferred skills in the JD.
       - Evidence Check: Look for actual evidence of these technologies in the candidate's "Work Experience" details. Do not rely solely on a summary or tags in a "Skills" section without corresponding project/role context. If a skill only appears in a skills dump list without experience context, reduce its matching weight by 50%.
    
    2. RECENCY & DURATION:
       - Calculate the duration of usage for core skills (e.g., 5+ years vs. 3 months).
       - Assess recency: Is the candidate currently using the technology, or was it used in a distant past role? Recent usage carries much higher weight.
       
    3. ROLE LEVEL & SENIORITY FIT:
       - Compare candidate seniority level (e.g., Junior, Mid, Senior, Lead) with the JD requirements. A senior JD requires senior-level design, leadership, or architecture achievements.
       
    4. STRICT SCORING RUBRIC (BE EXTREMELY CRITICAL - DO NOT INFLATE SCORES):
       - 85 - 100 (Exceptional Fit): Meets all core and almost all secondary requirements with extensive, recent, and hands-on experience at or above the required seniority level.
       - 70 - 84 (Strong Fit): Meets all core requirements and has some preferred skills, with recent experience.
       - 55 - 69 (Moderate/Fair Fit): Meets most core requirements but has gaps in some key areas, or has the core skills but with limited depth or non-recent usage.
       - 40 - 54 (Weak Fit): Missing major core technical requirements or lacks sufficient seniority, but has basic overlapping competencies.
       - Under 40 (Unsuitable Fit): Missing core requirements, lacks overall eligibility, or severe seniority mismatch.
    
    5. SUITABILITY CLASSIFICATION:
       - "suitable": strictly if the jdMatchScore is >= 40 AND they possess the baseline core technical skills.
       - "unsuitable": strictly if the jdMatchScore is < 40 OR they lack the fundamental core technologies required by the JD.
    
    Return ONLY a raw JSON object with no markdown formatting.
    Ensure the JSON matches this exact structure:
    {
      "executiveSummary": "A 2-3 sentence summary of the candidate's profile highlighting their fit.",
      "overallScore": 85, // out of 100
      "atsScore": 80, // out of 100
      "technicalScore": 90, // out of 100
      "impactScore": 75, // out of 100
      "communicationScore": 85, // out of 100
      "scores": {
        "actionVerbs": 80,
        "measurability": 70,
        "formatting": 90,
        "clarity": 85,
        "consistency": 95,
        "keywordOptimization": 80
      },
      "weaknesses": [
        {
          "category": "technical",
          "severity": "high", // high, medium, low
          "location": "Experience Section",
          "description": "Lacks experience in React and Node.js which are core required technologies.",
          "suggestion": "Gain experience with React or Node.js.",
          "examples": []
        }
      ],
      "strengths": [
        {
          "category": "Technical",
          "description": "Strong full-stack experience",
          "impact": "high" // high, medium, low
        }
      ],
      "targetRoles": ["Senior Frontend Developer", "Full Stack Engineer"], // Be highly accurate based on skills and experience
      "industryFit": [
        {
          "industry": "Software Development",
          "matchScore": 95, // out of 100
          "rationale": "Extensive experience with modern web frameworks"
        }
      ],
      "keywordAnalysis": {
        "suggestedKeywords": ["Docker", "CI/CD", "Testing"]
      },
      "suitability": "suitable", // MUST be either "suitable" or "unsuitable"
      "jdMatchScore": 75, // 0 to 100 rating how well they fit the JD
      "jdMatchRationale": "Detailed 2-3 sentence reason. Must name specifically: 1. Core tech that matched, 2. Core tech/experience elements that were missing/weak, 3. Summary of experience fit."
    }` : `
    You are an expert technical recruiter and resume analyst.
    Analyze the following resume text and parsed structure. Provide a highly accurate, critical evaluation.
    Return ONLY a raw JSON object with no markdown formatting.

    Resume Text:
    ${text.substring(0, 5000)} // Truncate to save tokens

    Parsed Structure:
    ${JSON.stringify(parsed, null, 2)}

    Ensure the JSON matches this exact structure:
    {
      "executiveSummary": "A 2-3 sentence summary of the candidate's profile.",
      "overallScore": 85, // out of 100
      "atsScore": 80, // out of 100
      "technicalScore": 90, // out of 100
      "impactScore": 75, // out of 100
      "communicationScore": 85, // out of 100
      "scores": {
        "actionVerbs": 80,
        "measurability": 70,
        "formatting": 90,
        "clarity": 85,
        "consistency": 95,
        "keywordOptimization": 80
      },
      "weaknesses": [
        {
          "category": "impact",
          "severity": "high", // high, medium, low
          "location": "Experience Section",
          "description": "Lacks quantifiable metrics in the recent role",
          "suggestion": "Add concrete numbers to demonstrate impact",
          "examples": ["Developed new feature"]
        }
      ],
      "strengths": [
        {
          "category": "Technical",
          "description": "Strong full-stack experience",
          "impact": "high" // high, medium, low
        }
      ],
      "targetRoles": ["Senior Frontend Developer", "Full Stack Engineer"], // Be highly accurate based on skills and experience
      "industryFit": [
        {
          "industry": "Software Development",
          "matchScore": 95, // out of 100
          "rationale": "Extensive experience with modern web frameworks"
        }
      ],
      "keywordAnalysis": {
        "suggestedKeywords": ["Docker", "CI/CD", "Testing"]
      }
    }`;

    try {
      const result = await this.model.generateContent(prompt);
      const response = await (result as any)?.response;
      let textResponse = response?.text?.() ?? '';
      
      // Clean up markdown if the model returns it despite instructions
      textResponse = textResponse.replace(/```json/gi, '').replace(/```/g, '').trim();
      
      try {
        return JSON.parse(textResponse);
      } catch (parseError) {
        console.error("Failed to parse Gemini response:", textResponse);
        throw new Error("AI returned malformed JSON response.");
      }
    } catch (error: any) {
      console.error("Gemini API Error:", error.message || error);
      throw new Error(`Gemini Analysis Failed: ${error.message || "Unknown error"}`);
    }
  }

  // Fallback for smaller rewrites
  enhanceBulletPoint(bullet: string, context: string): string {
    return bullet; // Handled by LLM if we want, or fallback to local
  }

  async generateText(prompt: string): Promise<any> {
    this.ensureInitialized();
    if (!this.model) {
      throw new Error("GEMINI_API_KEY is not configured.");
    }
    const result = await this.model.generateContent(prompt);
    const response = await (result as any)?.response;
    let textResponse = response?.text?.() ?? '';
    
    // Clean up markdown block styling
    let cleaned = textResponse.trim();
    
    // Find bracket boundaries for JSON
    const arrayStart = cleaned.indexOf('[');
    const objStart = cleaned.indexOf('{');
    let startIdx = -1;
    let endIdx = -1;

    if (arrayStart !== -1 && (objStart === -1 || arrayStart < objStart)) {
      startIdx = arrayStart;
      endIdx = cleaned.lastIndexOf(']');
    } else if (objStart !== -1) {
      startIdx = objStart;
      endIdx = cleaned.lastIndexOf('}');
    }

    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      cleaned = cleaned.substring(startIdx, endIdx + 1);
    } else {
      // Fallback manual replacement
      cleaned = cleaned.replace(/```json/gi, '').replace(/```/g, '').trim();
    }

    try {
      return JSON.parse(cleaned);
    } catch (parseError) {
      console.error("Failed to parse Gemini JSON response. Raw was:", textResponse);
      throw parseError;
    }
  }

  generateSuggestions(analysis: any): any[] {
    // Generate actionable suggestions based on weaknesses from LLM
    if (!analysis || !analysis.weaknesses) return [];
    
    return analysis.weaknesses.map((w: any, i: number) => ({
      type: "modify",
      section: w.location.toLowerCase().includes("experience") ? "experience" : "summary",
      priority: w.severity,
      description: w.description,
      rationale: w.suggestion
    }));
  }

  async verifyFaceMatch(
    idImageBase64: string,
    idMimeType: string,
    selfieImageBase64: string,
    selfieMimeType: string
  ): Promise<{ matched: boolean; confidence: number; reason: string }> {
    const { exec } = require("child_process");
    const { promisify } = require("util");
    const { writeFile, unlink } = require("fs/promises");
    const { join } = require("path");
    const fs = require("fs");
    const execPromise = promisify(exec);

    const cleanBase64 = (base64Str: string) => {
      const match = base64Str.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        return { mimeType: match[1], data: match[2] };
      }
      return { mimeType: null, data: base64Str };
    };

    const idData = cleanBase64(idImageBase64);
    const selfieData = cleanBase64(selfieImageBase64);

    const tempDir = join(process.cwd(), "uploads", "temp");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const idTempPath = join(tempDir, `temp_id_${Date.now()}_${Math.random().toString(36).substring(7)}.png`);
    const selfieTempPath = join(tempDir, `temp_selfie_${Date.now()}_${Math.random().toString(36).substring(7)}.png`);

    try {
      await writeFile(idTempPath, Buffer.from(idData.data, "base64"));
      await writeFile(selfieTempPath, Buffer.from(selfieData.data, "base64"));

      const pythonScriptPath = join(process.cwd(), "faceproj", "compare_images.py");
      const preferredPython = process.platform === 'win32' ? 'py -3.11' : 'python3.11';
      const fallbackPython = 'python';
      let cmd = `${preferredPython} "${pythonScriptPath}" "${idTempPath}" "${selfieTempPath}"`;

      console.log(`Executing local biometric check command: ${cmd}`);
      let stdout: string;
      let stderr: string;
      try {
        const result = await execPromise(cmd, { maxBuffer: 10 * 1024 * 1024 });
        stdout = result.stdout;
        stderr = result.stderr;
      } catch (err: any) {
        // On Windows, prefer using the Python launcher; if that fails, fall back to the default python command.
        if (process.platform === 'win32') {
          cmd = `${fallbackPython} "${pythonScriptPath}" "${idTempPath}" "${selfieTempPath}"`;
          console.warn(`Preferred Python command failed, falling back to: ${cmd}`);
          const result = await execPromise(cmd, { maxBuffer: 10 * 1024 * 1024 });
          stdout = result.stdout;
          stderr = result.stderr;
        } else {
          throw err;
        }
      }

      if (stderr && stderr.trim().length > 0) {
        console.warn("Local biometric check stderr:", stderr);
      }
      console.log("Local biometric check result:", stdout);

      // Clean up temp files
      try {
        await unlink(idTempPath);
        await unlink(selfieTempPath);
      } catch (e) {
        console.warn("Failed to clean up temp files:", e);
      }

      // Parse JSON result from stdout
      const jsonStart = stdout.indexOf("{");
      const jsonEnd = stdout.lastIndexOf("}");
      if (jsonStart !== -1 && jsonEnd !== -1) {
        const jsonStr = stdout.substring(jsonStart, jsonEnd + 1);
        const parsed = JSON.parse(jsonStr);
        return {
          matched: typeof parsed.matched === "boolean" ? parsed.matched : parsed.matched === "true" || parsed.confidence >= 70,
          confidence: typeof parsed.confidence === "number" ? parsed.confidence : parseInt(parsed.confidence) || 0,
          reason: parsed.reason || "Local face match complete."
        };
      } else {
        throw new Error(`Python output did not contain valid JSON: ${stdout}`);
      }

    } catch (error: any) {
      console.error("Local face match verification error:", error);
      try {
        if (fs.existsSync(idTempPath)) await unlink(idTempPath);
        if (fs.existsSync(selfieTempPath)) await unlink(selfieTempPath);
      } catch (cleanupErr) {
        console.warn("Failed to clean up temp files on error:", cleanupErr);
      }
      const message = error.message || String(error);
      if (message.includes("No module named 'facenet_pytorch'") || message.includes('ModuleNotFoundError')) {
        throw new Error(
          "Local biometric engine dependency missing: install faceproj/requirements.txt and ensure Python dependencies are available."
        );
      }
      throw new Error(`Local Biometric Match Failed: ${message}`);
    }
  }
}

export const geminiEngine = new GeminiAIEngine();
