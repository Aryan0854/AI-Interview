export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { writeFile, mkdir } from 'fs/promises';
import { resumeService } from '@/services/resume-service';
import { supabaseServer } from '@/lib/db';

function getUploadsRoot() {
  return process.env.VERCEL === "1" ? "/tmp" : join(process.cwd(), "uploads");
}

async function saveVideoLocally(buffer: Buffer, id: string): Promise<string> {
  const uploadsDir = join(getUploadsRoot(), "recordings");
  await mkdir(uploadsDir, { recursive: true });
  const filePath = join(uploadsDir, `${id}.webm`);
  await writeFile(filePath, buffer);
  return filePath;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    console.log(`📹 [UPLOAD_VIDEO] Starting upload for interview ${id}`);
    
    const formData = await request.formData();
    const file = formData.get('video') as File | null;

    if (!file) {
      console.error(`❌ [UPLOAD_VIDEO] No video file provided for ${id}`);
      return NextResponse.json({ error: 'No video file provided' }, { status: 400 });
    }
    
    console.log(`📹 [UPLOAD_VIDEO] Received file: ${file.name}, size: ${file.size} bytes`);

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 1. Try Supabase Storage first, fallback to local storage
    try {
      console.log(`📹 [UPLOAD_VIDEO] Checking recordings bucket...`);
      const { data: buckets, error: listErr } = await supabaseServer.storage.listBuckets();
      if (listErr) {
        throw new Error(`Storage list failed: ${listErr.message}`);
      }
      
      const bucketExists = buckets?.some(b => b.id === 'recordings') ?? false;
      
      if (!bucketExists) {
        console.log(`📹 [UPLOAD_VIDEO] Creating recordings bucket...`);
        const { error: createErr } = await supabaseServer.storage.createBucket('recordings', {
          public: true,
          allowedMimeTypes: ['video/webm', 'video/mp4', 'video/quicktime']
        });
        if (createErr) {
          throw new Error(`Bucket create failed: ${createErr.message}`);
        }
      }
      
      console.log(`📹 [UPLOAD_VIDEO] Uploading to Supabase Storage...`);
      const { error: uploadErr } = await supabaseServer.storage
        .from('recordings')
        .upload(`${id}.webm`, buffer, {
          contentType: 'video/webm',
          upsert: true
        });
      
      if (uploadErr) {
        throw new Error(`Upload failed: ${uploadErr.message}`);
      }
      
      console.log(`✅ [UPLOAD_VIDEO] Video uploaded to storage`);
    } catch (storageErr: any) {
      console.warn('⚠️ [UPLOAD_VIDEO] Supabase storage failed, using local fallback:', storageErr.message);
      await saveVideoLocally(buffer, id);
    }

    // 2. Fetch candidate resume record, update report with videoUrl (forceFresh = true)
    console.log(`📹 [UPLOAD_VIDEO] Fetching resume record for ${id}...`);
    const resume = await resumeService.getCachedResume(id, true);
    if (!resume) {
      console.error(`❌ [UPLOAD_VIDEO] Associated resume record not found for ${id}`);
      return NextResponse.json({ error: 'Associated resume record not found' }, { status: 404 });
    }

    console.log(`✅ [UPLOAD_VIDEO] Resume found: ${resume.filename}`);

    const durationStr = formData.get('duration')?.toString();
    const durationSec = durationStr ? parseFloat(durationStr) : undefined;

    resume.report = {
      ...resume.report,
      videoUrl: `/api/interview/${id}/video`,
      videoDuration: durationSec
    };

    // 3. Persist update to Database
    console.log(`📹 [UPLOAD_VIDEO] Updating resume report with video URL...`);
    const { error } = await supabaseServer.from('resumes').upsert({
      id: resume.id,
      filename: resume.filename,
      text_content: resume.originalText,
      parsed: JSON.stringify(resume.parsed),
      analysis: JSON.stringify(resume.analysis),
      enhanced: JSON.stringify(resume.enhanced),
      report: JSON.stringify(resume.report),
      error: resume.error || null
    });

    if (error) {
      console.error('❌ [UPLOAD_VIDEO] Failed to update resume report with video URL:', JSON.stringify(error));
      throw new Error(`Database Error: ${error?.message || JSON.stringify(error)}`);
    }

    console.log(`✅ [UPLOAD_VIDEO] Successfully uploaded video for ${id}`);
    return NextResponse.json({ success: true, videoUrl: resume.report.videoUrl });
  } catch (error: any) {
    console.error('❌ [UPLOAD_VIDEO] Upload video error:', JSON.stringify({
      message: error.message,
      stack: error.stack,
      name: error.name
    }));
    return NextResponse.json({ error: error.message || error.toString() || 'Upload video failed' }, { status: 500 });
  }
}