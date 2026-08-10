export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { readFile, readdir } from 'fs/promises';
import { join, extname } from 'path';
import { supabase } from '@/lib/db';
import { authenticateAdminRequest } from '@/lib/employee-auth';

const mimeMapping: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  try {
    let buffer: Buffer | null = null;
    let originalName = 'resume';
    let contentType = 'application/octet-stream';

    // 1. Try fetching from Supabase Storage
    try {
      const { data: filesList, error: listError } = await supabase.storage
        .from('resumes')
        .list('');
      if (!listError && filesList) {
        const storageFile = filesList.find(f => f.name.startsWith(`${id}-`))?.name;
        if (storageFile) {
          const { data: fileBlob, error: downloadError } = await supabase.storage
            .from('resumes')
            .download(storageFile);
          if (!downloadError && fileBlob) {
            const arrayBuffer = await fileBlob.arrayBuffer();
            buffer = Buffer.from(arrayBuffer);
            originalName = storageFile.replace(`${id}-`, '');
            const fileExt = extname(storageFile).toLowerCase();
            contentType = mimeMapping[fileExt] || 'application/octet-stream';
          }
        }
      }
    } catch (storageErr) {
      console.warn('Supabase storage fetch failed, trying local disk:', storageErr);
    }

    // 2. Try fetching from local disk if not found in Supabase Storage
    if (!buffer) {
      const root = process.env.VERCEL === "1" ? "/tmp" : join(process.cwd(), 'uploads');
      const directory = join(root, 'resumes');
      let resumeFile = "";
      try {
        const files = await readdir(directory);
        resumeFile = files.find((file) => file.startsWith(`${id}-`)) || "";
        if (resumeFile) {
          const filePath = join(directory, resumeFile);
          buffer = await readFile(filePath);
          originalName = resumeFile.replace(`${id}-`, '');
          const fileExt = extname(resumeFile).toLowerCase();
          contentType = mimeMapping[fileExt] || 'application/octet-stream';
        }
      } catch (localErr) {
        // directory or file might not exist
      }
    }

    // 3. Fallback: Fetch from Supabase database file_base64
    if (!buffer) {
      const { data, error } = await supabase
        .from('resumes')
        .select('filename, file_base64')
        .eq('id', id)
        .single();

      if (error || !data || !data.file_base64) {
        return NextResponse.json({ error: 'Resume file not found in storage, database, or local disk' }, { status: 404 });
      }

      buffer = Buffer.from(data.file_base64, 'base64');
      originalName = data.filename || 'resume';
      const fileExt = extname(originalName).toLowerCase();
      contentType = mimeMapping[fileExt] || 'application/octet-stream';
    }

    const body = new Uint8Array(buffer);
    return new NextResponse(body, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${originalName}"`,
      },
    });
  } catch (error) {
    console.error('Download error:', error);
    return NextResponse.json({ error: 'Resume download failed' }, { status: 500 });
  }
}
