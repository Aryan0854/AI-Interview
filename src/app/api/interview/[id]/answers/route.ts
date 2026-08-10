export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    const { data: rows, error } = await supabase
      .from('interview_attempts')
      .select('question_index, candidate_answer')
      .eq('resume_id', id);
    
    if (error) {
      console.error('Failed to query attempts from DB:', error);
      throw error;
    }
    
    const formattedRows = (rows || []).map((row: any) => ({
      question_index: row.question_index,
      answer: row.candidate_answer
    }));
    
    return NextResponse.json(formattedRows);
  } catch (err: any) {
    console.error("Failed to fetch answers for resume:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
