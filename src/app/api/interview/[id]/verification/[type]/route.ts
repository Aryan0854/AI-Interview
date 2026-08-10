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
  { params }: { params: Promise<{ id: string; type: string }> }
) {
  try {
    const { id, type } = await params;

    if (type !== 'id' && type !== 'selfie') {
      return NextResponse.json({ error: 'Invalid verification type' }, { status: 400 });
    }

    const filename = `${id}_${type}.png`;

    // 1. Try Supabase Storage first
    try {
      const { data: blob, error: downloadErr } = await supabaseServer.storage
        .from('verifications')
        .download(filename);

      if (!downloadErr && blob) {
        const fileBuffer = Buffer.from(await blob.arrayBuffer());
        return new NextResponse(fileBuffer as any, {
          headers: {
            'Content-Type': 'image/png',
            'Content-Length': fileBuffer.length.toString(),
            'Cache-Control': 'public, max-age=31536000, immutable'
          }
        });
      }
    } catch (storageErr) {
      console.warn(`Supabase Storage download failed for ${filename}, falling back to local storage:`, storageErr);
    }

    // 2. Fallback to local storage
    const filePath = join(getUploadsRoot(), "verifications", filename);
    try {
      const fileBuffer = await readFile(filePath);
      return new NextResponse(fileBuffer as any, {
        headers: {
          'Content-Type': 'image/png',
          'Content-Length': fileBuffer.length.toString(),
          'Cache-Control': 'public, max-age=31536000, immutable'
        }
      });
    } catch (readErr) {
      return NextResponse.json({ error: 'Verification image not found' }, { status: 404 });
    }
  } catch (error: any) {
    console.error('Serving verification image error:', error);
    return NextResponse.json({ error: 'Verification image serving failed' }, { status: 500 });
  }
}
