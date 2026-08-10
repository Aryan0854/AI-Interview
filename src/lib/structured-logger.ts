import { join } from 'path';
import { appendFile, mkdir, readFile, readdir } from 'fs/promises';

const getUploadsRoot = () => {
  return process.env.VERCEL === "1" ? "/tmp" : join(process.cwd(), "uploads");
};

export interface StructuredLog {
  timestamp: string;
  module: string;
  action: string;
  status: string;
  details: string;
}

/**
 * Appends a structured log message to a specific category log file.
 * Automatically copies failures and error logs to error.log.
 */
export async function writeLog(module: string, action: string, status: string, details: string) {
  const log: StructuredLog = {
    timestamp: new Date().toISOString(),
    module,
    action,
    status,
    details
  };

  try {
    const logDir = join(getUploadsRoot(), "logs");
    await mkdir(logDir, { recursive: true });

    const logLine = JSON.stringify(log) + "\n";
    const filename = `${module}.log`;

    // Append to category-specific log file
    await appendFile(join(logDir, filename), logLine, "utf8");

    // Copy to error.log if status is failed/warning or the module itself is error
    const lowerStatus = status.toLowerCase();
    if (lowerStatus === "failed" || lowerStatus === "error" || module === "error" || lowerStatus === "warning") {
      await appendFile(join(logDir, "error.log"), logLine, "utf8");
    }
  } catch (err) {
    console.error("Failed to write structured log:", err);
  }
}

/**
 * Reads logs from files. If a module is provided, reads only that category log.
 * Otherwise, reads all logs and combines them.
 */
export async function readLogs(module?: string): Promise<StructuredLog[]> {
  const logDir = join(getUploadsRoot(), "logs");
  const logs: StructuredLog[] = [];

  try {
    let files: string[] = [];
    if (module && module !== "all") {
      files = [`${module}.log`];
    } else {
      const dirContents = await readdir(logDir);
      files = dirContents.filter(f => f.endsWith(".log") && f !== "error.log"); // Avoid double-counting since error.log has copies
    }

    for (const file of files) {
      try {
        const content = await readFile(join(logDir, file), "utf8");
        const lines = content.split("\n").filter(Boolean);
        for (const line of lines) {
          try {
            logs.push(JSON.parse(line));
          } catch (e) {}
        }
      } catch (err: any) {
        if (err.code !== "ENOENT") {
          console.error("Error reading log file", file, err);
        }
      }
    }
  } catch (err: any) {
    if (err.code !== "ENOENT") {
      console.error("Error reading log directory", err);
    }
  }

  // Sort logs by timestamp descending (newest first)
  logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return logs;
}

/**
 * Empties all log files.
 */
export async function clearAllLogs() {
  const logDir = join(getUploadsRoot(), "logs");
  try {
    const files = await readdir(logDir);
    for (const file of files) {
      if (file.endsWith(".log")) {
        await appendFile(join(logDir, file), "", { flag: 'w' }); // Empty file
      }
    }
  } catch (err) {}
}
