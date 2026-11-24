import { createClient } from "@libsql/client/http";
import { createApp } from "./app";
import { initializeDb, isEmpty, type DB } from "./db";
import { seedBase } from "./practice";
import { extendHorizon, getTimezone } from "./schedule";

export async function createProductionApp(config: { url: string; authToken: string; adminKey: string }) {
  const db = await initializeDb(createClient({ url: config.url, authToken: config.authToken }));
  try {
    if (await isEmpty(db)) await seedBase(db);
    const refreshSchedule = rollingSchedule(db, await getTimezone(db));
    await refreshSchedule();
    return createApp({ db, adminKey: config.adminKey, refreshSchedule });
  } catch (error) {
    db.close();
    throw error;
  }
}

/** Share in-flight work per instance and persist the last generated day across cold starts. */
export function rollingSchedule(db: DB, timezone: string, now: () => Date = () => new Date()) {
  const date = new Intl.DateTimeFormat("sv-SE", { timeZone: timezone });
  let completedDay: string | undefined;
  let pending: Promise<void> | undefined;
  return async () => {
    const instant = now();
    const day = date.format(instant);
    if (completedDay === day) return;
    pending ??= (async () => {
      const last = await db.query("SELECT value FROM schedule_metadata WHERE key='horizon_day'").get() as { value: string } | null;
      if (last?.value !== day) {
        // Slot inserts are idempotent across simultaneous starts. Record completion only after they all succeed.
        await extendHorizon(db, instant);
        await db.query(`INSERT INTO schedule_metadata (key, value) VALUES ('horizon_day', ?)
          ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE value < excluded.value`).run(day);
      }
      completedDay = day;
    })().finally(() => { pending = undefined; });
    await pending;
  };
}
