import { NextRequest, NextResponse } from 'next/server';
import { authenticateAdminRequest } from '@/lib/employee-auth';
import { 
  refreshRequirements, 
  refreshCandidates, 
  refreshEmployees, 
  refreshInterviews,
  syncSelectedRequirementToMaster,
} from '@/services/automation-service';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  if (!authenticateAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');
  const activeJdId = searchParams.get('activeJdId') || undefined;

  try {
    if (type === 'requirements') {
      const res = await refreshRequirements();
      return NextResponse.json({ ...res, success: true });
    } else if (type === 'sync-selected') {
      const res = await syncSelectedRequirementToMaster(activeJdId || "");
      return NextResponse.json({ ...res, success: true });
    } else if (type === 'candidates') {
      const res = await refreshCandidates(activeJdId);
      return NextResponse.json({ ...res, success: true });
    } else if (type === 'employees') {
      const res = await refreshEmployees(activeJdId);
      return NextResponse.json({ ...res, success: true });
    } else if (type === 'interviews') {
      const res = await refreshInterviews();
      return NextResponse.json({ ...res, success: true });
    } else {
      return NextResponse.json({ error: 'Invalid refresh type specified' }, { status: 400 });
    }
  } catch (error: any) {
    console.error(`Refresh ${type} failed:`, error);
    return NextResponse.json({ error: error.message || 'Refresh failed' }, { status: 500 });
  }
}
