import { timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CLIENT_HEADER, blockSlotSchema, cancelBookingSchema, createBookingSchema, identifySchema,
  rangeQuerySchema, updateMeSchema, type SlotsResponse, type ApiErrorBody,
} from "@app/shared";
import { z } from "zod";

type Dispatch = (path: string, init?: RequestInit) => Response | Promise<Response>;

const identifier = z.string().regex(/^[A-Za-z0-9_-]+$/);
const client = { clientId: identifier.describe("Client ID returned by identify_client.") };
const slot = { slotId: identifier.describe("Slot ID returned by find_slots.") };
const booking = { bookingId: identifier.describe("Booking ID returned by book_slot or list_bookings.") };

function acceptsKey(header: string | null, key?: string) {
  if (!key || !header) return false;
  const actual = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${key}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function createBookingServer(dispatch: Dispatch, therapistAuthorization: string | null) {
  const server = new McpServer({ name: "therapist-booking", version: "1.0.0" });

  async function call<T = unknown>(method: string, path: string, body?: object, clientId?: string) {
    const headers = new Headers();
    if (body) headers.set("Content-Type", "application/json");
    if (clientId) headers.set(CLIENT_HEADER, clientId);
    if (path.startsWith("/admin/") && therapistAuthorization) headers.set("Authorization", therapistAuthorization);
    const response = await dispatch(`/api${path}`, { method, headers, body: body && JSON.stringify(body) });
    const data = response.status === 204 ? { released: true } : await response.json();
    if (!response.ok) {
      const { error } = data as ApiErrorBody;
      throw new Error(error ? `${error.code}: ${error.message}` : `Request failed (HTTP ${response.status}).`);
    }
    return data as T;
  }

  function tool<S extends z.ZodRawShape>(
    name: string, description: string, shape: S,
    run: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>,
    readOnly = false,
  ) {
    server.registerTool(name, {
      description, inputSchema: z.object(shape),
      annotations: { readOnlyHint: readOnly },
    }, async (args) => {
      const data = await run(args as z.infer<z.ZodObject<S>>);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    });
  }

  tool("get_therapist", "Get the therapist’s profile, time zone, booking policies, and time off.", {},
    () => call("GET", "/therapist"), true);
  tool("find_slots", "Find bookable session slots between two UTC timestamps.", {
    ...rangeQuerySchema.shape, clientId: client.clientId.optional(),
  }, async ({ from, to, clientId }) => {
    const { slots } = await call<SlotsResponse>("GET", `/slots?${new URLSearchParams({ from, to })}`, undefined, clientId);
    return { slots: slots.filter(s => s.availability === "available" || s.availability === "held_by_you") };
  }, true);
  tool("identify_client", "Find or create a client using their unverified email address or phone number.", identifySchema.shape,
    args => call("POST", "/identify", args));
  tool("get_client", "Get the profile for an identified client.", client,
    ({ clientId }) => call("GET", "/me", undefined, clientId), true);
  tool("update_client", "Update the name of an identified client.", { ...client, ...updateMeSchema.shape },
    ({ clientId, name }) => call("PATCH", "/me", { name }, clientId));
  tool("list_bookings", "List a client’s upcoming sessions, booking history, and active hold.", client,
    ({ clientId }) => call("GET", "/me/bookings", undefined, clientId), true);
  tool("hold_slot", "Temporarily hold an available slot, replacing the client’s previous hold.", { ...client, ...slot },
    ({ clientId, slotId }) => call("POST", "/holds", { slotId }, clientId));
  tool("release_hold", "Release a slot currently held by the client.", { ...client, ...slot },
    ({ clientId, slotId }) => call("DELETE", `/holds/${slotId}`, undefined, clientId));
  tool("book_slot", "Confirm an available slot or a slot held by the client.", { ...client, ...createBookingSchema.shape },
    ({ clientId, ...body }) => call("POST", "/bookings", body, clientId));
  tool("reschedule_booking", "Move a client’s booking to a new slot and release the previous slot.", {
    ...client, ...booking, newSlotId: slot.slotId,
  }, ({ clientId, bookingId, newSlotId }) => call("POST", `/bookings/${bookingId}/reschedule`, { newSlotId }, clientId));
  tool("cancel_booking", "Cancel a client’s booking and release the slot.", { ...client, ...booking, ...cancelBookingSchema.shape },
    ({ clientId, bookingId, reason }) => call("POST", `/bookings/${bookingId}/cancel`, { reason }, clientId));

  if (therapistAuthorization) {
    tool("get_schedule", "Get the therapist’s slot inventory, booking details, and utilization for a UTC date range.", rangeQuerySchema.shape,
      args => call("GET", `/admin/schedule?${new URLSearchParams(args)}`), true);
    tool("block_slot", "Block an open slot on the therapist’s schedule.", { ...slot, ...blockSlotSchema.shape },
      ({ slotId, reason }) => call("POST", `/admin/slots/${slotId}/block`, { reason }));
    tool("unblock_slot", "Return a blocked therapist slot to availability.", slot,
      ({ slotId }) => call("POST", `/admin/slots/${slotId}/unblock`));
    tool("cancel_as_therapist", "Cancel a client booking as the therapist, including inside the client change cutoff.", {
      ...booking, ...cancelBookingSchema.shape,
    }, ({ bookingId, reason }) => call("POST", `/admin/bookings/${bookingId}/cancel`, { reason }));
    tool("list_clients", "List the therapist’s clients and their booking counts.", {},
      () => call("GET", "/admin/clients"), true);
    tool("list_events", "List recent booking and schedule changes in reverse chronological order.", {
      limit: z.number().int().positive().max(500).optional(),
    }, ({ limit }) => call("GET", `/admin/events?limit=${limit ?? 50}`), true);
  }
  return server;
}

export async function handleMcp(request: Request, dispatch: Dispatch, adminKey?: string) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) return new Response("Forbidden origin", { status: 403 });
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  const authorization = request.headers.get("Authorization");
  if (authorization && !acceptsKey(authorization, adminKey)) return new Response("Invalid therapist key", { status: 403 });

  const server = createBookingServer(dispatch, authorization);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, enableJsonResponse: true,
  });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } finally {
    await server.close();
  }
}
