export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { join } from "path";
import { readFile } from "fs/promises";
import { supabaseServer } from "@/lib/db";

function getUploadsRoot() {
  return process.env.VERCEL === "1" ? "/tmp" : join(process.cwd(), "uploads");
}

function contentTypeForName(filename: string) {
  if (filename.endsWith(".jpg") || filename.endsWith(".jpeg")) return "image/jpeg";
  if (filename.endsWith(".webp")) return "image/webp";
  return "image/png";
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; type: string }> }
) {
  try {
    const { id, type } = await params;

    if (type !== "id" && type !== "selfie") {
      return NextResponse.json({ error: "Invalid verification type" }, { status: 400 });
    }

    const candidates = [`${id}_${type}.jpg`, `${id}_${type}.jpeg`, `${id}_${type}.png`, `${id}_${type}.webp`];

    for (const filename of candidates) {
      try {
        const { data: blob, error: downloadErr } = await supabaseServer.storage
          .from("verifications")
          .download(filename);

        if (!downloadErr && blob) {
          const fileBuffer = Buffer.from(await blob.arrayBuffer());
          return new NextResponse(fileBuffer as any, {
            headers: {
              "Content-Type": contentTypeForName(filename),
              "Content-Length": fileBuffer.length.toString(),
              "Cache-Control": "private, max-age=3600",
            },
          });
        }
      } catch {
        // try next candidate
      }
    }

    for (const filename of candidates) {
      const filePath = join(getUploadsRoot(), "verifications", filename);
      try {
        const fileBuffer = await readFile(filePath);
        return new NextResponse(fileBuffer as any, {
          headers: {
            "Content-Type": contentTypeForName(filename),
            "Content-Length": fileBuffer.length.toString(),
            "Cache-Control": "private, max-age=3600",
          },
        });
      } catch {
        // try next
      }
    }

    return NextResponse.json({ error: "Verification image not found" }, { status: 404 });
  } catch (error: any) {
    console.error("Serving verification image error:", error);
    return NextResponse.json({ error: "Verification image serving failed" }, { status: 500 });
  }
}
