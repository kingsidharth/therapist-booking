import { DEFAULT_POLICIES, normalizeContact } from "@app/shared";
import { DateTime } from "luxon";
import { isEmpty, openDb, type DB } from "./db";
import { extendHorizon, getTimezone } from "./schedule";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const TZ = "America/New_York";

// ---------------------------------------------------------------------------
// Base data (therapist, weekly rules, time off, recurring blocks)
// ---------------------------------------------------------------------------

/** Weekly rules in minutes from local midnight. ISO weekday: Mon=1 … Sun=7 (off). */
const RULES: Array<[number, number, number]> = [
  [1, 9 * 60, 12 * 60], [1, 13 * 60, 17 * 60],
  [2, 11 * 60, 14 * 60], [2, 15 * 60, 19 * 60],
  [3, 9 * 60, 13 * 60],
  [4, 11 * 60, 14 * 60], [4, 15 * 60, 19 * 60],
  [5, 9 * 60, 14 * 60],
  [6, 10 * 60, 13 * 60],
];

export function seedBase(db: DB): void {
  if (!isEmpty(db)) return;
  db.query(
    `INSERT INTO therapist (id, name, credentials, bio, specialties_json, timezone, location, policies_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "th_maya",
    "Dr. Maya Rao",
    "PhD, Licensed Clinical Psychologist",
    "Dr. Rao helps adults untangle anxiety, navigate big life changes, and strengthen their relationships using a warm, practical blend of CBT and mindfulness. She has been in private practice for over twelve years and sees clients via telehealth and in her Brooklyn office.",
    JSON.stringify(["Anxiety", "CBT", "Life transitions", "Couples"]),
    TZ,
    "Telehealth & Brooklyn, NY",
    JSON.stringify(DEFAULT_POLICIES),
  );
  const rule = db.prepare("INSERT INTO availability_rules (weekday, start_minute, end_minute) VALUES (?, ?, ?)");
  for (const r of RULES) rule.run(...r);
  db.query("INSERT INTO recurring_blocks (weekday, start_minute, reason) VALUES (3, 720, 'Clinical supervision')").run();
  const off = db.prepare("INSERT INTO time_off (id, start_date, end_date, reason) VALUES (?, ?, ?, ?)");
  off.run("to_thanksgiving", "2026-11-26", "2026-11-27", "Thanksgiving");
  off.run("to_winter", "2026-12-24", "2027-01-01", "Winter break");
}

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

function wipe(db: DB) {
  for (const t of [
    "booking_events", "bookings", "slots", "clients", "time_off", "recurring_blocks", "availability_rules", "therapist",
  ]) db.exec(`DELETE FROM ${t}`);
  db.exec("DELETE FROM sqlite_sequence");
}

/** Wipe everything and rebuild a realistic dataset relative to `now`. */
export function seedDemo(db: DB, now: Date): SeedSummary {
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
  const run = db.transaction(() => {
    wipe(db);
    seedBase(db);
    extendHorizon(db, now, { pastDays: 21 });
    const tz = getTimezone(db);

    // ---- clients ----
    const insClient = db.prepare(
      "INSERT INTO clients (id, contact, contact_type, name, created_at) VALUES (?, ?, ?, ?, ?)",
    );
    const clientIds: string[] = [];
    PEOPLE.forEach(([name, raw], i) => {
      const n = normalizeContact(raw)!;
      const id = `cli_seed${String(i + 1).padStart(2, "0")}`;
      clientIds.push(id);
      insClient.run(id, n.contact, n.contactType, name, new Date(nowMs - (30 + rnd() * 150) * DAY).toISOString());
    });

    // ---- slots ----
    const slots: SlotRec[] = (
      db.query("SELECT id, start_at, status FROM slots ORDER BY start_at").all() as {
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
    const event = (type: string, bookingId: string | null, slotId: string | null, fromSlotId: string | null, clientId: string | null, actor: string, atMs: number) =>
      insEvent.run(`ev_seed${String(++evN).padStart(4, "0")}`, type, bookingId, slotId, fromSlotId, clientId, actor, new Date(atMs).toISOString());
    for (const s of shuffle(adminCandidates).slice(0, 3)) {
      setStatus.run("blocked", "Admin", s.id);
      s.status = "blocked";
      event("slot_blocked", null, s.id, null, null, "therapist", nowMs - (1 + rnd() * 5) * DAY);
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

    const book = (slot: SlotRec, clientId: string, adhoc: boolean, createdOverride?: number) => {
      const createdMs =
        createdOverride ??
        Math.min(slot.startMs - (2 + rnd() * 12) * DAY, nowMs - (1 + rnd() * 47) * HOUR);
      const id = `bk_seed${String(++bkN).padStart(4, "0")}`;
      const notes = rnd() < 0.15 ? pick(NOTES) : null;
      const c = new Date(createdMs).toISOString();
      insBooking.run(id, slot.id, clientId, "confirmed", notes, 0, c, c, null, null);
      setStatus.run("booked", null, slot.id);
      slot.status = "booked";
      event("booked", id, slot.id, null, clientId, "client", createdMs);
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
      book(s, p.clientId, false);
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
        book(s, cid, true);
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
      delEv.run(bk.id);
      unbook.run(bk.id);
      setStatus.run("open", null, bk.slot.id);
      bk.slot.status = "open";
      upcoming.set(bk.clientId, (upcoming.get(bk.clientId) ?? 1) - 1);
      made.splice(made.indexOf(bk), 1);
    }

    // Cancelled bookings (slot stays open): 8 past, 3 future.
    const openPast = shuffle(slots.filter((s) => s.status === "open" && s.startMs < nowMs - DAY));
    const openFuture = shuffle(slots.filter((s) => s.status === "open" && s.startMs > nowMs + 2 * DAY));
    const cancelOne = (s: SlotRec, byTherapist: boolean) => {
      const cid = pick(clientIds);
      const id = `bk_seed${String(++bkN).padStart(4, "0")}`;
      const createdMs = Math.min(s.startMs - (3 + rnd() * 10) * DAY, nowMs - 2 * DAY);
      const cancelMs = Math.min(s.startMs - (1 + rnd() * 3) * DAY, nowMs - HOUR);
      const reason = pick(CANCEL_REASONS);
      insBooking.run(id, s.id, cid, "cancelled", null, 0, new Date(createdMs).toISOString(), new Date(cancelMs).toISOString(), new Date(cancelMs).toISOString(), reason);
      event("booked", id, s.id, null, cid, "client", createdMs);
      event("cancelled", id, s.id, null, cid, byTherapist ? "therapist" : "client", cancelMs);
      event("slot_released", null, s.id, null, cid, "system", cancelMs);
    };
    openPast.slice(0, 8).forEach((s, i) => cancelOne(s, i === 0));
    openFuture.slice(0, 3).forEach((s) => cancelOne(s, false));

    // Rescheduled bookings (from-slot is now open): 4 future ad-hoc, 2 past; one "today".
    const updReschedule = db.prepare("UPDATE bookings SET reschedule_count = ?, updated_at = ? WHERE id = ?");
    const reschedPool = shuffle(made.filter((m) => m.adhoc));
    const futureResched = reschedPool.filter((m) => m.slot.startMs > nowMs + 3 * DAY).slice(0, 4);
    const pastResched = reschedPool.filter((m) => m.slot.startMs < nowMs - 2 * DAY).slice(0, 2);
    const fromPool = shuffle(slots.filter((s) => s.status === "open"));
    [...futureResched, ...pastResched].forEach((bk, i) => {
      const from = fromPool.find((s) => s.id !== bk.slot.id && Math.abs(s.startMs - bk.slot.startMs) > HOUR);
      if (!from) return;
      const atMs = i === 0 ? nowMs - 40 * 60_000 : Math.min(bk.createdMs + (1 + rnd() * 20) * HOUR, nowMs - 2 * HOUR);
      const at = Math.max(atMs, bk.createdMs + 60_000);
      updReschedule.run(i === 1 ? 2 : 1, new Date(at).toISOString(), bk.id);
      event("rescheduled", bk.id, bk.slot.id, from.id, bk.clientId, "client", at);
    });

    // A couple of events from "today" (fresh bookings).
    const fresh = shuffle(made.filter((m) => m.adhoc && m.slot.startMs > nowMs + 2 * DAY && !futureResched.includes(m))).slice(0, 3);
    const freshAt = [18 * 60_000, 95 * 60_000, 4 * HOUR];
    fresh.forEach((bk, i) => {
      const at = new Date(nowMs - freshAt[i]!).toISOString();
      db.query("UPDATE bookings SET created_at = ?, updated_at = ? WHERE id = ?").run(at, at, bk.id);
      db.query("UPDATE booking_events SET at = ? WHERE booking_id = ? AND type = 'booked'").run(at, bk.id);
    });
  });
  run();
  return summarize(db);
}

export function summarize(db: DB): SeedSummary {
  const slots: Record<string, number> = {};
  for (const r of db.query("SELECT status, COUNT(*) n FROM slots GROUP BY status").all() as { status: string; n: number }[]) {
    slots[r.status] = r.n;
  }
  const c = (sql: string) => (db.query(sql).get() as { n: number }).n;
  return {
    clients: c("SELECT COUNT(*) n FROM clients"),
    slots,
    bookings: {
      confirmed: c("SELECT COUNT(*) n FROM bookings WHERE status='confirmed'"),
      cancelled: c("SELECT COUNT(*) n FROM bookings WHERE status='cancelled'"),
      rescheduled: c("SELECT COUNT(*) n FROM bookings WHERE reschedule_count > 0"),
    },
    events: c("SELECT COUNT(*) n FROM booking_events"),
  };
}

if (import.meta.main) {
  const dbPath = process.env.DB_PATH ?? new URL("../data/app.sqlite", import.meta.url).pathname;
  const db = openDb(dbPath);
  const summary = seedDemo(db, new Date());
  console.log(`[seed] ${dbPath}`);
  console.log(JSON.stringify(summary, null, 2));
}
