/**
 * Booking rules. Every function takes a context `{ db, now }` — the clock is
 * injected so rules are deterministic under test.
 *
 * Inventory invariants are enforced with conditional UPDATEs (check `changes`)
 * inside BEGIN IMMEDIATE transactions, backed by the partial unique index on
 * bookings(slot_id) WHERE status = 'confirmed'.
 */
import {
  normalizeContact,
  type AdminSlot,
  type Booking,
  type BookingEvent,
  type BookingEventType,
  type BookingPolicies,
  type Client,
  type ContactType,
  type Hold,
  type PublicSlot,
  type ScheduleStats,
  type SlotStatus,
  type Therapist,
  type TimeOff,
} from "@app/shared";
import type { DB } from "./db";
import { fail } from "./errors";
import { getPolicies } from "./schedule";

export interface Ctx {
  db: DB;
  now: Date;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const MAX_RANGE_DAYS = 62;

// ---------------------------------------------------------------------------
// Rows & mappers
// ---------------------------------------------------------------------------

interface SlotRow {
  id: string;
  start_at: string;
  end_at: string;
  status: SlotStatus;
  held_by_client_id: string | null;
  hold_expires_at: string | null;
  prev_hold_client_id: string | null;
  block_reason: string | null;
  version: number;
}

interface ClientRow {
  id: string;
  contact: string;
  contact_type: ContactType;
  name: string | null;
  created_at: string;
}

interface BookingRow {
  id: string;
  slot_id: string;
  client_id: string;
  status: "confirmed" | "cancelled";
  notes: string | null;
  reschedule_count: number;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
  cancel_reason: string | null;
}

type BookingJoin = BookingRow & { start_at: string; end_at: string };

const toClient = (r: ClientRow): Client => ({
  id: r.id,
  contact: r.contact,
  contactType: r.contact_type,
  name: r.name,
  createdAt: r.created_at,
});

const iso = (d: Date) => d.toISOString();
const uid = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

/** BEGIN IMMEDIATE transaction; throwing rolls back. */
function tx<T>(ctx: Ctx, fn: (ctx: Ctx) => Promise<T>): Promise<T> {
  return ctx.db.write(db => fn({ ...ctx, db }));
}

// ---------------------------------------------------------------------------
// Holds expiry
// ---------------------------------------------------------------------------

/** Turn expired holds back into open inventory. Returns how many were released. */
export async function sweepExpiredHolds(ctx: Ctx): Promise<number> {
  const res = await ctx.db
    .query(
      `UPDATE slots SET prev_hold_client_id = held_by_client_id, status = 'open',
         held_by_client_id = NULL, hold_expires_at = NULL, version = version + 1
       WHERE status = 'held' AND hold_expires_at <= ?`,
    )
    .run(iso(ctx.now));
  return res.changes;
}

// ---------------------------------------------------------------------------
// Therapist
// ---------------------------------------------------------------------------

export async function getTherapist(ctx: Ctx): Promise<{ therapist: Therapist; timeOff: TimeOff[] }> {
  const r = await ctx.db.query("SELECT * FROM therapist LIMIT 1").get() as {
    id: string;
    name: string;
    credentials: string;
    bio: string;
    specialties_json: string;
    timezone: string;
    location: string;
  } | null;
  if (!r) fail("NOT_FOUND", "No therapist has been set up yet.");
  const timeOff = (
    await ctx.db.query("SELECT id, start_date, end_date, reason FROM time_off ORDER BY start_date").all() as {
      id: string;
      start_date: string;
      end_date: string;
      reason: string;
    }[]
  ).map((t) => ({ id: t.id, startDate: t.start_date, endDate: t.end_date, reason: t.reason }));
  return {
    therapist: {
      id: r.id,
      name: r.name,
      credentials: r.credentials,
      bio: r.bio,
      specialties: JSON.parse(r.specialties_json) as string[],
      timezone: r.timezone,
      location: r.location,
      policies: await getPolicies(ctx.db),
    },
    timeOff,
  };
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

export async function identify(ctx: Ctx, input: { contact: string; name?: string | undefined }): Promise<Client> {
  const norm = normalizeContact(input.contact);
  if (!norm) fail("VALIDATION", "Enter a valid email or phone number.");
  return tx(ctx, async (ctx) => {
    const existing = await ctx.db.query("SELECT * FROM clients WHERE contact = ?").get(norm.contact) as ClientRow | null;
    if (existing) {
      if (input.name && input.name !== existing.name) {
        await ctx.db.query("UPDATE clients SET name = ? WHERE id = ?").run(input.name, existing.id);
        existing.name = input.name;
      }
      return toClient(existing);
    }
    const row: ClientRow = {
      id: uid("cli"),
      contact: norm.contact,
      contact_type: norm.contactType,
      name: input.name ?? null,
      created_at: iso(ctx.now),
    };
    await ctx.db
      .query("INSERT INTO clients (id, contact, contact_type, name, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(row.id, row.contact, row.contact_type, row.name, row.created_at);
    return toClient(row);
  });
}

export async function requireClient(ctx: Ctx, clientId: string | undefined | null): Promise<Client> {
  const row = clientId
    ? (await ctx.db.query("SELECT * FROM clients WHERE id = ?").get(clientId) as ClientRow | null)
    : null;
  if (!row) fail("UNIDENTIFIED", "Please enter your email or phone number to continue.");
  return toClient(row);
}

export async function updateMe(ctx: Ctx, clientId: string, name: string): Promise<Client> {
  await ctx.db.query("UPDATE clients SET name = ? WHERE id = ?").run(name, clientId);
  return requireClient(ctx, clientId);
}

// ---------------------------------------------------------------------------
// Slots (public)
// ---------------------------------------------------------------------------

export function clampRange(from: string, to: string): { from: string; to: string } {
  const f = new Date(from);
  let t = new Date(to);
  if (!(f.getTime() < t.getTime())) fail("VALIDATION", "'from' must be earlier than 'to'.");
  const max = new Date(f.getTime() + MAX_RANGE_DAYS * DAY);
  if (t > max) t = max;
  return { from: iso(f), to: iso(t) };
}

export async function listPublicSlots(ctx: Ctx, from: string, to: string, clientId?: string | null): Promise<PublicSlot[]> {
  await sweepExpiredHolds(ctx);
  const range = clampRange(from, to);
  const policies = await getPolicies(ctx.db);
  const earliest = ctx.now.getTime() + policies.minLeadHours * HOUR;
  const rows = await ctx.db
    .query(
      `SELECT s.id, s.start_at, s.end_at, s.status, s.held_by_client_id,
         (SELECT b.client_id FROM bookings b WHERE b.slot_id = s.id AND b.status = 'confirmed') AS booked_by
       FROM slots s WHERE s.start_at >= ? AND s.start_at < ? ORDER BY s.start_at ASC`,
    )
    .all(range.from, range.to) as (SlotRow & { booked_by: string | null })[];
  return rows.map((r) => {
    let availability: PublicSlot["availability"] = "unavailable";
    if (clientId && r.status === "booked" && r.booked_by === clientId) availability = "yours";
    else if (clientId && r.status === "held" && r.held_by_client_id === clientId) availability = "held_by_you";
    else if (r.status === "open" && Date.parse(r.start_at) >= earliest) availability = "available";
    return { id: r.id, startAt: r.start_at, endAt: r.end_at, availability };
  });
}

// ---------------------------------------------------------------------------
// Slot helpers
// ---------------------------------------------------------------------------

async function getSlot(ctx: Ctx, slotId: string): Promise<SlotRow | null> {
  return await ctx.db.query("SELECT * FROM slots WHERE id = ?").get(slotId) as SlotRow | null;
}

/** Throws unless `slot` can be taken by `clientId` right now (open, or held by them). */
function assertTakeable(
  ctx: Ctx,
  slot: SlotRow | null,
  clientId: string,
  policies: BookingPolicies,
  opts: { explainExpiry: boolean },
): asserts slot is SlotRow {
  if (!slot) fail("NOT_FOUND", "That time slot doesn't exist.");
  const start = Date.parse(slot.start_at);
  if (start <= ctx.now.getTime()) fail("SLOT_UNAVAILABLE", "That time has already passed. Please pick another slot.");
  const mine = slot.status === "held" && slot.held_by_client_id === clientId;
  if (slot.status !== "open" && !mine) {
    if (opts.explainExpiry && slot.prev_hold_client_id === clientId && slot.status !== "blocked") {
      fail("HOLD_EXPIRED", "Your hold on that time expired and someone else took it. Please pick another slot.");
    }
    fail("SLOT_UNAVAILABLE", "Sorry — someone just booked that time. Please pick another slot.");
  }
  if (start < ctx.now.getTime() + policies.minLeadHours * HOUR) {
    fail(
      "TOO_SOON",
      `Appointments need at least ${policies.minLeadHours} hours' notice. Please pick a later time.`,
    );
  }
}

async function releaseOtherHolds(ctx: Ctx, clientId: string, exceptSlotId: string | null) {
  await ctx.db
    .query(
      `UPDATE slots SET status = 'open', held_by_client_id = NULL, hold_expires_at = NULL, version = version + 1
       WHERE status = 'held' AND held_by_client_id = ? AND id IS NOT ?`,
    )
    .run(clientId, exceptSlotId);
}

async function logEvent(
  ctx: Ctx,
  e: {
    type: BookingEventType;
    bookingId?: string | null;
    slotId?: string | null;
    fromSlotId?: string | null;
    clientId?: string | null;
    actor: "client" | "therapist" | "system";
  },
) {
  await ctx.db
    .query(
      `INSERT INTO booking_events (id, type, booking_id, slot_id, from_slot_id, client_id, actor, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      uid("ev"),
      e.type,
      e.bookingId ?? null,
      e.slotId ?? null,
      e.fromSlotId ?? null,
      e.clientId ?? null,
      e.actor,
      iso(ctx.now),
    );
}

// ---------------------------------------------------------------------------
// Holds
// ---------------------------------------------------------------------------

const toHold = (s: SlotRow): Hold => ({
  slotId: s.id,
  startAt: s.start_at,
  endAt: s.end_at,
  expiresAt: s.hold_expires_at!,
});

export async function createHold(ctx: Ctx, clientId: string, slotId: string): Promise<Hold> {
  const policies = await getPolicies(ctx.db);
  return tx(ctx, async (ctx) => {
    await sweepExpiredHolds(ctx);
    const slot = await getSlot(ctx, slotId);
    assertTakeable(ctx, slot, clientId, policies, { explainExpiry: false });
    const expires = iso(new Date(ctx.now.getTime() + policies.holdMinutes * 60_000));
    if (slot.status === "held") {
      // Re-holding your own slot just extends it.
      await ctx.db
        .query(
          `UPDATE slots SET hold_expires_at = ?, version = version + 1
           WHERE id = ? AND status = 'held' AND held_by_client_id = ?`,
        )
        .run(expires, slotId, clientId);
    } else {
      await releaseOtherHolds(ctx, clientId, slotId);
      const res = await ctx.db
        .query(
          `UPDATE slots SET status = 'held', held_by_client_id = ?, hold_expires_at = ?,
             prev_hold_client_id = CASE WHEN prev_hold_client_id = ? THEN NULL ELSE prev_hold_client_id END,
             version = version + 1
           WHERE id = ? AND status = 'open'`,
        )
        .run(clientId, expires, clientId, slotId);
      if (res.changes !== 1) fail("SLOT_UNAVAILABLE", "Sorry — someone just took that time. Please pick another slot.");
    }
    return toHold((await getSlot(ctx, slotId))!);
  });
}

export async function releaseHold(ctx: Ctx, clientId: string, slotId: string): Promise<void> {
  await ctx.db
    .query(
      `UPDATE slots SET status = 'open', held_by_client_id = NULL, hold_expires_at = NULL, version = version + 1
       WHERE id = ? AND status = 'held' AND held_by_client_id = ?`,
    )
    .run(slotId, clientId);
}

async function activeHold(ctx: Ctx, clientId: string): Promise<Hold | null> {
  const s = await ctx.db
    .query(
      `SELECT * FROM slots WHERE status = 'held' AND held_by_client_id = ? AND hold_expires_at > ?
       ORDER BY hold_expires_at DESC LIMIT 1`,
    )
    .get(clientId, iso(ctx.now)) as SlotRow | null;
  return s ? toHold(s) : null;
}

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------

function toBooking(ctx: Ctx, r: BookingJoin, policies: BookingPolicies): Booking {
  const start = Date.parse(r.start_at);
  const deadline = start - policies.changeCutoffHours * HOUR;
  return {
    id: r.id,
    status: r.status,
    slot: { id: r.slot_id, startAt: r.start_at, endAt: r.end_at },
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    cancelledAt: r.cancelled_at,
    cancelReason: r.cancel_reason,
    rescheduleCount: r.reschedule_count,
    canModify: r.status === "confirmed" && start > ctx.now.getTime() && ctx.now.getTime() <= deadline,
    modifyDeadline: iso(new Date(deadline)),
  };
}

async function getBookingRow(ctx: Ctx, id: string): Promise<BookingJoin | null> {
  return await ctx.db
    .query(
      `SELECT b.*, s.start_at, s.end_at FROM bookings b JOIN slots s ON s.id = b.slot_id WHERE b.id = ?`,
    )
    .get(id) as BookingJoin | null;
}

async function bookingDto(ctx: Ctx, id: string, policies: BookingPolicies): Promise<Booking> {
  return toBooking(ctx, (await getBookingRow(ctx, id))!, policies);
}

async function countActiveBookings(ctx: Ctx, clientId: string): Promise<number> {
  const r = await ctx.db
    .query(
      `SELECT COUNT(*) AS n FROM bookings b JOIN slots s ON s.id = b.slot_id
       WHERE b.client_id = ? AND b.status = 'confirmed' AND s.start_at >= ?`,
    )
    .get(clientId, iso(ctx.now)) as { n: number };
  return r.n;
}

/** Claim a slot for a booking: open, or held by this client. */
async function claimSlotForBooking(ctx: Ctx, slotId: string, clientId: string) {
  const res = await ctx.db
    .query(
      `UPDATE slots SET status = 'booked', held_by_client_id = NULL, hold_expires_at = NULL,
         prev_hold_client_id = NULL, version = version + 1
       WHERE id = ? AND (status = 'open' OR (status = 'held' AND held_by_client_id = ?))`,
    )
    .run(slotId, clientId);
  if (res.changes !== 1) fail("SLOT_UNAVAILABLE", "Sorry — someone just booked that time. Please pick another slot.");
}

export async function createBooking(
  ctx: Ctx,
  clientId: string,
  input: { slotId: string; notes?: string | undefined },
): Promise<Booking> {
  const policies = await getPolicies(ctx.db);
  const id = uid("bk");
  return tx(ctx, async (ctx) => {
    await sweepExpiredHolds(ctx);
    const slot = await getSlot(ctx, input.slotId);
    assertTakeable(ctx, slot, clientId, policies, { explainExpiry: true });
    if (await countActiveBookings(ctx, clientId) >= policies.maxActiveBookings) {
      fail(
        "LIMIT_REACHED",
        `You can have up to ${policies.maxActiveBookings} upcoming sessions. Cancel one to book another.`,
      );
    }
    await claimSlotForBooking(ctx, input.slotId, clientId);
    await releaseOtherHolds(ctx, clientId, null);
    const now = iso(ctx.now);
    await ctx.db
      .query(
        `INSERT INTO bookings (id, slot_id, client_id, status, notes, reschedule_count, created_at, updated_at)
         VALUES (?, ?, ?, 'confirmed', ?, 0, ?, ?)`,
      )
      .run(id, input.slotId, clientId, input.notes || null, now, now);
    await logEvent(ctx, { type: "booked", bookingId: id, slotId: input.slotId, clientId, actor: "client" });
    return bookingDto(ctx, id, policies);
  });
}

export async function rescheduleBooking(ctx: Ctx, clientId: string, bookingId: string, newSlotId: string): Promise<Booking> {
  const policies = await getPolicies(ctx.db);
  return tx(ctx, async (ctx) => {
    await sweepExpiredHolds(ctx);
    const booking = await getBookingRow(ctx, bookingId);
    if (!booking) fail("NOT_FOUND", "We couldn't find that booking.");
    if (booking.client_id !== clientId) fail("FORBIDDEN", "That booking belongs to someone else.");
    if (booking.status !== "confirmed") fail("INVALID_STATE", "This booking has already been cancelled.");
    const start = Date.parse(booking.start_at);
    if (start <= ctx.now.getTime() || start - policies.changeCutoffHours * HOUR < ctx.now.getTime()) {
      fail(
        "CUTOFF_PASSED",
        `Sessions can only be changed at least ${policies.changeCutoffHours} hours ahead. Please contact your therapist.`,
      );
    }
    if (newSlotId === booking.slot_id) fail("INVALID_STATE", "You're already booked at that time.");
    const slot = await getSlot(ctx, newSlotId);
    assertTakeable(ctx, slot, clientId, policies, { explainExpiry: true });
    await claimSlotForBooking(ctx, newSlotId, clientId);
    const freed = await ctx.db
      .query(
        `UPDATE slots SET status = 'open', version = version + 1 WHERE id = ? AND status = 'booked'`,
      )
      .run(booking.slot_id);
    if (freed.changes !== 1) fail("INVALID_STATE", "Couldn't release the original time. Please try again.");
    await ctx.db
      .query(
        `UPDATE bookings SET slot_id = ?, reschedule_count = reschedule_count + 1, updated_at = ?
         WHERE id = ? AND status = 'confirmed'`,
      )
      .run(newSlotId, iso(ctx.now), bookingId);
    await releaseOtherHolds(ctx, clientId, null);
    await logEvent(ctx, {
      type: "rescheduled",
      bookingId,
      slotId: newSlotId,
      fromSlotId: booking.slot_id,
      clientId,
      actor: "client",
    });
    return bookingDto(ctx, bookingId, policies);
  });
}

export async function cancelBooking(
  ctx: Ctx,
  actor: { kind: "client"; clientId: string } | { kind: "therapist" },
  bookingId: string,
  reason?: string,
): Promise<Booking> {
  const policies = await getPolicies(ctx.db);
  return tx(ctx, async (ctx) => {
    const booking = await getBookingRow(ctx, bookingId);
    if (!booking) fail("NOT_FOUND", "We couldn't find that booking.");
    if (actor.kind === "client" && booking.client_id !== actor.clientId) {
      fail("FORBIDDEN", "That booking belongs to someone else.");
    }
    if (booking.status !== "confirmed") fail("INVALID_STATE", "This booking has already been cancelled.");
    const start = Date.parse(booking.start_at);
    if (actor.kind === "client" && start - policies.changeCutoffHours * HOUR < ctx.now.getTime()) {
      fail(
        "CUTOFF_PASSED",
        `Sessions can only be cancelled at least ${policies.changeCutoffHours} hours ahead. Please contact your therapist.`,
      );
    }
    const now = iso(ctx.now);
    await ctx.db
      .query(
        `UPDATE bookings SET status = 'cancelled', cancelled_at = ?, cancel_reason = ?, updated_at = ?
         WHERE id = ? AND status = 'confirmed'`,
      )
      .run(now, reason || null, now, bookingId);
    const actorName = actor.kind === "client" ? "client" : "therapist";
    await logEvent(ctx, {
      type: "cancelled",
      bookingId,
      slotId: booking.slot_id,
      clientId: booking.client_id,
      actor: actorName,
    });
    if (start > ctx.now.getTime()) {
      const freed = await ctx.db
        .query(
          `UPDATE slots SET status = 'open', prev_hold_client_id = NULL, version = version + 1
           WHERE id = ? AND status = 'booked'`,
        )
        .run(booking.slot_id);
      if (freed.changes === 1) {
        await logEvent(ctx, { type: "slot_released", slotId: booking.slot_id, clientId: booking.client_id, actor: "system" });
      }
    }
    return bookingDto(ctx, bookingId, policies);
  });
}

export async function myBookings(ctx: Ctx, clientId: string) {
  await sweepExpiredHolds(ctx);
  const policies = await getPolicies(ctx.db);
  const rows = await ctx.db
    .query(
      `SELECT b.*, s.start_at, s.end_at FROM bookings b JOIN slots s ON s.id = b.slot_id
       WHERE b.client_id = ? ORDER BY s.start_at ASC`,
    )
    .all(clientId) as BookingJoin[];
  const nowIso = iso(ctx.now);
  const dtos = rows.map((r) => ({ r, b: toBooking(ctx, r, policies) }));
  const upcoming = dtos.filter(({ r }) => r.status === "confirmed" && r.start_at >= nowIso).map((x) => x.b);
  const past = dtos
    .filter(({ r }) => r.status === "cancelled" || r.start_at < nowIso)
    .map((x) => x.b)
    .reverse();
  return { upcoming, past, hold: await activeHold(ctx, clientId) };
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

const ADMIN_SLOT_SQL = `
  SELECT s.id, s.start_at, s.end_at, s.status, s.block_reason, s.hold_expires_at,
    hc.id AS hc_id, hc.contact AS hc_contact, hc.contact_type AS hc_type, hc.name AS hc_name, hc.created_at AS hc_created,
    b.id AS b_id, b.notes AS b_notes, b.reschedule_count AS b_rc, b.created_at AS b_created,
    bc.id AS bc_id, bc.contact AS bc_contact, bc.contact_type AS bc_type, bc.name AS bc_name, bc.created_at AS bc_created
  FROM slots s
  LEFT JOIN clients hc ON hc.id = s.held_by_client_id
  LEFT JOIN bookings b ON b.slot_id = s.id AND b.status = 'confirmed'
  LEFT JOIN clients bc ON bc.id = b.client_id`;

type AdminRow = Record<string, any>;

function toAdminSlot(r: AdminRow): AdminSlot {
  return {
    id: r.id,
    startAt: r.start_at,
    endAt: r.end_at,
    status: r.status,
    blockReason: r.block_reason,
    hold: r.hc_id
      ? {
          client: { id: r.hc_id, contact: r.hc_contact, contactType: r.hc_type, name: r.hc_name, createdAt: r.hc_created },
          expiresAt: r.hold_expires_at,
        }
      : null,
    booking: r.b_id
      ? {
          id: r.b_id,
          client: { id: r.bc_id, contact: r.bc_contact, contactType: r.bc_type, name: r.bc_name, createdAt: r.bc_created },
          notes: r.b_notes,
          rescheduleCount: r.b_rc,
          createdAt: r.b_created,
        }
      : null,
  };
}

async function adminSlotById(ctx: Ctx, id: string): Promise<AdminSlot> {
  const r = await ctx.db.query(`${ADMIN_SLOT_SQL} WHERE s.id = ?`).get(id) as AdminRow | null;
  if (!r) fail("NOT_FOUND", "That time slot doesn't exist.");
  return toAdminSlot(r);
}

export async function adminSchedule(ctx: Ctx, from: string, to: string): Promise<{ slots: AdminSlot[]; stats: ScheduleStats }> {
  await sweepExpiredHolds(ctx);
  const range = clampRange(from, to);
  const rows = await ctx.db
    .query(`${ADMIN_SLOT_SQL} WHERE s.start_at >= ? AND s.start_at < ? ORDER BY s.start_at ASC`)
    .all(range.from, range.to) as AdminRow[];
  const slots = rows.map(toAdminSlot);
  const count = (st: SlotStatus) => slots.filter((s) => s.status === st).length;
  const booked = count("booked");
  const blocked = count("blocked");
  const total = slots.length;
  return {
    slots,
    stats: {
      total,
      open: count("open"),
      held: count("held"),
      booked,
      blocked,
      utilization: total - blocked > 0 ? booked / (total - blocked) : 0,
    },
  };
}

export async function adminBlockSlot(ctx: Ctx, slotId: string, reason?: string): Promise<AdminSlot> {
  return tx(ctx, async (ctx) => {
    await sweepExpiredHolds(ctx);
    const slot = await getSlot(ctx, slotId);
    if (!slot) fail("NOT_FOUND", "That time slot doesn't exist.");
    const res = await ctx.db
      .query(
        `UPDATE slots SET status = 'blocked', block_reason = ?, version = version + 1
         WHERE id = ? AND status = 'open'`,
      )
      .run(reason || null, slotId);
    if (res.changes !== 1) {
      fail("SLOT_UNAVAILABLE", "Only open slots can be blocked. This one is booked, held or already blocked.");
    }
    await logEvent(ctx, { type: "slot_blocked", slotId, actor: "therapist" });
    return adminSlotById(ctx, slotId);
  });
}

export async function adminUnblockSlot(ctx: Ctx, slotId: string): Promise<AdminSlot> {
  return tx(ctx, async (ctx) => {
    const slot = await getSlot(ctx, slotId);
    if (!slot) fail("NOT_FOUND", "That time slot doesn't exist.");
    const res = await ctx.db
      .query(
        `UPDATE slots SET status = 'open', block_reason = NULL, prev_hold_client_id = NULL, version = version + 1
         WHERE id = ? AND status = 'blocked'`,
      )
      .run(slotId);
    if (res.changes !== 1) fail("INVALID_STATE", "That slot isn't blocked.");
    await logEvent(ctx, { type: "slot_released", slotId, actor: "therapist" });
    return adminSlotById(ctx, slotId);
  });
}

export async function adminClients(ctx: Ctx) {
  const rows = await ctx.db
    .query(
      `SELECT c.*,
         (SELECT COUNT(*) FROM bookings b JOIN slots s ON s.id = b.slot_id
            WHERE b.client_id = c.id AND b.status = 'confirmed' AND s.start_at >= ?1) AS upcoming,
         (SELECT COUNT(*) FROM bookings b JOIN slots s ON s.id = b.slot_id
            WHERE b.client_id = c.id AND b.status = 'confirmed' AND s.start_at < ?1) AS total
       FROM clients c ORDER BY COALESCE(c.name, c.contact) COLLATE NOCASE`,
    )
    .all(iso(ctx.now)) as (ClientRow & { upcoming: number; total: number })[];
  return rows.map((r) => ({ ...toClient(r), upcomingCount: r.upcoming, totalSessions: r.total }));
}

export async function adminEvents(ctx: Ctx, limit = 50) {
  const rows = await ctx.db
    .query(
      `SELECT e.*, s.start_at AS slot_start, c.id AS c_id, c.contact AS c_contact, c.contact_type AS c_type,
         c.name AS c_name, c.created_at AS c_created
       FROM booking_events e
       LEFT JOIN slots s ON s.id = e.slot_id
       LEFT JOIN clients c ON c.id = e.client_id
       ORDER BY e.at DESC, e.rowid DESC LIMIT ?`,
    )
    .all(Math.max(1, Math.min(limit, 500))) as AdminRow[];
  return rows.map(
    (r): BookingEvent & { client: Client | null; slotStartAt: string | null } => ({
      id: r.id,
      type: r.type,
      bookingId: r.booking_id,
      slotId: r.slot_id,
      fromSlotId: r.from_slot_id,
      actor: r.actor,
      at: r.at,
      client: r.c_id
        ? { id: r.c_id, contact: r.c_contact, contactType: r.c_type, name: r.c_name, createdAt: r.c_created }
        : null,
      slotStartAt: r.slot_start,
    }),
  );
}
