import { formatProductDisplayName } from "@/lib/product-display-name";

/**
 * Portal learning subject cards shown on /employee/learn.
 */
export interface PortalLearningSubject {
  id: string;
  title: string;
  description: string;
  icon: string;
  color: string;
  href?: string;
}

export const QB_SUBJECT_BLOCKLIST = new Set(
  ["question banks", "auto-imported products"].map((s) => s.toLowerCase())
);

export function isBlockedQbCatalogSubject(subject: { title?: string; description?: string }): boolean {
  const title = (subject.title ?? "").trim().toLowerCase();
  const description = (subject.description ?? "").trim().toLowerCase();
  return QB_SUBJECT_BLOCKLIST.has(title) || description.includes("auto-imported");
}

export function buildLearningTopicsForEmployee(options: {
  productQbEligible: boolean;
  product?: string;
}): PortalLearningSubject[] {
  const topics: PortalLearningSubject[] = [...portalLearningSubjects];

  if (options.productQbEligible) {
    topics.unshift({
      id: "resource-product-assessment",
      title: options.product
        ? `${formatProductDisplayName(options.product)} Question Bank`
        : "Product Question Bank",
      description: "Your assigned product assessment from the question bank",
      icon: "Database",
      color: "#4338CA",
    });
  }

  return topics.filter((subject) => !isBlockedQbCatalogSubject(subject));
}

export const portalLearningSubjects: PortalLearningSubject[] = [
  {
    id: "ai",
    title: "Artificial Intelligence",
    description: "Neural networks, expert systems, and foundational AI theory",
    icon: "Brain",
    color: "#3b82f6",
  },
  {
    id: "ml",
    title: "Machine Learning",
    description: "Supervised, unsupervised, and reinforcement learning algorithms",
    icon: "Activity",
    color: "#8b5cf6",
  },
  {
    id: "ds",
    title: "Data Science",
    description: "Statistics, EDA, and end-to-end data pipelines",
    icon: "BarChart3",
    color: "#10b981",
  },
  {
    id: "dl",
    title: "Deep Learning",
    description: "CNNs, RNNs, transformers, and advanced neural architectures",
    icon: "Layers",
    color: "#6366f1",
  },
  {
    id: "nlp",
    title: "Natural Language Processing",
    description: "Text mining, sentiment analysis, and LLM engineering",
    icon: "MessageSquare",
    color: "#0ea5e9",
  },
  {
    id: "cv",
    title: "Computer Vision",
    description: "Image classification, object detection, and segmentation models",
    icon: "Eye",
    color: "#a855f7",
  },
  {
    id: "genai",
    title: "Generative AI",
    description: "GANs, VAEs, diffusion models, and LLM fine-tuning",
    icon: "Sparkles",
    color: "#ec4899",
  },
  {
    id: "python",
    title: "Python Programming",
    description: "Core language features, OOP, async, and standard library",
    icon: "Code",
    color: "#06b6d4",
  },
  {
    id: "sql",
    title: "SQL & Databases",
    description: "Query design, indexing, transactions, and optimization",
    icon: "Database",
    color: "#14b8a6",
  },
  {
    id: "cloud",
    title: "Cloud Computing",
    description: "AWS/GCP/Azure fundamentals, IaaS/PaaS/SaaS, cost management",
    icon: "Cloud",
    color: "#f59e0b",
  },
  {
    id: "mlops",
    title: "MLOps",
    description: "CI/CD for ML, model serving, monitoring, and drift detection",
    icon: "Zap",
    color: "#ef4444",
  },
  {
    id: "data-eng",
    title: "Data Engineering",
    description: "Pipelines, ETL/ELT, orchestration with Airflow / dbt, lakehouse",
    icon: "Workflow",
    color: "#64748b",
  },
  {
    id: "llm",
    title: "Large Language Models",
    description: "Prompt engineering, fine-tuning, RAG, function calling, evaluation",
    icon: "Bot",
    color: "#7c3aed",
  },
  {
    id: "ai-ethics",
    title: "AI Ethics & Governance",
    description: "Bias mitigation, responsible AI, EU AI Act, model auditing",
    icon: "Shield",
    color: "#475569",
  },
];

export function buildPortalCatalogFromSubjects() {
  return portalLearningSubjects.map((subject) => ({
    id: subject.id,
    title: subject.title,
    description: subject.description,
    icon: subject.icon,
    color: subject.color,
    is_active: true,
    modules: [
      {
        id: `${subject.id}-core`,
        subject_id: subject.id,
        title: "Core Concepts",
        description: subject.description,
        order_index: 1,
        topics: [
          {
            id: `${subject.id}-fundamentals`,
            module_id: `${subject.id}-core`,
            title: `${subject.title} Fundamentals`,
            difficulty: "beginner",
            order_index: 1,
            estimated_minutes: 25,
          },
          {
            id: `${subject.id}-intermediate`,
            module_id: `${subject.id}-core`,
            title: `${subject.title} Intermediate`,
            difficulty: "intermediate",
            order_index: 2,
            estimated_minutes: 30,
          },
          {
            id: `${subject.id}-advanced`,
            module_id: `${subject.id}-core`,
            title: `${subject.title} Advanced`,
            difficulty: "advanced",
            order_index: 3,
            estimated_minutes: 35,
          },
        ],
      },
    ],
  }));
}
