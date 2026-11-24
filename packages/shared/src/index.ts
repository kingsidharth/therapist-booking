/**
 * Shared contract between @app/server and @app/web.
 *
 * - All timestamps are ISO-8601 strings in UTC (e.g. "2026-11-25T14:00:00.000Z").
 * - Request bodies are validated with the zod schemas below on the server;
 *   the web app uses the inferred types (and may reuse the schemas for forms).
 * - Every error response has the shape `ApiErrorBody` with an HTTP status
 *   matching `ERROR_STATUS[code]`.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Contact identity (no verification — the contact string *is* the identity)
// ---------------------------------------------------------------------------

export type ContactType = "email" | "phone";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Normalises an email (trim + lowercase) or phone (keep leading "+", strip
 * everything that is not a digit). Returns null when it is neither.
 * Phones need 7–15 digits (E.164 upper bound).
 */
export function normalizeContact(
  raw: string,
): { contact: string; contactType: ContactType } | null {
  const value = raw.trim();
  if (value.includes("@")) {
    const email = value.toLowerCase();
    return EMAIL_RE.test(email) ? { contact: email, contactType: "email" } : null;
  }
  if (!/^[+\d\s().-]+$/.test(value)) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  const plus = value.startsWith("+") ? "+" : "";
  return { contact: plus + digits, contactType: "phone" };
}

export const contactSchema = z
  .string()
  .trim()
  .min(1, "Enter your email or phone number")
  .refine((v) => normalizeContact(v) !== null, "Enter a valid email or phone number");

// ---------------------------------------------------------------------------
// Domain models (API response shapes)
// ---------------------------------------------------------------------------

export interface BookingPolicies {
  /** Length of a session in minutes (slots start on the hour; the rest is buffer). */
  sessionMinutes: number;
  /** How long a hold reserves a slot while the client confirms. */
  holdMinutes: number;
  /** Slots starting sooner than this cannot be booked. */
  minLeadHours: number;
  /** Bookings cannot be cancelled/rescheduled by the client inside this window. */
  changeCutoffHours: number;
  /** Max confirmed upcoming bookings per client. */
  maxActiveBookings: number;
  /** How far ahead slots are published. */
  horizonDays: number;
}

export interface Therapist {
  id: string;
  name: string;
  credentials: string; // e.g. "PhD, Licensed Clinical Psychologist"
  bio: string;
  specialties: string[];
  /** IANA zone the schedule is defined in, e.g. "America/New_York". */
  timezone: string;
  location: string; // e.g. "Telehealth & Brooklyn, NY"
  policies: BookingPolicies;
}

export interface Client {
  id: string;
  contact: string; // normalised
  contactType: ContactType;
  name: string | null;
  createdAt: string;
}

/** Internal inventory state of a slot. */
export type SlotStatus = "open" | "held" | "booked" | "blocked";

/**
 * What a (possibly identified) client may see about a slot. Never reveals who
 * booked it.
 *  - available:   open, outside lead time — can be held/booked
 *  - unavailable: booked by someone else, blocked, held by someone else, or too soon
 *  - yours:       booked by the requesting client
 *  - held_by_you: currently held by the requesting client
 */
export type SlotAvailability = "available" | "unavailable" | "yours" | "held_by_you";

export interface PublicSlot {
  id: string;
  startAt: string;
  endAt: string;
  availability: SlotAvailability;
}

export type BookingStatus = "confirmed" | "cancelled";

export interface Booking {
  id: string;
  status: BookingStatus;
  slot: { id: string; startAt: string; endAt: string };
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  /** Number of times this booking has been moved. */
  rescheduleCount: number;
  /** True when confirmed, in the future, and outside the change cutoff. */
  canModify: boolean;
  /** startAt − changeCutoffHours. */
  modifyDeadline: string;
}

export interface Hold {
  slotId: string;
  startAt: string;
  endAt: string;
  expiresAt: string;
}

export type BookingEventType =
  | "booked"
  | "rescheduled"
  | "cancelled"
  | "slot_blocked"
  | "slot_released";

export interface BookingEvent {
  id: string;
  type: BookingEventType;
  bookingId: string | null;
  slotId: string | null;
  fromSlotId: string | null;
  actor: "client" | "therapist" | "system";
  at: string;
}

/** Therapist-side view of a slot: full inventory state + who holds/booked it. */
export interface AdminSlot {
  id: string;
  startAt: string;
  endAt: string;
  status: SlotStatus;
  blockReason: string | null;
  hold: { client: Client; expiresAt: string } | null;
  booking: {
    id: string;
    client: Client;
    notes: string | null;
    rescheduleCount: number;
    createdAt: string;
  } | null;
}

export interface ScheduleStats {
  total: number; // all slots in range
  open: number;
  held: number;
  booked: number;
  blocked: number;
  /** booked / (total − blocked), 0..1 */
  utilization: number;
}

export interface TimeOff {
  id: string;
  startDate: string; // YYYY-MM-DD in therapist timezone, inclusive
  endDate: string; // inclusive
  reason: string;
}

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

/** GET /api/slots?from&to  and  GET /api/admin/schedule?from&to */
export const rangeQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
});
export type RangeQuery = z.infer<typeof rangeQuerySchema>;

/** POST /api/identify */
export const identifySchema = z.object({
  contact: contactSchema,
  name: z.string().trim().min(1).max(80).optional(),
});
export type IdentifyRequest = z.infer<typeof identifySchema>;

/** PATCH /api/me */
export const updateMeSchema = z.object({
  name: z.string().trim().min(1).max(80),
});
export type UpdateMeRequest = z.infer<typeof updateMeSchema>;

/** POST /api/holds */
export const createHoldSchema = z.object({
  slotId: z.string().min(1),
});
export type CreateHoldRequest = z.infer<typeof createHoldSchema>;

/** POST /api/bookings — slot must be open or held by this client. */
export const createBookingSchema = z.object({
  slotId: z.string().min(1),
  notes: z.string().trim().max(500).optional(),
});
export type CreateBookingRequest = z.infer<typeof createBookingSchema>;

/** POST /api/bookings/:id/reschedule — target slot open or held by this client. */
export const rescheduleBookingSchema = z.object({
  newSlotId: z.string().min(1),
});
export type RescheduleBookingRequest = z.infer<typeof rescheduleBookingSchema>;

/** POST /api/bookings/:id/cancel  and  POST /api/admin/bookings/:id/cancel */
export const cancelBookingSchema = z.object({
  reason: z.string().trim().max(200).optional(),
});
export type CancelBookingRequest = z.infer<typeof cancelBookingSchema>;

/** POST /api/admin/slots/:id/block */
export const blockSlotSchema = z.object({
  reason: z.string().trim().max(120).optional(),
});
export type BlockSlotRequest = z.infer<typeof blockSlotSchema>;

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export interface TherapistResponse {
  therapist: Therapist;
  timeOff: TimeOff[];
}
export interface SlotsResponse {
  slots: PublicSlot[];
}
export interface IdentifyResponse {
  client: Client;
}
export interface MeResponse {
  client: Client;
}
export interface MyBookingsResponse {
  upcoming: Booking[]; // confirmed, startAt >= now, ascending
  past: Booking[]; // confirmed with startAt < now, plus cancelled; most recent first
  hold: Hold | null; // the client's active hold, if any (max one at a time)
}
export interface HoldResponse {
  hold: Hold;
}
export interface BookingResponse {
  booking: Booking;
}
export interface AdminScheduleResponse {
  slots: AdminSlot[];
  stats: ScheduleStats;
}
export interface AdminSlotResponse {
  slot: AdminSlot;
}
export interface AdminClientsResponse {
  clients: Array<Client & { upcomingCount: number; totalSessions: number }>;
}
export interface AdminEventsResponse {
  events: Array<BookingEvent & { client: Client | null; slotStartAt: string | null }>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const ERROR_STATUS = {
  VALIDATION: 400,
  UNIDENTIFIED: 401, // missing/unknown X-Client-Id
  FORBIDDEN: 403, // booking belongs to another client
  NOT_FOUND: 404,
  SLOT_UNAVAILABLE: 409, // taken/held by someone else/blocked
  HOLD_EXPIRED: 409,
  TOO_SOON: 422, // inside minLeadHours
  CUTOFF_PASSED: 422, // inside changeCutoffHours
  LIMIT_REACHED: 422, // maxActiveBookings
  INVALID_STATE: 422, // e.g. cancelling an already-cancelled booking
} as const;
export type ErrorCode = keyof typeof ERROR_STATUS;

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string };
}

// ---------------------------------------------------------------------------
// HTTP surface (for reference; both sides must agree)
// ---------------------------------------------------------------------------

/** Header carrying the identified client's id (from POST /api/identify). */
export const CLIENT_HEADER = "X-Client-Id";

export const API_ROUTES = {
  // public
  therapist: "GET /api/therapist", // -> TherapistResponse
  slots: "GET /api/slots?from&to", // -> SlotsResponse (availability relative to X-Client-Id if sent)
  identify: "POST /api/identify", // IdentifyRequest -> IdentifyResponse (upsert by normalised contact; sets name if given)
  // client (require X-Client-Id)
  me: "GET /api/me", // -> MeResponse
  updateMe: "PATCH /api/me", // UpdateMeRequest -> MeResponse
  myBookings: "GET /api/me/bookings", // -> MyBookingsResponse
  createHold: "POST /api/holds", // CreateHoldRequest -> HoldResponse (201). Replaces this client's previous hold.
  releaseHold: "DELETE /api/holds/:slotId", // -> 204
  createBooking: "POST /api/bookings", // CreateBookingRequest -> BookingResponse (201)
  rescheduleBooking: "POST /api/bookings/:id/reschedule", // RescheduleBookingRequest -> BookingResponse
  cancelBooking: "POST /api/bookings/:id/cancel", // CancelBookingRequest -> BookingResponse
  // therapist (requires a bearer access key)
  adminSchedule: "GET /api/admin/schedule?from&to", // -> AdminScheduleResponse
  adminBlock: "POST /api/admin/slots/:id/block", // BlockSlotRequest -> AdminSlotResponse (only open slots)
  adminUnblock: "POST /api/admin/slots/:id/unblock", // -> AdminSlotResponse (only blocked slots)
  adminCancel: "POST /api/admin/bookings/:id/cancel", // CancelBookingRequest -> BookingResponse (ignores cutoff)
  adminClients: "GET /api/admin/clients", // -> AdminClientsResponse
  adminEvents: "GET /api/admin/events?limit", // -> AdminEventsResponse (newest first, default 50)
  // dev
  health: "GET /api/health", // -> { ok: true }
} as const;

export const DEFAULT_POLICIES: BookingPolicies = {
  sessionMinutes: 50,
  holdMinutes: 5,
  minLeadHours: 12,
  changeCutoffHours: 24,
  maxActiveBookings: 4,
  horizonDays: 42,
};

export const PORTS = { server: 4610, web: 4611 } as const;
