import {
  CLIENT_HEADER,
  ERROR_STATUS,
  blockSlotSchema,
  cancelBookingSchema,
  createBookingSchema,
  createHoldSchema,
  identifySchema,
  rangeQuerySchema,
  rescheduleBookingSchema,
  updateMeSchema,
  type ApiErrorBody,
  type ErrorCode,
} from "@app/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import type { ZodError, ZodTypeAny, z } from "zod";
import type { DB } from "./db";
import { AppError } from "./errors";
import * as svc from "./service";

export interface AppDeps {
  db: DB;
  adminKey?: string | undefined;
  /** Injectable clock (tests). */
  now?: () => Date;
}

function readableZod(err: ZodError): string {
  const issue = err.issues[0];
  if (!issue) return "Invalid request.";
  const path = issue.path.join(".");
  return path && path !== "contact" && path !== "name" ? `${path}: ${issue.message}` : issue.message;
}

const validate = <T extends "json" | "query", S extends ZodTypeAny>(target: T, schema: S) =>
  zValidator(target, schema, (result) => {
    if (!result.success) throw new AppError("VALIDATION", readableZod(result.error as ZodError));
  });

/** For endpoints whose JSON body is optional. */
async function optionalBody<S extends ZodTypeAny>(c: Context, schema: S): Promise<z.infer<S>> {
  const raw = await c.req.json().catch(() => ({}));
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) throw new AppError("VALIDATION", readableZod(parsed.error));
  return parsed.data;
}

export function createApp(deps: AppDeps) {
  const { db } = deps;
  const clock = deps.now ?? (() => new Date());
  const mk = (): svc.Ctx => ({ db, now: clock() });
  const clientOf = (c: Context, ctx: svc.Ctx) => svc.requireClient(ctx, c.req.header(CLIENT_HEADER));

  const app = new Hono()
    .use("*", cors({ origin: (o) => o ?? "*", allowHeaders: ["Content-Type", "Authorization", CLIENT_HEADER], allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"] }))

    // ---- dev / public ----
    .get("/api/health", (c) => c.json({ ok: true as const }))
    .get("/api/therapist", (c) => c.json(svc.getTherapist(mk())))
    .get("/api/slots", validate("query", rangeQuerySchema), (c) => {
      const { from, to } = c.req.valid("query");
      const ctx = mk();
      const slots = svc.listPublicSlots(ctx, from, to, c.req.header(CLIENT_HEADER));
      return c.json({ slots });
    })
    .post("/api/identify", validate("json", identifySchema), (c) => {
      const client = svc.identify(mk(), c.req.valid("json"));
      return c.json({ client });
    })

    // ---- client ----
    .get("/api/me", (c) => {
      const ctx = mk();
      return c.json({ client: clientOf(c, ctx) });
    })
    .patch("/api/me", validate("json", updateMeSchema), (c) => {
      const ctx = mk();
      const me = clientOf(c, ctx);
      return c.json({ client: svc.updateMe(ctx, me.id, c.req.valid("json").name) });
    })
    .get("/api/me/bookings", (c) => {
      const ctx = mk();
      const me = clientOf(c, ctx);
      return c.json(svc.myBookings(ctx, me.id));
    })
    .post("/api/holds", validate("json", createHoldSchema), (c) => {
      const ctx = mk();
      const me = clientOf(c, ctx);
      return c.json({ hold: svc.createHold(ctx, me.id, c.req.valid("json").slotId) }, 201);
    })
    .delete("/api/holds/:slotId", (c) => {
      const ctx = mk();
      const me = clientOf(c, ctx);
      svc.releaseHold(ctx, me.id, c.req.param("slotId"));
      return c.body(null, 204);
    })
    .post("/api/bookings", validate("json", createBookingSchema), (c) => {
      const ctx = mk();
      const me = clientOf(c, ctx);
      return c.json({ booking: svc.createBooking(ctx, me.id, c.req.valid("json")) }, 201);
    })
    .post("/api/bookings/:id/reschedule", validate("json", rescheduleBookingSchema), (c) => {
      const ctx = mk();
      const me = clientOf(c, ctx);
      const booking = svc.rescheduleBooking(ctx, me.id, c.req.param("id"), c.req.valid("json").newSlotId);
      return c.json({ booking });
    })
    .post("/api/bookings/:id/cancel", async (c) => {
      const ctx = mk();
      const me = clientOf(c, ctx);
      const body = await optionalBody(c, cancelBookingSchema);
      const booking = svc.cancelBooking(ctx, { kind: "client", clientId: me.id }, c.req.param("id"), body.reason);
      return c.json({ booking });
    })

    // ---- therapist ----
    .use("/api/admin/*", async (c, next) => {
      if (!deps.adminKey || c.req.header("Authorization") !== `Bearer ${deps.adminKey}`) {
        throw new AppError("FORBIDDEN", "A therapist access key is required.");
      }
      c.header("Cache-Control", "no-store");
      await next();
    })
    .get("/api/admin/schedule", validate("query", rangeQuerySchema), (c) => {
      const { from, to } = c.req.valid("query");
      return c.json(svc.adminSchedule(mk(), from, to));
    })
    .post("/api/admin/slots/:id/block", async (c) => {
      const body = await optionalBody(c, blockSlotSchema);
      return c.json({ slot: svc.adminBlockSlot(mk(), c.req.param("id"), body.reason) });
    })
    .post("/api/admin/slots/:id/unblock", (c) => c.json({ slot: svc.adminUnblockSlot(mk(), c.req.param("id")) }))
    .post("/api/admin/bookings/:id/cancel", async (c) => {
      const body = await optionalBody(c, cancelBookingSchema);
      const booking = svc.cancelBooking(mk(), { kind: "therapist" }, c.req.param("id"), body.reason);
      return c.json({ booking });
    })
    .get("/api/admin/clients", (c) => c.json({ clients: svc.adminClients(mk()) }))
    .get("/api/admin/events", (c) => {
      const n = Number(c.req.query("limit") ?? 50);
      return c.json({ events: svc.adminEvents(mk(), Number.isFinite(n) && n > 0 ? Math.floor(n) : 50) });
    });

  const errorBody = (code: ErrorCode, message: string): ApiErrorBody => ({ error: { code, message } });

  app.onError((err, c) => {
    if (err instanceof AppError) return c.json(errorBody(err.code, err.message), ERROR_STATUS[err.code]);
    if (err instanceof HTTPException) {
      const code: ErrorCode = err.status === 404 ? "NOT_FOUND" : "VALIDATION";
      return c.json(errorBody(code, code === "VALIDATION" ? "That request couldn't be read. Please check it and try again." : err.message), ERROR_STATUS[code]);
    }
    console.error(err);
    // Unexpected; there is no 5xx code in the contract, so surface as INVALID_STATE-free generic 500.
    return c.json({ error: { code: "INVALID_STATE", message: "Something went wrong on our side. Please try again." } }, 500);
  });
  app.notFound((c) => c.json(errorBody("NOT_FOUND", "Not found."), 404));

  return app;
}

export type AppType = ReturnType<typeof createApp>;
