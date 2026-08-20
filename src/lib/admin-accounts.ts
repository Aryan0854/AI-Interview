export type AdminAccess = {
  email: string;
  canViewEmployeePortal: boolean;
  canChangePassword: boolean;
};

const PORTAL_FLAG_KEY = "admin-can-view-employee-portal";
const PASSWORD_FLAG_KEY = "admin-can-change-password";

export function storeAdminAccessFlags(
  access: Pick<AdminAccess, "canViewEmployeePortal" | "canChangePassword">
) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(PORTAL_FLAG_KEY, access.canViewEmployeePortal ? "1" : "0");
  window.sessionStorage.setItem(PASSWORD_FLAG_KEY, access.canChangePassword ? "1" : "0");
}

export function readAdminAccessFlags(): Pick<AdminAccess, "canViewEmployeePortal" | "canChangePassword"> {
  if (typeof window === "undefined") {
    return { canViewEmployeePortal: true, canChangePassword: false };
  }
  return {
    canViewEmployeePortal: window.sessionStorage.getItem(PORTAL_FLAG_KEY) !== "0",
    canChangePassword: window.sessionStorage.getItem(PASSWORD_FLAG_KEY) === "1",
  };
}

export function clearAdminAccessFlags() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(PORTAL_FLAG_KEY);
  window.sessionStorage.removeItem(PASSWORD_FLAG_KEY);
}
