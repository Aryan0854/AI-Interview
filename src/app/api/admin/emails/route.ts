export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db';
import { join } from 'path';
import { readFile, writeFile } from 'fs/promises';
import { authenticateAdminRequest } from '@/lib/employee-auth';
import { writeLog } from '@/lib/structured-logger';

const getUploadsRoot = () => {
  return process.env.VERCEL === "1" ? "/tmp" : join(process.cwd(), "uploads");
};

const getEmailsPath = () => {
  return join(getUploadsRoot(), "emails.json");
};

async function readLocalEmails(): Promise<any[]> {
  try {
    const path = getEmailsPath();
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw);
  } catch (e: any) {
    return [];
  }
}

async function writeLocalEmails(emails: any[]): Promise<void> {
  try {
    const path = getEmailsPath();
    await writeFile(path, JSON.stringify(emails, null, 2), "utf8");
  } catch (err) {
    console.error("Failed to write local emails:", err);
  }
}

export async function GET(request: NextRequest) {
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const email = url.searchParams.get("email")?.toLowerCase().trim();

    // 1. Fetch from database (gracefully swallowing errors/RLS blocks)
    let dbEmails: any[] = [];
    let dbErrorOccurred = false;
    try {
      const { data, error } = await supabase
        .from('simulated_emails')
        .select('*');
      if (error) {
        console.error("Supabase simulated_emails query error:", error);
        dbErrorOccurred = true;
      } else {
        dbEmails = data || [];
      }
    } catch (dbErr) {
      console.error("Failed to query DB for emails:", dbErr);
      dbErrorOccurred = true;
    }

    // Map database rows
    const dbMapped = dbEmails.map((row: any) => ({
      id: row.id,
      to: row.candidate_email,
      fullName: row.full_name || '',
      subject: row.subject || '',
      htmlBody: row.body || '',
      dispatchedAt: row.created_at || new Date().toISOString(),
      status: row.status || 'simulated',
      rmEmail: row.rm_email,
    }));

    // 2. Fetch from local JSON backup
    const localEmails = await readLocalEmails();

    // 3. Merge both lists (deduplicating by id, preferring local)
    const emailMap = new Map<string, any>();
    dbMapped.forEach((item) => emailMap.set(item.id, item));
    localEmails.forEach((item) => emailMap.set(item.id, item));

    let combined = Array.from(emailMap.values());

    // 4. Two-way sync: Save combined list back to local backup
    await writeLocalEmails(combined);

    // 5. Two-way sync: Upload local-only emails to Supabase if database is online
    if (!dbErrorOccurred) {
      const dbIds = new Set(dbMapped.map(item => item.id));
      const missingInDb = localEmails.filter(item => !dbIds.has(item.id));
      
      for (const item of missingInDb) {
        try {
          await supabase.from('simulated_emails').insert({
            id: item.id,
            candidate_email: item.to,
            full_name: item.fullName,
            subject: item.subject,
            body: item.htmlBody,
            status: item.status,
            rm_email: item.rmEmail,
            created_at: item.dispatchedAt
          });
        } catch (dbInsertErr) {
          console.error("Failed to sync missing email to Supabase:", dbInsertErr);
        }
      }
    }

    // 6. Apply filtering by rm_email
    if (email && email !== "admin@infinite.com") {
      combined = combined.filter((item) => item.rmEmail?.toLowerCase().trim() === email);
    }

    // 7. Order by dispatchedAt descending
    combined.sort((a, b) => new Date(b.dispatchedAt).getTime() - new Date(a.dispatchedAt).getTime());

    return NextResponse.json({ emails: combined });
  } catch (error: any) {
    console.error("Failed to read emails outbox:", error);
    return NextResponse.json({ error: "Failed to read Outbox Logs" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let ids: any = null;
  try {
    const body = await request.json().catch(() => ({}));
    ids = body.ids;

    // 1. Delete from database
    try {
      if (ids && Array.isArray(ids)) {
        await supabase
          .from('simulated_emails')
          .delete()
          .in('id', ids);
      } else {
        await supabase
          .from('simulated_emails')
          .delete()
          .neq('id', '00000000-0000-0000-0000-000000000000');
      }
    } catch (dbErr) {
      console.error("Failed to delete emails from DB:", dbErr);
    }

    // 2. Delete from local JSON backup
    if (ids && Array.isArray(ids)) {
      const localEmails = await readLocalEmails();
      const filtered = localEmails.filter((item) => !ids.includes(item.id));
      await writeLocalEmails(filtered);
      await writeLog('email', 'DELETE_EMAIL_LOGS', 'success', `Deleted email logs for IDs: ${ids.join(', ')}`);
    } else {
      await writeLocalEmails([]);
      await writeLog('email', 'CLEAR_EMAIL_LOGS', 'success', 'Cleared all email outbox logs');
    }

    return NextResponse.json({ success: true, emails: [] });
  } catch (error: any) {
    console.error("Failed to clear outbox logs:", error);
    await writeLog('email', 'DELETE_EMAIL_LOGS_FAILED', 'failed', `Failed to delete/clear email outbox logs: ${error.message}`);
    return NextResponse.json({ error: "Failed to clear Outbox Logs" }, { status: 500 });
  }
}
