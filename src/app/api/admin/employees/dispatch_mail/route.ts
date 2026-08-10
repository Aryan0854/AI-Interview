import { NextRequest, NextResponse } from 'next/server';
import { authenticateAdminRequest } from '@/lib/employee-auth';
import { join } from 'path';
import { readFile, writeFile } from 'fs/promises';
import { supabase } from '@/lib/db';
import { sessionService } from '@/services/session-service';
import { resumeService } from '@/services/resume-service';
import nodemailer from 'nodemailer';
import { auditLogService } from '@/services/audit-log-service';
import { writeLog } from '@/lib/structured-logger';
import { checkCsrf, getClientIp } from '@/lib/security';

export const runtime = 'nodejs';

const getUploadsRoot = () => {
  return process.env.VERCEL === "1" ? "/tmp" : join(process.cwd(), "uploads");
};

const getEmployeesJsonPath = () => {
  return join(getUploadsRoot(), "employees.json");
};

const getEmailsPath = () => {
  return join(getUploadsRoot(), "emails.json");
};

const getTransporter = () => {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT || '465');
  const secure = port === 465;
  const user = process.env.SMTP_USER || 'aryan.collageid@gmail.com';
  const pass = process.env.SMTP_PASS;

  if (!pass) return null;

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    tls: { rejectUnauthorized: false }
  });
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
    const path = getEmailsPath();
    let emails = [];
    try {
      const raw = await readFile(path, "utf8");
      emails = JSON.parse(raw);
    } catch (e: any) {
      // Ignored
    }
    emails.unshift(emailRecord);
    await writeFile(path, JSON.stringify(emails, null, 2), "utf8");
  } catch (localErr) {}
}

export async function POST(request: NextRequest) {
  if (!checkCsrf(request)) {
    return NextResponse.json({ error: "Forbidden (CSRF check failed)" }, { status: 403 });
  }
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ip = getClientIp(request);

  try {
    const body = await request.json().catch(() => ({}));
    const requesterEmail = body.adminEmail || "admin@infinite.com";

    const requestUrl = new URL(request.url);
    const portalUrl = 'https://ai-interview-ahkoe7hof-aryan0854s-projects.vercel.app';

    const jsonPath = getEmployeesJsonPath();
    let employees = [];
    try {
      const raw = await readFile(jsonPath, "utf8");
      employees = JSON.parse(raw);
    } catch (e) {
      return NextResponse.json({ error: "Employee pool not loaded" }, { status: 404 });
    }

    const targetEmployeeIds = body.employeeIds;
    let targets = [];
    if (Array.isArray(targetEmployeeIds) && targetEmployeeIds.length > 0) {
      targets = employees.filter((e: any) => targetEmployeeIds.includes(e.employee_id));
    } else {
      targets = employees.filter((e: any) => e.shortlisted);
    }

    if (targets.length === 0) {
      return NextResponse.json({ error: "No target employees found to dispatch invite emails." }, { status: 400 });
    }

    const transporter = getTransporter();
    const dispatched = [];

    for (const emp of targets) {
      if (!emp.email) {
        console.warn(`Employee ${emp.full_name} (${emp.employee_id}) has no email address. Skipping email dispatch.`);
        continue;
      }

      // 1. Create a dummy/placeholder resume record for the employee
      const resumeId = crypto.randomUUID();
      const dummyResume = {
        id: resumeId,
        filename: `Employee_${emp.employee_id}.txt`,
        originalText: `Employee Profile\nName: ${emp.full_name}\nID: ${emp.employee_id}\nDept: ${emp.department}\nSkills: ${emp.skills}`,
        parsed: {
          personal: {
            fullName: emp.full_name,
            email: emp.email,
            phone: ""
          },
          skills: {
            technical: emp.skills ? [emp.skills] : [],
            soft: []
          },
          experience: [],
          education: []
        },
        analysis: {
          executiveSummary: `Employee profile matched for internal screening. Grade: ${emp.grade || 'N/A'}, Designation: ${emp.designation || 'N/A'}.`,
          overallScore: emp.score || 50,
          atsScore: emp.score || 50,
          technicalScore: emp.score || 50,
          jdMatchScore: emp.score || 50
        },
        enhanced: null,
        report: {
          rmEmail: requesterEmail,
          verification: null
        },
        error: null,
        fileHash: `emp_${emp.employee_id}_hash`,
        fileBase64: null,
        status: 'parsed',
        createdAt: new Date().toISOString()
      };

      // Save dummy resume row
      await resumeService.saveResumeRow(dummyResume as any);

      // 2. Register candidate session
      await sessionService.createCandidateSession(emp.email, resumeId);

      // 3. Dispatch simulated/real email
      const subject = `Assessment Invitation - BizX Screening Console`;
      
      const htmlBody = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px; border: 1px solid #e0e7ff; border-radius: 16px; background-color: #ffffff; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
  <div style="text-align: center; margin-bottom: 24px;">
    <div style="display: inline-block; width: 48px; height: 48px; border-radius: 12px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); line-height: 48px; color: #ffffff; font-size: 24px; font-weight: bold; font-family: sans-serif;">B</div>
    <h2 style="color: #1e1b4b; margin-top: 12px; margin-bottom: 4px; font-size: 20px; font-weight: 800; font-family: sans-serif;">BizX Intelligence Portal</h2>
    <span style="color: #6b7280; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; font-family: sans-serif;">Assessment Invitation</span>
  </div>
  <hr style="border: 0; border-top: 1px solid #f3f4f6; margin-bottom: 24px;" />
  <div style="color: #374151; font-size: 14px; line-height: 1.6; font-weight: 500; font-family: sans-serif;">
    <p>Dear <strong>${emp.full_name}</strong>,</p>
    <p>Congratulations! Our HR team evaluated your profile against one of our open position's Job, and classified you as a <strong>Highly Suitable</strong> candidate.</p>
    <p>We are excited to invite you to the next step of our recruitment process: a secure, voice-assisted technical evaluation on our screening portal.</p>
    
    <div style="margin: 28px 0; text-align: center;">
      <a href="${portalUrl}" target="_blank" style="display: inline-block; padding: 12px 32px; background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); color: #ffffff; text-decoration: none; border-radius: 10px; font-weight: bold; font-size: 14px; box-shadow: 0 4px 10px rgba(79, 70, 229, 0.25);">Start Assessment</a>
    </div>

    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 20px 0;">
      <h4 style="color: #1e293b; margin: 0 0 8px 0; font-size: 13px; font-weight: 700;">Instructions for logging in:</h4>
      <ul style="margin: 0; padding-left: 20px; font-size: 12px; color: #475569;">
        <li style="margin-bottom: 4px;">Go to: <a href="${portalUrl}" style="color: #4f46e5; text-decoration: underline;">${portalUrl}</a></li>
        <li style="margin-bottom: 4px;">Login email address: <strong>${emp.email}</strong></li>
        <li>You will have exactly <strong>one attempt</strong> to take the technical evaluation. Please make sure you are in a quiet room with a working microphone.</li>
      </ul>
    </div>
    
    <p style="margin-top: 24px;">Good luck with your interview!</p>
    <p style="color: #9ca3af; font-size: 12px; margin-top: 32px; border-top: 1px solid #f3f4f6; padding-top: 16px; text-align: center;">
      This is an automated simulation email dispatched by the BizX Screening Console.
    </p>
  </div>
</div>
`;

      let status = 'simulated';
      if (transporter) {
        try {
          const from = process.env.SMTP_FROM || `"BizX HR Team" <${process.env.SMTP_USER || 'aryan.collageid@gmail.com'}>`;
          await transporter.sendMail({
            from,
            to: emp.email,
            subject: subject,
            html: htmlBody,
          });
          status = 'sent';
        } catch (err) {
          console.error(`SMTP send failed for ${emp.email}:`, err);
          status = 'failed_real_fallback_simulated';
        }
      }

      // Log email outbox
      const emailRecord = {
        id: crypto.randomUUID(),
        to: emp.email,
        fullName: emp.full_name,
        subject,
        htmlBody,
        dispatchedAt: new Date().toISOString(),
        status,
        rmEmail: requesterEmail
      };
      await logDispatchedEmail(emailRecord);

      await auditLogService.addLog({
        actorEmail: requesterEmail,
        action: "ADMIN_INVITE_EMPLOYEE",
        target: emp.email,
        details: `Dispatched internal assessment invite to employee ${emp.full_name} (${emp.employee_id}). Status: ${status}.`,
        ipAddress: ip
      });

      dispatched.push({ email: emp.email, name: emp.full_name, status });
    }

    await writeLog('employee', 'DISPATCH_EMPLOYEE_MAILS', 'success', `Successfully dispatched assessment invitations to ${targets.length} employees.`);
    return NextResponse.json({ success: true, count: targets.length, dispatched });
  } catch (error: any) {
    console.error("Failed to dispatch internal emails:", error);
    await writeLog('employee', 'DISPATCH_EMPLOYEE_MAILS_FAILED', 'failed', `Failed to dispatch internal emails: ${error.message}`);
    return NextResponse.json({ error: error.message || "Failed to dispatch emails" }, { status: 500 });
  }
}
