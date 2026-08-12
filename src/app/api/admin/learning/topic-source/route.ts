import { NextRequest, NextResponse } from "next/server";
import { authenticateAdminRequest } from "@/lib/employee-auth";
import { supabase } from "@/lib/db";
import { extractPdfText } from "@/lib/pdf-extract";

export async function POST(request: NextRequest) {
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const topicId = formData.get("topicId") as string | null;

    if (!file || !topicId) {
      return NextResponse.json({ error: "file and topicId are required" }, { status: 400 });
    }
    if (file.type !== "application/pdf") {
      return NextResponse.json({ error: "Only PDF files are supported" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const extractedText = await extractPdfText(buffer);

    const storagePath = `topic-sources/${topicId}/${Date.now()}-${file.name}`;
    const { error: uploadErr } = await supabase.storage
      .from("quiz-source-docs")
      .upload(storagePath, buffer, { contentType: "application/pdf", upsert: false });
    if (uploadErr) {
      console.warn("Storage upload failed, saving extracted text without the file:", uploadErr.message);
    }

    const { data, error } = await supabase
      .from("topic_source_documents")
      .insert({
        topic_id: topicId,
        file_name: file.name,
        storage_path: uploadErr ? "" : storagePath,
        extracted_text: extractedText,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, document: data });
  } catch (err: any) {
    console.error("Topic source upload error:", err);
    return NextResponse.json({ error: err.message || "Upload failed" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const topicId = new URL(request.url).searchParams.get("topicId");
  if (!topicId) {
    return NextResponse.json({ error: "topicId is required" }, { status: 400 });
  }
  const { data, error } = await supabase
    .from("topic_source_documents")
    .select("id, file_name, uploaded_at")
    .eq("topic_id", topicId)
    .order("uploaded_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ documents: data ?? [] });
}

export async function DELETE(request: NextRequest) {
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  const { error } = await supabase.from("topic_source_documents").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
