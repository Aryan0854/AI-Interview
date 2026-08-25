import { supabase } from "@/lib/db";
import { readPersistedJson, writePersistedJson } from "@/lib/runtime-data";
import { hashPassword, verifyPassword } from "@/lib/employee-auth";
import type { AdminAccess } from "@/lib/admin-accounts";

const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "12345";
const SUPER_ADMIN_EMAIL = "admin@infinite.com";
const SCREENING_ONLY_PASSWORD = process.env.SCREENING_ADMIN_PASSWORD || "56789";
const SCREENING_ONLY_ADMIN_EMAILS = new Set([
  "ramendras@infinite.com",
  "nehalathar@infinite.com",
  "shwethab@infinite.com",
]);
const ACCOUNTS_SETTINGS_KEY = "admin_named_accounts";
const LEGACY_PASSWORD_SETTINGS_KEY = "admin_named_passwords";
const ACCOUNTS_STORE_FILE = "admin-named-accounts.json";

type StoredSecret = { hash: string; salt: string };

export type NamedAdminRecord = {
  hash?: string;
  salt?: string;
  canViewEmployeePortal: boolean;
  canChangePassword: boolean;
  canViewOrgScreeningData: boolean;
};

type NamedAdminMap = Record<string, NamedAdminRecord>;

let accountCache: { at: number; value: NamedAdminMap } | null = null;

function cleanEmail(email: string): string {
  return String(email || "").trim().toLowerCase();
}

function isScreeningOnlyAdmin(email: string): boolean {
  return SCREENING_ONLY_ADMIN_EMAILS.has(cleanEmail(email));
}

function secretLooksValid(stored?: { hash?: string; salt?: string }): stored is StoredSecret {
  return Boolean(stored?.hash && stored?.salt);
}

function matchesStoredPassword(password: string, stored: StoredSecret): boolean {
  try {
    return verifyPassword(password, stored.salt, stored.hash);
  } catch {
    return false;
  }
}

function normalizeRecord(raw: any): { record: NamedAdminRecord; strippedPlaintext: boolean } {
  const plaintext = String(raw?.password || "").trim();
  const hashed = plaintext ? hashPassword(plaintext) : null;
  return {
    record: {
      hash: secretLooksValid(raw) ? raw.hash : hashed?.hash,
      salt: secretLooksValid(raw) ? raw.salt : hashed?.salt,
      canViewEmployeePortal: raw?.canViewEmployeePortal !== false,
      canChangePassword: raw?.canChangePassword !== false,
      canViewOrgScreeningData: raw?.canViewOrgScreeningData !== false,
    },
    strippedPlaintext: Boolean(plaintext),
  };
}

function parseAccountMap(value: unknown): { accounts: NamedAdminMap; strippedPlaintext: boolean } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { accounts: {}, strippedPlaintext: false };
  }
  const accounts: NamedAdminMap = {};
  let strippedPlaintext = false;
  for (const [email, raw] of Object.entries(value as Record<string, any>)) {
    const user = cleanEmail(email);
    if (!user.endsWith("@infinite.com")) continue;
    const parsed = normalizeRecord(raw);
    accounts[user] = parsed.record;
    if (parsed.strippedPlaintext) strippedPlaintext = true;
  }
  return { accounts, strippedPlaintext };
}

async function readSettingsMap(key: string): Promise<Record<string, any>> {
  try {
    const { data, error } = await supabase
      .from("portal_settings")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    if (error || !data?.value || typeof data.value !== "object") return {};
    return data.value as Record<string, any>;
  } catch (err) {
    console.warn(`Failed to load ${key} from Supabase:`, err);
    return {};
  }
}

async function loadNamedAdminAccounts(): Promise<NamedAdminMap> {
  if (accountCache && Date.now() - accountCache.at < 4000) return accountCache.value;

  const parsed = parseAccountMap(await readSettingsMap(ACCOUNTS_SETTINGS_KEY));
  let accounts = parsed.accounts;
  let dirty = parsed.strippedPlaintext;

  if (Object.keys(accounts).length === 0) {
    try {
      const raw = await readPersistedJson(ACCOUNTS_STORE_FILE);
      if (raw) {
        const fromFile = parseAccountMap(JSON.parse(raw));
        accounts = fromFile.accounts;
        dirty = dirty || fromFile.strippedPlaintext;
      }
    } catch {
      accounts = {};
    }
  }

  const legacySecrets = await readSettingsMap(LEGACY_PASSWORD_SETTINGS_KEY);
  for (const [email, secret] of Object.entries(legacySecrets)) {
    const user = cleanEmail(email);
    if (!accounts[user] || !secretLooksValid(secret) || secretLooksValid(accounts[user])) continue;
    accounts[user] = {
      ...accounts[user],
      hash: secret.hash,
      salt: secret.salt,
    };
    dirty = true;
  }

  for (const email of SCREENING_ONLY_ADMIN_EMAILS) {
    if (accounts[email]?.canViewEmployeePortal) {
      accounts[email] = { ...accounts[email], canViewEmployeePortal: false };
      dirty = true;
    }
  }

  if (dirty) {
    await saveNamedAdminAccounts(accounts);
  } else {
    accountCache = { at: Date.now(), value: accounts };
  }

  return accounts;
}

async function saveNamedAdminAccounts(value: NamedAdminMap): Promise<void> {
  accountCache = { at: Date.now(), value };
  try {
    const { error } = await supabase.from("portal_settings").upsert(
      {
        key: ACCOUNTS_SETTINGS_KEY,
        value,
      },
      { onConflict: "key" }
    );
    if (error) throw error;
  } catch (err) {
    console.warn("Failed to save named admin accounts to Supabase:", err);
  }
  try {
    await writePersistedJson(ACCOUNTS_STORE_FILE, JSON.stringify(value, null, 2));
  } catch (err) {
    console.warn("Failed to persist named admin accounts locally:", err);
  }
}

export async function getNamedAdminRecord(email: string): Promise<NamedAdminRecord | null> {
  const accounts = await loadNamedAdminAccounts();
  return accounts[cleanEmail(email)] || null;
}

export async function getAdminAccess(email: string): Promise<AdminAccess> {
  const user = cleanEmail(email);
  const named = await getNamedAdminRecord(user);
  const hidePortal = isScreeningOnlyAdmin(user);
  if (named) {
    return {
      email: user,
      canViewEmployeePortal: named.canViewEmployeePortal && !hidePortal,
      canChangePassword: named.canChangePassword,
    };
  }
  return {
    email: user,
    canViewEmployeePortal: !hidePortal,
    canChangePassword: false,
  };
}

export async function adminCanChangePassword(email: string): Promise<boolean> {
  const named = await getNamedAdminRecord(email);
  return Boolean(named?.canChangePassword);
}

export async function adminCanViewOrgScreeningData(email: string): Promise<boolean> {
  const user = cleanEmail(email);
  if (user === SUPER_ADMIN_EMAIL || isScreeningOnlyAdmin(user)) return true;
  const named = await getNamedAdminRecord(user);
  return Boolean(named?.canViewOrgScreeningData);
}

export async function authenticateAdminCredentials(
  email: string,
  password: string
): Promise<AdminAccess | null> {
  const user = cleanEmail(email);
  if (!user.endsWith("@infinite.com") || !password) return null;

  const named = await getNamedAdminRecord(user);
  if (named && secretLooksValid(named) && matchesStoredPassword(password, named)) {
    return await getAdminAccess(user);
  }

  if (isScreeningOnlyAdmin(user) && password === SCREENING_ONLY_PASSWORD) {
    return await getAdminAccess(user);
  }

  if (named) return null;

  if (password !== DEFAULT_ADMIN_PASSWORD) return null;
  return await getAdminAccess(user);
}

export async function changeNamedAdminPassword(
  email: string,
  currentPassword: string,
  newPassword: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = cleanEmail(email);
  const named = await getNamedAdminRecord(user);
  if (!named?.canChangePassword) {
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

  const accounts = await loadNamedAdminAccounts();
  const current = accounts[user];
  if (!current) {
    return { ok: false, error: "This account cannot change its password here." };
  }
  accounts[user] = { ...current, ...hashPassword(next) };
  await saveNamedAdminAccounts(accounts);
  return { ok: true };
}
