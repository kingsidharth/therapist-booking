import { PORTS } from "@app/shared";
import { loadAdminKey } from "./admin-key";
import { fileURLToPath } from "node:url";
import { createApp } from "./app";
import { isEmpty, openDb } from "./db";
import { extendHorizon } from "./schedule";
import { seedDemo } from "./seed";
import { sweepExpiredHolds } from "./service";

const dbPath = process.env.DB_PATH ?? new URL("../data/app.sqlite", import.meta.url).pathname;
const port = Number(process.env.PORT ?? PORTS.server);

const db = openDb(dbPath);
if (isEmpty(db)) {
  const s = seedDemo(db, new Date());
  console.log("[server] empty database — seeded", s);
}
extendHorizon(db, new Date());

setInterval(() => sweepExpiredHolds({ db, now: new Date() }), 30_000);
setInterval(() => extendHorizon(db, new Date()), 60 * 60_000);

const keyPath = fileURLToPath(new URL("../data/admin-key", import.meta.url));
const app = createApp({ db, adminKey: loadAdminKey(keyPath, process.env.ADMIN_KEY) });
console.log(`[server] listening on http://localhost:${port} (db: ${dbPath})`);

export default { port, fetch: app.fetch };
