-- 1. Learning Subjects (14) - Idempotent Insert
-- ---------------------------------------------------------------------------
INSERT INTO learning_subjects (title, description, icon, color, order_index)
SELECT v.title, v.description, v.icon, v.color, v.order_index
FROM (VALUES
  ('Artificial Intelligence',         'Neural networks, expert systems, and foundational AI theory',                           'Brain',             '#3b82f6', 1),
  ('Machine Learning',               'Supervised, unsupervised, and reinforcement learning algorithms',                       'Activity',          '#8b5cf6', 2),
  ('Data Science',                   'Statistics, EDA, and end-to-end data pipelines',                                        'BarChart3',         '#10b981', 3),
  ('Deep Learning',                  'CNNs, RNNs, transformers, and advanced neural architectures',                           'Layers',            '#f59e0b', 4),
  ('Natural Language Processing',   'Text mining, sentiment analysis, and LLM engineering',                                  'MessageSquare',     '#ef4444', 5),
  ('Computer Vision',                'Image classification, object detection, and segmentation models',                       'Eye',               '#06b6d4', 6),
  ('Generative AI',                  'GANs, VAEs, diffusion models, and LLM fine-tuning',                                    'Sparkles',          '#ec4899', 7),
  ('Python Programming',             'Core language features, OOP, async, and standard library',                             'Terminal',          '#22c55e', 8),
  ('SQL & Databases',                'Query design, indexing, transactions, and optimization',                                'Database',          '#6366f1', 9),
  ('Cloud Computing',                'AWS/GCP/Azure fundamentals, IaaS/PaaS/SaaS, cost management',                          'Cloud',             '#0ea5e9', 10),
  ('MLOps',                          'CI/CD for ML, model serving, monitoring, and drift detection',                          'Gauge',             '#f97316', 11),
  ('Data Engineering',               'Pipelines, ETL/ELT, orchestration with Airflow / dbt, lakehouse',                      'GitBranch',         '#14b8a6', 12),
  ('Large Language Models',         'Prompt engineering, fine-tuning, RAG, function calling, evaluation',                   'Bot',               '#a855f7', 13),
  ('AI Ethics & Governance',        'Bias mitigation, responsible AI, EU AI Act, model auditing',                           'Shield',            '#64748b', 14)
) AS v(title, description, icon, color, order_index)
WHERE NOT EXISTS (SELECT 1 FROM learning_subjects s WHERE s.title = v.title);

-- ---------------------------------------------------------------------------
-- 2. Modules — Artificial Intelligence (subject 1)
-- ---------------------------------------------------------------------------
INSERT INTO learning_modules (subject_id, title, description, order_index)
SELECT s.id, v.title, v.description, v.ord
FROM learning_subjects s
CROSS JOIN (VALUES
  ('Introduction to AI',          'History, definitions, and key milestones of artificial intelligence',       1),
  ('Search Algorithms',          'BFS, DFS, A*, minimax, and alpha-beta pruning',                            2),
  ('Knowledge Representation',   'Ontologies, logic, frames, and semantic networks',                         3),
  ('Expert Systems',            'Rule-based systems, inference engines, and MYCIN architecture',            4),
  ('AI Agents',                 'Goal-directed agents, environments, and utility-based decision-making',    5)
) AS v(title, description, ord)
WHERE s.title = 'Artificial Intelligence'
  AND NOT EXISTS (SELECT 1 FROM learning_modules m WHERE m.subject_id = s.id AND m.title = v.title);

-- ---------------------------------------------------------------------------
-- 3. Modules — Machine Learning (subject 2)
-- ---------------------------------------------------------------------------
INSERT INTO learning_modules (subject_id, title, description, order_index)
SELECT s.id, v.title, v.description, v.ord
FROM learning_subjects s
CROSS JOIN (VALUES
  ('Supervised Learning',       'Linear/logistic regression, decision trees, k-NN, and SVM',            1),
  ('Unsupervised Learning',     'K-means, PCA, t-SNE, and Gaussian mixture models',                       2),
  ('Reinforcement Learning',    'Q-learning, policy gradients, and actor-critic architectures',           3),
  ('Model Evaluation',         'Metrics, cross-validation, ROC-AUC, F1, and hyperparameter tuning',    4),
  ('Ensemble Methods',         'Random forests, XGBoost, bagging, and boosting',                         5)
) AS v(title, description, ord)
WHERE s.title = 'Machine Learning'
  AND NOT EXISTS (SELECT 1 FROM learning_modules m WHERE m.subject_id = s.id AND m.title = v.title);

-- ---------------------------------------------------------------------------
-- 4. Modules — Data Science (subject 3)
-- ---------------------------------------------------------------------------
INSERT INTO learning_modules (subject_id, title, description, order_index)
SELECT s.id, v.title, v.description, v.ord
FROM learning_subjects s
CROSS JOIN (VALUES
  ('Statistical Foundations',   'Probability, distributions, hypothesis testing, and Bayesian inference', 1),
  ('EDA & Visualization',       'Matplotlib, seaborn, EDA techniques, and storytelling with data',        2),
  ('Pandas & NumPy Deep Dive',  'Vectorised operations, pivoting, and time-series analysis',              3)
) AS v(title, description, ord)
WHERE s.title = 'Data Science'
  AND NOT EXISTS (SELECT 1 FROM learning_modules m WHERE m.subject_id = s.id AND m.title = v.title);

-- Remaining 11 subjects get a single generic module each
INSERT INTO learning_modules (subject_id, title, description, order_index)
SELECT id, 'Core Concepts', 'Foundational topics for ' || title, 1
FROM learning_subjects s
WHERE title NOT IN ('Artificial Intelligence','Machine Learning','Data Science')
  AND NOT EXISTS (SELECT 1 FROM learning_modules m WHERE m.subject_id = s.id AND m.title = 'Core Concepts');

-- ============================================================
-- 5. Topics
-- ============================================================

-- ---------- Artificial Intelligence subject ----------
INSERT INTO learning_topics (module_id, title, difficulty, order_index, estimated_minutes)
SELECT m.id, t.title, t.difficulty::difficulty_level, t.ord, t.mins
FROM learning_modules m
CROSS JOIN (VALUES
  ('History of AI',                 'beginner',    1, 20),
  ('Search Algorithms (BFS/DFS)',  'intermediate',2, 30),
  ('Adversarial Search',            'intermediate',3, 30),
  ('Knowledge Representation',      'advanced',    4, 30),
  ('Expert Systems',                'advanced',    5, 30)
) AS t(title, difficulty, ord, mins)
WHERE m.subject_id IN (SELECT id FROM learning_subjects WHERE title = 'Artificial Intelligence')
  AND m.title = 'Introduction to AI'
  AND NOT EXISTS (SELECT 1 FROM learning_topics tp WHERE tp.module_id = m.id AND tp.title = t.title)
ORDER BY t.ord;

INSERT INTO learning_topics (module_id, title, difficulty, order_index, estimated_minutes)
SELECT m.id, t.title, t.difficulty::difficulty_level, t.ord, t.mins
FROM learning_modules m
CROSS JOIN (VALUES
  ('BFS & DFS',                     'beginner',    1, 20),
  ('A* Search',                     'intermediate',2, 30),
  ('Minimax',                       'intermediate',3, 30),
  ('Alpha-Beta Pruning',            'advanced',    4, 30)
) AS t(title, difficulty, ord, mins)
WHERE m.subject_id IN (SELECT id FROM learning_subjects WHERE title = 'Artificial Intelligence')
  AND m.title = 'Search Algorithms'
  AND NOT EXISTS (SELECT 1 FROM learning_topics tp WHERE tp.module_id = m.id AND tp.title = t.title)
ORDER BY t.ord;

INSERT INTO learning_topics (module_id, title, difficulty, order_index, estimated_minutes)
SELECT m.id, t.title, t.difficulty::difficulty_level, t.ord, t.mins
FROM learning_modules m
CROSS JOIN (VALUES
  ('Ontologies & Frames',           'intermediate',1, 25),
  ('Propositional Logic',           'intermediate',2, 25),
  ('Semantic Networks',             'advanced',    3, 30)
) AS t(title, difficulty, ord, mins)
WHERE m.subject_id IN (SELECT id FROM learning_subjects WHERE title = 'Artificial Intelligence')
  AND m.title = 'Knowledge Representation'
  AND NOT EXISTS (SELECT 1 FROM learning_topics tp WHERE tp.module_id = m.id AND tp.title = t.title)
ORDER BY t.ord;

INSERT INTO learning_topics (module_id, title, difficulty, order_index, estimated_minutes)
SELECT m.id, t.title, t.difficulty::difficulty_level, t.ord, t.mins
FROM learning_modules m
CROSS JOIN (VALUES
  ('Rule-Based Systems',            'intermediate',1, 25),
  ('Inference Engines',             'intermediate',2, 25),
  ('MYCIN Architecture',            'advanced',    3, 30)
) AS t(title, difficulty, ord, mins)
WHERE m.subject_id IN (SELECT id FROM learning_subjects WHERE title = 'Artificial Intelligence')
  AND m.title = 'Expert Systems'
  AND NOT EXISTS (SELECT 1 FROM learning_topics tp WHERE tp.module_id = m.id AND tp.title = t.title)
ORDER BY t.ord;

INSERT INTO learning_topics (module_id, title, difficulty, order_index, estimated_minutes)
SELECT m.id, t.title, t.difficulty::difficulty_level, t.ord, t.mins
FROM learning_modules m
CROSS JOIN (VALUES
  ('Goal-Directed Agents',          'beginner',    1, 20),
  ('Utility-Based Decision Making', 'intermediate',2, 25),
  ('Reinforcement Learning Basics', 'advanced',    3, 30)
) AS t(title, difficulty, ord, mins)
WHERE m.subject_id IN (SELECT id FROM learning_subjects WHERE title = 'Artificial Intelligence')
  AND m.title = 'AI Agents'
  AND NOT EXISTS (SELECT 1 FROM learning_topics tp WHERE tp.module_id = m.id AND tp.title = t.title)
ORDER BY t.ord;

-- ---------- Machine Learning subject ----------
INSERT INTO learning_topics (module_id, title, difficulty, order_index, estimated_minutes)
SELECT m.id, t.title, t.difficulty::difficulty_level, t.ord, t.mins
FROM learning_modules m
CROSS JOIN (VALUES
  ('Linear Regression',             'beginner',    1, 25),
  ('Logistic Regression',           'beginner',    2, 25),
  ('Decision Trees',                'intermediate',3, 30),
  ('k-NN',                          'beginner',    4, 20),
  ('Support Vector Machines',       'intermediate',5, 30)
) AS t(title, difficulty, ord, mins)
WHERE m.subject_id IN (SELECT id FROM learning_subjects WHERE title = 'Machine Learning')
  AND m.title = 'Supervised Learning'
  AND NOT EXISTS (SELECT 1 FROM learning_topics tp WHERE tp.module_id = m.id AND tp.title = t.title)
ORDER BY t.ord;

INSERT INTO learning_topics (module_id, title, difficulty, order_index, estimated_minutes)
SELECT m.id, t.title, t.difficulty::difficulty_level, t.ord, t.mins
FROM learning_modules m
CROSS JOIN (VALUES
  ('K-Means Clustering',            'intermediate',1, 25),
  ('PCA',                           'intermediate',2, 25),
  ('t-SNE',                         'advanced',    3, 30),
  ('Gaussian Mixture Models',       'advanced',    4, 30)
) AS t(title, difficulty, ord, mins)
WHERE m.subject_id IN (SELECT id FROM learning_subjects WHERE title = 'Machine Learning')
  AND m.title = 'Unsupervised Learning'
  AND NOT EXISTS (SELECT 1 FROM learning_topics tp WHERE tp.module_id = m.id AND tp.title = t.title)
ORDER BY t.ord;

INSERT INTO learning_topics (module_id, title, difficulty, order_index, estimated_minutes)
SELECT m.id, t.title, t.difficulty::difficulty_level, t.ord, t.mins
FROM learning_modules m
CROSS JOIN (VALUES
  ('Q-Learning',                    'advanced',    1, 30),
  ('Policy Gradients',              'advanced',    2, 30),
  ('Actor-Critic Methods',          'expert',      3, 35)
) AS t(title, difficulty, ord, mins)
WHERE m.subject_id IN (SELECT id FROM learning_subjects WHERE title = 'Machine Learning')
  AND m.title = 'Reinforcement Learning'
  AND NOT EXISTS (SELECT 1 FROM learning_topics tp WHERE tp.module_id = m.id AND tp.title = t.title)
ORDER BY t.ord;

INSERT INTO learning_topics (module_id, title, difficulty, order_index, estimated_minutes)
SELECT m.id, t.title, t.difficulty::difficulty_level, t.ord, t.mins
FROM learning_modules m
CROSS JOIN (VALUES
  ('Classification Metrics',        'intermediate',1, 25),
  ('ROC-AUC & F1',                  'intermediate',2, 25),
  ('Cross-Validation',              'beginner',    3, 20),
  ('Hyperparameter Tuning',         'intermediate',4, 25)
) AS t(title, difficulty, ord, mins)
WHERE m.subject_id IN (SELECT id FROM learning_subjects WHERE title = 'Machine Learning')
  AND m.title = 'Model Evaluation'
  AND NOT EXISTS (SELECT 1 FROM learning_topics tp WHERE tp.module_id = m.id AND tp.title = t.title)
ORDER BY t.ord;

INSERT INTO learning_topics (module_id, title, difficulty, order_index, estimated_minutes)
SELECT m.id, t.title, t.difficulty::difficulty_level, t.ord, t.mins
FROM learning_modules m
CROSS JOIN (VALUES
  ('Random Forests',                'intermediate',1, 25),
  ('XGBoost & LightGBM',            'intermediate',2, 30),
  ('Bagging & Boosting',            'intermediate',3, 25),
  ('Stacking',                      'advanced',    4, 30)
) AS t(title, difficulty, ord, mins)
WHERE m.subject_id IN (SELECT id FROM learning_subjects WHERE title = 'Machine Learning')
  AND m.title = 'Ensemble Methods'
  AND NOT EXISTS (SELECT 1 FROM learning_topics tp WHERE tp.module_id = m.id AND tp.title = t.title)
ORDER BY t.ord;

-- ---------- Data Science subject ----------
INSERT INTO learning_topics (module_id, title, difficulty, order_index, estimated_minutes)
SELECT m.id, t.title, t.difficulty::difficulty_level, t.ord, t.mins
FROM learning_modules m
CROSS JOIN (VALUES
  ('Probability Distributions',     'intermediate',1, 25),
  ('Hypothesis Testing',            'intermediate',2, 25),
  ('Bayesian Inference',            'advanced',    3, 30)
) AS t(title, difficulty, ord, mins)
WHERE m.subject_id IN (SELECT id FROM learning_subjects WHERE title = 'Data Science')
  AND m.title = 'Statistical Foundations'
  AND NOT EXISTS (SELECT 1 FROM learning_topics tp WHERE tp.module_id = m.id AND tp.title = t.title)
ORDER BY t.ord;

INSERT INTO learning_topics (module_id, title, difficulty, order_index, estimated_minutes)
SELECT m.id, t.title, t.difficulty::difficulty_level, t.ord, t.mins
FROM learning_modules m
CROSS JOIN (VALUES
  ('Visualization Principles',      'beginner',    1, 20),
  ('Missing Data Handling',         'intermediate',2, 25),
  ('Outlier Detection',             'intermediate',3, 25)
) AS t(title, difficulty, ord, mins)
WHERE m.subject_id IN (SELECT id FROM learning_subjects WHERE title = 'Data Science')
  AND m.title = 'EDA & Visualization'
  AND NOT EXISTS (SELECT 1 FROM learning_topics tp WHERE tp.module_id = m.id AND tp.title = t.title)
ORDER BY t.ord;

INSERT INTO learning_topics (module_id, title, difficulty, order_index, estimated_minutes)
SELECT m.id, t.title, t.difficulty::difficulty_level, t.ord, t.mins
FROM learning_modules m
CROSS JOIN (VALUES
  ('Vectorised Operations',         'beginner',    1, 20),
  ('GroupBy & Pivot Tables',        'intermediate',2, 25),
  ('Time-Series Indexing',          'intermediate',3, 25)
) AS t(title, difficulty, ord, mins)
WHERE m.subject_id IN (SELECT id FROM learning_subjects WHERE title = 'Data Science')
  AND m.title = 'Pandas & NumPy Deep Dive'
  AND NOT EXISTS (SELECT 1 FROM learning_topics tp WHERE tp.module_id = m.id AND tp.title = t.title)
ORDER BY t.ord;

-- ---------- All 11 remaining subjects ----------
INSERT INTO learning_topics (module_id, title, difficulty, order_index, estimated_minutes)
SELECT m.id, t.title, t.difficulty::difficulty_level, t.ord, t.mins
FROM learning_modules m
CROSS JOIN (VALUES
  ('Fundamentals',                  'beginner',    1, 25),
  ('Intermediate Concepts',         'intermediate',2, 30),
  ('Advanced Topics',               'advanced',    3, 35)
) AS t(title, difficulty, ord, mins)
WHERE m.title = 'Core Concepts'
  AND NOT EXISTS (SELECT 1 FROM learning_topics tp WHERE tp.module_id = m.id AND tp.title = t.title)
ORDER BY m.subject_id, t.ord;


-- ---------------------------------------------------------------------------
-- Employee seed data (2 sample employees)
-- ---------------------------------------------------------------------------
INSERT INTO employees (
  employee_id, email, full_name, department, role,
  xp_points, streak_days, last_active_date,
  badges, skill_level, ai_readiness_score, is_first_login
) VALUES
  (
    'EMP002',
    'arjun.sharma@company.com',
    'Arjun Sharma',
    'engineering',
    'Senior Software Engineer',
    350,
    5,
    CURRENT_DATE,
    '[{"id":"first_login","label":"Early Adopter","icon":"Star","earned_at":"2026-08-01T00:00:00Z"}]',
    'intermediate',
    72,
    false
  ),
  (
    'EMP003',
    'priya.nair@company.com',
    'Priya Nair',
    'data-science',
    'Data Scientist',
    120,
    2,
    CURRENT_DATE,
    '[]',
    'beginner',
    45,
    false
  );

