export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { readFile } from 'fs/promises';
import { supabaseServer } from '@/lib/db';

function getUploadsRoot() {
  return process.env.VERCEL === "1" ? "/tmp" : join(process.cwd(), "uploads");
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Try Supabase Storage first
    const { data: blob, error: downloadErr } = await supabaseServer.storage
      .from('recordings')
      .download(`${id}.webm`);

    let fileBuffer: Buffer;
    
    if (!downloadErr && blob) {
      fileBuffer = Buffer.from(await blob.arrayBuffer());
    } else {
      // Fallback to local storage
      const filePath = join(getUploadsRoot(), "recordings", `${id}.webm`);
      try {
        fileBuffer = await readFile(filePath);
      } catch (readErr) {
        return NextResponse.json({ error: 'Video file not found' }, { status: 404 });
      }
    }

    const fileSize = fileBuffer.length;
    const range = request.headers.get('range');

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      
      const chunk = fileBuffer.subarray(start, end + 1);

      return new NextResponse(chunk as any, {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize.toString(),
          'Content-Type': 'video/webm',
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
        }
      });
    } else {
      return new NextResponse(fileBuffer as any, {
        headers: {
          'Content-Length': fileSize.toString(),
          'Content-Type': 'video/webm',
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
        }
      });
    }
  } catch (error: any) {
    console.error('Video streaming error:', error);
    return NextResponse.json({ error: 'Video streaming failed' }, { status: 500 });
  }
}