export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { interviewService } from '@/services/interview-service';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const data = await request.json();
    
    let question_index = parseInt(data.question_index);
    if (isNaN(question_index)) {
      return NextResponse.json({ status: "error", message: "question_index must be an integer" }, { status: 400 });
    }

    let question = data.question;
    if (!question || typeof question !== 'string') {
      return NextResponse.json({ status: "error", message: "question text is required" }, { status: 400 });
    }

    let answer = data.answer || "";
    if (typeof answer !== 'string') answer = String(answer);

    await interviewService.evaluateAnswer(id, question_index, question, answer);

    return NextResponse.json({ status: "success" });
  } catch (err: any) {
    console.error("Submit answer error:", err);
    return NextResponse.json({ status: "error", message: err.message }, { status: 500 });
  }
}
