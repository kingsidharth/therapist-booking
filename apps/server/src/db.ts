import type { Client, InStatement, InValue, Transaction } from "@libsql/client";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schedule_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS therapist (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  credentials TEXT NOT NULL,
  bio TEXT NOT NULL,
  specialties_json TEXT NOT NULL,
  timezone TEXT NOT NULL,
  location TEXT NOT NULL,
  policies_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS availability_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7), -- ISO: Mon=1
  start_minute INTEGER NOT NULL,
  end_minute INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS recurring_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  weekday INTEGER NOT NULL,
  start_minute INTEGER NOT NULL,
  reason TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS time_off (
  id TEXT PRIMARY KEY,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  reason TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  contact TEXT NOT NULL UNIQUE,
  contact_type TEXT NOT NULL CHECK (contact_type IN ('email','phone')),
  name TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS slots (
  id TEXT PRIMARY KEY,
  start_at TEXT NOT NULL UNIQUE,
  end_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','held','booked','blocked')),
  held_by_client_id TEXT REFERENCES clients(id),
  hold_expires_at TEXT,
  prev_hold_client_id TEXT,
  block_reason TEXT,
  version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_slots_status_hold ON slots(status, hold_expires_at);
CREATE INDEX IF NOT EXISTS idx_slots_held_by ON slots(held_by_client_id);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  slot_id TEXT NOT NULL REFERENCES slots(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  status TEXT NOT NULL CHECK (status IN ('confirmed','cancelled')),
  notes TEXT,
  reschedule_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  cancelled_at TEXT,
  cancel_reason TEXT
);
-- The inventory invariant: at most one confirmed booking per slot.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bookings_confirmed_slot ON bookings(slot_id) WHERE status = 'confirmed';
CREATE INDEX IF NOT EXISTS idx_bookings_client ON bookings(client_id, status);

CREATE TABLE IF NOT EXISTS booking_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('booked','rescheduled','cancelled','slot_blocked','slot_released')),
  booking_id TEXT,
  slot_id TEXT,
  from_slot_id TEXT,
  client_id TEXT,
  actor TEXT NOT NULL CHECK (actor IN ('client','therapist','system')),
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_at ON booking_events(at DESC);
`;


/** Carries the current SQL executor explicitly so every statement uses its caller's transaction. */
export class DB {
  private nextWrite: Promise<void> = Promise.resolve();

  constructor(private client: Client, private tx?: Transaction) {}

  query(sql: string) {
    const execute = (...args: InValue[]) => (this.tx ?? this.client).execute({ sql, args });
    return {
      get: async (...args: InValue[]): Promise<unknown> => (await execute(...args)).rows[0] ?? null,
      all: async (...args: InValue[]): Promise<unknown[]> => (await execute(...args)).rows,
      run: async (...args: InValue[]) => ({ changes: (await execute(...args)).rowsAffected }),
    };
  }

  prepare(sql: string) { return this.query(sql); }

  exec(sql: string) { return (this.tx ?? this.client).execute(sql); }

  batch(statements: InStatement[]) {
    return this.tx ? this.tx.batch(statements) : this.client.batch(statements, "write");
  }

  async write<T>(fn: (db: DB) => Promise<T>): Promise<T> {
    if (this.tx) return fn(this);
    // Local connections cannot wait on another transaction in the same JS event loop.
    // Queue writers on this client; the database still arbitrates writers on other instances.
    const pending = this.nextWrite.then(() => this.transact(fn));
    this.nextWrite = pending.then(() => {}, () => {});
    return pending;
  }

  private async transact<T>(fn: (db: DB) => Promise<T>): Promise<T> {
    const tx = await this.client.transaction("write");
    try {
      const result = await fn(new DB(this.client, tx));
      await tx.commit();
      return result;
    } finally {
      tx.close();
    }
  }

  close() { this.client.close(); }
}

export async function initializeDb(client: Client): Promise<DB> {
  try {
    await client.executeMultiple(SCHEMA);
    return new DB(client);
  } catch (error) {
    client.close();
    throw error;
  }
}

export async function isEmpty(db: DB): Promise<boolean> {
  const row = await db.query("SELECT COUNT(*) AS n FROM therapist").get() as { n: number };
  return row.n === 0;
}
