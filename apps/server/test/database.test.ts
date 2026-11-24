import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/local-db";
import { rollingSchedule } from "../src/production";
import { seedBase } from "../src/practice";
import { createBooking, identify } from "../src/service";
import { MON_9, T0, slotId } from "./helpers";

test("a file-backed schedule survives competing bookings, cold starts and a new calendar day", async () => {
  const dir = mkdtempSync(join(tmpdir(), "booking-test-"));
  const file = join(dir, "schedule.db");
  let db = await openDb(file);
  try {
    await Promise.all([seedBase(db), seedBase(db)]);
    let now = T0;
    let refresh = rollingSchedule(db, "America/New_York", () => now);
    await Promise.all([refresh(), refresh()]);
    const rules = await db.query("SELECT count(*) n FROM availability_rules").get();
    expect(rules).toMatchObject({ n: 9 });
    const slot = await slotId(db, MON_9);
    const ctx = { db, now };
    const a = await identify(ctx, { contact: "a@example.test" });
    const b = await identify(ctx, { contact: "b@example.test" });
    const attempts = await Promise.allSettled([a, b].map(client => createBooking(ctx, client.id, { slotId: slot })));
    expect(attempts.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const failure = attempts.find(result => result.status === "rejected");
    expect(failure?.reason.code).toBe("SLOT_UNAVAILABLE");

    db.close();
    db = await openDb(file);
    refresh = rollingSchedule(db, "America/New_York", () => now);
    const count = () => db.query("SELECT count(*) n FROM slots").get() as Promise<{ n: number }>;
    await refresh();
    const before = await count();
    now = new Date(now.getTime() + 7 * 86_400_000);
    await refresh();
    expect((await count()).n).toBeGreaterThan(before.n);
    expect(await db.query("SELECT status FROM slots WHERE id = ?").get(slot)).toMatchObject({ status: "booked" });
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
