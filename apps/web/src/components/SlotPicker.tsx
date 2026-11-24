import { useEffect, useMemo, useState } from "react";
import { Check, Hourglass } from "lucide-react";
import type { PublicSlot, TimeOff } from "@app/shared";
import { cn } from "@/lib/utils";
import { addDays, dateKeyInTz, formatKey, formatTime, viewerTz } from "@/lib/time";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

interface DayModel {
  key: string;
  slots: PublicSlot[];
  available: number;
  note: string | null;
  isPast: boolean;
}

function buildDays(weekStart: string, slots: PublicSlot[], timeOff: TimeOff[]): DayModel[] {
  const today = dateKeyInTz(new Date(), viewerTz);
  return Array.from({ length: 7 }, (_, i) => {
    const key = addDays(weekStart, i);
    const daySlots = slots
      .filter((s) => dateKeyInTz(s.startAt, viewerTz) === key)
      .sort((a, b) => a.startAt.localeCompare(b.startAt));
    const available = daySlots.filter((s) => s.availability === "available").length;
    const off = timeOff.find((t) => key >= t.startDate && key <= t.endDate);
    const interactive = daySlots.some((s) => s.availability === "yours" || s.availability === "held_by_you");
    let note: string | null = null;
    if (available === 0 && !interactive) {
      if (off) note = off.reason || "Time off";
      else if (daySlots.length > 0) note = "Fully booked";
      else note = "Unavailable";
    }
    return { key, slots: daySlots, available, note, isPast: key < today };
  });
}

function SlotButton({ slot, onPick }: { slot: PublicSlot; onPick: (s: PublicSlot) => void }) {
  const time = formatTime(slot.startAt, viewerTz);
  if (slot.availability === "yours") {
    return (
      <div className="flex items-center justify-between gap-1 rounded-md border border-success/40 bg-success-soft px-2 py-1.5 text-sm text-success">
        <span className="font-medium">{time}</span>
        <span className="flex items-center gap-1 text-xs">
          <Check className="size-3" aria-hidden /> Your session
        </span>
      </div>
    );
  }
  if (slot.availability === "unavailable") return null;
  const held = slot.availability === "held_by_you";
  return (
    <button
      type="button"
      onClick={() => onPick(slot)}
      className={cn(
        "flex w-full items-center justify-between rounded-md border bg-card px-2 py-1.5 text-sm font-medium transition-colors",
        "hover:border-primary hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        held && "border-primary/50 bg-accent",
      )}
    >
      <span>{time}</span>
      {held && (
        <span className="flex items-center gap-1 text-xs font-normal text-accent-foreground">
          <Hourglass className="size-3" aria-hidden /> Held
        </span>
      )}
    </button>
  );
}

function DayBody({ day, onPick }: { day: DayModel; onPick: (s: PublicSlot) => void }) {
  if (day.note) {
    return <p className="py-2 text-sm text-muted-foreground">{day.note}</p>;
  }
  return (
    <div className="flex flex-col gap-1.5">
      {day.slots.map((s) => (
        <SlotButton key={s.id} slot={s} onPick={onPick} />
      ))}
    </div>
  );
}

export function SlotPicker({
  weekStart,
  slots,
  timeOff,
  loading,
  onPick,
}: {
  weekStart: string;
  slots: PublicSlot[];
  timeOff: TimeOff[];
  loading: boolean;
  onPick: (s: PublicSlot) => void;
}) {
  const days = useMemo(() => buildDays(weekStart, slots, timeOff), [weekStart, slots, timeOff]);
  const [selected, setSelected] = useState<string>(weekStart);

  // Mobile: choose a sensible default day when the week (or data) changes.
  useEffect(() => {
    const firstOpen = days.find((d) => !d.note && !d.isPast) ?? days.find((d) => !d.isPast) ?? days[0];
    if (firstOpen) setSelected(firstOpen.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart, loading]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-7">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className={cn("space-y-2", i > 1 && "hidden md:block")}>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ))}
      </div>
    );
  }

  const sel = days.find((d) => d.key === selected) ?? days[0]!;

  return (
    <>
      {/* Desktop: 7 columns */}
      <div className="hidden grid-cols-7 gap-2 md:grid" data-testid="week-grid">
        {days.map((d) => (
          <section key={d.key} aria-label={formatKey(d.key, { weekday: "long", month: "long", day: "numeric" })} className={cn("min-w-0 rounded-lg border bg-card/50 p-2", d.isPast && "opacity-60")}>
            <header className="mb-2 border-b pb-2 text-center">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">{formatKey(d.key, { weekday: "short" })}</div>
              <div className="text-lg font-semibold leading-tight">{formatKey(d.key, { day: "numeric" })}</div>
              <div className="text-xs text-muted-foreground">{formatKey(d.key, { month: "short" })}</div>
            </header>
            <DayBody day={d} onPick={onPick} />
          </section>
        ))}
      </div>

      {/* Mobile: chip picker + list */}
      <div className="md:hidden">
        <div role="tablist" aria-label="Day" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2">
          {days.map((d) => {
            const active = d.key === sel.key;
            return (
              <button
                key={d.key}
                role="tab"
                aria-selected={active}
                type="button"
                onClick={() => setSelected(d.key)}
                className={cn(
                  "flex w-14 shrink-0 flex-col items-center rounded-xl border px-2 py-2 text-center transition-colors",
                  active ? "border-primary bg-primary text-primary-foreground" : "bg-card",
                  d.isPast && !active && "opacity-50",
                )}
              >
                <span className="text-[11px] uppercase tracking-wide opacity-80">{formatKey(d.key, { weekday: "short" })}</span>
                <span className="text-lg font-semibold leading-tight">{formatKey(d.key, { day: "numeric" })}</span>
                <span className={cn("mt-0.5 h-1 w-1 rounded-full", d.available > 0 ? (active ? "bg-primary-foreground" : "bg-primary") : "bg-transparent")} />
              </button>
            );
          })}
        </div>
        <div className="mt-3 rounded-lg border bg-card/50 p-3">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-medium">{formatKey(sel.key, { weekday: "long", month: "long", day: "numeric" })}</h3>
            {sel.available > 0 && <Badge variant="secondary">{sel.available} open</Badge>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {sel.note ? <p className="col-span-2 py-2 text-sm text-muted-foreground">{sel.note}</p> : sel.slots.map((s) => <SlotButton key={s.id} slot={s} onPick={onPick} />)}
          </div>
        </div>
      </div>
    </>
  );
}
