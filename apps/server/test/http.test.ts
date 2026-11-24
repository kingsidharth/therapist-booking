import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { CLIENT_HEADER } from "@app/shared";
import { MON_9, setup, slotId } from "./helpers";

const j = async (r: Response): Promise<any> => r.json();
const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

describe("http", () => {
  test("therapist endpoints require the configured key", async () => {
    const { app, db } = setup();
    const authorized = { headers: { Authorization: "Bearer test-key" } };
    expect((await app.request("/api/admin/clients", authorized)).status).toBe(403);
    const secured = createApp({ db, adminKey: "test-key" });
    expect((await secured.request("/api/admin/clients")).status).toBe(403);
    expect((await secured.request("/api/admin/slots/foo/block", json({}))).status).toBe(403);
    expect((await secured.request("/api/admin/clients", authorized)).status).toBe(200);
  });

  test("health and therapist", async () => {
    const { app } = setup();
    expect(await j(await app.request("/api/health"))).toEqual({ ok: true });
    const t = await j(await app.request("/api/therapist"));
    expect(t.therapist.timezone).toBe("America/New_York");
    expect(t.timeOff.length).toBe(2);
  });

  test("validation failure -> 400 VALIDATION with readable message", async () => {
    const { app } = setup();
    const res = await app.request("/api/identify", json({ contact: "nope" }));
    expect(res.status).toBe(400);
    const body = await j(res);
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.message).toBe("Enter a valid email or phone number");
    const bad = await app.request("/api/slots?from=x&to=y");
    expect(bad.status).toBe(400);
  });

  test("missing client header -> 401 UNIDENTIFIED", async () => {
    const { app } = setup();
    const res = await app.request("/api/me/bookings");
    expect(res.status).toBe(401);
    expect((await j(res)).error.code).toBe("UNIDENTIFIED");
  });

  test("full flow + 409 SLOT_UNAVAILABLE + 404", async () => {
    const { app, db } = setup();
    const id = async (c: string) => (await j(await app.request("/api/identify", json({ contact: c })))).client.id as string;
    const a = await id("a@example.com");
    const b = await id("b@example.com");
    const s = slotId(db, MON_9);
    const h = await app.request("/api/holds", json({ slotId: s }, { [CLIENT_HEADER]: a }));
    expect(h.status).toBe(201);
    const conflict = await app.request("/api/holds", json({ slotId: s }, { [CLIENT_HEADER]: b }));
    expect(conflict.status).toBe(409);
    expect((await j(conflict)).error.code).toBe("SLOT_UNAVAILABLE");
    const bk = await app.request("/api/bookings", json({ slotId: s }, { [CLIENT_HEADER]: a }));
    expect(bk.status).toBe(201);
    const booking = (await j(bk)).booking;
    const forbidden = await app.request(`/api/bookings/${booking.id}/cancel`, json({}, { [CLIENT_HEADER]: b }));
    expect(forbidden.status).toBe(403);
    const cancel = await app.request(`/api/bookings/${booking.id}/cancel`, { method: "POST", headers: { [CLIENT_HEADER]: a } });
    expect(cancel.status).toBe(200);
    const del = await app.request(`/api/holds/${s}`, { method: "DELETE", headers: { [CLIENT_HEADER]: a } });
    expect(del.status).toBe(204);
    expect((await app.request("/api/nope")).status).toBe(404);
  });
});
