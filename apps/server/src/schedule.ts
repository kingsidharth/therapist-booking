import { DEFAULT_POLICIES, type BookingPolicies } from "@app/shared";
import { DateTime } from "luxon";
import type { InStatement } from "@libsql/client";
import type { DB } from "./db";

export interface RuleRow {
  weekday: number;
  start_minute: number;
  end_minute: number;
}

export function slotIdFor(startIso: string): string {
  // sl_20261125T1400
  return "sl_" + startIso.replace(/[-:]/g, "").slice(0, 13);
}

export async function getTimezone(db: DB): Promise<string> {
  const row = await db.query("SELECT timezone FROM therapist LIMIT 1").get() as { timezone: string } | null;
  return row?.timezone ?? "America/New_York";
}

export async function getPolicies(db: DB): Promise<BookingPolicies> {
  const row = await db.query("SELECT policies_json FROM therapist LIMIT 1").get() as
    | { policies_json: string }
    | null;
  return row ? { ...DEFAULT_POLICIES, ...JSON.parse(row.policies_json) } : DEFAULT_POLICIES;
}

/**
 * Idempotently materialise slots from the weekly rules for local dates
 * [today - pastDays, today + horizonDays] in the therapist's timezone.
 * Local wall-clock times are converted to UTC per-slot, so DST is handled.
 * Returns the number of newly inserted slots.
 */
export async function extendHorizon(db: DB, now: Date, opts: { pastDays?: number } = {}): Promise<number> {
  const tz = await getTimezone(db);
  const policies = await getPolicies(db);
  const rules = await db.query("SELECT weekday, start_minute, end_minute FROM availability_rules").all() as RuleRow[];
  const blocks = await db.query("SELECT weekday, start_minute, reason FROM recurring_blocks").all() as {
    weekday: number;
    start_minute: number;
    reason: string;
  }[];
  const timeOff = await db.query("SELECT start_date, end_date FROM time_off").all() as {
    start_date: string;
    end_date: string;
  }[];

  const today = DateTime.fromJSDate(now, { zone: tz }).startOf("day");
  const first = today.minus({ days: opts.pastDays ?? 0 });
  const last = today.plus({ days: policies.horizonDays });

  const sql = `INSERT OR IGNORE INTO slots (id, start_at, end_at, status, block_reason) VALUES (?, ?, ?, ?, ?)`;
  const statements: InStatement[] = [];
  for (let d = first; d <= last; d = d.plus({ days: 1 })) {
    const date = d.toISODate()!;
    if (timeOff.some((t) => date >= t.start_date && date <= t.end_date)) continue;
    for (const rule of rules) {
      if (rule.weekday !== d.weekday) continue;
      for (let m = rule.start_minute; m + policies.sessionMinutes <= rule.end_minute; m += 60) {
        const start = d.set({ hour: Math.floor(m / 60), minute: m % 60 }).toUTC();
        const end = start.plus({ minutes: policies.sessionMinutes });
        const block = blocks.find((b) => b.weekday === d.weekday && b.start_minute === m);
        const startIso = start.toISO()!;
        statements.push({ sql, args: [
          slotIdFor(startIso),
          startIso,
          end.toISO()!,
          block ? "blocked" : "open",
          block ? block.reason : null,
        ] });
      }
    }
  }
  const results = statements.length ? await db.batch(statements) : [];
  return results.reduce((sum, row) => sum + row.rowsAffected, 0);
}
