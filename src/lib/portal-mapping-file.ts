/** Filename helpers for Employee Portal mapping workbooks. Safe for client and server. */

function normalizeFileName(name: string): string {
  return String(name || "")
    .toLowerCase()
    .replace(/[_'`’]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isPortalCredentialsFileName(name: string): boolean {
  const n = normalizeFileName(name);
  if (!/\.(xlsx|xls|csv)$/i.test(n)) return false;
  return n.includes("user credential") || n.includes("employee user credential");
}

export function isPortalMappingFileName(name: string): boolean {
  const n = normalizeFileName(name);
  if (!/\.(xlsx|xls)$/i.test(n)) return false;
  if (isPortalCredentialsFileName(name)) return false;
  return n.includes("resource question mapping") || n.includes("question mapping");
}

export const PORTAL_MAPPING_STORED_NAME = "Resource_Question_Mapping.xlsx";
