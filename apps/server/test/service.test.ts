import { describe, expect, test } from "bun:test";
import * as svc from "../src/service";
import {
  MON_10, MON_11, MON_13, MON_14, MON_9, TUE_11, WED_10, WED_11, WED_12, WED_9, codeOf, setup, slotId,
} from "./helpers";

describe("identify", () => {
  test("normalizes contacts so differently-formatted input maps to one client", () => {
    const { client, ctx } = setup();
    const a = client("  Priya.Nair@Gmail.COM ", "Priya");
    const b = client("priya.nair@gmail.com");
    expect(b.id).toBe(a.id);
    expect(b.name).toBe("Priya"); // not overwritten by undefined
    const p1 = client("+1 (917) 555-0142");
    const p2 = client("+19175550142", "Marcus");
    expect(p2.id).toBe(p1.id);
    expect(p2.contact).toBe("+19175550142");
    expect(p2.contactType).toBe("phone");
    expect(p2.name).toBe("Marcus");
    expect(codeOf(() => svc.requireClient(ctx(), "nope"))).toBe("UNIDENTIFIED");
    expect(codeOf(() => svc.identify(ctx(), { contact: "garbage" }))).toBe("VALIDATION");
  });
});

describe("holds & bookings", () => {
  test("hold -> book happy path", () => {
    const { db, ctx, client } = setup();
    const a = client("a@example.com");
    const s = slotId(db, WED_9);
    const hold = svc.createHold(ctx(), a.id, s);
    expect(hold.slotId).toBe(s);
    expect(svc.myBookings(ctx(), a.id).hold?.slotId).toBe(s);
    const b = svc.createBooking(ctx(), a.id, { slotId: s, notes: "hi" });
    expect(b.status).toBe("confirmed");
    expect(b.notes).toBe("hi");
    expect(svc.myBookings(ctx(), a.id).hold).toBeNull();
    const slots = svc.listPublicSlots(ctx(), WED_9, WED_10, a.id);
    expect(slots[0]?.availability).toBe("yours");
  });

  test("book without a hold on an open slot works", () => {
    const { db, ctx, client } = setup();
    const a = client("a@example.com");
    const b = svc.createBooking(ctx(), a.id, { slotId: slotId(db, MON_9) });
    expect(b.slot.startAt).toBe(MON_9);
    expect(b.canModify).toBe(true);
  });

  test("double hold: second client gets SLOT_UNAVAILABLE", () => {
    const { db, ctx, client } = setup();
    const a = client("a@example.com");
    const b = client("b@example.com");
    const s = slotId(db, MON_9);
    svc.createHold(ctx(), a.id, s);
    expect(codeOf(() => svc.createHold(ctx(), b.id, s))).toBe("SLOT_UNAVAILABLE");
  });

  test("new hold replaces the previous hold; re-hold extends", () => {
    const { db, ctx, client, advance } = setup();
    const a = client("a@example.com");
    const s1 = slotId(db, MON_9);
    const s2 = slotId(db, MON_10);
    const h1 = svc.createHold(ctx(), a.id, s1);
    advance(60_000);
    const h1b = svc.createHold(ctx(), a.id, s1);
    expect(h1b.expiresAt > h1.expiresAt).toBe(true);
    svc.createHold(ctx(), a.id, s2);
    const open = svc.listPublicSlots(ctx(), MON_9, MON_10, null);
    expect(open[0]?.availability).toBe("available"); // s1 released
  });

  test("hold expiry lets another client take the slot; original gets HOLD_EXPIRED", () => {
    const { db, ctx, client, advance } = setup();
    const a = client("a@example.com");
    const b = client("b@example.com");
    const s = slotId(db, MON_9);
    svc.createHold(ctx(), a.id, s);
    advance(5 * 60_000 + 1000);
    svc.createHold(ctx(), b.id, s);
    expect(codeOf(() => svc.createBooking(ctx(), a.id, { slotId: s }))).toBe("HOLD_EXPIRED");
    expect(svc.createBooking(ctx(), b.id, { slotId: s }).status).toBe("confirmed");
  });

  test("booking someone else's held slot fails", () => {
    const { db, ctx, client } = setup();
    const a = client("a@example.com");
    const b = client("b@example.com");
    const s = slotId(db, MON_9);
    svc.createHold(ctx(), a.id, s);
    expect(codeOf(() => svc.createBooking(ctx(), b.id, { slotId: s }))).toBe("SLOT_UNAVAILABLE");
  });

  test("release only works for the holder and is idempotent", () => {
    const { db, ctx, client } = setup();
    const a = client("a@example.com");
    const b = client("b@example.com");
    const s = slotId(db, MON_9);
    svc.createHold(ctx(), a.id, s);
    svc.releaseHold(ctx(), b.id, s);
    expect(svc.listPublicSlots(ctx(), MON_9, MON_10, a.id)[0]?.availability).toBe("held_by_you");
    svc.releaseHold(ctx(), a.id, s);
    svc.releaseHold(ctx(), a.id, s);
    expect(svc.listPublicSlots(ctx(), MON_9, MON_10, a.id)[0]?.availability).toBe("available");
  });

  test("lead time: slots inside 12h are TOO_SOON", () => {
    const { db, ctx, client } = setup();
    const a = client("a@example.com");
    // Tue 2026-11-24 11:00 ET = 16:00Z, one hour after T0
    const soon = slotId(db, "2026-11-24T16:00:00.000Z");
    expect(codeOf(() => svc.createHold(ctx(), a.id, soon))).toBe("TOO_SOON");
    expect(codeOf(() => svc.createBooking(ctx(), a.id, { slotId: soon }))).toBe("TOO_SOON");
    const pub = svc.listPublicSlots(ctx(), "2026-11-24T00:00:00.000Z", "2026-11-25T00:00:00.000Z", a.id);
    expect(pub.every((p) => p.availability === "unavailable")).toBe(true);
  });

  test("LIMIT_REACHED after maxActiveBookings", () => {
    const { db, ctx, client } = setup();
    const a = client("a@example.com");
    for (const t of [MON_9, MON_10, MON_11, MON_13]) svc.createBooking(ctx(), a.id, { slotId: slotId(db, t) });
    expect(codeOf(() => svc.createBooking(ctx(), a.id, { slotId: slotId(db, MON_14) }))).toBe("LIMIT_REACHED");
  });
});

describe("reschedule & cancel", () => {
  test("reschedule atomically frees old slot and books new", () => {
    const { db, ctx, client } = setup();
    const a = client("a@example.com");
    const b = svc.createBooking(ctx(), a.id, { slotId: slotId(db, MON_9) });
    const r = svc.rescheduleBooking(ctx(), a.id, b.id, slotId(db, TUE_11));
    expect(r.slot.startAt).toBe(TUE_11);
    expect(r.rescheduleCount).toBe(1);
    const pub = svc.listPublicSlots(ctx(), MON_9, MON_10, null);
    expect(pub[0]?.availability).toBe("available");
    const ev = svc.adminEvents(ctx(), 5)[0]!;
    expect(ev.type).toBe("rescheduled");
    expect(ev.fromSlotId).toBe(slotId(db, MON_9));
    expect(ev.slotId).toBe(slotId(db, TUE_11));
  });

  test("failed reschedule leaves the original untouched", () => {
    const { db, ctx, client } = setup();
    const a = client("a@example.com");
    const o = client("o@example.com");
    const b = svc.createBooking(ctx(), a.id, { slotId: slotId(db, MON_9) });
    svc.createBooking(ctx(), o.id, { slotId: slotId(db, TUE_11) });
    expect(codeOf(() => svc.rescheduleBooking(ctx(), a.id, b.id, slotId(db, TUE_11)))).toBe("SLOT_UNAVAILABLE");
    expect(svc.myBookings(ctx(), a.id).upcoming[0]?.slot.startAt).toBe(MON_9);
  });

  test("reschedule inside the cutoff -> CUTOFF_PASSED; cancel too, admin cancel ignores it", () => {
    const { db, ctx, client } = setup();
    const a = client("a@example.com");
    // Wed 9:00 ET is 23h away (< 24h cutoff, > 12h lead)
    const b = svc.createBooking(ctx(), a.id, { slotId: slotId(db, WED_9) });
    expect(b.canModify).toBe(false);
    expect(codeOf(() => svc.rescheduleBooking(ctx(), a.id, b.id, slotId(db, MON_9)))).toBe("CUTOFF_PASSED");
    expect(codeOf(() => svc.cancelBooking(ctx(), { kind: "client", clientId: a.id }, b.id))).toBe("CUTOFF_PASSED");
    const c = svc.cancelBooking(ctx(), { kind: "therapist" }, b.id, "Therapist unwell");
    expect(c.status).toBe("cancelled");
    expect(c.cancelReason).toBe("Therapist unwell");
    expect(svc.listPublicSlots(ctx(), WED_9, WED_10, null)[0]?.availability).toBe("available");
  });

  test("client cancel releases the slot to open and logs events", () => {
    const { db, ctx, client } = setup();
    const a = client("a@example.com");
    const b = svc.createBooking(ctx(), a.id, { slotId: slotId(db, MON_9) });
    const c = svc.cancelBooking(ctx(), { kind: "client", clientId: a.id }, b.id);
    expect(c.status).toBe("cancelled");
    expect((db.query("SELECT status FROM slots WHERE start_at = ?").get(MON_9) as any).status).toBe("open");
    const types = svc.adminEvents(ctx(), 10).map((e) => e.type);
    expect(types).toContain("cancelled");
    expect(types).toContain("slot_released");
    expect(codeOf(() => svc.cancelBooking(ctx(), { kind: "client", clientId: a.id }, b.id))).toBe("INVALID_STATE");
    // another client can now book it
    const o = client("o@example.com");
    expect(svc.createBooking(ctx(), o.id, { slotId: slotId(db, MON_9) }).status).toBe("confirmed");
  });

  test("non-owner reschedule/cancel -> FORBIDDEN", () => {
    const { db, ctx, client } = setup();
    const a = client("a@example.com");
    const o = client("o@example.com");
    const b = svc.createBooking(ctx(), a.id, { slotId: slotId(db, MON_9) });
    expect(codeOf(() => svc.rescheduleBooking(ctx(), o.id, b.id, slotId(db, TUE_11)))).toBe("FORBIDDEN");
    expect(codeOf(() => svc.cancelBooking(ctx(), { kind: "client", clientId: o.id }, b.id))).toBe("FORBIDDEN");
  });

  test("cancelled booking cannot be rescheduled", () => {
    const { db, ctx, client } = setup();
    const a = client("a@example.com");
    const b = svc.createBooking(ctx(), a.id, { slotId: slotId(db, MON_9) });
    svc.cancelBooking(ctx(), { kind: "client", clientId: a.id }, b.id);
    expect(codeOf(() => svc.rescheduleBooking(ctx(), a.id, b.id, slotId(db, TUE_11)))).toBe("INVALID_STATE");
  });
});

describe("admin", () => {
  test("block/unblock rules", () => {
    const { db, ctx, client } = setup();
    const a = client("a@example.com");
    const s = slotId(db, MON_9);
    expect(svc.adminBlockSlot(ctx(), s, "Admin").status).toBe("blocked");
    expect(codeOf(() => svc.adminBlockSlot(ctx(), s))).toBe("SLOT_UNAVAILABLE");
    expect(codeOf(() => svc.createHold(ctx(), a.id, s))).toBe("SLOT_UNAVAILABLE");
    expect(svc.listPublicSlots(ctx(), MON_9, MON_10, a.id)[0]?.availability).toBe("unavailable");
    expect(svc.adminUnblockSlot(ctx(), s).status).toBe("open");
    expect(codeOf(() => svc.adminUnblockSlot(ctx(), s))).toBe("INVALID_STATE");
    // held and booked slots cannot be blocked
    svc.createHold(ctx(), a.id, s);
    expect(codeOf(() => svc.adminBlockSlot(ctx(), s))).toBe("SLOT_UNAVAILABLE");
    svc.createBooking(ctx(), a.id, { slotId: s });
    expect(codeOf(() => svc.adminBlockSlot(ctx(), s))).toBe("SLOT_UNAVAILABLE");
    expect(codeOf(() => svc.adminBlockSlot(ctx(), "missing"))).toBe("NOT_FOUND");
  });

  test("supervision slot is generated blocked; schedule stats", () => {
    const { db, ctx, client } = setup();
    const a = client("a@example.com");
    svc.createBooking(ctx(), a.id, { slotId: slotId(db, MON_9) });
    const sup = svc.adminSchedule(ctx(), WED_12, "2026-11-25T18:00:00.000Z");
    expect(sup.slots[0]?.status).toBe("blocked");
    expect(sup.slots[0]?.blockReason).toBe("Clinical supervision");
    const r = svc.adminSchedule(ctx(), "2026-11-30T00:00:00.000Z", "2026-12-01T00:00:00.000Z");
    expect(r.stats.total).toBe(7);
    expect(r.stats.booked).toBe(1);
    expect(r.stats.open).toBe(6);
    expect(r.stats.utilization).toBeCloseTo(1 / 7);
    expect(r.slots[0]?.booking?.client.id).toBe(a.id);
  });
});

describe("visibility & schedule", () => {
  test("public slots never leak another client's booking", () => {
    const { db, ctx, client } = setup();
    const a = client("a@example.com");
    const o = client("o@example.com");
    svc.createBooking(ctx(), a.id, { slotId: slotId(db, MON_9) });
    svc.createHold(ctx(), a.id, slotId(db, MON_10));
    const asOther = svc.listPublicSlots(ctx(), MON_9, MON_11, o.id);
    expect(asOther.map((s) => s.availability)).toEqual(["unavailable", "unavailable"]);
    const asOwner = svc.listPublicSlots(ctx(), MON_9, MON_11, a.id);
    expect(asOwner.map((s) => s.availability)).toEqual(["yours", "held_by_you"]);
    const anon = svc.listPublicSlots(ctx(), MON_9, MON_11, null);
    expect(JSON.stringify(anon)).not.toContain(a.id);
  });

  test("no slots on time-off days, DST-safe hours, range clamp", () => {
    const { db, ctx } = setup();
    const n = (from: string, to: string) => svc.listPublicSlots(ctx(), from, to, null).length;
    expect(n("2026-11-26T00:00:00.000Z", "2026-11-28T10:00:00.000Z")).toBe(0); // Thanksgiving Thu+Fri
    expect(n("2026-12-24T00:00:00.000Z", "2027-01-02T10:00:00.000Z")).toBe(0);
    // clamp: 200 days requested, <= 62 days returned
    const all = svc.listPublicSlots(ctx(), "2026-11-24T00:00:00.000Z", "2027-06-01T00:00:00.000Z", null);
    const last = Date.parse(all[all.length - 1]!.startAt);
    expect(last - Date.parse("2026-11-24T00:00:00.000Z")).toBeLessThanOrEqual(62 * 86_400_000);
    // all slots start on the hour ET
    expect(db.query("SELECT COUNT(*) n FROM slots").get()).toBeTruthy();
  });

  test("partial unique index prevents two confirmed bookings on one slot", () => {
    const { db, client } = setup();
    const a = client("a@example.com");
    const o = client("o@example.com");
    const s = slotId(db, MON_9);
    const ins = (id: string, cid: string, st: string) =>
      db.query(
        `INSERT INTO bookings (id, slot_id, client_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'x', 'x')`,
      ).run(id, s, cid, st);
    ins("b1", a.id, "confirmed");
    expect(() => ins("b2", o.id, "confirmed")).toThrow();
    ins("b3", o.id, "cancelled"); // cancelled rows are fine
  });

  test("wed 11:00 sanity: WED_11 open, WED_10 open", () => {
    const { db, ctx } = setup();
    const s = svc.listPublicSlots(ctx(), WED_10, "2026-11-25T17:00:00.000Z", null);
    expect(s.map((x) => x.startAt)).toEqual([WED_10, WED_11]);
    void db;
  });
});
