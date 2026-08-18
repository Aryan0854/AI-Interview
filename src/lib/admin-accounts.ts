export type AdminAccess = {
  email: string;
  canViewEmployeePortal: boolean;
  canChangePassword: boolean;
};

const TAG_STYLE_EMAILS = new Set([
  "ramendras@infinite.com",
  "nehalathar@infinite.com",
  "shwethab@infinite.com",
]);

const PASSWORD_CHANGE_EMAILS = new Set([
  "ramendras@infinite.com",
  "nehalathar@infinite.com",
  "shwethab@infinite.com",
]);

function cleanEmail(email: string): string {
  return String(email || "").trim().toLowerCase();
}

export function adminCanViewEmployeePortal(email: string): boolean {
  return !TAG_STYLE_EMAILS.has(cleanEmail(email));
}

export function adminCanChangePassword(email: string): boolean {
  return PASSWORD_CHANGE_EMAILS.has(cleanEmail(email));
}

export function adminCanViewOrgScreeningData(email: string): boolean {
  const user = cleanEmail(email);
  return user === "admin@infinite.com" || TAG_STYLE_EMAILS.has(user);
}

export function getAdminAccess(email: string): AdminAccess {
  const user = cleanEmail(email);
  return {
    email: user,
    canViewEmployeePortal: adminCanViewEmployeePortal(user),
    canChangePassword: adminCanChangePassword(user),
  };
}
