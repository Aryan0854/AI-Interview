import { NextRequest } from "next/server";

// 1. CSRF Protection Check
export function checkCsrf(request: NextRequest): boolean {
  const method = request.method;
  // Read-only HTTP methods are safe
  if (["GET", "HEAD", "OPTIONS"].includes(method)) {
    return true;
  }

  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  if (!origin && !referer) {
    return false; // Mutating request must specify origin or referer
  }

  const targetOrigin = origin || (referer ? new URL(referer).origin : "");
  if (!targetOrigin) return false;

  const hostUrl = new URL(request.url).origin;
  return targetOrigin === hostUrl;
}

// 2. IP-Based Sliding Window Rate Limiting
const tracker = new Map<string, { count: number; resetTime: number }>();

// Run a cleanup interval every minute to release memory from expired entries
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, val] of tracker.entries()) {
      if (now > val.resetTime) {
        tracker.delete(key);
      }
    }
  }, 60000);
}

export function isRateLimited(
  ip: string,
  limit = 60,
  windowMs = 60000
): { limited: boolean; remaining: number; reset: number } {
  const now = Date.now();
  const record = tracker.get(ip);

  if (!record || now > record.resetTime) {
    const resetTime = now + windowMs;
    tracker.set(ip, { count: 1, resetTime });
    return { limited: false, remaining: limit - 1, reset: resetTime };
  }

  if (record.count >= limit) {
    return { limited: true, remaining: 0, reset: record.resetTime };
  }

  record.count++;
  return { limited: false, remaining: limit - record.count, reset: record.resetTime };
}

// 3. Deep File Binary Magic Number Validation
export function validateFileSignature(buffer: Buffer, filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (!ext) return false;

  // Read the first 4 bytes as hex
  const header = buffer.toString("hex", 0, 4).toUpperCase();

  if (ext === "pdf") {
    // PDF signature: 25504446 (%PDF)
    return header.startsWith("25504446");
  }
  if (ext === "docx" || ext === "zip") {
    // DOCX/ZIP signature: 504b0304 (PK..)
    return header.startsWith("504B0304");
  }
  if (ext === "doc") {
    // DOC signature: d0cf11e0a1b11ae1
    return header.startsWith("D0CF11E0");
  }
  if (ext === "txt") {
    // Plain text verification: ensure it does not contain binary null/control bytes
    try {
      const text = buffer.toString("utf8");
      return !/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(text);
    } catch {
      return false;
    }
  }
  return false;
}

// 4. Client IP Extraction Helper
export function getClientIp(request: NextRequest): string {
  const xForwardedFor = request.headers.get("x-forwarded-for");
  if (xForwardedFor) {
    return xForwardedFor.split(",")[0].trim();
  }
  return (request as any).ip || "127.0.0.1";
}
