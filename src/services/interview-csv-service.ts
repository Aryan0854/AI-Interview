import { join } from 'path';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { supabase } from '@/lib/db';
import { resumeService } from './resume-service';
import { sessionService } from './session-service';

const getUploadsRoot = () => {
  return process.env.VERCEL === "1" ? "/tmp" : join(process.cwd(), "uploads");
};

const getCSVPath = () => {
  return join(getUploadsRoot(), "candidate_interview_data.csv");
};

function escapeCSV(val: any): string {
  if (val === null || val === undefined) return '';
  let str = String(val).trim();
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    str = '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

export class InterviewCSVService {
  private static instance: InterviewCSVService;

  static getInstance(): InterviewCSVService {
    if (!InterviewCSVService.instance) {
      InterviewCSVService.instance = new InterviewCSVService();
    }
    return InterviewCSVService.instance;
  }

  /**
   * Synchronizes all resumes and their interview attempts/conclusions from Supabase to local CSV.
   */
  async syncAllInterviewsToCSV(): Promise<void> {
    try {
      const resumes = await resumeService.getAllResumes();
      
      // Fetch all attempts
      const { data: attempts, error } = await supabase
        .from('interview_attempts')
        .select('*')
        .order('id', { ascending: true });
        
      if (error) throw error;

      // Group attempts by resume_id
      const attemptsMap: Record<string, any[]> = {};
      if (attempts) {
        attempts.forEach(a => {
          if (a.resume_id) {
            if (!attemptsMap[a.resume_id]) attemptsMap[a.resume_id] = [];
            attemptsMap[a.resume_id].push(a);
          }
        });
      }

      // Fetch all sessions to check if they are concluded
      const sessions = await sessionService.getAllSessions();
      const sessionsMap = new Map<string, boolean>();
      sessions.forEach(s => {
        if (s.resumeId) {
          sessionsMap.set(s.resumeId, s.used);
        }
      });

      const csvRows = [
        ["Candidate ID", "Candidate Name", "Email", "Interview Status", "Score", "Warnings", "Evaluation", "Timestamp"]
      ];

      for (const resume of resumes) {
        const candidateAttempts = attemptsMap[resume.id] || [];
        const isConcluded = sessionsMap.get(resume.id) || false;
        const hasAttempts = candidateAttempts.length > 0;
        
        const status = isConcluded ? "Completed" : (hasAttempts ? "In Progress" : "Pending");
        
        let avgScore = 0;
        if (hasAttempts) {
          const sum = candidateAttempts.reduce((acc, curr) => acc + (curr.mock_score || 0), 0);
          avgScore = Math.round((sum / candidateAttempts.length) * 10) / 10;
        }

        const warningCount = resume.report?.proctoring?.warningCount || 0;
        
        // Build a short evaluation summary from the feedback of attempts
        let evaluation = "No attempts recorded yet.";
        if (hasAttempts) {
          const feedBacks = candidateAttempts.map((a, i) => `Q${i+1}: ${a.mock_feedback || 'Recorded'}`).join(' | ');
          evaluation = feedBacks.substring(0, 300); // Truncate to reasonable size
        }

        const lastAttempt = candidateAttempts[candidateAttempts.length - 1];
        const timestamp = lastAttempt?.created_at || lastAttempt?.timestamp || resume.createdAt?.toISOString() || new Date().toISOString();

        csvRows.push([
          resume.id,
          resume.parsed?.personal?.fullName || resume.filename.replace(/\.[^/.]+$/, ""),
          resume.parsed?.personal?.email || "",
          status,
          String(avgScore),
          String(warningCount),
          evaluation,
          timestamp
        ]);
      }

      const csvContent = csvRows.map(row => row.map(escapeCSV).join(',')).join('\n');
      
      const csvPath = getCSVPath();
      await mkdir(getUploadsRoot(), { recursive: true });
      await writeFile(csvPath, csvContent, "utf8");
    } catch (err) {
      console.error("Failed to sync interviews to CSV:", err);
    }
  }

  /**
   * Retrieves the raw CSV content. Syncs first if file is not found.
   */
  async getCSVContent(): Promise<string> {
    const csvPath = getCSVPath();
    try {
      return await readFile(csvPath, "utf8");
    } catch (e: any) {
      if (e.code === "ENOENT") {
        await this.syncAllInterviewsToCSV();
        return await readFile(csvPath, "utf8");
      }
      throw e;
    }
  }
}

export const interviewCSVService = InterviewCSVService.getInstance();
