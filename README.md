<img src="assets/icon.svg" width="56" height="56" alt="">

# Therapist booking

Book, reschedule and cancel sessions with one therapist using only an email or phone number, with no sign-up. Includes a therapist view showing who booked each slot.

**Stack:** Bun · Hono · SQLite/libSQL (Turso in production) · React · Tailwind · shadcn/ui · TanStack Query. Types and zod schemas shared via `packages/shared`.

```
apps/server     Hono API, booking rules, seed, MCP tools
apps/web        React client (/) and therapist view (/therapist)
packages/shared API contract: types, schemas, error codes
```

## Setup

Requires [Bun](https://bun.sh) 1.3+.

```sh
bun install
```

## Run locally

```sh
bun run dev        # API :4610 + web :4611 (Vite proxies /api)
```

Open http://localhost:4611.

- First start creates `apps/server/data/app.sqlite`, seeded with a realistic practice: 3 weeks back, 6 weeks ahead, ~30 clients and recurring sessions.
- `bun run seed` wipes and reseeds.
- **Therapist view** (`/therapist`) asks for an access key. It is generated in `apps/server/data/admin-key`, or you can set `ADMIN_KEY`.

| Env | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4610` | API port |
| `DB_PATH` | `apps/server/data/app.sqlite` | Local database file |
| `ADMIN_KEY` | generated file | Therapist access key |

## Booking rules

- 50-minute sessions, hourly slots, America/New_York schedule
- Picking a time **holds** it for 5 min; closing the dialog **releases** it
- Book ≥ 12 h ahead; clients can change/cancel until 24 h before
- Max 4 upcoming bookings per client
- A unique index guarantees one confirmed booking per slot

Clients aren't verified, so anyone who knows a contact can manage its bookings. That's why the therapist API is gated by `ADMIN_KEY`.

## Verify

```sh
bun run test && bun run typecheck && bun run build
```

## Production (Vercel + Turso)

1. Create a Turso database: `turso db create therapist` → copy URL and token.
2. Import the repo in Vercel (root directory = repo root; `vercel.json` handles build, output and `/api` rewrites).
3. Set Production env vars:
   - `TURSO_DATABASE_URL`: `libsql://…`
   - `TURSO_AUTH_TOKEN`
   - `ADMIN_KEY`: long random string, e.g. `openssl rand -base64 32`
4. Deploy. The first request creates the schema, practice hours and slots. Production starts with **no demo clients**. The slot horizon rolls forward daily.

`bun run build` emits the web app to `apps/web/dist` and bundles the API to `apps/server/dist/vercel.mjs`, which `api/booking.mjs` serves as the serverless function.

### Remote MCP

Agents can book over MCP at `https://<deployment>/api/mcp` (Streamable HTTP):

- `find_slots` → `identify_client` → `book_slot`
- `reschedule_booking`, `cancel_booking`
- Therapist tools require `Authorization: Bearer <ADMIN_KEY>`.

Treat client IDs as private.
