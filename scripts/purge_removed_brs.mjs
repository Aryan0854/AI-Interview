import { createHash } from "crypto";
import { existsSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const BLOCKED = new Set();
const EXCEL_PATHS = [
  "docs/BR/BR_RawData 3.xlsx",
  "uploads/docs-cache/BR/BR_RawData 3.xlsx",
];

function brIdToUuid(brId) {
  const hash = createHash("md5").update(brId).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function extractBrId(value) {
  const prefix = String(value || "").split("|")[0] || "";
  const match = prefix.trim().match(/(\d+)\s*BR/i);
  if (match) return `${match[1]}br`;
  return prefix.trim().toLowerCase();
}

function cellText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object" && value.text) return String(value.text).trim();
  if (typeof value === "object" && Array.isArray(value.richText)) {
    return value.richText.map((t) => t.text || "").join("").trim();
  }
  return String(value).trim();
}

async function stripExcel(path) {
  if (!existsSync(path)) {
    console.log(`excel skip (missing): ${path}`);
    return 0;
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  let removed = 0;
  const remaining = [];
  for (const sheet of workbook.worksheets) {
    const header = sheet.getRow(1);
    let idCol = 0;
    header.eachCell((cell, col) => {
      const name = cellText(cell.value).toLowerCase();
      if (name.includes("auto req id") || name === "br id" || name === "id") idCol = col;
    });
    if (!idCol) continue;
    const rowNumbers = [];
    sheet.eachRow((row, n) => {
      if (n === 1) return;
      const id = extractBrId(cellText(row.getCell(idCol).value));
      if (BLOCKED.has(id)) rowNumbers.push(n);
      else if (id) remaining.push(`${sheet.name}:${id}`);
    });
    rowNumbers.sort((a, b) => b - a);
    for (const n of rowNumbers) {
      sheet.spliceRows(n, 1);
      removed += 1;
    }
  }
  if (removed) await workbook.xlsx.writeFile(path);
  console.log(`excel ${path}: removed ${removed} row(s); remaining ids: ${remaining.join(", ") || "(none)"}`);
  return removed;
}

async function purgeJson(path) {
  if (!existsSync(path)) return 0;
  const rows = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(rows)) return 0;
  const next = rows.filter((row) => !BLOCKED.has(extractBrId(row.fileName || row.file_name || row.brId)));
  const removed = rows.length - next.length;
  if (removed) await writeFile(path, JSON.stringify(next, null, 2), "utf8");
  console.log(`json ${path}: removed ${removed} row(s)`);
  return removed;
}

async function main() {
  for (const path of EXCEL_PATHS) await stripExcel(path);
  await purgeJson("uploads/job_descriptions.json");
  await purgeJson("src/data/job_descriptions.json");

  if (process.env.ALLOW_INSECURE_TLS === "1") {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.log("No Supabase credentials; skipped database purge.");
    return;
  }

  const supabase = createClient(url, key);
  const blockedIds = [
    ...BLOCKED,
    ...Array.from(BLOCKED).map((id) => id.replace(/br$/i, "BR")),
    ...Array.from(BLOCKED).flatMap((id) => {
      const num = id.match(/\d+/)[0];
      return [brIdToUuid(`${num}BR`), brIdToUuid(`${num}br`), brIdToUuid(id)];
    }),
  ];

  const { data: settings } = await supabase
    .from("portal_settings")
    .select("value")
    .eq("key", "deleted_requirements")
    .maybeSingle();
  const current = settings?.value && typeof settings.value === "object" ? settings.value : {};
  const next = {
    ids: Array.from(new Set([...(current.ids || []), ...blockedIds.map((id) => String(id).toLowerCase())])),
    brIds: Array.from(new Set([...(current.brIds || []).map((id) => String(id).toLowerCase()), ...BLOCKED])),
    groupKeys: current.groupKeys || [],
  };
  const { error: settingsError } = await supabase.from("portal_settings").upsert(
    { key: "deleted_requirements", value: next },
    { onConflict: "key" }
  );
  if (settingsError) console.log("settings upsert failed:", settingsError.message);
  else console.log("tombstoned BR IDs:", next.brIds.join(", "));

  const { data: rows, error: selectError } = await supabase
    .from("job_descriptions")
    .select("id, file_name");
  if (selectError) {
    console.log("job_descriptions select failed:", selectError.message);
    return;
  }
  const toDelete = (rows || []).filter((row) => {
    const brId = extractBrId(row.file_name);
    return BLOCKED.has(brId) || blockedIds.includes(String(row.id || "").toLowerCase());
  });
  if (toDelete.length) {
    const { error: deleteError } = await supabase
      .from("job_descriptions")
      .delete()
      .in("id", toDelete.map((row) => row.id));
    if (deleteError) console.log("delete failed:", deleteError.message);
    else console.log(`deleted ${toDelete.length} job_descriptions: ${toDelete.map((r) => `${r.file_name} (${r.id})`).join("; ")}`);
  } else {
    console.log("no matching job_descriptions rows left");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
