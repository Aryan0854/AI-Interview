import { NextRequest, NextResponse } from "next/server";
import { authenticateRequestAsync } from "@/lib/employee-auth";
import { effectivenessService } from "@/services/effectiveness-service";

const MOCK_BLOOM_QUESTIONS: Record<string, any[]> = {
  ai: [
    {
      level: "remember",
      question_text: "What is the primary search strategy utilized by the A* Search Algorithm?",
      options: [
        "Depth-first search with chronological backtracking",
        "Heuristic-guided best-first search combining path cost and estimated cost to goal",
        "Breadth-first search with uniform edge weights",
        "Random walk with policy evaluation"
      ],
      correct_idx: 1
    },
    {
      level: "understand",
      question_text: "Explain the difference between a heuristic being admissible versus consistent. In what scenario can A* fail if a heuristic is inadmissible?",
      options: [
        "An admissible heuristic never overestimates the cost, ensuring A* finds the optimal path. An inadmissible heuristic can cause A* to return sub-optimal paths.",
        "A consistent heuristic never overestimates the cost, while an admissible heuristic requires monotonic behavior.",
        "Admissibility only applies to DFS search trees and has no impact on path optimality.",
        "There is no difference; they are synonymous terms for the same mathematical constraint."
      ],
      correct_idx: 0
    },
    {
      level: "apply",
      question_text: "Submit evidence of how you applied heuristic search algorithms in a recent project. Describe the module, algorithm selected, and input data used.",
      placeholder: "e.g., I implemented a Breadth-First Search (BFS) algorithm to dynamically resolve candidate skill overlaps against active Job Descriptions..."
    },
    {
      level: "analyze",
      question_text: "Analyze a performance bottleneck in your search heuristic. How did you diagnose the root cause and profile memory/time complexity?",
      placeholder: "e.g., Profiled node expansion rates and found the heuristic was underestimating, leading to excessive state expansions. Restructured the heuristic..."
    },
    {
      level: "evaluate",
      question_text: "Evaluate the trade-offs of choosing BFS vs A* search in candidate screening logic. Justify your architectural choice based on scalability.",
      placeholder: "e.g., A* is faster for targeted matchings but requires a well-formed heuristic. BFS is robust but slow. I selected A* because..."
    },
    {
      level: "create",
      question_text: "Propose a new AI-driven workflow or custom agent utility. Describe its structure, inputs, outputs, and the estimated operational hours saved.",
      placeholder: "e.g., I propose a custom background cron sync agent that scans resume updates and updates candidate scores. This saves 5 hours of manual screening weekly..."
    }
  ],
  ml: [
    {
      level: "remember",
      question_text: "In machine learning, what is the primary objective of hyperparameter tuning?",
      options: [
        "To update the weights and biases during backpropagation",
        "To find the optimal settings for parameters that are not learned during training, preventing overfitting",
        "To clean missing data rows dynamically from the dataset",
        "To increase the database retrieval speed for feature vectors"
      ],
      correct_idx: 1
    },
    {
      level: "understand",
      question_text: "Explain why classification accuracy alone can be a misleading metric for highly imbalanced datasets. Which metrics would you recommend instead?",
      options: [
        "In imbalanced classes, a model can achieve 99% accuracy by simply predicting the majority class. Precision, Recall, F1-Score, and ROC-AUC are better alternatives.",
        "Accuracy is always the most reliable metric; imbalanced classes should be corrected by discarding data.",
        "Imbalanced data causes model convergence errors, making accuracy mathematically undefined.",
        "F1-score is misleading because it ignores true negatives entirely; accuracy is preferred."
      ],
      correct_idx: 0
    },
    {
      level: "apply",
      question_text: "Describe how you applied a supervised classification or regression algorithm (e.g. Random Forest, SVM) in a project. Specify inputs and target variables.",
      placeholder: "e.g., Applied Random Forest to categorize candidates into suitable/non-suitable bins based on matched skill counts..."
    },
    {
      level: "analyze",
      question_text: "Describe how you performed feature selection or root cause diagnosis on a model showing high variance (overfitting). What was the resolution?",
      placeholder: "e.g., Selected top 15 features using PCA, introduced L2 regularization, and pruned decision trees to reduce model variance..."
    },
    {
      level: "evaluate",
      question_text: "Evaluate the trade-offs between a linear SVM model and an XGBoost ensemble model for candidate screening. Which model is optimal and why?",
      placeholder: "e.g., SVM is fast and interpretable, but XGBoost handles non-linear interactions better. I chose XGBoost because..."
    },
    {
      level: "create",
      question_text: "Propose an innovation or automation idea involving ML pipelines to optimize HR workflows. Estimate its time-savings impact.",
      placeholder: "e.g., Proposed a pipeline that extracts skill taxonomy clusters from raw resumes automatically, reducing manual classification time by 80%..."
    }
  ]
};

const DEFAULT_QUESTIONS = [
  {
    level: "remember",
    question_text: "Which of the following describes the first step in the knowledge representation process?",
    options: [
      "Defining entity concepts, taxonomy, and relations",
      "Writing raw code logic directly in database triggers",
      "Analyzing system log files",
      "Deploying the system to staging"
    ],
    correct_idx: 0
  },
  {
    level: "understand",
    question_text: "Explain how conceptual understanding differs from pure recall in practical engineering tasks.",
    options: [
      "Recall is the ability to remember facts; understanding is the ability to explain concepts and interpret outcomes.",
      "Recall is more complex and weighted higher in professional competencies.",
      "There is no difference in software development.",
      "Understanding only applies to managers and executives."
    ],
    correct_idx: 0
  },
  {
    level: "apply",
    question_text: "Submit evidence of how you applied this subject's concepts in your daily work tasks.",
    placeholder: "Describe the task, action taken, and evidence of implementation..."
  },
  {
    level: "analyze",
    question_text: "Analyze a complex problem or root cause analysis you solved using these techniques.",
    placeholder: "Explain the diagnosis process and analytical reasoning..."
  },
  {
    level: "evaluate",
    question_text: "Evaluate the trade-offs between two alternative approaches in this domain.",
    placeholder: "Compare options, describe risks, and justify the chosen design..."
  },
  {
    level: "create",
    question_text: "Propose a process improvement or custom workflow using these concepts.",
    placeholder: "Outline the proposal structure, architecture, and estimated business impact..."
  }
];

export async function GET(request: NextRequest) {
  const auth = await authenticateRequestAsync(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const subjectId = url.searchParams.get("subjectId") || "";

  if (!subjectId) {
    return NextResponse.json({ error: "Missing subjectId" }, { status: 400 });
  }

  const questions = MOCK_BLOOM_QUESTIONS[subjectId] || DEFAULT_QUESTIONS;
  return NextResponse.json({ success: true, questions });
}

export async function POST(request: NextRequest) {
  const auth = await authenticateRequestAsync(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { subjectId, subjectTitle, answers } = body; // answers: { remember: idx, understand: idx, apply: text, analyze: text, evaluate: text, create: text }

    if (!subjectId || !answers) {
      return NextResponse.json({ error: "Missing required parameters" }, { status: 400 });
    }

    const questions = MOCK_BLOOM_QUESTIONS[subjectId] || DEFAULT_QUESTIONS;
    
    // 1. Grade auto-graded levels (Remember & Understand)
    const rememberQ = questions.find(q => q.level === "remember");
    const understandQ = questions.find(q => q.level === "understand");

    const rememberScore = (answers.remember === rememberQ?.correct_idx) ? 100 : 0;
    const understandScore = (answers.understand === understandQ?.correct_idx) ? 100 : 0;

    const existing = await effectivenessService.getEvaluationBySubject(auth.employeeId, subjectId);

    // 2. Compile Bloom scores and submissions
    const bloom_scores = {
      remember: rememberScore,
      understand: understandScore,
      apply: existing?.bloom_scores?.apply || 0,
      analyze: existing?.bloom_scores?.analyze || 0,
      evaluate: existing?.bloom_scores?.evaluate || 0,
      create: existing?.bloom_scores?.create || 0,
    };

    const bloom_submissions = {
      apply_evidence: answers.apply || "",
      analyze_text: answers.analyze || "",
      evaluate_text: answers.evaluate || "",
      create_text: answers.create || "",
    };

    // Calculate immediate learning gain
    // Immediate post test score uses Remember & Understand (scaled to 100)
    const immediatePostScore = Math.round((rememberScore + understandScore) / 2);

    const updated = await effectivenessService.saveEvaluation({
      employee_id: auth.employeeId,
      employee_name: auth.employee.full_name || auth.employeeId,
      department: auth.employee.department || "general",
      subject_id: subjectId,
      subject_title: subjectTitle || existing?.subject_title || "Subject",
      pre_test_score: existing?.pre_test_score || 0,
      post_test_score: immediatePostScore,
      learning_gain_pct: existing?.pre_test_score 
        ? Math.round(((immediatePostScore - existing.pre_test_score) / (existing.pre_test_score || 1)) * 100) 
        : 0,
      completion_date: existing?.completion_date || new Date().toISOString(),
      reaction_relevance: existing?.reaction_relevance,
      reaction_utility: existing?.reaction_utility,
      reaction_instructor: existing?.reaction_instructor,
      reaction_nps: existing?.reaction_nps,
      reaction_comments: existing?.reaction_comments,
      reaction_submitted_at: existing?.reaction_submitted_at,
      bloom_scores,
      bloom_submissions,
      bloom_graded: {
        apply_score: undefined,
        analyze_score: undefined,
        evaluate_score: undefined,
        create_score: undefined
      },
      bloom_graded_by: undefined,
      bloom_graded_at: undefined,
    });

    return NextResponse.json({ success: true, record: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to submit assessment" }, { status: 500 });
  }
}
