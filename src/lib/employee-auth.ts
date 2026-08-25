import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { NextRequest } from "next/server";
import { supabase } from "@/lib/db";
import { useSupabasePrimary } from "@/lib/db-mode";
import {
  cacheEmployeeAccount,
  fetchEmployeeAccountFromDb,
  fetchEmployeeByEmailFromDb,
  getCachedEmployeeAccount,
  shouldUseDbAccounts,
  upsertEmployeeAccountToDb,
} from "@/services/employee-account-store";

export interface EmployeeAccount {
  employee_id: string;
  full_name: string;
  email: string;
  department: string;
  role: string;
  is_first_login: boolean;
  password_hash?: string;
  password_salt?: string;
  xp_points?: number;
  streak_days?: number;
  skill_level?: string;
  ai_readiness_score?: number;
  product?: string;
  /** Employee is in the resources / QB credentials cohort. */
  product_qb_eligible?: boolean;
  /** When true, employee may only access their pre-assigned product Q bank test. */
  assessment_only?: boolean;
}

export const PRODUCT_ASSESSMENT_TOPIC_ID = "resource-product-assessment";

export function isProductQbEmployee(
  employee: Pick<EmployeeAccount, "product_qb_eligible" | "role">
): boolean {
  if (employee.role === "admin") return false;
  return employee.product_qb_eligible === true;
}

export function isAssessmentOnlyEmployee(employee: Pick<EmployeeAccount, "assessment_only" | "role">): boolean {
  if (employee.role === "admin") return false;
  return employee.assessment_only === true;
}

interface AccountStore {
  employees: EmployeeAccount[];
}

const STATIC_ACCOUNT_FILE = path.join(process.cwd(), "src", "data", "employee-accounts.json");
const AUTH_SECRET = process.env.EMPLOYEE_AUTH_SECRET || "";

if (!AUTH_SECRET) {
  if (useSupabasePrimary()) {
    console.error("EMPLOYEE_AUTH_SECRET is required in production.");
  } else {
    console.warn("EMPLOYEE_AUTH_SECRET is not set. Using a development fallback secret.");
  }
}

function getAuthSecret(): string {
  return AUTH_SECRET || "dev-employee-auth-secret";
}

function getAccountFilePath() {
  if (process.env.VERCEL === "1") {
    return "/tmp/employee-accounts.json";
  }
  return STATIC_ACCOUNT_FILE;
}

let inMemoryStore: AccountStore | null = null;

function readStore(): AccountStore {
  if (process.env.NODE_ENV === "development") {
    inMemoryStore = null;
  }
  if (inMemoryStore) {
    return inMemoryStore;
  }

  const filePath = getAccountFilePath();

  // On Vercel, if the tmp file doesn't exist, seed it from the static file
  if (process.env.VERCEL === "1" && !fs.existsSync(filePath)) {
    let initial: AccountStore = { employees: [] };
    if (fs.existsSync(STATIC_ACCOUNT_FILE)) {
      try {
        const raw = fs.readFileSync(STATIC_ACCOUNT_FILE, "utf8");
        initial = JSON.parse(raw) as AccountStore;
      } catch (e) {
        console.error("Failed to parse static account file:", e);
      }
    }
    try {
      fs.writeFileSync(filePath, JSON.stringify(initial, null, 2), "utf8");
    } catch (e) {
      console.error("Failed to write initial account file to /tmp:", e);
    }
    inMemoryStore = initial;
    return initial;
  }

  if (!fs.existsSync(filePath)) {
    const initial: AccountStore = { employees: [] };
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(initial, null, 2), "utf8");
    } catch (e) {
      console.error("Failed to create directory or write empty account file:", e);
    }
    inMemoryStore = initial;
    return initial;
  }

  const raw = fs.readFileSync(filePath, "utf8");
  try {
    inMemoryStore = JSON.parse(raw) as AccountStore;
    return inMemoryStore;
  } catch {
    const initial: AccountStore = { employees: [] };
    try {
      fs.writeFileSync(filePath, JSON.stringify(initial, null, 2), "utf8");
    } catch (e) {
      console.error("Failed to write default account file on parse failure:", e);
    }
    inMemoryStore = initial;
    return initial;
  }
}

function writeStore(store: AccountStore) {
  inMemoryStore = store;
  const filePath = getAccountFilePath();
  try {
    fs.writeFileSync(filePath, JSON.stringify(store, null, 2), "utf8");
  } catch (e) {
    console.error("Failed to write store to", filePath, e);
  }
}

function normalizeEmployeeId(employeeId: string) {
  return employeeId.trim().toUpperCase();
}

export function getEmployeeAccount(employeeId: string): EmployeeAccount | null {
  if (shouldUseDbAccounts()) {
    const cached = getCachedEmployeeAccount(employeeId);
    if (cached) return cached;
  }
  const store = readStore();
  return store.employees.find((employee) => normalizeEmployeeId(employee.employee_id) === normalizeEmployeeId(employeeId)) ?? null;
}

export async function getEmployeeAccountAsync(employeeId: string): Promise<EmployeeAccount | null> {
  if (shouldUseDbAccounts()) {
    const fromDb = await fetchEmployeeAccountFromDb(employeeId);
    if (fromDb) return fromDb;
  }
  return getEmployeeAccount(employeeId);
}

export function getEmployeeByEmail(email: string): EmployeeAccount | null {
  const store = readStore();
  const cleanEmail = email.toLowerCase().trim();
  return store.employees.find((employee) => employee.email?.toLowerCase().trim() === cleanEmail) ?? null;
}

export async function getEmployeeByEmailAsync(email: string): Promise<EmployeeAccount | null> {
  if (shouldUseDbAccounts()) {
    const fromDb = await fetchEmployeeByEmailFromDb(email);
    if (fromDb) return fromDb;
  }
  return getEmployeeByEmail(email);
}

export function hasPassword(employee: EmployeeAccount): boolean {
  return Boolean(employee.password_hash && employee.password_salt);
}

export function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString("base64");
  const hash = crypto.pbkdf2Sync(password, salt, 120_000, 64, "sha512").toString("base64");
  return { hash, salt };
}

export function verifyPassword(password: string, salt: string, hash: string) {
  const candidate = crypto.pbkdf2Sync(password, salt, 120_000, 64, "sha512").toString("base64");
  return crypto.timingSafeEqual(Buffer.from(candidate, "utf8"), Buffer.from(hash, "utf8"));
}

export function saveEmployeePassword(
  employeeId: string,
  password: string,
  details?: { full_name?: string; email?: string }
): EmployeeAccount | null {
  const employee = getEmployeeAccount(employeeId);
  if (!employee) return null;

  const { hash, salt } = hashPassword(password);
  employee.password_hash = hash;
  employee.password_salt = salt;
  employee.is_first_login = false;
  employee.product_qb_eligible = true;

  if (details?.full_name?.trim()) {
    employee.full_name = details.full_name.trim();
  }
  if (details?.email?.trim()) {
    employee.email = details.email.trim();
  }

  if (shouldUseDbAccounts()) {
    cacheEmployeeAccount(employee);
    void upsertEmployeeAccountToDb(employee);
    return employee;
  }

  const store = readStore();
  const idx = store.employees.findIndex((item) => normalizeEmployeeId(item.employee_id) === normalizeEmployeeId(employeeId));
  if (idx === -1) return null;
  store.employees[idx] = employee;
  writeStore(store);
  return employee;
}

export async function saveEmployeePasswordAsync(
  employeeId: string,
  password: string,
  details?: { full_name?: string; email?: string }
): Promise<EmployeeAccount | null> {
  const employee = await getEmployeeAccountAsync(employeeId);
  if (!employee) return null;
  const { hash, salt } = hashPassword(password);
  employee.password_hash = hash;
  employee.password_salt = salt;
  employee.is_first_login = false;
  employee.product_qb_eligible = true;

  if (details?.full_name?.trim()) {
    employee.full_name = details.full_name.trim();
  }
  if (details?.email?.trim()) {
    employee.email = details.email.trim();
  }

  if (shouldUseDbAccounts()) {
    const ok = await upsertEmployeeAccountToDb(employee);
    return ok ? employee : null;
  }
  return saveEmployeePassword(employeeId, password, details);
}

export function completeFirstTimeLogin(employeeId: string): EmployeeAccount | null {
  const employee = getEmployeeAccount(employeeId);
  if (!employee) return null;
  employee.is_first_login = false;

  if (shouldUseDbAccounts()) {
    cacheEmployeeAccount(employee);
    void upsertEmployeeAccountToDb(employee);
    return employee;
  }

  const store = readStore();
  const idx = store.employees.findIndex((item) => normalizeEmployeeId(item.employee_id) === normalizeEmployeeId(employeeId));
  if (idx === -1) return null;
  store.employees[idx].is_first_login = false;
  writeStore(store);
  return employee;
}

export async function completeFirstTimeLoginAsync(employeeId: string): Promise<EmployeeAccount | null> {
  const employee = await getEmployeeAccountAsync(employeeId);
  if (!employee) return null;
  employee.is_first_login = false;
  if (shouldUseDbAccounts()) {
    const ok = await upsertEmployeeAccountToDb(employee);
    return ok ? employee : null;
  }
  return completeFirstTimeLogin(employeeId);
}

export function signToken(employeeId: string, expiresInMs?: number) {
  const duration = expiresInMs ?? 7 * 24 * 60 * 60 * 1000; // 7 days
  const expiresAt = Date.now() + duration;
  const payload = JSON.stringify({ employee_id: normalizeEmployeeId(employeeId), exp: expiresAt });
  const encoded = Buffer.from(payload).toString("base64url");
  const signature = crypto.createHmac("sha256", getAuthSecret()).update(encoded).digest("hex");
  return `${encoded}.${signature}`;
}

export function verifyToken(token: string) {
  if (!token || typeof token !== "string") return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expected = crypto.createHmac("sha256", getAuthSecret()).update(payload).digest("hex");
  if (!crypto.timingSafeEqual(Buffer.from(signature, "utf8"), Buffer.from(expected, "utf8"))) {
    return null;
  }

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { employee_id: string; exp: number };
    if (Date.now() > data.exp) return null;
    return data.employee_id;
  } catch {
    return null;
  }
}

export function authenticateRequest(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.replace("Bearer ", "") : authHeader;
  const employeeId = verifyToken(token);
  if (!employeeId) return null;
  const employee = getEmployeeAccount(employeeId);
  if (!employee) return null;
  return { employeeId: employee.employee_id, employee };
}

export async function authenticateRequestAsync(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.replace("Bearer ", "") : authHeader;
  const employeeId = verifyToken(token);
  if (!employeeId) return null;
  const employee = await getEmployeeAccountAsync(employeeId);
  if (!employee) return null;
  return { employeeId: employee.employee_id, employee };
}

export function addEmployeeAccount(account: EmployeeAccount) {
  if (shouldUseDbAccounts()) {
    cacheEmployeeAccount(account);
    void upsertEmployeeAccountToDb(account);
    return true;
  }
  const store = readStore();
  const existing = store.employees.find((item) => normalizeEmployeeId(item.employee_id) === normalizeEmployeeId(account.employee_id));
  if (existing) return false;
  store.employees.push(account);
  writeStore(store);
  return true;
}

/**
 * DB-aware, fully-awaited variant of addEmployeeAccount. In Supabase-primary
 * mode this blocks on the actual database write instead of firing it in the
 * background, which matters on serverless where the function can be frozen
 * before an un-awaited write completes. Always use this (not the sync
 * version) from request handlers when the account may need to exist in the
 * database for a later, possibly cold, invocation to find it.
 */
export async function addEmployeeAccountAsync(account: EmployeeAccount): Promise<boolean> {
  if (shouldUseDbAccounts()) {
    const existing = await getEmployeeAccountAsync(account.employee_id);
    if (existing) return false;
    cacheEmployeeAccount(account);
    return upsertEmployeeAccountToDb(account);
  }
  return addEmployeeAccount(account);
}

export async function syncEmployeeToSupabase(account: EmployeeAccount): Promise<string | null> {
  if (shouldUseDbAccounts()) {
    const ok = await upsertEmployeeAccountToDb(account);
    if (!ok) return null;
    const { data } = await supabase
      .from("employees")
      .select("id")
      .eq("employee_id", account.employee_id)
      .maybeSingle();
    return data?.id ?? null;
  }

  try {
    // 1. Check if employee already exists in Supabase by employee_id
    const { data: existing, error: findError } = await supabase
      .from("employees")
      .select("id")
      .eq("employee_id", account.employee_id)
      .maybeSingle();

    if (findError) {
      console.error("Error finding employee in Supabase:", findError);
    }

    const uuid = existing?.id || crypto.randomUUID();

    // 2. Upsert the profile details to Supabase employees table
    const upsertPayload: Record<string, unknown> = {
      id: uuid,
      employee_id: account.employee_id,
      email: account.email || "",
      full_name: account.full_name || account.employee_id,
      role: account.role || "employee",
      product: account.product ?? null,
      password_hash: account.password_hash ?? null,
      password_salt: account.password_salt ?? null,
      xp_points: account.xp_points || 0,
      streak_days: account.streak_days || 0,
      skill_level: account.skill_level || "beginner",
      ai_readiness_score: account.ai_readiness_score || 0,
      is_first_login: account.is_first_login ?? false,
      updated_at: new Date().toISOString(),
    };

    // Defensively include columns that may not exist on older schemas yet.
    // Run: ALTER TABLE employees ADD COLUMN IF NOT EXISTS product_qb_eligible boolean NOT NULL DEFAULT false;
    //      ALTER TABLE employees ADD COLUMN IF NOT EXISTS assessment_only boolean NOT NULL DEFAULT false;
    if (account.product_qb_eligible !== undefined) {
      upsertPayload.product_qb_eligible = account.product_qb_eligible;
    }
    if (account.assessment_only !== undefined) {
      upsertPayload.assessment_only = account.assessment_only;
    }

    const { error: upsertError } = await supabase
      .from("employees")
      .upsert(upsertPayload);

    if (upsertError) {
      console.error("Failed to sync employee to Supabase:", upsertError);
      return null;
    }
    return uuid;
  } catch (err) {
    console.error("Error syncing employee to Supabase:", err);
    return null;
  }
}

export function authenticateAdminRequest(request: NextRequest): boolean {
  try {
    const authHeader = request.headers.get("authorization") ?? "";
    let token = authHeader.startsWith("Bearer ") ? authHeader.substring(7) : authHeader;

    if (!token) {
      const url = new URL(request.url);
      token = url.searchParams.get("token") ?? "";
    }

    if (!token) return false;

    const identifier = verifyToken(token);
    return identifier === "ADMIN";
  } catch (err) {
    console.error("Error authenticating admin request:", err);
    return false;
  }
}

