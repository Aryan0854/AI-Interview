export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db';
import { join } from 'path';
import { readFile, writeFile } from 'fs/promises';
import { authenticateAdminRequest } from '@/lib/employee-auth';
import { writeLog } from '@/lib/structured-logger';
import { allowLocalDataFallback } from '@/lib/db-mode';
import { adminCanViewOrgScreeningData } from '@/lib/admin-accounts-server';

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
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
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

function mapDbEmail(row: any) {
  return {
    id: row.id,
    to: row.candidate_email,
    fullName: row.full_name || '',
    subject: row.subject || '',
    htmlBody: row.body || '',
    dispatchedAt: row.created_at || new Date().toISOString(),
    status: row.status || 'simulated',
    rmEmail: row.rm_email,
  };
}

function sortEmails(emails: any[]) {
  return [...emails].sort(
    (a, b) => new Date(b.dispatchedAt).getTime() - new Date(a.dispatchedAt).getTime()
  );
}

async function filterByRm(emails: any[], email: string | null) {
  if (!email || (await adminCanViewOrgScreeningData(email))) return emails;
  return emails.filter((item) => item.rmEmail?.toLowerCase().trim() === email);
}

async function fetchDbEmails(): Promise<{ rows: any[]; error: string | null }> {
  const { data, error } = await supabase.from('simulated_emails').select('*');
  if (error) {
    return { rows: [], error: error.message };
  }
  return { rows: (data || []).map(mapDbEmail), error: null };
}

export async function GET(request: NextRequest) {
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const email = url.searchParams.get("email")?.toLowerCase().trim() || null;

    const { rows: dbEmails, error: dbError } = await fetchDbEmails();
    if (dbError) {
      console.error("Supabase simulated_emails query error:", dbError);
    }

    // Local JSON is offline backup only. Never re-insert local rows into Supabase
    // on GET — that is what made deleted outbox items reappear.
    let combined = dbEmails;
    if (dbError && allowLocalDataFallback()) {
      combined = await readLocalEmails();
    }

    combined = sortEmails(await filterByRm(combined, email));
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

  try {
    const url = new URL(request.url);
    const body = await request.json().catch(() => ({}));
    const queryIds = url.searchParams.get("ids");
    const rawIds = Array.isArray(body.ids)
      ? body.ids
      : queryIds
        ? queryIds.split(",").map((id) => id.trim()).filter(Boolean)
        : null;
    const ids = rawIds
      ? [...new Set(rawIds.map((id: unknown) => String(id || "").trim()).filter(Boolean))]
      : null;
    const clearAll = !ids || ids.length === 0;

    if (clearAll) {
      const { error } = await supabase
        .from('simulated_emails')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');
      if (error) {
        throw new Error(error.message);
      }
      await writeLocalEmails([]);
      await writeLog('email', 'CLEAR_EMAIL_LOGS', 'success', 'Cleared all email outbox logs');
      return NextResponse.json({ success: true, emails: [], deletedCount: null });
    }

    const { error } = await supabase
      .from('simulated_emails')
      .delete()
      .in('id', ids);
    if (error) {
      throw new Error(error.message);
    }

    const { data: stillThere, error: verifyError } = await supabase
      .from('simulated_emails')
      .select('id')
      .in('id', ids);
    if (verifyError) {
      throw new Error(verifyError.message);
    }
    if (stillThere && stillThere.length > 0) {
      throw new Error(
        `Failed to delete ${stillThere.length} outbox log(s) from the database. They were restored on refresh.`
      );
    }

    const localEmails = await readLocalEmails();
    if (localEmails.length > 0) {
      await writeLocalEmails(localEmails.filter((item) => !ids.includes(String(item.id))));
    }

    await writeLog('email', 'DELETE_EMAIL_LOGS', 'success', `Deleted email logs for IDs: ${ids.join(', ')}`);

    const { rows: remaining } = await fetchDbEmails();
    const email = url.searchParams.get("email")?.toLowerCase().trim() || null;
    return NextResponse.json({
      success: true,
      emails: sortEmails(await filterByRm(remaining, email)),
      deletedCount: ids.length,
    });
  } catch (error: any) {
    console.error("Failed to clear outbox logs:", error);
    await writeLog('email', 'DELETE_EMAIL_LOGS_FAILED', 'failed', `Failed to delete/clear email outbox logs: ${error.message}`);
    return NextResponse.json({ error: error.message || "Failed to clear Outbox Logs" }, { status: 500 });
  }
}
