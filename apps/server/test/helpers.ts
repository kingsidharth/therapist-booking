import { createApp } from "../src/app";
import { openDb, type DB } from "../src/db";
import { extendHorizon } from "../src/schedule";
import { seedBase } from "../src/seed";
import * as svc from "../src/service";
import { AppError } from "../src/errors";

/** Tue 2026-11-24 10:00 America/New_York. */
export const T0 = new Date("2026-11-24T15:00:00.000Z");

export function setup(now: Date = T0) {
  const db = openDb(":memory:");
  seedBase(db);
  extendHorizon(db, now);
  const clock = { now: new Date(now) };
  const ctx = (): svc.Ctx => ({ db, now: new Date(clock.now) });
  const app = createApp({ db, now: () => new Date(clock.now) });
  const client = (contact: string, name?: string) => svc.identify(ctx(), { contact, name });
  const advance = (ms: number) => (clock.now = new Date(clock.now.getTime() + ms));
  return { db, clock, ctx, app, client, advance };
}

/** Slot id for a UTC start instant, asserting it exists. */
export function slotId(db: DB, startIso: string): string {
  const r = db.query("SELECT id FROM slots WHERE start_at = ?").get(startIso) as { id: string } | null;
  if (!r) throw new Error("no slot at " + startIso);
  return r.id;
}

export function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
  return undefined;
}

// Wed 2026-11-25 ET (EST = UTC-5): 9:00 ET = 14:00Z (23h after T0)
export const WED_9 = "2026-11-25T14:00:00.000Z";
export const WED_10 = "2026-11-25T15:00:00.000Z";
export const WED_11 = "2026-11-25T16:00:00.000Z";
export const WED_12 = "2026-11-25T17:00:00.000Z"; // supervision (blocked)
// Mon 2026-11-30
export const MON_9 = "2026-11-30T14:00:00.000Z";
export const MON_10 = "2026-11-30T15:00:00.000Z";
export const MON_11 = "2026-11-30T16:00:00.000Z";
export const MON_13 = "2026-11-30T18:00:00.000Z";
export const MON_14 = "2026-11-30T19:00:00.000Z";
// Tue 2026-12-01
export const TUE_11 = "2026-12-01T16:00:00.000Z";
