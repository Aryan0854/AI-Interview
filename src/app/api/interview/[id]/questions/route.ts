export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { interviewService } from '@/services/interview-service';

interface ErrorResponse {
  error: string;
  message?: string;
}


/**
 * GET /api/interview/[id]/questions
 * 
 * Fetches or generates interview questions for a given resume ID.
 * - If questions exist in DB, returns cached questions
 * - Otherwise, generates new questions using AI (with fallback)
 * - All logic runs INSIDE the request handler (nothing at module level)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<string[] | ErrorResponse>> {
  try {
    // Validate and extract params (async operation for Next.js 15)
    const { id } = await params;

    // Validate resume ID format (UUID-like)
    if (!id || typeof id !== 'string' || id.trim().length === 0) {
      return NextResponse.json(
        { error: 'Invalid request', message: 'Resume ID is required and must be non-empty' },
        { status: 400 }
      );
    }

    // Sanitize ID (prevent injection)
    const sanitizedId = id.trim();

    // Fetch questions (service handles DB + AI fallback)
    const questions = await interviewService.getQuestions(sanitizedId);

    // Validate response
    if (!Array.isArray(questions) || questions.length === 0) {
      return NextResponse.json(
        { error: 'No questions generated', message: 'Failed to generate interview questions' },
        { status: 500 }
      );
    }

    // Return properly typed response
    return NextResponse.json(questions, { status: 200 });
  } catch (error) {
    // Proper error handling with type guard
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    const errorName = error instanceof Error ? error.name : 'Error';

    console.error('[GET /api/interview/[id]/questions]', {
      error: errorName,
      message: errorMessage,
      timestamp: new Date().toISOString(),
    });

    // Return generic error for security (don't expose internals)
    return NextResponse.json<ErrorResponse>(
      {
        error: 'Failed to fetch interview questions',
        message: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
      },
      { status: 500 }
    );
  }
}
