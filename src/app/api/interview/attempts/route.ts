export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { data: rows, error } = await supabase
      .from('interview_attempts')
      .select('*')
      .order('id', { ascending: false });
    
    if (error) throw error;
    
    return NextResponse.json(rows);
  } catch (err: any) {
    console.error("Failed to fetch attempts", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
