/** Timezone helpers built on Intl (no external tz library). Date keys are "YYYY-MM-DD". */

export const viewerTz: string = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function partsInTz(input: Date | string | number, tz: string): Parts {
  const d = input instanceof Date ? input : new Date(input);
  const out: Record<string, number> = {};
  for (const p of partsFormatter(tz).formatToParts(d)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return {
    year: out.year ?? 1970,
    month: out.month ?? 1,
    day: out.day ?? 1,
    hour: (out.hour ?? 0) % 24,
    minute: out.minute ?? 0,
    second: out.second ?? 0,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function dateKeyInTz(input: Date | string | number, tz: string): string {
  const p = partsInTz(input, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

function keyToUtcDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

export function addDays(key: string, n: number): string {
  const d = keyToUtcDate(key);
  d.setUTCDate(d.getUTCDate() + n);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Monday of the week containing `key`. */
export function mondayOf(key: string): string {
  const dow = keyToUtcDate(key).getUTCDay(); // 0 = Sun
  return addDays(key, -((dow + 6) % 7));
}

export function diffDays(a: string, b: string): number {
  return Math.round((keyToUtcDate(b).getTime() - keyToUtcDate(a).getTime()) / 86_400_000);
}

/** UTC instant of 00:00 on `key` in `tz`. */
export function startOfDayInTz(key: string, tz: string): Date {
  const base = keyToUtcDate(key).getTime();
  let guess = base;
  for (let i = 0; i < 3; i++) {
    const p = partsInTz(new Date(guess), tz);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    guess += base - asUtc;
  }
  return new Date(guess);
}

export function weekRange(mondayKey: string, tz: string) {
  return {
    from: startOfDayInTz(mondayKey, tz).toISOString(),
    to: startOfDayInTz(addDays(mondayKey, 7), tz).toISOString(),
  };
}

export function formatTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export function formatHourLabel(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h} ${hour < 12 ? "AM" : "PM"}`;
}

/** "Tue, Dec 1" */
export function formatDay(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(
    new Date(iso),
  );
}

/** "Tue, Dec 1 · 3:00 PM" */
export function formatSession(iso: string, tz: string): string {
  return `${formatDay(iso, tz)} · ${formatTime(iso, tz)}`;
}

export function formatKey(key: string, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...opts }).format(keyToUtcDate(key));
}

export function tzLabel(tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date());
  const short = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  return `${tz.replace(/_/g, " ")}${short ? ` (${short})` : ""}`;
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
export function relativeTime(iso: string, now = Date.now()): string {
  const diffSec = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(Math.round(diffSec / 1), "second").replace(/^in 0 seconds$/, "now");
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(diffSec / 3600), "hour");
  return rtf.format(Math.round(diffSec / 86_400), "day");
}

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${pad(total % 60)}`;
}
