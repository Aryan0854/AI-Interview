export type AdminAccess = {
  email: string;
  canViewEmployeePortal: boolean;
};

const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "12345";
const TAG_PASSWORD = "56789";

const ADMIN_ACCOUNTS: Record<string, { password: string; canViewEmployeePortal: boolean }> = {
  "tag@infinite.com": { password: TAG_PASSWORD, canViewEmployeePortal: false },
  "ramendras@infinite.com": { password: TAG_PASSWORD, canViewEmployeePortal: false },
  "nehalathar@infinite.com": { password: TAG_PASSWORD, canViewEmployeePortal: false },
  "shwethab@infinite.com": { password: TAG_PASSWORD, canViewEmployeePortal: false },
};

export function authenticateAdminCredentials(email: string, password: string): AdminAccess | null {
  const cleanEmail = String(email || "").trim().toLowerCase();
  if (!cleanEmail.endsWith("@infinite.com") || !password) return null;

  const named = ADMIN_ACCOUNTS[cleanEmail];
  if (named) {
    if (password !== named.password) return null;
    return { email: cleanEmail, canViewEmployeePortal: named.canViewEmployeePortal };
  }

  if (password !== DEFAULT_ADMIN_PASSWORD) return null;
  return { email: cleanEmail, canViewEmployeePortal: true };
}

export function adminCanViewEmployeePortal(email: string): boolean {
  const cleanEmail = String(email || "").trim().toLowerCase();
  const named = ADMIN_ACCOUNTS[cleanEmail];
  if (named) return named.canViewEmployeePortal;
  return true;
}
