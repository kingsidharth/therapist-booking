import { createClient } from "@libsql/client";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { initializeDb } from "./db";

export async function openDb(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const url = path === ":memory:" ? ":memory:" : pathToFileURL(path).href;
  const client = createClient({ url });
  if (path !== ":memory:") await client.execute("PRAGMA journal_mode=WAL");
  await client.execute("PRAGMA foreign_keys=ON");
  return initializeDb(client);
}
