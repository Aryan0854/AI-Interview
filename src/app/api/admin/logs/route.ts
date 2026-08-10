import { NextRequest, NextResponse } from 'next/server';
import { readLogs, clearAllLogs } from '@/lib/structured-logger';
import { authenticateAdminRequest } from '@/lib/employee-auth';
import { join } from 'path';
import { readFile } from 'fs/promises';

const getUploadsRoot = () => {
  return process.env.VERCEL === "1" ? "/tmp" : join(process.cwd(), "uploads");
};

export async function GET(request: NextRequest) {
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const module = searchParams.get('module') || 'all';
  const search = searchParams.get('search') || '';
  const status = searchParams.get('status') || 'all';
  const download = searchParams.get('download') === 'true';

  if (download) {
    try {
      const logDir = join(getUploadsRoot(), "logs");
      if (module === 'all') {
        const logs = await readLogs('all');
        const content = logs.map(l => JSON.stringify(l)).join('\n');
        return new Response(content, {
          headers: {
            'Content-Type': 'text/plain',
            'Content-Disposition': 'attachment; filename="system_logs.log"'
          }
        });
      } else {
        const fileToDownload = join(logDir, `${module}.log`);
        const content = await readFile(fileToDownload, 'utf8');
        return new Response(content, {
          headers: {
            'Content-Type': 'text/plain',
            'Content-Disposition': `attachment; filename="${module}.log"`
          }
        });
      }
    } catch (e) {
      return NextResponse.json({ error: "Log file not found" }, { status: 404 });
    }
  }

  try {
    let logs = await readLogs(module);

    if (status !== 'all') {
      logs = logs.filter(l => l.status.toLowerCase() === status.toLowerCase());
    }

    if (search) {
      const queryLower = search.toLowerCase();
      logs = logs.filter(l => 
        l.action.toLowerCase().includes(queryLower) ||
        l.details.toLowerCase().includes(queryLower) ||
        l.module.toLowerCase().includes(queryLower)
      );
    }

    return NextResponse.json({ logs });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await clearAllLogs();
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
