import { askGemini } from "./learning-ai";
import { join } from "path";
import { existsSync } from "fs";
import { readFile, writeFile, mkdir } from "fs/promises";

export function mapDifficulty(diff: string): string {
  const d = String(diff).toLowerCase().trim();
  if (d === "easy" || d === "beginner") return "beginner";
  if (d === "medium" || d === "intermediate") return "intermediate";
  if (d === "hard" || d === "advanced") return "advanced";
  if (d === "expert") return "expert";
  return "intermediate";
}

export function isMissingTestsTableError(error: unknown) {
  const message = String(
    (error as any)?.message ||
    (error as any)?.error ||
    error ||
    ""
  ).toLowerCase();
  return (
    message.includes("could not find table") ||
    message.includes("not found in the schema cache") ||
    message.includes("relation \"tests\" does not exist")
  );
}

export function getFallbackQuestions(topicTitle: string, defDiff: string): any[] {
  const titleLower = topicTitle.toLowerCase();

  // --- 1. History of AI ---
  if (titleLower.includes("history")) {
    return [
      {
        question: "Who proposed the famous 'Turing Test' in 1950 to evaluate machine intelligence?",
        options: ["Alan Turing", "John McCarthy", "Marvin Minsky", "Herbert Simon"],
        correctIndex: 0,
        explanation: "Alan Turing proposed the Turing Test in his 1950 paper 'Computing Machinery and Intelligence'.",
        difficulty: "easy",
      },
      {
        question: "Which conference in 1956 is widely regarded as the birth of artificial intelligence as an academic field?",
        options: ["The Dartmouth Workshop", "The Stanford Summit", "The MIT AI Symposium", "The London Turing Congress"],
        correctIndex: 0,
        explanation: "The Dartmouth Summer Research Project on Artificial Intelligence (1956) was the birth of the field.",
        difficulty: "easy",
      },
      {
        question: "What does the term 'AI Winter' refer to in the history of AI?",
        options: ["Periods of reduced funding and interest in AI research due to unmet expectations", "The development of AI systems designed to monitor global weather patterns", "A technical failure of early mainframe computers during winter months", "An early AI chess program that went undefeated during the winter of 1974"],
        correctIndex: 0,
        explanation: "AI Winters were periods of decline in interest and funding following periods of over-optimism.",
        difficulty: "medium",
      },
      {
        question: "Which early AI program, developed by Joseph Weizenbaum at MIT in the 1960s, simulated a Rogerian psychotherapist?",
        options: ["ELIZA", "SHRDLU", "MYCIN", "Deep Blue"],
        correctIndex: 0,
        explanation: "ELIZA was one of the first natural language processing programs, simulating conversation by pattern matching.",
        difficulty: "medium",
      },
      {
        question: "Which IBM computer defeated world chess champion Garry Kasparov in 1997?",
        options: ["Deep Blue", "Watson", "AlphaGo", "DeepMind"],
        correctIndex: 0,
        explanation: "Deep Blue's victory was a historic milestone for computer chess and AI history.",
        difficulty: "easy",
      },
      {
        question: "What was the primary approach of early AI systems in the 1950s and 60s, often called 'Good Old-Fashioned AI' (GOFAI)?",
        options: ["Symbolic reasoning and logic-based representations", "Deep neural networks and backpropagation", "Reinforcement learning through trial and error", "Unsupervised clustering of big data"],
        correctIndex: 0,
        explanation: "GOFAI focused on manipulating symbolic representations of the world using rules and logic.",
        difficulty: "medium",
      },
      {
        question: "Who coined the term 'Artificial Intelligence' in 1955?",
        options: ["John McCarthy", "Marvin Minsky", "Claude Shannon", "Arthur Samuel"],
        correctIndex: 0,
        explanation: "John McCarthy coined the term in his proposal for the 1956 Dartmouth Workshop.",
        difficulty: "easy",
      },
      {
        question: "What major hardware advancement in the late 2000s fueled the modern 'Deep Learning' boom?",
        options: ["Graphics Processing Units (GPUs)", "Floppy disk storage", "Vacuum tube systems", "Mechanical relay switches"],
        correctIndex: 0,
        explanation: "GPUs allowed parallel computation of large matrix multiplications, accelerating neural network training.",
        difficulty: "easy",
      },
      {
        question: "The 'Lighthill Report' of 1973 had what major effect on AI research?",
        options: ["It led to a dramatic cut in AI research funding in the UK", "It announced the discovery of backpropagation", "It predicted the invention of self-driving cars by 1980", "It established the first computer science department at Cambridge"],
        correctIndex: 0,
        explanation: "The Lighthill Report criticized the lack of practical results in AI, initiating a funding drop.",
        difficulty: "hard",
      },
      {
        question: "What early neural network model, invented by Frank Rosenblatt in 1958, was later criticized by Minsky and Papert?",
        options: ["The Perceptron", "The Transformer", "The Hopfield Network", "The Autoencoder"],
        correctIndex: 0,
        explanation: "The 1969 book 'Perceptrons' showed its inability to solve non-linearly separable problems like XOR.",
        difficulty: "hard",
      },
      {
        question: "Which system was developed in the 1970s at Stanford to diagnose blood infections and prescribe treatments?",
        options: ["MYCIN", "ELIZA", "Shakey the Robot", "General Problem Solver"],
        correctIndex: 0,
        explanation: "MYCIN was an early expert system that used about 450 rules to perform medical diagnoses.",
        difficulty: "medium",
      },
      {
        question: "In 2012, which deep convolutional neural network won the ImageNet challenge by a huge margin, sparking the deep learning era?",
        options: ["AlexNet", "ResNet", "LeNet", "Transformer"],
        correctIndex: 0,
        explanation: "AlexNet, designed by Alex Krizhevsky, Ilya Sutskever, and Geoffrey Hinton, revolutionized computer vision.",
        difficulty: "medium",
      },
      {
        question: "Which AI system developed by Google DeepMind defeated a 9-dan professional Go player in 2016?",
        options: ["AlphaGo", "Deep Blue", "Watson", "AlphaFold"],
        correctIndex: 0,
        explanation: "AlphaGo defeated Lee Sedol, demonstrating the power of deep reinforcement learning and tree search.",
        difficulty: "easy",
      },
      {
        question: "What was the main focus of the 'Connectionist' school of AI that emerged in the 1980s?",
        options: ["Artificial neural networks inspired by the biological brain", "If-then rule engines and relational databases", "Physical robot arms navigating maze environments", "Formal mathematical logic proofs"],
        correctIndex: 0,
        explanation: "Connectionism proposed that mental phenomena can be described by interconnected networks of simple units.",
        difficulty: "medium",
      },
      {
        question: "Which famous scientist wrote the 1948 report 'Intelligent Machinery', outlining neural networks and evolutionary training long before the field was named?",
        options: ["Alan Turing", "Albert Einstein", "Richard Feynman", "John von Neumann"],
        correctIndex: 0,
        explanation: "Alan Turing's 1948 report introduced many foundational concepts that would later define machine learning.",
        difficulty: "hard",
      }
    ];
  }

  // --- 2. Search Algorithms (BFS/DFS/A*) ---
  if (titleLower.includes("search algorithm")) {
    return [
      {
        question: "Which search algorithm guarantees finding the shortest path first in an unweighted graph?",
        options: ["Breadth-First Search (BFS)", "Depth-First Search (DFS)", "Depth-Limited Search", "Greedy Best-First Search"],
        correctIndex: 0,
        explanation: "BFS explores nodes level by level, ensuring that the first time a goal is reached, it is via the path with the fewest edges.",
        difficulty: "easy",
      },
      {
        question: "What is the space complexity of Depth-First Search (DFS) where 'b' is the branching factor and 'm' is the maximum depth?",
        options: ["O(bm)", "O(b^m)", "O(b + m)", "O(1)"],
        correctIndex: 0,
        explanation: "DFS only needs to store the current path and its sibling nodes, giving it a linear space complexity of O(bm).",
        difficulty: "medium",
      },
      {
        question: "In A* search, what is the defining formula used to evaluate and order nodes in the priority queue?",
        options: ["f(n) = g(n) + h(n)", "f(n) = g(n) - h(n)", "f(n) = g(n) * h(n)", "f(n) = h(n)"],
        correctIndex: 0,
        explanation: "f(n) represents the total estimated cost, where g(n) is the cost to reach node n and h(n) is the heuristic estimate to the goal.",
        difficulty: "easy",
      },
      {
        question: "For a heuristic function h(n) to be 'admissible' in A* search, what condition must it satisfy?",
        options: ["It must never overestimate the true cost to reach the goal", "It must always equal the true cost to reach the goal", "It must never underestimate the true cost to reach the goal", "It must return a value between 0 and 1"],
        correctIndex: 0,
        explanation: "An admissible heuristic is optimistic, meaning it never estimates a cost higher than the actual cheapest cost.",
        difficulty: "easy",
      },
      {
        question: "What data structure is typically used to implement the frontier (open list) in Breadth-First Search (BFS)?",
        options: ["FIFO Queue", "LIFO Stack", "Priority Queue", "Hash Map"],
        correctIndex: 0,
        explanation: "BFS uses a First-In-First-Out (FIFO) queue to ensure nodes are expanded in the exact order they were discovered.",
        difficulty: "easy",
      },
      {
        question: "Which search algorithm is a combination of Depth-First Search and Breadth-First Search, avoiding the space drawbacks of BFS and completeness drawbacks of DFS?",
        options: ["Iterative Deepening DFS (IDDFS)", "Uniform Cost Search (UCS)", "Greedy Best-First Search", "Bidirectional Search"],
        correctIndex: 0,
        explanation: "IDDFS repeatedly runs depth-limited DFS with increasing depth limits, combining DFS's space efficiency with BFS's completeness.",
        difficulty: "medium",
      },
      {
        question: "What is the primary difference between Uniform Cost Search (UCS) and Breadth-First Search (BFS)?",
        options: ["UCS accounts for varying step costs, while BFS assumes uniform step costs", "UCS is always faster than BFS in terms of time complexity", "UCS uses a LIFO stack while BFS uses a FIFO queue", "UCS is heuristic-driven while BFS is not"],
        correctIndex: 0,
        explanation: "UCS expands nodes in order of cumulative path cost g(n) using a priority queue, whereas BFS expands nodes by depth level.",
        difficulty: "medium",
      },
      {
        question: "In A* graph search, what does 'consistency' (or monotonicity) of a heuristic mean?",
        options: ["The heuristic estimate of a node is less than or equal to the step cost to a neighbor plus the neighbor's estimate", "The heuristic returns the same value every time it is evaluated for the same node", "The heuristic is mathematically proven to be symmetric", "The heuristic value decreases monotonically as we move farther from the goal"],
        correctIndex: 0,
        explanation: "Consistency requires that h(n) <= c(n, a, n') + h(n'), ensuring that optimal paths to nodes are found first without re-expanding closed nodes.",
        difficulty: "hard",
      },
      {
        question: "Which of the following is a classic example of an inadmissible heuristic for pathfinding on a grid?",
        options: ["Manhattan distance multiplied by 2", "Manhattan distance", "Euclidean distance", "Straight-line distance"],
        correctIndex: 0,
        explanation: "Multiplying the true distance by 2 can overestimate the actual cost, making the heuristic inadmissible and potentially leading to suboptimal paths.",
        difficulty: "medium",
      },
      {
        question: "What is the main drawback of Depth-First Search (DFS) in infinite state spaces?",
        options: ["It is not complete and may get stuck in infinite paths", "It uses exponential memory compared to BFS", "It is mathematically impossible to implement recursively", "It cannot find goals located at shallow depths"],
        correctIndex: 0,
        explanation: "If the state space has infinite paths, DFS can follow a branch forever without ever backtracking to find a goal.",
        difficulty: "easy",
      },
      {
        question: "In pathfinding, what is the straight-line distance (or Euclidean distance) heuristic an example of?",
        options: ["An admissible heuristic", "An inadmissible heuristic", "A consistent-only but inadmissible heuristic", "A non-heuristic constant value"],
        correctIndex: 0,
        explanation: "The straight-line distance is the shortest possible physical distance between two points, so it never overestimates the actual path cost.",
        difficulty: "easy",
      },
      {
        question: "Which search algorithm is purely 'greedy' because it expands nodes solely based on the heuristic estimate h(n) without considering the path cost g(n)?",
        options: ["Greedy Best-First Search", "A* Search", "Uniform Cost Search", "Breadth-First Search"],
        correctIndex: 0,
        explanation: "Greedy Best-First Search chooses the node that appears closest to the goal (lowest h(n)), ignoring the cost to get to that node.",
        difficulty: "easy",
      },
      {
        question: "What is the worst-case space complexity of Breadth-First Search (BFS) with branching factor 'b' and depth 'd'?",
        options: ["O(b^d)", "O(bd)", "O(d)", "O(1)"],
        correctIndex: 0,
        explanation: "BFS must keep all nodes at the current level in memory, which grows exponentially as O(b^d).",
        difficulty: "hard",
      },
      {
        question: "How does Bidirectional Search improve search efficiency?",
        options: ["It searches forward from the start and backward from the goal, meeting in the middle", "It searches in two different threads using different heuristic formulas", "It searches both state space and database history simultaneously", "It alternates between DFS and BFS depending on memory availability"],
        correctIndex: 0,
        explanation: "Running two concurrent searches from both ends reduces the search complexity from O(b^d) to O(b^(d/2)).",
        difficulty: "medium",
      },
      {
        question: "What happens to A* search if the heuristic function h(n) is set to 0 everywhere?",
        options: ["It behaves exactly like Uniform Cost Search (Dijkstra's Algorithm)", "It behaves exactly like Depth-First Search", "It fails to find any path and throws an error", "It runs in O(1) constant time"],
        correctIndex: 0,
        explanation: "When h(n) = 0, f(n) = g(n), meaning A* orders nodes purely by path cost, which is the definition of Uniform Cost Search.",
        difficulty: "easy",
      }
    ];
  }

  // --- 3. Adversarial Search ---
  if (titleLower.includes("adversarial")) {
    return [
      {
        question: "Which algorithm is the foundation of game-playing agents in two-player, zero-sum, perfect-information games?",
        options: ["Minimax Algorithm", "A* Search", "Dijkstra's Algorithm", "Markov Decision Process"],
        correctIndex: 0,
        explanation: "Minimax computes the optimal move for a player under the assumption that the opponent plays optimally to minimize the player's gain.",
        difficulty: "easy",
      },
      {
        question: "What does the 'zero-sum' property imply in adversarial game theory?",
        options: ["One player's gain is exactly equal to the other player's loss", "The total score of both players at the end of the game is always zero", "Neither player can win, resulting in a guaranteed draw", "The game requires zero memory to evaluate utility values"],
        correctIndex: 0,
        explanation: "In a zero-sum game, the total utility is constant; any increase in utility for one player means an equal decrease for the opponent.",
        difficulty: "easy",
      },
      {
        question: "What are the two parameters used in Alpha-Beta pruning to keep track of the bounds of optimal scores?",
        options: ["Alpha (MAX best option) and Beta (MIN best option)", "Alpha (depth limit) and Beta (branching factor)", "Alpha (heuristic value) and Beta (exact utility)", "Alpha (learning rate) and Beta (discount factor)"],
        correctIndex: 0,
        explanation: "Alpha represents the best utility choice found so far for MAX, and Beta represents the best utility choice found so far for MIN.",
        difficulty: "medium",
      },
      {
        question: "How does Alpha-Beta pruning improve the Minimax algorithm?",
        options: ["It prunes branches that cannot influence the final decision, reducing search time", "It guarantees finding a better move than the standard Minimax algorithm", "It reduces the space complexity of Minimax from linear to constant", "It allows the agent to play games with imperfect information"],
        correctIndex: 0,
        explanation: "Alpha-Beta pruning cuts off branches that are guaranteed to be worse than previously evaluated moves, without altering the final minimax decision.",
        difficulty: "easy",
      },
      {
        question: "In the worst-case scenario (unfavorable move ordering), what is the time complexity of Alpha-Beta pruning?",
        options: ["O(b^d)", "O(b^(d/2))", "O(bd)", "O(b + d)"],
        correctIndex: 0,
        explanation: "If the moves are ordered poorly, Alpha-Beta pruning cannot cut off any branches, falling back to the standard Minimax time complexity of O(b^d).",
        difficulty: "hard",
      },
      {
        question: "With perfect move ordering, what is the effective branching factor of Alpha-Beta pruning, allowing it to search twice as deep?",
        options: ["O(sqrt(b))", "O(b / 2)", "O(b - 1)", "O(log b)"],
        correctIndex: 0,
        explanation: "With optimal move ordering, the time complexity is reduced to O(b^(d/2)), effectively halving the exponent or square-rooting the branching factor.",
        difficulty: "hard",
      },
      {
        question: "What is the purpose of an 'evaluation function' in game-playing programs like chess engines?",
        options: ["To estimate the utility of a non-terminal game state when search depth is limited", "To calculate the exact winning sequence of moves from the start of the game", "To check if the players are adhering to the rules of the game", "To measure the CPU time spent on computing each move"],
        correctIndex: 0,
        explanation: "Since searching to the end of a complex game is impossible, an evaluation function estimates the strength of a board position.",
        difficulty: "medium",
      },
      {
        question: "Which adversarial search method uses random simulations to evaluate the utility of moves, popularized by AlphaGo?",
        options: ["Monte Carlo Tree Search (MCTS)", "Alpha-Beta Minimax", "Heuristic Depth-Limited Search", "Constraint Satisfaction Search"],
        correctIndex: 0,
        explanation: "MCTS builds a search tree by performing random rollouts (simulations) from states to evaluate their winning potential.",
        difficulty: "medium",
      },
      {
        question: "What are the four steps of a single iteration in Monte Carlo Tree Search (MCTS)?",
        options: ["Selection, Expansion, Simulation, Backpropagation", "Initialization, Search, Evaluation, Execution", "Pruning, Minimaxing, Estimating, Backtracking", "Observation, Policy, Action, Reward"],
        correctIndex: 0,
        explanation: "MCTS iteratively selects nodes, expands the tree, runs simulations (rollouts), and backpropagates results to update node values.",
        difficulty: "hard",
      },
      {
        question: "In games like Backgammon, which introduce elements of chance (e.g., rolling dice), which algorithm is used?",
        options: ["Expectiminimax", "Standard Minimax", "Alpha-Beta Pruning", "A* Pathfinding"],
        correctIndex: 0,
        explanation: "Expectiminimax includes 'chance nodes' that calculate the expected utility by summing utilities multiplied by their probabilities.",
        difficulty: "hard",
      },
      {
        question: "What is the 'horizon effect' in depth-limited adversarial search?",
        options: ["A damaging move by the opponent is pushed past the search depth limit, making the agent blind to it", "The grid of the game board appears to expand as depth increases", "The agent chooses suboptimal moves because it expects the game to end immediately", "The search algorithm runs out of memory when approaching the maximum possible depth"],
        correctIndex: 0,
        explanation: "The horizon effect occurs when a game-playing agent takes stalling actions to push an unavoidable bad event beyond its search horizon.",
        difficulty: "hard",
      },
      {
        question: "In Alpha-Beta pruning, when does a beta-cutoff occur?",
        options: ["When the current node's value is less than or equal to alpha", "When the current node's value is greater than or equal to beta", "When the search depth reaches zero", "When a terminal state is discovered by MAX"],
        correctIndex: 0,
        explanation: "If MAX finds a move that yields a value greater than or equal to beta (the opponent's best alternative), MIN will avoid this path entirely.",
        difficulty: "medium",
      },
      {
        question: "Which game is a classic example of an imperfect-information game?",
        options: ["Poker", "Chess", "Checkers", "Go"],
        correctIndex: 0,
        explanation: "In Poker, players cannot see their opponent's cards, which means information about the game state is hidden (imperfect).",
        difficulty: "easy",
      },
      {
        question: "What does 'utility' mean in a minimax game tree?",
        options: ["The numerical value representing the outcome of a game at a terminal state", "The speed at which the game engine computes moves", "The amount of memory used by the transposition table", "The level of difficulty selected by the user"],
        correctIndex: 0,
        explanation: "Utility values (e.g., +1 for win, -1 for loss, 0 for draw) define the payoff of terminal game positions.",
        difficulty: "easy",
      },
      {
        question: "What is a 'transposition table' in game programming?",
        options: ["A cache of previously evaluated board positions to avoid redundant search", "A table mapping the keyboard layout to game controls", "A list of valid starting board configurations", "A log of all moves played in tournament matches"],
        correctIndex: 0,
        explanation: "Transposition tables store search results for visited positions (often using Zobrist hashing) to prevent re-searching identical states reached via different move orders.",
        difficulty: "medium",
      }
    ];
  }

  // --- 4. Logical Inference & Knowledge Representation ---
  if (titleLower.includes("logical") || titleLower.includes("knowledge representation")) {
    return [
      {
        question: "What is the primary difference between propositional logic and first-order logic?",
        options: ["First-order logic allows quantification over objects and predicates, while propositional logic does not", "Propositional logic uses variables, while first-order logic only uses constants", "First-order logic is decidable, whereas propositional logic is undecidable", "Propositional logic does not support truth values (true/false)"],
        correctIndex: 0,
        explanation: "First-order logic introduces objects, relations, and quantifiers (universal and existential) for richer representation.",
        difficulty: "easy",
      },
      {
        question: "In logic, what does it mean for a knowledge base KB to 'entail' a sentence alpha (KB ⊨ alpha)?",
        options: ["Alpha is true in every model/world where KB is true", "Alpha can be derived from KB using sound inference rules", "Alpha is a syntactic subset of the sentences in KB", "Alpha contains the exact same truth variables as KB"],
        correctIndex: 0,
        explanation: "Entailment is a semantic relationship: if KB is true, alpha must also be true.",
        difficulty: "medium",
      },
      {
        question: "What is 'Modus Ponens' in propositional logic inference?",
        options: ["An inference rule: If P and P => Q are true, then Q is true", "An inference rule: If Q is true, then P is true", "A rule stating that double negatives cancel out", "A process of converting sentences to Conjunctive Normal Form"],
        correctIndex: 0,
        explanation: "Modus Ponens is a fundamental, sound rule: from P and P implies Q, we infer Q.",
        difficulty: "easy",
      },
      {
        question: "Which form must sentences be converted to before they can be resolved using the resolution inference rule?",
        options: ["Conjunctive Normal Form (CNF)", "Disjunctive Normal Form (DNF)", "First-Order Logic (FOL)", "Horn Clause Form"],
        correctIndex: 0,
        explanation: "Resolution requires all sentences to be in CNF, which is a conjunction of one or more clauses, where each clause is a disjunction of literals.",
        difficulty: "medium",
      },
      {
        question: "What is a 'Horn Clause' in logical representation?",
        options: ["A clause with at most one positive literal", "A clause containing only variables and no constants", "A logical sentence that is always true (a tautology)", "A rule that negates all its inputs"],
        correctIndex: 0,
        explanation: "Horn clauses (having at most one positive literal) are computationally efficient and form the basis of logic programming (like Prolog).",
        difficulty: "medium",
      },
      {
        question: "In first-order logic, what is the role of the universal quantifier (∀)?",
        options: ["It states that a property is true for ALL objects in the domain", "It states that a property is true for AT LEAST ONE object in the domain", "It checks if a variable has been initialized", "It negates the truth value of the connected predicate"],
        correctIndex: 0,
        explanation: "The universal quantifier ∀ stands for 'for all' or 'every', indicating a statement holds universally.",
        difficulty: "easy",
      },
      {
        question: "What is 'unification' in first-order logic inference?",
        options: ["The process of finding a substitution of variables that makes two logical expressions identical", "The combination of multiple knowledge bases into a single repository", "Converting first-order sentences into propositional sentences", "Assigning a single truth value to all variables in a formula"],
        correctIndex: 0,
        explanation: "Unification takes two terms and attempts to find a variable mapping (substitution) that makes them syntactically equal.",
        difficulty: "hard",
      },
      {
        question: "What does 'soundness' of an inference algorithm mean?",
        options: ["It derives only sentences that are semantically entailed by the knowledge base", "It is capable of deriving every sentence that is entailed by the knowledge base", "It completes its execution in polynomial time", "It uses an audio-based alert system when a proof is found"],
        correctIndex: 0,
        explanation: "An inference system is sound (or truth-preserving) if it only derives sentences that are actually true given the KB.",
        difficulty: "medium",
      },
      {
        question: "What does 'completeness' of an inference algorithm mean?",
        options: ["It can derive any sentence that is semantically entailed by the knowledge base", "It runs to completion without running out of memory or stack space", "It covers all possible variables defined in the propositional alphabet", "It yields a proof that contains no variables"],
        correctIndex: 0,
        explanation: "An inference algorithm is complete if it can prove any assertion that is logically entailed by the knowledge base.",
        difficulty: "medium",
      },
      {
        question: "What is 'existential instantiation' used for in logical inference?",
        options: ["Replacing an existentially quantified variable with a new constant symbol (Skolem constant)", "Proving that a variable exists in the local computer memory scope", "Checking if there are any models that satisfy the knowledge base", "Negating a universal quantifier to create an existential quantifier"],
        correctIndex: 0,
        explanation: "Existential instantiation replaces a variable quantified by ∃ with a specific new constant that does not appear elsewhere in the KB.",
        difficulty: "hard",
      },
      {
        question: "Which of the following describes the 'Ontological Commitment' of propositional logic?",
        options: ["The world consists of facts that are either true or false", "The world consists of objects, relations, and functions", "The world consists of probabilities and uncertain variables", "The world contains only physical hardware systems"],
        correctIndex: 0,
        explanation: "Propositional logic commits only to the existence of facts about the world, without detailing relations or individual objects.",
        difficulty: "medium",
      },
      {
        question: "In Knowledge Representation, what is a 'Semantic Network'?",
        options: ["A graph representation where nodes represent concepts and edges represent relationships", "A neural network that processes semantic meaning of natural language", "A network protocol for transmitting logical statements between servers", "A database schema containing only text fields"],
        correctIndex: 0,
        explanation: "Semantic networks represent knowledge as a directed graph of concepts joined by semantic relations (e.g., 'is-a', 'has-a').",
        difficulty: "easy",
      },
      {
        question: "What is the 'Closed-World Assumption' (CWA) in knowledge bases?",
        options: ["Any statement that is not known to be true is assumed to be false", "No external connections are allowed to the database server", "The knowledge base cannot be modified after compilation", "All variables must be bound to finite domains"],
        correctIndex: 0,
        explanation: "CWA assumes that the database or knowledge base contains all true facts, so any omission implies falsehood.",
        difficulty: "medium",
      },
      {
        question: "What is 'Resolution Refutation' as a proof technique?",
        options: ["Proving KB ⊨ A by showing that KB ∧ ¬A leads to a contradiction", "Simplifying a logic formula by removing redundant operators", "Solving a logical proof by converting all sentences to propositional logic", "Checking all possible rows of a truth table for validity"],
        correctIndex: 0,
        explanation: "Resolution refutation is a proof by contradiction: we negate the query, add it to the KB, and use resolution to derive an empty clause (contradiction).",
        difficulty: "hard",
      },
      {
        question: "Which logic programming language is based directly on first-order predicate calculus and Horn clauses?",
        options: ["Prolog", "Lisp", "Python", "Haskell"],
        correctIndex: 0,
        explanation: "Prolog (Programming in Logic) is a declarative language where programs are expressed in terms of relations and rules.",
        difficulty: "easy",
      }
    ];
  }

  // --- 5. Expert Systems ---
  if (titleLower.includes("expert system")) {
    return [
      {
        question: "What are the two primary components of a classic Expert System?",
        options: ["Knowledge Base and Inference Engine", "User Interface and Database Compiler", "Neural Network and Training Dataset", "Search Indexer and Web Crawler"],
        correctIndex: 0,
        explanation: "An expert system separates domain-specific facts/rules (Knowledge Base) from the general reasoning mechanism (Inference Engine).",
        difficulty: "easy",
      },
      {
        question: "In expert systems, what is the role of the 'Inference Engine'?",
        options: ["It applies logical rules to the knowledge base to deduce new facts", "It allows the domain expert to input new rules into the system", "It compiles the source code into machine-executable binary files", "It monitors the temperature and CPU usage of the hardware"],
        correctIndex: 0,
        explanation: "The inference engine is the brain of the expert system, executing reasoning steps by matching rules to facts.",
        difficulty: "easy",
      },
      {
        question: "What is the difference between 'Forward Chaining' and 'Backward Chaining' in rule-based systems?",
        options: ["Forward chaining starts with facts and applies rules; backward chaining starts with goals and works backward", "Forward chaining runs from top to bottom; backward chaining runs from bottom to top", "Forward chaining is logic-based; backward chaining is probability-based", "Forward chaining is for beginners; backward chaining is for advanced developers"],
        correctIndex: 0,
        explanation: "Forward chaining is data-driven (reasoning forward from premises to conclusions), whereas backward chaining is goal-driven (finding matching premises for a target goal).",
        difficulty: "medium",
      },
      {
        question: "Which of the following is a legendary expert system developed in the 1960s to identify chemical compounds from mass spectrometry data?",
        options: ["DENDRAL", "MYCIN", "ELIZA", "Prospector"],
        correctIndex: 0,
        explanation: "DENDRAL was one of the earliest expert systems, designed at Stanford to help organic chemists identify molecular structures.",
        difficulty: "medium",
      },
      {
        question: "Who is the 'Domain Expert' in the context of building an expert system?",
        options: ["A human specialist whose knowledge and problem-solving skills are modeled in the system", "The system administrator who manages the server infrastructure", "The software programmer who writes the inference engine logic", "The end-user who operates the client interface"],
        correctIndex: 0,
        explanation: "The domain expert is the person with deep, specialized knowledge in the specific application area (e.g., a doctor, geologist, or engineer).",
        difficulty: "easy",
      },
      {
        question: "What is 'Knowledge Engineering' in the field of artificial intelligence?",
        options: ["The process of acquiring, structuring, and representing human expertise in a computer system", "The development of faster CPU architectures for deep learning calculations", "Designing computer networks to share large databases", "Setting up backups and security policies for logical databases"],
        correctIndex: 0,
        explanation: "Knowledge engineering is the discipline of building expert systems by extracting knowledge from experts and encoding it in a knowledge base.",
        difficulty: "medium",
      },
      {
        question: "What is a 'Production Rule' in an expert system knowledge base?",
        options: ["An IF-THEN statement expressing a condition and an action or conclusion", "A software configuration specifying the database write privileges", "A deployment guideline for running the application in a live environment", "A rule that limits the maximum concurrent users on the server"],
        correctIndex: 0,
        explanation: "Expert systems typically represent domain knowledge as production rules: IF <antecedents> THEN <consequents>.",
        difficulty: "easy",
      },
      {
        question: "What does the 'Rete Algorithm' optimize in rule-based expert systems?",
        options: ["The speed of matching facts against a large set of pattern rules", "The memory footprint of storing millions of static strings", "The process of translating rules into natural language", "The mathematical computation of decimal probability scores"],
        correctIndex: 0,
        explanation: "Developed by Charles Forgy, the Rete algorithm is a pattern-matching algorithm that avoids redundant comparisons in rule evaluation.",
        difficulty: "hard",
      },
      {
        question: "How do expert systems handle uncertainty or incomplete data?",
        options: ["By using Certainty Factors, Fuzzy Logic, or Bayesian probabilities", "By stopping execution and prompting the user to fill in all missing values", "By randomly selecting one of the available production rules", "By assuming all uncertain values are false (closed-world assumption)"],
        correctIndex: 0,
        explanation: "Real-world expert systems use certainty factors (like in MYCIN) or fuzzy logic to represent degrees of belief or confidence in rules and facts.",
        difficulty: "medium",
      },
      {
        question: "What is the 'Explanation Facility' of an expert system?",
        options: ["A subsystem that explains the reasoning behind the system's recommendations to the user", "A help menu containing tutorials and documentation", "A comment block in the source code describing the function definitions", "A feature that translates the program into multiple languages"],
        correctIndex: 0,
        explanation: "The explanation facility allows the user to ask 'Why' a question is being asked or 'How' a conclusion was reached, building trust.",
        difficulty: "easy",
      },
      {
        question: "Which expert system was created in the late 1970s to assist geologists in mineral exploration?",
        options: ["Prospector", "MYCIN", "DENDRAL", "XCON / R1"],
        correctIndex: 0,
        explanation: "Prospector, developed by SRI International, was a famous expert system that successfully predicted the location of a major molybdenum deposit.",
        difficulty: "medium",
      },
      {
        question: "What was 'XCON' (also known as R1), developed by Digital Equipment Corporation (DEC)?",
        options: ["An expert system that configured VAX computer systems to meet customer orders", "A network terminal system for remote logical programming", "An early operating system based entirely on predicate logic rules", "The first voice-controlled virtual assistant system"],
        correctIndex: 0,
        explanation: "XCON was a highly successful commercial expert system that saved DEC millions of dollars annually by automating computer configuration.",
        difficulty: "medium",
      },
      {
        question: "What is the main bottleneck or limitation in building and maintaining expert systems?",
        options: ["The knowledge acquisition bottleneck (extracting and updating rules is difficult and slow)", "The lack of computational power in modern computers to run rules", "The strict licensing fees for using declarative language compilers", "The high network latency during logical query execution"],
        correctIndex: 0,
        explanation: "The 'knowledge acquisition bottleneck' is the difficulty of translating human expertise into a structured rule format, which requires extensive interviews.",
        difficulty: "hard",
      },
      {
        question: "In forward chaining, what is the 'Conflict Resolution' phase?",
        options: ["Deciding which rule to fire when multiple rules are matched by the current facts", "Resolving merge conflicts in the Git repository of the knowledge base", "Alerting the user when two different experts disagree on a rule", "Clearing variable bindings that have conflicting data types"],
        correctIndex: 0,
        explanation: "When the premises of multiple rules are satisfied, the conflict resolver decides which rule to execute first (e.g., using priority, specificity, or recency).",
        difficulty: "medium",
      },
      {
        question: "Why did traditional rule-based expert systems decline in popularity in the 1990s?",
        options: ["They were expensive to maintain, brittle when facing novel situations, and unable to learn on their own", "They were banned by government regulators due to safety concerns", "They were completely replaced by simple relational spreadsheets", "They could only be executed on expensive specialized Lisp machine hardware"],
        correctIndex: 0,
        explanation: "Expert systems are brittle (they fail outside their narrow domain) and expensive to maintain because manual rule updates are required, leading to the rise of data-driven machine learning.",
        difficulty: "hard",
      }
    ];
  }

  // --- 6. Generic Fallback Templates (15 Distinct, Topic-Independent Templates) ---
  const templates = [
    {
      question: `What is the primary goal or objective when working with ${topicTitle}?`,
      options: [
        `To model, analyze, and optimize relationship behaviors or system components in ${topicTitle} effectively`,
        `To permanently store historical static data without ever reading it back`,
        `To convert the application from digital execution to manual spreadsheet processes`,
        `To eliminate the need for any programming language or database compiler`
      ],
      correctIndex: 0,
      explanation: `The fundamental goal of ${topicTitle} is to model, analyze, and optimize system relationships and behaviors.`,
      difficulty: "easy"
    },
    {
      question: `Which of the following is a common challenge or limitation associated with ${topicTitle}?`,
      options: [
        `High computational complexity or sensitivity to noisy, unscaled input data`,
        `The system automatically becoming too simple to solve basic algebra equations`,
        `A complete lack of mathematical representation in computer science theory`,
        `Incompatibility with basic web browser versions and visual layout rules`
      ],
      correctIndex: 0,
      explanation: `${topicTitle} often struggles with computational efficiency or noise in the dataset, requiring careful pre-processing.`,
      difficulty: "medium"
    },
    {
      question: `In the context of ${topicTitle}, what does 'overfitting' or 'algorithmic bias' typically mean?`,
      options: [
        `The model performs exceptionally well on training data but fails to generalize to new, unseen data`,
        `The software compiler optimizes the code for execution speed rather than storage file size`,
        `The physical processor runs too hot and throttles performance during execution`,
        `The user interface does not adapt appropriately to mobile screen sizes`
      ],
      correctIndex: 0,
      explanation: `Overfitting occurs when a system learns the noise and details of the training data to the extent that it negatively impacts performance on new data.`,
      difficulty: "medium"
    },
    {
      question: `Which approach is most effective for improving the accuracy and robustness of a system using ${topicTitle}?`,
      options: [
        `Applying cross-validation, regularization, or clean feature engineering`,
        `Simply doubling the font size of the application's main dashboard header`,
        `Deleting all existing code comments and documentation from the repository`,
        `Restricting the execution system to only run on prime-numbered calendar days`
      ],
      correctIndex: 0,
      explanation: `Regularization and cross-validation help prevent overfitting, while quality feature engineering ensures the model learns relevant patterns.`,
      difficulty: "hard"
    },
    {
      question: `What is the typical time or space complexity constraint encountered in standard implementations of ${topicTitle}?`,
      options: [
        `It scales exponentially or polynomially depending on the size of the state space or input dataset`,
        `It always runs in O(1) constant time regardless of the size of the input variables`,
        `It consumes zero bytes of system RAM or disk storage space during runtime execution`,
        `It is determined entirely by the network latency and speed of the user's internet connection`
      ],
      correctIndex: 0,
      explanation: `Large-scale applications of ${topicTitle} often face exponential or polynomial growth in resource requirements, requiring optimization.`,
      difficulty: "hard"
    },
    {
      question: `When introducing ${topicTitle} to a production environment, what is the best practice for initial deployment?`,
      options: [
        `Deploying the model in shadow or canary mode to validate performance on live traffic without risk`,
        `Replacing all backend SQL databases with static local text files immediately`,
        `Disabling all security firewalls and user authentication gateways`,
        `Running the model solely on client-side web browsers without any backend validation`
      ],
      correctIndex: 0,
      explanation: `Canary deployments and shadow modes allow testing the system's performance on real traffic safely before full transition.`,
      difficulty: "medium"
    },
    {
      question: `What type of data or input representation is most commonly suited for ${topicTitle}?`,
      options: [
        `Structured vectors, matrix collections, or relational fact tables`,
        `Unformatted raw binary files with randomized file headers`,
        `Handwritten logs stored on physical paper documents`,
        `Encrypted security tokens without any decrypting keys`
      ],
      correctIndex: 0,
      explanation: `${topicTitle} requires clean, structured numerical or symbolic representations to successfully train or execute decisions.`,
      difficulty: "easy"
    },
    {
      question: `Which of the following fields of study is ${topicTitle} most closely associated with?`,
      options: [
        `Computer science, applied mathematics, and data analytics`,
        `Organic chemistry and molecular biology simulation`,
        `Macroeconomics and international trade regulation`,
        `Mechanical engineering and fluid dynamics modeling`
      ],
      correctIndex: 0,
      explanation: `As a core AI/ML concept, ${topicTitle} is deeply rooted in computational theory, math, and data analysis.`,
      difficulty: "easy"
    },
    {
      question: `What is the significance of the 'heuristic' or 'loss function' in ${topicTitle}?`,
      options: [
        `It provides a mathematical measure of error or guides search toward the goal`,
        `It automatically formats the output into a human-readable text report`,
        `It represents the electrical power consumed by the computing hardware`,
        `It is a security key used to encrypt the user's personal details`
      ],
      correctIndex: 0,
      explanation: `Heuristics or loss functions guide the optimization process by indicating how far the current state is from the goal or optimal solution.`,
      difficulty: "medium"
    },
    {
      question: `How does the 'curse of dimensionality' affect algorithms in ${topicTitle}?`,
      options: [
        `The volume of space increases so fast that the available data becomes sparse and hard to model`,
        `The system becomes physically three-dimensional and requires holographic screens`,
        `The database storage size is halved for every extra column added`,
        `The program can only execute on systems with multiple CPU sockets`
      ],
      correctIndex: 0,
      explanation: `High-dimensional spaces require exponentially more data to generalize effectively, which degrades the performance of ${topicTitle}.`,
      difficulty: "hard"
    },
    {
      question: `In a real-world scenario, what is the primary benefit of deploying ${topicTitle}?`,
      options: [
        `Automating complex decision-making processes and recognizing hidden patterns`,
        `Guaranteeing that the server never requires hardware maintenance`,
        `Completely eliminating the need for human personnel in the organization`,
        `Reducing the physical electricity bill of the data center to zero`
      ],
      correctIndex: 0,
      explanation: `${topicTitle} excels at automating repetitive tasks, identifying complex trends in data, and augmenting human intelligence.`,
      difficulty: "easy"
    },
    {
      question: `What is the role of 'preprocessing' or 'normalization' before applying ${topicTitle}?`,
      options: [
        `To scale features to a common range, improving convergence speed and stability`,
        `To translate the code logic into other programming languages automatically`,
        `To check if the user has paid their subscription fee`,
        `To compile the static HTML pages into dynamic web interfaces`
      ],
      correctIndex: 0,
      explanation: `Normalizing or scaling input values prevents features with larger scales from dominating the distance calculations or gradients.`,
      difficulty: "medium"
    },
    {
      question: `Which validation strategy is critical to ensure ${topicTitle} does not memorize training data?`,
      options: [
        `Splitting the data into distinct training, validation, and test datasets`,
        `Running the algorithm multiple times on the same input file`,
        `Using a single large dataset for both training and performance reporting`,
        `Applying basic compression algorithms like ZIP to the database files`
      ],
      correctIndex: 0,
      explanation: `A strict split between training and validation data ensures we evaluate the model on data it has never seen before.`,
      difficulty: "medium"
    },
    {
      question: `In ${topicTitle}, what is a key difference between parametric and non-parametric approaches?`,
      options: [
        `Parametric makes assumptions about the functional form; non-parametric does not and grows with data`,
        `Parametric runs on servers; non-parametric runs on local client devices only`,
        `Parametric requires user passwords; non-parametric runs without authentication`,
        `Parametric is built using CSS; non-parametric is built using plain HTML`
      ],
      correctIndex: 0,
      explanation: `Parametric models simplify the modeling process but are limited by their assumptions, while non-parametric models are highly flexible but require more data.`,
      difficulty: "hard"
    },
    {
      question: `How is the performance of ${topicTitle} typically communicated to business stakeholders?`,
      options: [
        `Through key performance indicators (KPIs), charts, and simple accuracy or ROI metrics`,
        `By sharing the raw binary model file or compiler assembly output`,
        `By asking stakeholders to write their own unit tests for the backend code`,
        `Through complex mathematical proofs written in first-order logic symbols`
      ],
      correctIndex: 0,
      explanation: `Presenting findings via clear, visual metrics and business-oriented KPIs helps stakeholders make informed decisions.`,
      difficulty: "easy"
    }
  ];

  return templates;
}

function generateTemplateQuestion(subject: string, topic: string, index: number, difficulty: string) {
  const questionStems = [
    "What is the primary objective of {topic} in the context of {subject}?",
    "Which of the following is a key advantage of utilizing {topic} over traditional methods?",
    "What is a potential risk or bottleneck when applying {topic} to large-scale systems?",
    "In {subject}, how does {topic} handle unexpected input anomalies?",
    "Which tool or framework is commonly associated with implementing {topic}?",
    "What is the theoretical foundation behind {topic} design principles?",
    "How is the efficiency of {topic} typically measured in production?",
    "Which best practice is recommended when configuring {topic} parameters?",
    "What type of data representation is optimal for {topic} processing?",
    "Under what condition does {topic} perform most optimally?",
    "What is the impact of dimensionality or scale on {topic} execution?",
    "How does {topic} interact with other components in a {subject} pipeline?",
    "Which algorithm or technique is a core component of {topic}?",
    "What is the primary difference between a simple and advanced implementation of {topic}?",
    "How does {topic} ensure model generalization or robustness?",
    "Which metric is most suitable for validating the output of {topic}?",
    "What is a common misconception about {topic} in the industry?",
    "How does resource allocation affect the performance of {topic}?",
    "Which mathematical concept is fundamental to {topic}?",
    "What is the future trend or research focus in the field of {topic}?"
  ];

  const stemIndex = index % questionStems.length;
  const stem = questionStems[stemIndex];
  
  const correctOptions = [
    "To establish structured patterns, reduce bias, and ensure execution consistency.",
    "Enhanced adaptability to complex patterns and improved overall efficiency.",
    "Increased latency or memory footprint during peak workload conditions.",
    "By applying filtering mechanisms, normalization, or default fallbacks.",
    "Industry-standard packages and integrated development frameworks.",
    "Rigorous mathematical logic and empirical validation models.",
    "Through latency metrics, precision scores, and throughput optimization.",
    "Conducting hyperparameter search and validating on isolated test sets.",
    "Normalized vectors, relational schemas, or structured feature maps.",
    "When the input distribution closely aligns with the training assumptions.",
    "It can cause sparseness or increased complexity, requiring dimensionality reduction.",
    "It acts as a feature extractor or decision node in the data pipeline.",
    "Iterative optimization, gradient-based search, or rule-based matching.",
    "The inclusion of non-linear mappings and deeper parameter spaces.",
    "By using cross-validation, regularization, and dropout techniques.",
    "Mean squared error, classification accuracy, or custom utility functions.",
    "That it guarantees perfect accuracy without requiring high-quality input data.",
    "Insufficient hardware capacity can cause execution timeouts or failures.",
    "Linear algebra, probability theory, or multi-variable calculus.",
    "Improving explainability, reducing latency, and enhancing zero-shot capabilities."
  ];

  const distractors = [
    [
      "To write temporary log files that are automatically deleted after 24 hours.",
      "To customize the visual color themes of the administrator dashboard.",
      "To run background network speed tests during peak system traffic."
    ],
    [
      "It eliminates the need for any programming language or compiler.",
      "It reduces the physical power consumption of the server to zero.",
      "It allows users to bypass authorization rules completely."
    ],
    [
      "The system UI automatically reverting to default browser settings.",
      "A lack of documentation in the developer community repositories.",
      "The server requiring physical hardware reboot after each run."
    ],
    [
      "By shutting down the active execution process immediately.",
      "By emailing the system administrator a notification check.",
      "By converting the data into unformatted binary strings."
    ],
    [
      "Basic word processors and spreadsheet document applications.",
      "Legacy file transfer protocols and storage tape devices.",
      "Static web browsers running on outdated mobile hardware."
    ]
  ];

  const distList = distractors[index % distractors.length];
  
  const rawQuestion = stem
    .replace(/{topic}/g, topic)
    .replace(/{subject}/g, subject);

  const rawCorrect = correctOptions[stemIndex]
    .replace(/{topic}/g, topic)
    .replace(/{subject}/g, subject);

  const rawDistractors = distList.map(d => 
    d.replace(/{topic}/g, topic).replace(/{subject}/g, subject)
  );

  const questionText = `${rawQuestion} (Ref: ${index + 1})`;
  const options = [rawCorrect, ...rawDistractors];
  
  const correctIndex = (index * 7) % 4;
  if (correctIndex !== 0) {
    const temp = options[0];
    options[0] = options[correctIndex];
    options[correctIndex] = temp;
  }

  const explanation = `This question (Reference ID: ${index + 1}) tests your understanding of ${topic} concepts within ${subject}. The correct answer was chosen because it correctly describes the core architectural, performance, or theoretical characteristics under standard conditions.`;

  return {
    question: questionText,
    options,
    correctIndex,
    explanation,
    difficulty: mapDifficulty(difficulty)
  };
}

async function getOrCreateDatabank(subject: string, topic: string, difficulty: string): Promise<any[]> {
  const root = process.env.VERCEL === "1" ? "/tmp" : join(process.cwd(), "uploads");
  const filePath = join(root, "question_databank.json");
  
  let databank: Record<string, any[]> = {};
  try {
    if (existsSync(filePath)) {
      const content = await readFile(filePath, "utf-8");
      databank = JSON.parse(content);
    }
  } catch (e) {
    console.warn("Failed to load question databank file, initializing new one.", e);
  }

  const cacheKey = `${subject}::${topic}`.toLowerCase();
  if (databank[cacheKey] && databank[cacheKey].length >= 100) {
    return databank[cacheKey];
  }

  const generated: any[] = [];
  const baseQuestions = getFallbackQuestions(topic, difficulty).map(q => ({
    ...q,
    difficulty: mapDifficulty(q.difficulty)
  }));
  
  generated.push(...baseQuestions);

  const needed = 100 - generated.length;
  for (let i = 0; i < needed; i++) {
    const qIndex = generated.length;
    const diff = qIndex % 3 === 0 ? "easy" : (qIndex % 3 === 1 ? "medium" : "hard");
    const generatedQuestion = generateTemplateQuestion(subject, topic, qIndex, diff);
    generated.push(generatedQuestion);
  }

  databank[cacheKey] = generated;
  try {
    await mkdir(root, { recursive: true });
    await writeFile(filePath, JSON.stringify(databank, null, 2), "utf-8");
  } catch (e) {
    console.error("Failed to save question databank file.", e);
  }

  return generated;
}

export async function fetchQuestionsFromAI(subjectTitle: string, topicTitle: string, defDiff: string): Promise<any[]> {
  try {
    const databank = await getOrCreateDatabank(subjectTitle, topicTitle, defDiff);
    // Shuffle and pick 10 random questions
    const shuffled = [...databank].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, 10);
  } catch (err) {
    console.warn("Failed to fetch questions from databank, falling back to basic list.", err);
    const fallback = getFallbackQuestions(topicTitle, defDiff);
    const shuffled = [...fallback].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, 10);
  }
}


