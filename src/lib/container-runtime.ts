import { join } from "path";

/** True when running in Vercel, Docker/Azure container, or explicit production DB mode. */
export function isCloudDeployment(): boolean {
  return (
    process.env.VERCEL === "1" ||
    process.env.CONTAINER === "1" ||
    process.env.USE_SUPABASE_PRIMARY === "1" ||
    process.env.DOCS_USE_CLOUD === "1" ||
    Boolean(process.env.WEBSITE_SITE_NAME) ||
    Boolean(process.env.AZURE_CONTAINER_APP_NAME)
  );
}

/** Writable directory for runtime JSON, CSV, and ephemeral uploads. */
export function getRuntimeUploadsRoot(): string {
  if (process.env.UPLOADS_DIR?.trim()) {
    return process.env.UPLOADS_DIR.trim();
  }
  if (process.env.VERCEL === "1") {
    return "/tmp";
  }
  if (process.env.CONTAINER === "1") {
    return process.env.UPLOADS_DIR || "/data/uploads";
  }
  return join(process.cwd(), "uploads");
}
