import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function loadAdminKey(path: string, configured?: string): string {
  if (configured?.trim()) return configured.trim();
  mkdirSync(dirname(path), { recursive: true });
  try {
    writeFileSync(path, randomBytes(32).toString("base64url") + "\n", { flag: "wx", mode: 0o600 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
  const key = readFileSync(path, "utf8").trim();
  if (!key) throw new Error("Therapist key file is empty. Configure ADMIN_KEY to restore therapist access.");
  return key;
}
