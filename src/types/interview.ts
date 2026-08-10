export interface InterviewAttempt {
  id: string;
  resumeId: string;
  questionIndex: number;
  questionText: string;
  mockScore: number;
  mockFeedback: string;
  timestamp: string;
  createdAt?: string;
}
