import { DEFAULT_POLICIES, normalizeContact } from "@app/shared";
import { DateTime } from "luxon";
import { isEmpty, type DB } from "./db";
import { extendHorizon, getTimezone } from "./schedule";

import { seedBase } from "./practice";
export { seedBase };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// ---------------------------------------------------------------------------
// Deterministic PRNG
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Demo data
// ---------------------------------------------------------------------------

const PEOPLE: Array<[string | null, string]> = [
  ["Priya Nair", "priya.nair@gmail.com"],
  ["Marcus Johnson", "+1 (917) 555-0142"],
  ["Elena Rodriguez", "elena.rodriguez@outlook.com"],
  ["Daniel Kim", "dkim.design@gmail.com"],
  ["Aisha Okafor", "aisha.okafor@icloud.com"],
  ["Tom Whitfield", "+1 646 555 0188"],
  ["Sofia Marchetti", "sofia.marchetti@gmail.com"],
  ["James O'Connor", "james.oconnor@yahoo.com"],
  ["Mei Lin Chen", "meilin.chen@gmail.com"],
  ["Jordan Ellis", "+1 (347) 555-0119"],
  ["Hannah Goldberg", "hannah.goldberg@gmail.com"],
  ["Rohan Mehta", "rohan.mehta@proton.me"],
  ["Camille Dubois", "camille.dubois@gmail.com"],
  ["Andre Williams", "+1 718-555-0163"],
  ["Nina Petrova", "nina.petrova@gmail.com"],
  ["Samuel Adeyemi", "sam.adeyemi@hey.com"],
  ["Grace Thompson", "+1 (929) 555-0107"],
  ["Luis Hernandez", "luis.hernandez@gmail.com"],
  ["Yuki Tanaka", "yuki.tanaka@icloud.com"],
  ["Fatima Al-Sayed", "fatima.alsayed@gmail.com"],
  ["Ben Cohen", "+1 (212) 555-0176"],
  ["Olivia Brooks", "olivia.brooks@outlook.com"],
  ["Kwame Mensah", "kwame.mensah@gmail.com"],
  ["Isabelle Laurent", "isabelle.laurent@gmail.com"],
  ["Ravi Shankar", "+1 (201) 555-0134"],
  ["Chloe Anderson", "chloe.anderson@yahoo.com"],
  [null, "jt.running@gmail.com"],
  [null, "+1 (917) 555-0191"],
  [null, "mbarnes@gmail.com"],
  ["Zoe Park", "zoe.park@gmail.com"],
];

const NOTES = [
  "Would like to talk through some work stress.",
  "Following up on last session's breathing exercises.",
  "Preparing for a job change — nervous about it.",
  "Couples session with my partner joining.",
  "Having trouble sleeping lately.",
  "First time trying telehealth.",
  "Want to revisit the thought-record worksheet.",
  "Family visiting next month; anxious about it.",
];
const CANCEL_REASONS = [
  "Feeling under the weather",
  "Work conflict came up",
  "Travel plans changed",
  "Childcare fell through",
  null,
];

interface SlotRec {
  id: string;
  startMs: number;
  status: string;
  local: DateTime;
}

export interface SeedSummary {
  clients: number;
  slots: Record<string, number>;
  bookings: { confirmed: number; cancelled: number; rescheduled: number };
  events: number;
}

async function wipe(db: DB) {
  for (const t of [
    "booking_events", "bookings", "slots", "clients", "time_off", "recurring_blocks", "availability_rules", "therapist",
  ]) await db.exec(`DELETE FROM ${t}`);
  await db.exec("DELETE FROM sqlite_sequence");
}

/** Wipe everything and rebuild a realistic dataset relative to `now`. */
export async function seedDemo(db: DB, now: Date, onlyIfEmpty = false): Promise<SeedSummary> {
  const rnd = mulberry32(20261124);
  const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)]!;
  const shuffle = <T>(a: T[]): T[] => {
    const r = [...a];
    for (let i = r.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [r[i], r[j]] = [r[j]!, r[i]!];
    }
    return r;
  };
  const nowMs = now.getTime();
  await db.write(async (db) => {
    if (onlyIfEmpty && !(await isEmpty(db))) return;
    await wipe(db);
    await seedBase(db);
    await extendHorizon(db, now, { pastDays: 21 });
    const tz = await getTimezone(db);

    // ---- clients ----
    const insClient = db.prepare(
      "INSERT INTO clients (id, contact, contact_type, name, created_at) VALUES (?, ?, ?, ?, ?)",
    );
    const clientIds: string[] = [];
    for (const [i, [name, raw]] of PEOPLE.entries()) {
      const n = normalizeContact(raw)!;
      const id = `cli_seed${String(i + 1).padStart(2, "0")}`;
      clientIds.push(id);
      await insClient.run(id, n.contact, n.contactType, name, new Date(nowMs - (30 + rnd() * 150) * DAY).toISOString());
    }

    // ---- slots ----
    const slots: SlotRec[] = (
      await db.query("SELECT id, start_at, status FROM slots ORDER BY start_at").all() as {
        id: string;
        start_at: string;
        status: string;
      }[]
    ).map((r) => ({
      id: r.id,
      startMs: Date.parse(r.start_at),
      status: r.status,
      local: DateTime.fromISO(r.start_at, { zone: "utc" }).setZone(tz),
    }));
    const setStatus = db.prepare("UPDATE slots SET status = ?, block_reason = ?, version = version + 1 WHERE id = ?");

    // Admin blocks: 3 random future open slots in the next ~3 weeks.
    const adminCandidates = slots.filter(
      (s) => s.status === "open" && s.startMs > nowMs + 2 * DAY && s.startMs < nowMs + 21 * DAY,
    );
    const insEvent = db.prepare(
      `INSERT INTO booking_events (id, type, booking_id, slot_id, from_slot_id, client_id, actor, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let evN = 0;
    const event = async (type: string, bookingId: string | null, slotId: string | null, fromSlotId: string | null, clientId: string | null, actor: string, atMs: number) =>
      await insEvent.run(`ev_seed${String(++evN).padStart(4, "0")}`, type, bookingId, slotId, fromSlotId, clientId, actor, new Date(atMs).toISOString());
    for (const s of shuffle(adminCandidates).slice(0, 3)) {
      await setStatus.run("blocked", "Admin", s.id);
      s.status = "blocked";
      await event("slot_blocked", null, s.id, null, null, "therapist", nowMs - (1 + rnd() * 5) * DAY);
    }

    // ---- bookings ----
    const insBooking = db.prepare(
      `INSERT INTO bookings (id, slot_id, client_id, status, notes, reschedule_count, created_at, updated_at, cancelled_at, cancel_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let bkN = 0;
    const upcoming = new Map<string, number>();
    interface Bk { id: string; slot: SlotRec; clientId: string; createdMs: number; adhoc: boolean }
    const made: Bk[] = [];

    const book = async (slot: SlotRec, clientId: string, adhoc: boolean, createdOverride?: number) => {
      const createdMs =
        createdOverride ??
        Math.min(slot.startMs - (2 + rnd() * 12) * DAY, nowMs - (1 + rnd() * 47) * HOUR);
      const id = `bk_seed${String(++bkN).padStart(4, "0")}`;
      const notes = rnd() < 0.15 ? pick(NOTES) : null;
      const c = new Date(createdMs).toISOString();
      await insBooking.run(id, slot.id, clientId, "confirmed", notes, 0, c, c, null, null);
      await setStatus.run("booked", null, slot.id);
      slot.status = "booked";
      await event("booked", id, slot.id, null, clientId, "client", createdMs);
      if (slot.startMs >= nowMs) upcoming.set(clientId, (upcoming.get(clientId) ?? 0) + 1);
      const rec = { id, slot, clientId, createdMs, adhoc };
      made.push(rec);
      return rec;
    };

    // Weekly / biweekly patterns on the weekly template (excluding the supervision block).
    const patterns = shuffle(
      [...new Set(slots.filter((s) => s.status === "open").map((s) => `${s.local.weekday}-${s.local.hour}`))],
    );
    const recurring = new Map<string, { clientId: string; biweekly: boolean; parity: number }>();
    clientIds.slice(0, 22).forEach((clientId, i) => {
      const key = patterns[i];
      if (key) recurring.set(key, { clientId, biweekly: i >= 16, parity: i % 2 });
    });
    for (const s of slots) {
      if (s.status !== "open") continue;
      const p = recurring.get(`${s.local.weekday}-${s.local.hour}`);
      if (!p) continue;
      const week = Math.floor(Date.parse(s.local.toISODate()! + "T00:00:00Z") / (7 * DAY));
      if (p.biweekly && week % 2 !== p.parity) continue;
      if (s.startMs > nowMs + 14 * DAY) continue; // recurring clients are booked ~2 weeks ahead
      if (rnd() < 0.1) continue; // skipped week
      await book(s, p.clientId, false);
    }

    // Ad-hoc fill with density that decays into the future.
    const target = (s: SlotRec) => {
      const d = (s.startMs - nowMs) / DAY;
      return s.startMs < nowMs ? 0.85 : d < 7 ? 0.85 : d < 14 ? 0.65 : d < 28 ? 0.4 : 0.2;
    };
    const bucket = (s: SlotRec) => {
      const d = (s.startMs - nowMs) / DAY;
      return s.startMs < nowMs ? "past" : d < 7 ? "w1" : d < 14 ? "w2" : d < 28 ? "w34" : "far";
    };
    const tot: Record<string, number> = {};
    const booked: Record<string, number> = {};
    for (const s of slots) {
      if (s.status === "blocked") continue;
      const b = bucket(s);
      tot[b] = (tot[b] ?? 0) + 1;
      if (s.status === "booked") booked[b] = (booked[b] ?? 0) + 1;
    }
    for (const s of slots) {
      if (s.status !== "open") continue;
      const b = bucket(s);
      const N = tot[b] ?? 1;
      const R = booked[b] ?? 0;
      const p = Math.max(0, (target(s) * N - R) / Math.max(1, N - R));
      if (rnd() >= p) continue;
      for (let tries = 0; tries < 8; tries++) {
        const cid = pick(clientIds);
        if (s.startMs >= nowMs && (upcoming.get(cid) ?? 0) >= DEFAULT_POLICIES.maxActiveBookings) continue;
        await book(s, cid, true);
        break;
      }
    }

    // Guarantee open availability in the next ~10 days beyond the 12h lead.
    const lo = nowMs + DEFAULT_POLICIES.minLeadHours * HOUR;
    const hi = nowMs + 10 * DAY;
    const unbook = db.prepare("DELETE FROM bookings WHERE id = ?");
    const delEv = db.prepare("DELETE FROM booking_events WHERE booking_id = ?");
    const windowOpen = () => slots.filter((s) => s.status === "open" && s.startMs >= lo && s.startMs < hi).length;
    for (const bk of shuffle(made.filter((m) => m.adhoc && m.slot.startMs >= lo && m.slot.startMs < hi))) {
      if (windowOpen() >= 7) break;
      await delEv.run(bk.id);
      await unbook.run(bk.id);
      await setStatus.run("open", null, bk.slot.id);
      bk.slot.status = "open";
      upcoming.set(bk.clientId, (upcoming.get(bk.clientId) ?? 1) - 1);
      made.splice(made.indexOf(bk), 1);
    }

    // Cancelled bookings (slot stays open): 8 past, 3 future.
    const openPast = shuffle(slots.filter((s) => s.status === "open" && s.startMs < nowMs - DAY));
    const openFuture = shuffle(slots.filter((s) => s.status === "open" && s.startMs > nowMs + 2 * DAY));
    const cancelOne = async (s: SlotRec, byTherapist: boolean) => {
      const cid = pick(clientIds);
      const id = `bk_seed${String(++bkN).padStart(4, "0")}`;
      const createdMs = Math.min(s.startMs - (3 + rnd() * 10) * DAY, nowMs - 2 * DAY);
      const cancelMs = Math.min(s.startMs - (1 + rnd() * 3) * DAY, nowMs - HOUR);
      const reason = pick(CANCEL_REASONS);
      await insBooking.run(id, s.id, cid, "cancelled", null, 0, new Date(createdMs).toISOString(), new Date(cancelMs).toISOString(), new Date(cancelMs).toISOString(), reason);
      await event("booked", id, s.id, null, cid, "client", createdMs);
      await event("cancelled", id, s.id, null, cid, byTherapist ? "therapist" : "client", cancelMs);
      await event("slot_released", null, s.id, null, cid, "system", cancelMs);
    };
    for (const [i,s] of openPast.slice(0, 8).entries()) await cancelOne(s, i === 0);
    for (const s of openFuture.slice(0, 3)) await cancelOne(s, false);

    // Rescheduled bookings (from-slot is now open): 4 future ad-hoc, 2 past; one "today".
    const updReschedule = db.prepare("UPDATE bookings SET reschedule_count = ?, updated_at = ? WHERE id = ?");
    const reschedPool = shuffle(made.filter((m) => m.adhoc));
    const futureResched = reschedPool.filter((m) => m.slot.startMs > nowMs + 3 * DAY).slice(0, 4);
    const pastResched = reschedPool.filter((m) => m.slot.startMs < nowMs - 2 * DAY).slice(0, 2);
    const fromPool = shuffle(slots.filter((s) => s.status === "open"));
    for (const [i,bk] of [...futureResched, ...pastResched].entries()) {
      const from = fromPool.find((s) => s.id !== bk.slot.id && Math.abs(s.startMs - bk.slot.startMs) > HOUR);
      if (!from) continue;
      const atMs = i === 0 ? nowMs - 40 * 60_000 : Math.min(bk.createdMs + (1 + rnd() * 20) * HOUR, nowMs - 2 * HOUR);
      const at = Math.max(atMs, bk.createdMs + 60_000);
      await updReschedule.run(i === 1 ? 2 : 1, new Date(at).toISOString(), bk.id);
      await event("rescheduled", bk.id, bk.slot.id, from.id, bk.clientId, "client", at);
    }

    // A couple of events from "today" (fresh bookings).
    const fresh = shuffle(made.filter((m) => m.adhoc && m.slot.startMs > nowMs + 2 * DAY && !futureResched.includes(m))).slice(0, 3);
    const freshAt = [18 * 60_000, 95 * 60_000, 4 * HOUR];
    for (const [i,bk] of fresh.entries()) {
      const at = new Date(nowMs - freshAt[i]!).toISOString();
      await db.query("UPDATE bookings SET created_at = ?, updated_at = ? WHERE id = ?").run(at, at, bk.id);
      await db.query("UPDATE booking_events SET at = ? WHERE booking_id = ? AND type = 'booked'").run(at, bk.id);
    }
  });

  return await summarize(db);
}

export async function summarize(db: DB): Promise<SeedSummary> {
  const slots: Record<string, number> = {};
  for (const r of await db.query("SELECT status, COUNT(*) n FROM slots GROUP BY status").all() as { status: string; n: number }[]) {
    slots[r.status] = r.n;
  }
  const c = async (sql: string) => (await db.query(sql).get() as { n: number }).n;
  return {
    clients: await c("SELECT COUNT(*) n FROM clients"),
    slots,
    bookings: {
      confirmed: await c("SELECT COUNT(*) n FROM bookings WHERE status='confirmed'"),
      cancelled: await c("SELECT COUNT(*) n FROM bookings WHERE status='cancelled'"),
      rescheduled: await c("SELECT COUNT(*) n FROM bookings WHERE reschedule_count > 0"),
    },
    events: await c("SELECT COUNT(*) n FROM booking_events"),
  };
}

if (import.meta.main) {
  const dbPath = process.env.DB_PATH ?? new URL("../data/app.sqlite", import.meta.url).pathname;
  const { openDb } = await import("./local-db");
  const db = await openDb(dbPath);
  const summary = await seedDemo(db, new Date());
  console.log(`[seed] ${dbPath}`);
  console.log(JSON.stringify(summary, null, 2));
}
