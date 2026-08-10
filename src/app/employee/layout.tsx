"use client";

import { usePathname } from "next/navigation";
import EmployeeAuthGate from "@/components/EmployeeAuthGate";

export default function EmployeeLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPublicRoute = pathname === "/employee" || pathname.startsWith("/employee/set-password");

  if (isPublicRoute) {
    return <>{children}</>;
  }

  return <EmployeeAuthGate>{children}</EmployeeAuthGate>;
}
