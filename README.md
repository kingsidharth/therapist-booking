# Therapist booking

A single-practice scheduling demo built with Bun, Hono, SQLite, React, Tailwind CSS, shadcn/ui, and TanStack Query. Both applications use the TypeScript models and validation schemas in `packages/shared`.

## Run locally

Run `bun install --frozen-lockfile` and `bun run dev` from the repository root. The web app listens on port 4611 and proxies API requests to port 4610. The API creates its SQLite database and sample schedule on first startup. Subsequent starts preserve appointments.

Clients can browse six weeks of availability in their local time zone. Choose a time and enter an email address or phone number to book. Use **My sessions** with the same contact to reschedule or cancel. Anyone who knows a contact can manage its bookings, so use fictional client details for this demo.

Open **Therapist view** and enter the generated key in `apps/server/data/admin-key` to inspect the weekly schedule, see who booked a session, block time, or release a slot. Set `ADMIN_KEY` before starting the server to supply your own key.

Sessions last 50 minutes. The demo accepts bookings at least 12 hours ahead and client changes at least 24 hours ahead. SQLite transactions and a unique index enforce one confirmed booking per slot.

## Verify

Run `bun run test`, `bun run typecheck`, and `bun run build`.

## Vercel and Turso

Deploy from the repository root. Set `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, and `ADMIN_KEY` as Vercel Production environment variables. The first request creates the schema, practice hours, and bookable slots. The local demo client roster stays on the development machine.

## Remote MCP

Connect a Streamable HTTP client to `https://<deployment>/api/mcp`. Use `find_slots` to search a UTC date range and `identify_client` to get a client ID from an email or phone number. Pass that ID and a slot ID to `book_slot`. Use the returned booking ID for `reschedule_booking` or `cancel_booking`. Treat client IDs as private.

Therapist MCP clients send `Authorization: Bearer <ADMIN_KEY>` to access schedule management, client records, and booking events. Client tools use the same unverified-contact policy as the web app.
