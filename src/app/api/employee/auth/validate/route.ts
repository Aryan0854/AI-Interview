import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest, isAssessmentOnlyEmployee, isProductQbEmployee } from "@/lib/employee-auth";

export async function GET(request: NextRequest) {
  const auth = authenticateRequest(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const assessmentOnly = isAssessmentOnlyEmployee(auth.employee);

  return NextResponse.json({
    employee: {
      employee_id: auth.employee.employee_id,
      full_name: auth.employee.full_name,
      email: auth.employee.email,
      department: auth.employee.department,
      role: auth.employee.role,
      is_first_login: auth.employee.is_first_login,
      product: auth.employee.product ?? "",
      product_qb_eligible: isProductQbEmployee(auth.employee),
      assessment_only: assessmentOnly,
    },
  });
}
