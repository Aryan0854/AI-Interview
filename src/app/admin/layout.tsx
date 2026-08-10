import AdminAuthGate from "@/components/AdminAuthGate";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminAuthGate>{children}</AdminAuthGate>;
}
