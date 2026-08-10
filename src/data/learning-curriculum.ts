/**
 * Static learning curriculum
 * Used as a fallback / quick-reference if the DB is unavailable during dev.
 */
import type { DifficultyLevel } from "@/types/learning";

// ---------------------------------------------------------------------------
// All subjects
// ---------------------------------------------------------------------------
export interface CurriculumSubject {
  id:       string;
  title:    string;
  icon:     string;
  color:    string;
  modules:  CurriculumModule[];
}

export interface CurriculumModule {
  id:       string;
  title:    string;
  topics:   CurriculumTopic[];
}

export interface CurriculumTopic {
  id:           string;
  title:        string;
  difficulty:   DifficultyLevel;
  estimatedMins:number;
}

// ---------------------------------------------------------------------------
// Curriculum
// Only modules with actual content are listed here.
// Summary titles and icons mirror learning_subjects in the DB.
// ---------------------------------------------------------------------------

export const curriculum: CurriculumSubject[] = [
  {
    // matching learning_subjects id = '1' UNLESS seeded differently — in which
    // case this file is used as a pure frontend references.
    id: "ai",
    title: "Artificial Intelligence",
    icon: "Brain",
    color: "#3b82f6",
    modules: [
      {
        id: "ai-intro",
        title: "Introduction to AI",
        topics: [
          { id: "ai-intro-history",         title: "History of AI",            difficulty: "beginner", estimatedMins: 20 },
          { id: "ai-intro-agents",          title: "Search Algorithms (BFS/DFS/A*)", difficulty: "intermediate", estimatedMins: 30 },
          { id: "ai-intro-adversarial",     title: "Adversarial Search",       difficulty: "intermediate", estimatedMins: 30 },
          { id: "ai-intro-logic",           title: "Logical Inference & Knowledge Representation", difficulty: "advanced", estimatedMins: 30 },
          { id: "ai-intro-expert",          title: "Expert Systems",            difficulty: "advanced", estimatedMins: 30 },
        ],
      },
    ],
  },

  {
    id: "ml",
    title: "Machine Learning",
    icon: "Activity",
    color: "#8b5cf6",
    modules: [
      {
        id: "ml-supervised",
        title: "Supervised Learning",
        topics: [
          { id: "ml-sl-regression",   title: "Linear Regression",           difficulty: "beginner",      estimatedMins: 25 },
          { id: "ml-sl-classification",title: "Logistic Regression",         difficulty: "beginner",      estimatedMins: 25 },
          { id: "ml-sl-knn",          title: "k-Nearest Neighbors",         difficulty: "beginner",      estimatedMins: 20 },
          { id: "ml-sl-svm",          title: "Support Vector Machines",     difficulty: "intermediate",  estimatedMins: 30 },
          { id: "ml-sl-trees",        title: "Decision Trees & Random Forests", difficulty: "intermediate", estimatedMins: 30 },
        ],
      },
      {
        id: "ml-unsupervised",
        title: "Unsupervised Learning",
        topics: [
          { id: "ml-ul-kmeans",   title: "K-Means Clustering",      difficulty: "intermediate", estimatedMins: 25 },
          { id: "ml-ul-pca",      title: "Principal Component Analysis", difficulty: "intermediate",  estimatedMins: 30 },
          { id: "ml-ul-gmm",      title: "Gaussian Mixture Models",  difficulty: "advanced",     estimatedMins: 35 },
        ],
      },
      {
        id: "ml-rl",
        title: "Reinforcement Learning",
        topics: [
          { id: "ml-rl-mdp",      title: "MDPs & Bellman Equations",    difficulty: "advanced",   estimatedMins: 30 },
          { id: "ml-rl-q",        title: "Q-Learning",                  difficulty: "advanced",   estimatedMins: 30 },
          { id: "ml-rl-pg",       title: "Policy Gradients",            difficulty: "expert",     estimatedMins: 35 },
        ],
      },
      {
        id: "ml-eval",
        title: "Model Evaluation",
        topics: [
          { id: "ml-ev-metrics",     title: "Classification & Regression Metrics", difficulty: "intermediate", estimatedMins: 25 },
          { id: "ml-ev-cv",          title: "Cross-Validation",                     difficulty: "beginner",     estimatedMins: 20 },
          { id: "ml-ev-hyper",       title: "Hyperparameter Tuning",                difficulty: "intermediate", estimatedMins: 25 },
        ],
      },
      {
        id: "ml-ensemble",
        title: "Ensemble Methods",
        topics: [
          { id: "ml-en-rf",    title: "Random Forests",    difficulty: "intermediate", estimatedMins: 25 },
          { id: "ml-en-xgb",   title: "XGBoost & LightGBM", difficulty: "intermediate", estimatedMins: 30 },
          { id: "ml-en-stack", title: "Stacking & Blending",difficulty: "advanced",    estimatedMins: 30 },
        ],
      },
    ],
  },

  {
    id: "ds",
    title: "Data Science",
    icon: "BarChart3",
    color: "#10b981",
    modules: [
      {
        id: "ds-stats",
        title: "Statistical Foundations",
        topics: [
          { id: "ds-stats-prob",  title: "Probability Distributions",      difficulty: "intermediate", estimatedMins: 25 },
          { id: "ds-stats-hyp",   title: "Hypothesis Testing",              difficulty: "intermediate", estimatedMins: 25 },
          { id: "ds-stats-bayes", title: "Bayesian Inference",              difficulty: "advanced",     estimatedMins: 30 },
        ],
      },
      {
        id: "ds-eda",
        title: "Exploratory Data Analysis",
        topics: [
          { id: "ds-eda-visual", title: "Visualization Principles",   difficulty: "beginner",  estimatedMins: 20 },
          { id: "ds-eda-missing",title: "Missing Data Handling",      difficulty: "intermediate", estimatedMins: 25 },
          { id: "ds-eda-outliers",title:"Outlier Detection",          difficulty: "intermediate", estimatedMins: 25 },
        ],
      },
      {
        id: "ds-pandas",
        title: "Pandas & NumPy",
        topics: [
          { id: "ds-pd-ops",      title: "Vectorised Operations",         difficulty: "beginner", estimatedMins: 20 },
          { id: "ds-pd-groupby",  title: "GroupBy & Pivot Tables",        difficulty: "intermediate", estimatedMins: 25 },
          { id: "ds-pd-timeseries",title:"Time-Series Indexing",          difficulty: "intermediate", estimatedMins: 25 },
        ],
      },
    ],
  },

  // Remaining subjects — minimal seeding; expand as needed
  ...(["Deep Learning","NLP","Computer Vision","Generative AI",
       "Python","SQL","Cloud Computing","MLOps",
       "Data Engineering","Large Language Models","AI Ethics & Governance"] as const).map(
    (title, i) => ({
      id:    `s${i + 4}`,
      title: title,
      icon:  "BookOpen",
      color: "#64748b",
      modules: [
        {
          id:    `m${i + 4}`,
          title: "Core Concepts",
          topics: [
            { id: `t${i + 4}-1`, title: `${title} Fundamentals`,  difficulty: "beginner" as DifficultyLevel, estimatedMins: 25 },
            { id: `t${i + 4}-2`, title: `${title} Intermediate`,  difficulty: "intermediate" as DifficultyLevel, estimatedMins: 30 },
            { id: `t${i + 4}-3`, title: `${title} Advanced`,     difficulty: "advanced" as DifficultyLevel,    estimatedMins: 35 },
          ],
        },
      ],
    })
  ),
];

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

export function findSubject(idOrTitle: string): CurriculumSubject | undefined {
  return curriculum.find(
    (s) => s.id.toLowerCase() === idOrTitle.toLowerCase()
        || s.title.toLowerCase().includes(idOrTitle.toLowerCase())
  );
}

export function findTopic(idOrTitle: string, subjId?: string): { subject: CurriculumSubject; module: CurriculumModule; topic: CurriculumTopic } | undefined {
  for (const subject of subjId ? curriculum.filter((s) => s.id === subjId) : curriculum) {
    for (const module of subject.modules) {
      const topic = module.topics.find(
        (t) => t.id.toLowerCase() === idOrTitle.toLowerCase()
          || t.title.toLowerCase().includes(idOrTitle.toLowerCase())
      );
      if (topic) return { subject, module, topic };
    }
  }
  return undefined;
}
