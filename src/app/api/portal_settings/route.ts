import { NextResponse } from "next/server";
import { settingsService } from "@/services/settings-service";

export const runtime = "nodejs";

export async function GET() {
  try {
    const settings = await settingsService.getSettings();
    return NextResponse.json(settings);
  } catch (error: any) {
    console.error("Failed to get portal settings:", error);
    return NextResponse.json({ error: "Failed to get settings" }, { status: 500 });
  }
}
