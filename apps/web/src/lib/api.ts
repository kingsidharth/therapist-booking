import {
  CLIENT_HEADER,
  type AdminClientsResponse,
  type AdminEventsResponse,
  type AdminScheduleResponse,
  type AdminSlotResponse,
  type ApiErrorBody,
  type BlockSlotRequest,
  type BookingResponse,
  type CancelBookingRequest,
  type CreateBookingRequest,
  type ErrorCode,
  type HoldResponse,
  type IdentifyRequest,
  type IdentifyResponse,
  type MeResponse,
  type MyBookingsResponse,
  type SlotsResponse,
  type TherapistResponse,
  type UpdateMeRequest,
} from "@app/shared";
import { identityStore } from "./identity";

export class ApiError extends Error {
  readonly code: ErrorCode | "NETWORK" | "UNKNOWN";
  readonly status: number;
  constructor(code: ApiError["code"], message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

let adminKey = "";
export function setAdminKey(value: string) {
  adminKey = value;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const id = identityStore.get();
  const isAdmin = path.startsWith("/api/admin/");
  if (isAdmin && adminKey) headers.Authorization = `Bearer ${adminKey}`;
  if (!isAdmin && id) headers[CLIENT_HEADER] = id.clientId;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError("NETWORK", "Can't reach the server. Check your connection and try again.", 0);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: unknown = undefined;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    /* non-JSON body (e.g. proxy error page) */
  }

  if (!res.ok) {
    const err = (json as ApiErrorBody | undefined)?.error;
    if (!isAdmin && res.status === 401 && id) identityStore.set(null); // unknown client id: sign out
    throw new ApiError(
      err?.code ?? "UNKNOWN",
      err?.message ?? (res.status >= 500 ? "The server is unavailable right now. Please try again shortly." : "Something went wrong."),
      res.status,
    );
  }
  return json as T;
}

const qs = (r: { from: string; to: string }) => `?from=${encodeURIComponent(r.from)}&to=${encodeURIComponent(r.to)}`;

export const api = {
  therapist: () => request<TherapistResponse>("GET", "/api/therapist"),
  slots: (r: { from: string; to: string }) => request<SlotsResponse>("GET", `/api/slots${qs(r)}`),
  identify: (b: IdentifyRequest) => request<IdentifyResponse>("POST", "/api/identify", b),
  me: () => request<MeResponse>("GET", "/api/me"),
  updateMe: (b: UpdateMeRequest) => request<MeResponse>("PATCH", "/api/me", b),
  myBookings: () => request<MyBookingsResponse>("GET", "/api/me/bookings"),
  createHold: (slotId: string) => request<HoldResponse>("POST", "/api/holds", { slotId }),
  releaseHold: (slotId: string) => request<void>("DELETE", `/api/holds/${encodeURIComponent(slotId)}`),
  createBooking: (b: CreateBookingRequest) => request<BookingResponse>("POST", "/api/bookings", b),
  reschedule: (id: string, newSlotId: string) =>
    request<BookingResponse>("POST", `/api/bookings/${encodeURIComponent(id)}/reschedule`, { newSlotId }),
  cancel: (id: string, b: CancelBookingRequest) =>
    request<BookingResponse>("POST", `/api/bookings/${encodeURIComponent(id)}/cancel`, b),
  adminSchedule: (r: { from: string; to: string }) =>
    request<AdminScheduleResponse>("GET", `/api/admin/schedule${qs(r)}`),
  adminBlock: (id: string, b: BlockSlotRequest) =>
    request<AdminSlotResponse>("POST", `/api/admin/slots/${encodeURIComponent(id)}/block`, b),
  adminUnblock: (id: string) => request<AdminSlotResponse>("POST", `/api/admin/slots/${encodeURIComponent(id)}/unblock`, {}),
  adminCancel: (id: string, b: CancelBookingRequest) =>
    request<BookingResponse>("POST", `/api/admin/bookings/${encodeURIComponent(id)}/cancel`, b),
  adminClients: () => request<AdminClientsResponse>("GET", "/api/admin/clients"),
  adminEvents: (limit = 30) => request<AdminEventsResponse>("GET", `/api/admin/events?limit=${limit}`),
};
