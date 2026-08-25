import { NextRequest, NextResponse } from "next/server";
import { authenticateRequestAsync } from "@/lib/employee-auth";
import { effectivenessService } from "@/services/effectiveness-service";

export async function GET(request: NextRequest) {
  const auth = await authenticateRequestAsync(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const records = await effectivenessService.getEvaluationsForEmployee(auth.employeeId);
    return NextResponse.json({ success: true, records });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to load evaluations" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await authenticateRequestAsync(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { type, subjectId, subjectTitle } = body;

    if (!subjectId) {
      return NextResponse.json({ error: "Missing subjectId" }, { status: 400 });
    }

    const existing = await effectivenessService.getEvaluationBySubject(auth.employeeId, subjectId);

    if (type === "pre_test") {
      const { score } = body;
      const updated = await effectivenessService.saveEvaluation({
        employee_id: auth.employeeId,
        employee_name: auth.employee.full_name || auth.employeeId,
        department: auth.employee.department || "general",
        subject_id: subjectId,
        subject_title: subjectTitle || "Subject",
        pre_test_score: score || 0,
        post_test_score: existing?.post_test_score || 0,
        learning_gain_pct: existing?.post_test_score ? Math.round(((existing.post_test_score - (score || 0)) / (score || 1)) * 100) : 0,
        completion_date: existing?.completion_date || new Date().toISOString(),
        reaction_relevance: existing?.reaction_relevance,
        reaction_utility: existing?.reaction_utility,
        reaction_instructor: existing?.reaction_instructor,
        reaction_nps: existing?.reaction_nps,
        reaction_comments: existing?.reaction_comments,
        reaction_submitted_at: existing?.reaction_submitted_at,
        bloom_scores: existing?.bloom_scores,
        bloom_submissions: existing?.bloom_submissions,
        bloom_graded: existing?.bloom_graded,
        bloom_graded_by: existing?.bloom_graded_by,
        bloom_graded_at: existing?.bloom_graded_at,
      });
      return NextResponse.json({ success: true, record: updated });
    }

    if (type === "reaction") {
      const { relevance, utility, instructor, nps, comments } = body;
      const updated = await effectivenessService.saveEvaluation({
        employee_id: auth.employeeId,
        employee_name: auth.employee.full_name || auth.employeeId,
        department: auth.employee.department || "general",
        subject_id: subjectId,
        subject_title: subjectTitle || existing?.subject_title || "Subject",
        pre_test_score: existing?.pre_test_score || 0,
        post_test_score: existing?.post_test_score || 0,
        learning_gain_pct: existing?.learning_gain_pct || 0,
        completion_date: existing?.completion_date || new Date().toISOString(),
        reaction_relevance: relevance,
        reaction_utility: utility,
        reaction_instructor: instructor,
        reaction_nps: nps,
        reaction_comments: comments,
        reaction_submitted_at: new Date().toISOString(),
        bloom_scores: existing?.bloom_scores,
        bloom_submissions: existing?.bloom_submissions,
        bloom_graded: existing?.bloom_graded,
        bloom_graded_by: existing?.bloom_graded_by,
        bloom_graded_at: existing?.bloom_graded_at,
      });
      return NextResponse.json({ success: true, record: updated });
    }

    return NextResponse.json({ error: "Invalid action type" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to submit evaluation" }, { status: 500 });
  }
}
