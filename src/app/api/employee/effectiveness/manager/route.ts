import { NextRequest, NextResponse } from "next/server";
import { authenticateRequestAsync } from "@/lib/employee-auth";
import { effectivenessService } from "@/services/effectiveness-service";
import crypto from "crypto";

export async function GET(request: NextRequest) {
  const auth = await authenticateRequestAsync(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = await effectivenessService.loadDB();
    return NextResponse.json({
      success: true,
      evaluations: db.evaluations,
      behavior_evaluations: db.behavior_evaluations,
      business_impacts: db.business_impacts,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to load manager records" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await authenticateRequestAsync(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { action, employeeId, subjectId } = body;

    if (!action || !employeeId || !subjectId) {
      return NextResponse.json({ error: "Missing required parameters" }, { status: 400 });
    }

    const evalRecord = await effectivenessService.getEvaluationBySubject(employeeId, subjectId);
    if (!evalRecord) {
      return NextResponse.json({ error: "Evaluation record not found" }, { status: 404 });
    }

    if (action === "grade_bloom") {
      const { apply_score, analyze_score, evaluate_score, create_score } = body;
      
      const bloom_scores = {
        remember: evalRecord.bloom_scores?.remember || 0,
        understand: evalRecord.bloom_scores?.understand || 0,
        apply: apply_score,
        analyze: analyze_score,
        evaluate: evaluate_score,
        create: create_score,
      };

      const bloom_graded = {
        apply_score,
        analyze_score,
        evaluate_score,
        create_score,
      };

      // Calculate overall post_test_score using Bloom's weights:
      // Remember (10%), Understand (15%), Apply (25%), Analyze (20%), Evaluate (15%), Create (15%)
      const weightedScore = Math.round(
        bloom_scores.remember * 0.10 +
        bloom_scores.understand * 0.15 +
        bloom_scores.apply * 0.25 +
        bloom_scores.analyze * 0.20 +
        bloom_scores.evaluate * 0.15 +
        bloom_scores.create * 0.15
      );

      const updated = await effectivenessService.saveEvaluation({
        ...evalRecord,
        bloom_scores,
        bloom_graded,
        post_test_score: weightedScore,
        learning_gain_pct: evalRecord.pre_test_score 
          ? Math.round(((weightedScore - evalRecord.pre_test_score) / evalRecord.pre_test_score) * 100)
          : 0,
        bloom_graded_by: auth.employee.email || "manager@infinite.com",
        bloom_graded_at: new Date().toISOString(),
      });

      return NextResponse.json({ success: true, record: updated });
    }

    if (action === "behavior") {
      const { evaluator_role, interval_days, q1, q2, q3, q4, q5, comments, evidence_url } = body;

      const newEval = await effectivenessService.saveBehaviorEvaluation({
        employee_id: employeeId,
        subject_id: subjectId,
        evaluator_role,
        evaluator_email: auth.employee.email || "manager@infinite.com",
        interval_days: Number(interval_days) as 30 | 60 | 90,
        q1_demonstrates_skills: q1,
        q2_independently_applies: q2,
        q3_shares_learning: q3,
        q4_solves_problems: q4,
        q5_measurable_improvement: q5,
        comments: comments || "",
        evidence_url: evidence_url || "",
      });

      return NextResponse.json({ success: true, behavior: newEval });
    }

    if (action === "results") {
      const { 
        productivity_before, productivity_after, productivity_metric,
        quality_before, quality_after, quality_metric,
        customer_csat_before, customer_csat_after,
        cost_reduction, time_saved_hours
      } = body;

      const costOfTraining = 1500; // standard mock cost
      const roi_score = Math.round(((cost_reduction - costOfTraining) / costOfTraining) * 100);

      // Normalize metrics to 0-100 indexes
      const prodChange = ((productivity_after - productivity_before) / (productivity_before || 1)) * 100;
      const prodIndex = Math.min(100, Math.max(0, prodChange));

      const qualChange = ((quality_before - quality_after) / (quality_before || 1)) * 100; // defect reduction
      const qualIndex = Math.min(100, Math.max(0, qualChange));

      const csatChange = ((customer_csat_after - customer_csat_before) / (customer_csat_before || 1)) * 100;
      const csatIndex = Math.min(100, Math.max(0, csatChange));

      const timeIndex = Math.min(100, (time_saved_hours / 40) * 100);
      const roiIndex = Math.min(100, Math.max(0, (roi_score / 200) * 100)); // normalized against 200% ROI goal

      const business_impact_score = Math.round((prodIndex + qualIndex + csatIndex + timeIndex + roiIndex) / 5);

      const impact = await effectivenessService.saveBusinessImpact({
        employee_id: employeeId,
        subject_id: subjectId,
        productivity_before: Number(productivity_before),
        productivity_after: Number(productivity_after),
        productivity_metric,
        quality_before: Number(quality_before),
        quality_after: Number(quality_after),
        quality_metric,
        customer_csat_before: Number(customer_csat_before),
        customer_csat_after: Number(customer_csat_after),
        cost_reduction: Number(cost_reduction),
        time_saved_hours: Number(time_saved_hours),
        roi_score,
        business_impact_score,
        approved_by_pm: true,
        approved_by_rm: true,
      });

      return NextResponse.json({ success: true, impact });
    }

    if (action === "simulate_time") {
      const { days_ago } = body;
      const d = new Date();
      d.setDate(d.getDate() - Number(days_ago));
      
      const updated = await effectivenessService.saveEvaluation({
        ...evalRecord,
        completion_date: d.toISOString(),
      });

      return NextResponse.json({ success: true, record: updated });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Operation failed" }, { status: 500 });
  }
}
