export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { resumeService } from '@/services/resume-service';
import { sessionService } from '@/services/session-service';
import { join } from 'path';
import { readFile, writeFile, mkdir } from 'fs/promises';
import nodemailer from 'nodemailer';
import { supabase } from '@/lib/db';
import { authenticateAdminRequest } from '@/lib/employee-auth';
import { checkCsrf, getClientIp } from '@/lib/security';
import { auditLogService } from '@/services/audit-log-service';
import { writeLog } from '@/lib/structured-logger';

const getTransporter = () => {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT || '465');
  const secure = port === 465;
  const user = process.env.SMTP_USER || 'aryan.collageid@gmail.com';
  const pass = process.env.SMTP_PASS;

  if (!pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass,
    },
    tls: {
      rejectUnauthorized: false
    }
  });
};


const getUploadsRoot = () => {
  return process.env.VERCEL === "1" ? "/tmp" : join(process.cwd(), "uploads");
};

const getEmailsPath = () => {
  return join(getUploadsRoot(), "emails.json");
};

async function logDispatchedEmail(emailRecord: any) {
  try {
    const { error } = await supabase.from('simulated_emails').insert({
      id: emailRecord.id,
      candidate_email: emailRecord.to,
      full_name: emailRecord.fullName,
      subject: emailRecord.subject,
      body: emailRecord.htmlBody,
      status: emailRecord.status,
      rm_email: emailRecord.rmEmail,
    });
    if (error) {
      console.error("Failed to write to simulated_emails table:", error);
    }
  } catch (err) {
    console.error("Failed to write to emails outbox:", err);
  }

  // Fallback: Maintain local backup file for local debugging
  try {
    await mkdir(getUploadsRoot(), { recursive: true });
    const path = getEmailsPath();
    let emails = [];
    try {
      const raw = await readFile(path, "utf8");
      emails = JSON.parse(raw);
    } catch (e: any) {
      if (e.code !== "ENOENT") { }
    }
    emails.unshift(emailRecord);
    await writeFile(path, JSON.stringify(emails, null, 2), "utf8");
  } catch (localErr) { }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!checkCsrf(request)) {
    return NextResponse.json({ error: "Forbidden (CSRF check failed)" }, { status: 403 });
  }
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ip = getClientIp(request);
  const { id } = await params;

  try {
    const resume = await resumeService.getCachedResume(id);
    if (!resume) {
      return NextResponse.json({ error: 'Resume record not found' }, { status: 404 });
    }

    const email = resume.parsed?.personal?.email;
    if (!email) {
      return NextResponse.json({ error: 'Candidate email address not found in resume parsed structure' }, { status: 400 });
    }

    // Parse and apply interview configuration
    let interviewConfig = null;
    try {
      const body = await request.json();
      interviewConfig = body?.interviewConfig || null;
    } catch (e) {
      // Body may not exist or not be json
    }

    if (interviewConfig) {
      resume.report = {
        ...resume.report,
        interviewConfig
      };
      await resumeService.saveResumeRow(resume);

      // Force regeneration by deleting existing questions
      const { error: deleteErr } = await supabase
        .from('interview_questions')
        .delete()
        .eq('resume_id', id);
      if (deleteErr) {
        console.error("Failed to delete existing interview questions on config update:", deleteErr);
      }
    }

    // Ensure session is registered / created
    await sessionService.createCandidateSession(email, id);

    const interviewType = interviewConfig?.interviewType || "technical";
    const assessmentLabel =
      interviewType === "both"
        ? "combined technical and non-technical"
        : interviewType === "non-technical"
          ? "non-technical"
          : "technical";
    const origin = 'https://ai-interview-ahkoe7hof-aryan0854s-projects.vercel.app';

    const fullName = resume.parsed?.personal?.fullName || 'Candidate';
    const subject =
      interviewType === "non-technical"
        ? `Invitation to Interview Assessment - ${fullName.toUpperCase()}`
        : interviewType === "both"
          ? `Invitation to Technical & Behavioral Assessment - ${fullName.toUpperCase()}`
          : `Invitation to Technical Interview Assessment - ${fullName.toUpperCase()}`;

    // Premium responsive HTML email template
    const htmlBody = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px; border: 1px solid #e0e7ff; border-radius: 16px; background-color: #ffffff; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
  <div style="text-align: center; margin-bottom: 24px;">
    <div style="display: inline-block; width: 48px; height: 48px; border-radius: 12px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); line-height: 48px; color: #ffffff; font-size: 24px; font-weight: bold; font-family: sans-serif;">B</div>
    <h2 style="color: #1e1b4b; margin-top: 12px; margin-bottom: 4px; font-size: 20px; font-weight: 800; font-family: sans-serif;">BizX Intelligence Portal</h2>
    <span style="color: #6b7280; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; font-family: sans-serif;">Assessment Invitation</span>
  </div>
  <hr style="border: 0; border-top: 1px solid #f3f4f6; margin-bottom: 24px;" />
  <div style="color: #374151; font-size: 14px; line-height: 1.6; font-weight: 500; font-family: sans-serif;">
    <p>Dear <strong>${fullName}</strong>,</p>
    <p>Congratulations! Our HR team evaluated your profile against one of our open position's Job, and classified you as a <strong>Highly Suitable</strong> candidate.</p>
    <p>We are excited to invite you to the next step of our recruitment process: a secure, voice-assisted ${assessmentLabel} evaluation on our screening portal.</p>
    
    <div style="margin: 28px 0; text-align: center;">
      <a href="${origin}" target="_blank" style="display: inline-block; padding: 12px 32px; background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); color: #ffffff; text-decoration: none; border-radius: 10px; font-weight: bold; font-size: 14px; box-shadow: 0 4px 10px rgba(79, 70, 229, 0.25);">Start Assessment</a>
    </div>

    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 20px 0;">
      <h4 style="color: #1e293b; margin: 0 0 8px 0; font-size: 13px; font-weight: 700;">Instructions for logging in:</h4>
      <ul style="margin: 0; padding-left: 20px; font-size: 12px; color: #475569;">
        <li style="margin-bottom: 4px;">Go to: <a href="${origin}" style="color: #4f46e5; text-decoration: underline;">${origin}</a></li>
        <li style="margin-bottom: 4px;">Login email address: <strong>${email}</strong></li>
        <li>You will have exactly <strong>one attempt</strong> to take the ${assessmentLabel} evaluation. Please make sure you are in a quiet room with a working microphone.</li>
      </ul>
    </div>
    
    <p style="margin-top: 24px;">Good luck with your interview!</p>
    <p style="color: #9ca3af; font-size: 12px; margin-top: 32px; border-top: 1px solid #f3f4f6; padding-top: 16px; text-align: center;">
      This is an automated simulation email dispatched by the BizX Screening Console.
    </p>
  </div>
</div>
`;

    // Attempt real email dispatch if SMTP password is provided
    let status = 'simulated';
    let realDispatchError: string | null = null;
    const transporter = getTransporter();

    if (transporter) {
      try {
        const from = process.env.SMTP_FROM || `"BizX HR Team" <${process.env.SMTP_USER || 'aryan.collageid@gmail.com'}>`;
        await transporter.sendMail({
          from,
          to: email,
          subject: subject,
          html: htmlBody,
        });
        status = 'sent';
      } catch (err: any) {
        console.error('Failed to send real email via SMTP, falling back to simulated:', err);
        realDispatchError = err.message || 'SMTP delivery failed';
        status = 'failed_real_fallback_simulated';
      }
    }

    // Log the dispatched email record
    const emailRecord = {
      id: crypto.randomUUID(),
      to: email,
      fullName,
      subject,
      htmlBody,
      dispatchedAt: new Date().toISOString(),
      status,
      rmEmail: resume.report?.rmEmail || 'admin@infinite.com'
    };
    await logDispatchedEmail(emailRecord);

    // Console logs for simulated fallback/info
    console.log(`\n==================================================`);
    console.log(`[EMAIL DISPATCH] Assessment invitation`);
    console.log(`To: ${email}`);
    console.log(`Subject: ${subject}`);
    console.log(`Candidate Name: ${fullName}`);
    console.log(`Access Link: ${origin}`);
    console.log(`Status: ${status === 'sent' ? 'Successfully Dispatched Real Email!' : 'Recorded in Outbox Logs (Simulated)'}`);
    if (realDispatchError) {
      console.log(`SMTP Error: ${realDispatchError}`);
    }
    console.log(`==================================================\n`);

    await auditLogService.addLog({
      actorEmail: resume.report?.rmEmail || "admin@infinite.com",
      action: "ADMIN_INVITE_CANDIDATE",
      target: email,
      details: `Dispatched assessment invitation email. Status: ${status}. Subject: ${subject}`,
      ipAddress: ip
    });

    await writeLog('email', 'INVITE_CANDIDATE', 'success', `Dispatched assessment invitation email to ${email}. Status: ${status}. Subject: ${subject}`);

    return NextResponse.json({
      success: true,
      email,
      fullName,
      status,
      error: realDispatchError
    });
  } catch (error: any) {
    console.error('Send candidate invite session error:', error);
    await writeLog('email', 'INVITE_CANDIDATE_FAILED', 'failed', `Failed to send invite email to candidate ID ${id}: ${error.message}`);
    return NextResponse.json({ error: error.message || 'Invitation failed' }, { status: 500 });
  }
}
