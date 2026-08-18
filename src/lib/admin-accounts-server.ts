import { supabase } from "@/lib/db";
import { readPersistedJson, writePersistedJson } from "@/lib/runtime-data";
import { hashPassword, verifyPassword } from "@/lib/employee-auth";
import { getAdminAccess, adminCanChangePassword, type AdminAccess } from "@/lib/admin-accounts";

const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "12345";
const TAG_PASSWORD = "56789";
const PASSWORD_STORE_FILE = "admin-named-passwords.json";
const PASSWORD_SETTINGS_KEY = "admin_named_passwords";

type StoredSecret = { hash: string; salt: string };
type SecretMap = Record<string, StoredSecret>;

const NAMED_ADMIN_PASSWORDS: Record<string, string> = {
  "tag@infinite.com": TAG_PASSWORD,
  "ramendras@infinite.com": TAG_PASSWORD,
  "nehalathar@infinite.com": TAG_PASSWORD,
  "shwethab@infinite.com": TAG_PASSWORD,
};

let secretCache: { at: number; value: SecretMap } | null = null;

function cleanEmail(email: string): string {
  return String(email || "").trim().toLowerCase();
}

function secretLooksValid(stored?: StoredSecret): stored is StoredSecret {
  return Boolean(stored?.hash && stored?.salt);
}

function matchesStoredPassword(password: string, stored: StoredSecret): boolean {
  try {
    return verifyPassword(password, stored.salt, stored.hash);
  } catch {
    return false;
  }
}

async function loadSecrets(): Promise<SecretMap> {
  if (secretCache && Date.now() - secretCache.at < 4000) return secretCache.value;

  let value: SecretMap = {};
  try {
    const { data, error } = await supabase
      .from("portal_settings")
      .select("value")
      .eq("key", PASSWORD_SETTINGS_KEY)
      .maybeSingle();
    if (!error && data?.value && typeof data.value === "object") {
      value = data.value as SecretMap;
    }
  } catch (err) {
    console.warn("Failed to load named admin passwords from Supabase:", err);
  }

  if (Object.keys(value).length === 0) {
    try {
      const raw = await readPersistedJson(PASSWORD_STORE_FILE);
      if (raw) value = JSON.parse(raw) as SecretMap;
    } catch {
      value = {};
    }
  }

  secretCache = { at: Date.now(), value };
  return value;
}

async function saveSecrets(value: SecretMap): Promise<void> {
  secretCache = { at: Date.now(), value };
  try {
    const { error } = await supabase.from("portal_settings").upsert({
      key: PASSWORD_SETTINGS_KEY,
      value,
    });
    if (error) throw error;
  } catch (err) {
    console.warn("Failed to save named admin passwords to Supabase:", err);
  }
  try {
    await writePersistedJson(PASSWORD_STORE_FILE, JSON.stringify(value, null, 2));
  } catch (err) {
    console.warn("Failed to persist named admin passwords locally:", err);
  }
}

export async function authenticateAdminCredentials(
  email: string,
  password: string
): Promise<AdminAccess | null> {
  const user = cleanEmail(email);
  if (!user.endsWith("@infinite.com") || !password) return null;

  const namedPassword = NAMED_ADMIN_PASSWORDS[user];
  if (namedPassword) {
    const secrets = await loadSecrets();
    const stored = secrets[user];
    const ok = secretLooksValid(stored)
      ? matchesStoredPassword(password, stored)
      : password === namedPassword;
    if (!ok) return null;
    return getAdminAccess(user);
  }

  if (password !== DEFAULT_ADMIN_PASSWORD) return null;
  return getAdminAccess(user);
}

export async function changeNamedAdminPassword(
  email: string,
  currentPassword: string,
  newPassword: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = cleanEmail(email);
  if (!adminCanChangePassword(user)) {
    return { ok: false, error: "This account cannot change its password here." };
  }
  const next = String(newPassword || "");
  if (next.length < 5) {
    return { ok: false, error: "New password must be at least 5 characters." };
  }

  const authed = await authenticateAdminCredentials(user, currentPassword);
  if (!authed) {
    return { ok: false, error: "Current password is incorrect." };
  }

  const secrets = await loadSecrets();
  secrets[user] = hashPassword(next);
  await saveSecrets(secrets);
  return { ok: true };
}
