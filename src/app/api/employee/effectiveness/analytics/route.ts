import { NextRequest, NextResponse } from "next/server";
import { authenticateRequestAsync } from "@/lib/employee-auth";
import { effectivenessService } from "@/services/effectiveness-service";

export async function GET(request: NextRequest) {
  const auth = await authenticateRequestAsync(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const employeeIdParam = url.searchParams.get("employeeId") || auth.employeeId;
  const isHR = url.searchParams.get("scope") === "hr";
  const isManager = url.searchParams.get("scope") === "manager";

  try {
    const db = await effectivenessService.loadDB();

    // -------------------------------------------------------------------------
    // 1. HR / Admin Scope Analytics
    // -------------------------------------------------------------------------
    if (isHR) {
      // Training ROI
      const totalImpacts = db.business_impacts.length;
      const impactsWithSavings = db.business_impacts.filter((item) => typeof item.cost_reduction === "number");
      const totalSavings = impactsWithSavings.reduce((sum, item) => sum + (item.cost_reduction as number), 0);
      const totalCost = totalImpacts * 1500; // Mock cost of $1500 per training program
      const netBenefits = totalSavings - totalCost;
      const overallROI = totalCost > 0 ? Math.round((netBenefits / totalCost) * 100) : 0;

      // Program Effectiveness rankings
      const subjectTEIMap: Record<string, { teiSum: number; count: number; name: string }> = {};
      
      db.evaluations.forEach((item) => {
        const subId = item.subject_id;
        const subTitle = item.subject_title;
        
        // Calculate TEI for this evaluation
        const reaction = (item.reaction_relevance || 0) * 20; // scale 1-5 to 0-100
        const learning = item.post_test_score || 0;
        
        // Behavior
        const behaviors = db.behavior_evaluations.filter(b => b.employee_id === item.employee_id && b.subject_id === subId);
        const behaviorSum = behaviors.reduce((s, b) => s + (b.q1_demonstrates_skills + b.q2_independently_applies + b.q3_shares_learning + b.q4_solves_problems + b.q5_measurable_improvement), 0);
        const behaviorCount = behaviors.length * 5;
        const behaviorScore = behaviorCount > 0 ? Math.round((behaviorSum / behaviorCount) * 100) : 0;

        // Results
        const results = db.business_impacts.find(b => b.employee_id === item.employee_id && b.subject_id === subId);
        const resultsScore = results ? results.business_impact_score : 0;

        const tei = Math.round(reaction * 0.10 + learning * 0.30 + behaviorScore * 0.35 + resultsScore * 0.25);

        if (!subjectTEIMap[subId]) {
          subjectTEIMap[subId] = { teiSum: 0, count: 0, name: subTitle };
        }
        subjectTEIMap[subId].teiSum += tei;
        subjectTEIMap[subId].count += 1;
      });

      const highImpactPrograms = Object.entries(subjectTEIMap).map(([id, val]) => ({
        subject_id: id,
        title: val.name,
        tei: Math.round(val.teiSum / val.count),
        completed_count: val.count,
      })).sort((a, b) => b.tei - a.tei);

      // Department-wise effectiveness
      const deptMap: Record<string, { teiSum: number; count: number }> = {};
      db.evaluations.forEach((item) => {
        const dept = item.department || "general";
        
        // Calculate TEI
        const reaction = (item.reaction_relevance || 0) * 20;
        const learning = item.post_test_score || 0;
        const behaviors = db.behavior_evaluations.filter(b => b.employee_id === item.employee_id && b.subject_id === item.subject_id);
        const behaviorSum = behaviors.reduce((s, b) => s + (b.q1_demonstrates_skills + b.q2_independently_applies + b.q3_shares_learning + b.q4_solves_problems + b.q5_measurable_improvement), 0);
        const behaviorCount = behaviors.length * 5;
        const behaviorScore = behaviorCount > 0 ? Math.round((behaviorSum / behaviorCount) * 100) : 0;
        const results = db.business_impacts.find(b => b.employee_id === item.employee_id && b.subject_id === item.subject_id);
        const resultsScore = results ? results.business_impact_score : 0;

        const tei = Math.round(reaction * 0.10 + learning * 0.30 + behaviorScore * 0.35 + resultsScore * 0.25);

        if (!deptMap[dept]) {
          deptMap[dept] = { teiSum: 0, count: 0 };
        }
        deptMap[dept].teiSum += tei;
        deptMap[dept].count += 1;
      });

      const departmentBreakdown = Object.entries(deptMap).map(([dept, val]) => ({
        department: dept,
        employee_count: val.count,
        avg_effectiveness: Math.round(val.teiSum / val.count),
      }));

      // Overall average Effectiveness
      const totalTeiSum = Object.values(subjectTEIMap).reduce((s, v) => s + v.teiSum, 0);
      const totalTeiCount = Object.values(subjectTEIMap).reduce((s, v) => s + v.count, 0);
      const avgEffectiveness = totalTeiCount > 0 ? Math.round(totalTeiSum / totalTeiCount) : 0;

      // Skill Gap Analysis
      const skillAverages = Object.entries(subjectTEIMap).map(([id, val]) => ({
        subject_id: id,
        subject_title: val.name,
        avg_competency: Math.min(100, Math.round((val.teiSum / val.count) * 1.1)), // Mocked scale
        target: 100,
      }));

      return NextResponse.json({
        success: true,
        overall_roi: overallROI,
        total_savings: totalSavings,
        total_cost: totalCost,
        training_effectiveness_index: avgEffectiveness,
        high_impact_programs: highImpactPrograms,
        department_effectiveness: departmentBreakdown,
        skill_gap_analysis: skillAverages,
      });
    }

    // -------------------------------------------------------------------------
    // 2. Manager Scope Analytics
    // -------------------------------------------------------------------------
    if (isManager) {
      // Calculate manager averages
      const teamEvals = db.evaluations;
      const count = teamEvals.length;
      
      let behaviorSum = 0;
      let behaviorCount = 0;
      let teiSum = 0;

      const behavior30: number[] = [];
      const behavior60: number[] = [];
      const behavior90: number[] = [];

      db.behavior_evaluations.forEach((item) => {
        const score = Math.round((item.q1_demonstrates_skills + item.q2_independently_applies + item.q3_shares_learning + item.q4_solves_problems + item.q5_measurable_improvement) * 4); // convert to %
        behaviorSum += score;
        behaviorCount += 1;
        if (item.interval_days === 30) behavior30.push(score);
        if (item.interval_days === 60) behavior60.push(score);
        if (item.interval_days === 90) behavior90.push(score);
      });

      const avgBehavior = behaviorCount > 0 ? Math.round(behaviorSum / behaviorCount) : 0;

      teamEvals.forEach((item) => {
        const reaction = (item.reaction_relevance || 0) * 20;
        const learning = item.post_test_score || 0;
        const behaviors = db.behavior_evaluations.filter(b => b.employee_id === item.employee_id && b.subject_id === item.subject_id);
        const bSum = behaviors.reduce((s, b) => s + (b.q1_demonstrates_skills + b.q2_independently_applies + b.q3_shares_learning + b.q4_solves_problems + b.q5_measurable_improvement), 0);
        const bCount = behaviors.length * 5;
        const bScore = bCount > 0 ? Math.round((bSum / bCount) * 100) : 0;
        const results = db.business_impacts.find(b => b.employee_id === item.employee_id && b.subject_id === item.subject_id);
        const resultsScore = results ? results.business_impact_score : 0;

        const tei = Math.round(reaction * 0.10 + learning * 0.30 + bScore * 0.35 + resultsScore * 0.25);
        teiSum += tei;
      });

      const avgTEI = count > 0 ? Math.round(teiSum / count) : 0;

      const behaviorTrends = [
        { name: "30 Days", score: behavior30.length > 0 ? Math.round(behavior30.reduce((a,b)=>a+b)/behavior30.length) : 0 },
        { name: "60 Days", score: behavior60.length > 0 ? Math.round(behavior60.reduce((a,b)=>a+b)/behavior60.length) : 0 },
        { name: "90 Days", score: behavior90.length > 0 ? Math.round(behavior90.reduce((a,b)=>a+b)/behavior90.length) : 0 },
      ];

      const employeeApplicationScores = teamEvals.map((item) => {
        const behaviors = db.behavior_evaluations.filter(b => b.employee_id === item.employee_id && b.subject_id === item.subject_id);
        const bSum = behaviors.reduce((s, b) => s + (b.q1_demonstrates_skills + b.q2_independently_applies + b.q3_shares_learning + b.q4_solves_problems + b.q5_measurable_improvement), 0);
        const bCount = behaviors.length * 5;
        const bScore = bCount > 0 ? Math.round((bSum / bCount) * 100) : 0;
        return {
          employee_id: item.employee_id,
          employee_name: item.employee_name,
          subject_title: item.subject_title,
          application_score: bScore,
        };
      });

      return NextResponse.json({
        success: true,
        team_training_impact: avgTEI,
        employee_application_scores: employeeApplicationScores,
        behavioral_change_trends: behaviorTrends,
      });
    }

    // -------------------------------------------------------------------------
    // 3. Employee Scope Analytics (Default)
    // -------------------------------------------------------------------------
    const employeeEvals = db.evaluations.filter((e) => e.employee_id === employeeIdParam);
    if (employeeEvals.length === 0) {
      return NextResponse.json({
        success: true,
        total_evaluations: 0,
        reaction_score: 0,
        learning_score: 0,
        behavior_score: 0,
        results_score: 0,
        training_effectiveness_score: 0,
        learning_maturity_score: 0,
        competency_development_score: 0,
        knowledge_retention_score: 0,
        bloom_radar: [
          { subject: "Remember", value: 0 },
          { subject: "Understand", value: 0 },
          { subject: "Apply", value: 0 },
          { subject: "Analyze", value: 0 },
          { subject: "Evaluate", value: 0 },
          { subject: "Create", value: 0 },
        ],
        milestones: [],
      });
    }

    let totalPre = 0;
    let totalPost = 0;
    let totalReaction = 0;
    let reactionCount = 0;
    let totalBehavior = 0;
    let behaviorCount = 0;
    let totalResults = 0;
    let resultsCount = 0;

    const bloomAggr = { remember: 0, understand: 0, apply: 0, analyze: 0, evaluate: 0, create: 0 };
    let bloomCount = 0;

    employeeEvals.forEach((item) => {
      totalPre += item.pre_test_score || 0;
      totalPost += item.post_test_score || 0;

      if (item.reaction_relevance) {
        totalReaction += (item.reaction_relevance + (item.reaction_utility || 0) + (item.reaction_instructor || 0)) / 3 * 20; // convert 1-5 scale to 100
        reactionCount += 1;
      }

      if (item.bloom_scores) {
        bloomAggr.remember += item.bloom_scores.remember;
        bloomAggr.understand += item.bloom_scores.understand;
        bloomAggr.apply += item.bloom_scores.apply;
        bloomAggr.analyze += item.bloom_scores.analyze;
        bloomAggr.evaluate += item.bloom_scores.evaluate;
        bloomAggr.create += item.bloom_scores.create;
        bloomCount += 1;
      }

      // Behavior reviews
      const behaviors = db.behavior_evaluations.filter(b => b.employee_id === employeeIdParam && b.subject_id === item.subject_id);
      behaviors.forEach((b) => {
        totalBehavior += (b.q1_demonstrates_skills + b.q2_independently_applies + b.q3_shares_learning + b.q4_solves_problems + b.q5_measurable_improvement) * 4; // scale 1-5 to 100
        behaviorCount += 1;
      });

      // Business results
      const results = db.business_impacts.find(b => b.employee_id === employeeIdParam && b.subject_id === item.subject_id);
      if (results) {
        totalResults += results.business_impact_score;
        resultsCount += 1;
      }
    });

    const reactionScore = reactionCount > 0 ? Math.round(totalReaction / reactionCount) : 0;
    const learningScore = employeeEvals.length > 0 ? Math.round(totalPost / employeeEvals.length) : 0;
    const behaviorScore = behaviorCount > 0 ? Math.round(totalBehavior / behaviorCount) : 0;
    const resultsScore = resultsCount > 0 ? Math.round(totalResults / resultsCount) : 0;

    // Unified Training Effectiveness Score
    const tei = Math.round(
      reactionScore * 0.10 +
      learningScore * 0.30 +
      behaviorScore * 0.35 +
      resultsScore * 0.25
    );

    // Bloom Radar formatted dataset
    const bloomRadar = [
      { subject: "Remember", value: bloomCount > 0 ? Math.round(bloomAggr.remember / bloomCount) : 0 },
      { subject: "Understand", value: bloomCount > 0 ? Math.round(bloomAggr.understand / bloomCount) : 0 },
      { subject: "Apply", value: bloomCount > 0 ? Math.round(bloomAggr.apply / bloomCount) : 0 },
      { subject: "Analyze", value: bloomCount > 0 ? Math.round(bloomAggr.analyze / bloomCount) : 0 },
      { subject: "Evaluate", value: bloomCount > 0 ? Math.round(bloomAggr.evaluate / bloomCount) : 0 },
      { subject: "Create", value: bloomCount > 0 ? Math.round(bloomAggr.create / bloomCount) : 0 },
    ];

    // Maturity, Development, Retention
    const bloomWeightedSum = bloomRadar.reduce((sum, item, idx) => {
      const weights = [0.10, 0.15, 0.25, 0.20, 0.15, 0.15];
      return sum + item.value * weights[idx];
    }, 0);

    const learningMaturity = Math.round(bloomWeightedSum);
    
    const preAvg = Math.round(totalPre / employeeEvals.length);
    const postAvg = Math.round(totalPost / employeeEvals.length);
    const competencyDevelopment = preAvg > 0 ? Math.round(((postAvg - preAvg) / preAvg) * 100) : postAvg;

    // Knowledge retention is behavioral application score relative to immediate post test
    const knowledgeRetention = postAvg > 0 ? Math.min(100, Math.round((behaviorScore / postAvg) * 100)) : behaviorScore;

    // Timeline milestones
    const milestones = employeeEvals.map((item) => {
      const elapsedMs = Date.now() - new Date(item.completion_date).getTime();
      const elapsedDays = Math.floor(elapsedMs / (1000 * 60 * 60 * 24));
      
      const reactionDone = !!item.reaction_relevance;
      const bloomDone = !!item.bloom_scores;
      
      const rmEvals = db.behavior_evaluations.filter(b => b.employee_id === employeeIdParam && b.subject_id === item.subject_id);
      
      return {
        subject_id: item.subject_id,
        subject_title: item.subject_title,
        completion_date: item.completion_date,
        elapsed_days: elapsedDays,
        reaction_complete: reactionDone,
        bloom_complete: bloomDone,
        eval_30_complete: rmEvals.some(e => e.interval_days === 30),
        eval_60_complete: rmEvals.some(e => e.interval_days === 60),
        eval_90_complete: rmEvals.some(e => e.interval_days === 90),
        results_complete: db.business_impacts.some(b => b.employee_id === employeeIdParam && b.subject_id === item.subject_id),
      };
    });

    return NextResponse.json({
      success: true,
      total_evaluations: employeeEvals.length,
      reaction_score: reactionScore,
      learning_score: learningScore,
      behavior_score: behaviorScore,
      results_score: resultsScore,
      training_effectiveness_score: tei,
      learning_maturity_score: learningMaturity,
      competency_development_score: competencyDevelopment,
      knowledge_retention_score: knowledgeRetention,
      bloom_radar: bloomRadar,
      milestones,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to compile analytics" }, { status: 500 });
  }
}
