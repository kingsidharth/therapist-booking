import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { BookingResponse, IdentifyResponse, MyBookingsResponse, SlotsResponse } from "@app/shared";
import { createApp } from "../src/app";
import { setup, T0 } from "./helpers";

async function connect(app: ReturnType<typeof createApp>, key?: string) {
  const client = new Client({ name: "booking-test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL("https://example.test/api/mcp"), {
    requestInit: { headers: key ? { Authorization: `Bearer ${key}` } : {} },
    fetch: (input, init) => Promise.resolve(app.request(input.toString(), init as RequestInit)),
  }));
  return client;
}

async function invoke<T>(client: Client, name: string, args: Record<string, unknown>): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type: string; text: string }>;
  expect(content[0]?.type).toBe("text");
  if (result.isError) throw new Error(content[0]?.text);
  return JSON.parse(content[0]!.text) as T;
}

test("a stateless MCP client can discover, book, reschedule and cancel through the API", async () => {
  const { app, db } = await setup();
  const client = await connect(app);
  try {
    const { tools } = await client.listTools();
    expect(tools.every(tool => tool.description?.length && !tool.description.includes("\n"))).toBe(true);
    expect(tools.map(tool => tool.name)).not.toContain("list_clients");
    const { client: profile } = await invoke<IdentifyResponse>(client, "identify_client", { contact: "mcp@example.test" });
    const args = { clientId: profile.id };
    const range = { from: "2026-11-30T13:00:00.000Z", to: "2026-12-01T00:00:00.000Z" };
    const { slots } = await invoke<SlotsResponse>(client, "find_slots", range);
    const slotId = slots[0]!.id;
    const newSlotId = slots[1]!.id;
    await invoke(client, "hold_slot", { ...args, slotId });
    const { booking } = await invoke<BookingResponse>(client, "book_slot", { ...args, slotId });
    expect((await invoke<SlotsResponse>(client, "find_slots", range)).slots.some(s => s.id === slotId)).toBe(false);
    const moved = await invoke<BookingResponse>(client, "reschedule_booking", { ...args, bookingId: booking.id, newSlotId });
    expect(moved.booking.slot.id).toBe(newSlotId);
    expect((await invoke<MyBookingsResponse>(client, "list_bookings", args)).upcoming[0]?.id).toBe(booking.id);
    const cancelled = await invoke<BookingResponse>(client, "cancel_booking", { ...args, bookingId: booking.id });
    expect(cancelled.booking.status).toBe("cancelled");
    expect((await invoke<SlotsResponse>(client, "find_slots", range)).slots.map(s => s.id)).toContain(newSlotId);
  } finally {
    await client.close();
    db.close();
  }
});

test("therapist tools require the bearer key on every MCP request", async () => {
  const { db } = await setup();
  const app = createApp({ db, adminKey: "test-key", now: () => T0 });
  const therapist = await connect(app, "test-key");
  const publicClient = await connect(app);
  try {
    expect((await therapist.listTools()).tools.map(tool => tool.name)).toContain("get_schedule");
    await invoke(therapist, "list_clients", {});
    expect((await publicClient.callTool({ name: "list_clients", arguments: {} })).isError).toBe(true);
    expect((await app.request("/api/mcp", { method: "POST", headers: { Authorization: "Bearer wrong" } })).status).toBe(403);
    expect((await app.request("/api/mcp", { method: "POST", headers: { Origin: "https://another.example" } })).status).toBe(403);
    expect((await app.request("/api/mcp")).status).toBe(405);
  } finally {
    await therapist.close();
    await publicClient.close();
    db.close();
  }
});
