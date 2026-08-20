import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Use Sign in with Microsoft. Email-only SSO is disabled." },
    { status: 410 }
  );
}
