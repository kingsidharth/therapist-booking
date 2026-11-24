import { useMemo, useState } from "react";
import { Ban, Hourglass, RefreshCw, StickyNote } from "lucide-react";
import type { AdminSlot, SlotStatus } from "@app/shared";
import { AdminSlotDialog } from "@/components/AdminSlotDialog";
import { ActivityFeed } from "@/components/ActivityFeed";
import { ClientsTable } from "@/components/ClientsTable";
import { ErrorState } from "@/components/ErrorState";
import { WeekNav } from "@/components/WeekNav";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { displayName } from "@/lib/identity";
import { useAdminSchedule, useTherapist } from "@/lib/queries";
import { addDays, dateKeyInTz, formatHourLabel, formatKey, formatTime, mondayOf, partsInTz, relativeTime, tzLabel, weekRange } from "@/lib/time";
import { cn } from "@/lib/utils";

const MAX_BACK_WEEKS = 3;

const STATUS_STYLE: Record<SlotStatus, string> = {
  booked: "border-primary/40 bg-accent text-accent-foreground",
  open: "border-success/40 bg-success-soft text-success",
  held: "border-warning/50 bg-warning-soft text-warning",
  blocked: "border-border bg-muted text-muted-foreground hatched",
};

export function TherapistView() {
  const therapistQ = useTherapist();
  const tz = therapistQ.data?.therapist.timezone ?? "America/New_York";
  const todayKey = dateKeyInTz(new Date(), tz);
  const thisMonday = mondayOf(todayKey);
  const [weekStart, setWeekStart] = useState<string | null>(null);
  const week = weekStart ?? thisMonday;
  const range = useMemo(() => weekRange(week, tz), [week, tz]);
  const q = useAdminSchedule(range);
  const [selected, setSelected] = useState<string | null>(null);

  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const slots = q.data?.slots ?? [];
  const byCell = useMemo(() => {
    const m = new Map<string, AdminSlot>();
    for (const s of slots) {
      const p = partsInTz(s.startAt, tz);
      m.set(`${dateKeyInTz(s.startAt, tz)}|${p.hour}`, s);
    }
    return m;
  }, [slots, tz]);

  const hours = useMemo(() => {
    let min = 9;
    let max = 19;
    for (const s of slots) {
      const h = partsInTz(s.startAt, tz).hour;
      min = Math.min(min, h);
      max = Math.max(max, h);
    }
    return Array.from({ length: max - min + 1 }, (_, i) => min + i);
  }, [slots, tz]);

  const selectedSlot = selected ? slots.find((s) => s.id === selected) ?? null : null;
  const stats = q.data?.stats;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Schedule</h1>
        <p className="text-sm text-muted-foreground">
          {therapistQ.data ? therapistQ.data.therapist.name : ""} · Times in {tzLabel(tz)}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5" data-testid="stats">
        {(
          [
            ["Booked", stats?.booked],
            ["Open", stats?.open],
            ["Held", stats?.held],
            ["Blocked", stats?.blocked],
            ["Utilization", stats ? `${Math.round(stats.utilization * 100)}%` : undefined],
          ] as const
        ).map(([label, value]) => (
          <Card key={label} className="gap-1 px-4 py-3">
            <span className="text-xs text-muted-foreground">{label}</span>
            {value === undefined ? <Skeleton className="h-7 w-10" /> : <span className="text-2xl font-semibold tabular-nums">{value}</span>}
          </Card>
        ))}
      </div>

      <Tabs defaultValue="schedule">
        <TabsList>
          <TabsTrigger value="schedule">Schedule</TabsTrigger>
          <TabsTrigger value="clients">Clients</TabsTrigger>
        </TabsList>

        <TabsContent value="schedule" className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-3">
            <WeekNav
              weekStart={week}
              onPrev={() => setWeekStart(addDays(week, -7))}
              onNext={() => setWeekStart(addDays(week, 7))}
              onToday={() => setWeekStart(null)}
              prevDisabled={week <= addDays(thisMonday, -7 * MAX_BACK_WEEKS)}
              todayDisabled={week === thisMonday}
            />
            {q.isError && !q.data ? (
              <ErrorState error={q.error} onRetry={() => q.refetch()} title="We couldn't load the schedule" />
            ) : (
              <div className="overflow-x-auto rounded-xl border bg-card">
                <div className="grid min-w-[760px] grid-cols-[56px_repeat(7,minmax(0,1fr))]" role="grid" aria-label="Weekly schedule">
                  <div className="border-b" />
                  {days.map((d) => (
                    <div key={d} role="columnheader" className={cn("border-b border-l px-2 py-2 text-center", d === todayKey && "bg-accent/50")}>
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">{formatKey(d, { weekday: "short" })}</div>
                      <div className="font-semibold">{formatKey(d, { month: "short", day: "numeric" })}</div>
                    </div>
                  ))}
                  {hours.map((h) => (
                    <HourRow key={h} hour={h} days={days} byCell={byCell} loading={q.isPending} tz={tz} onSelect={setSelected} />
                  ))}
                </div>
              </div>
            )}
            <Legend />
          </div>
          <ActivityFeed tz={tz} />
        </TabsContent>

        <TabsContent value="clients" className="mt-4">
          <ClientsTable />
        </TabsContent>
      </Tabs>

      {selectedSlot && <AdminSlotDialog slot={selectedSlot} tz={tz} onClose={() => setSelected(null)} />}
    </div>
  );
}

function HourRow({
  hour,
  days,
  byCell,
  loading,
  tz,
  onSelect,
}: {
  hour: number;
  days: string[];
  byCell: Map<string, AdminSlot>;
  loading: boolean;
  tz: string;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      <div className="border-b px-2 py-2 text-right text-xs text-muted-foreground">{formatHourLabel(hour)}</div>
      {days.map((d) => {
        const s = byCell.get(`${d}|${hour}`);
        return (
          <div key={d} role="gridcell" className="min-h-[64px] border-b border-l p-1">
            {s ? <SlotCell slot={s} tz={tz} onClick={() => onSelect(s.id)} /> : loading ? <Skeleton className="h-full min-h-14 w-full" /> : <div className="hatched h-full min-h-14 rounded-md opacity-60" aria-label="No slot" />}
          </div>
        );
      })}
    </>
  );
}

function SlotCell({ slot, tz, onClick }: { slot: AdminSlot; tz: string; onClick: () => void }) {
  let label: string;
  let sub: string | null = null;
  if (slot.status === "booked" && slot.booking) {
    label = displayName(slot.booking.client);
    sub = null;
  } else if (slot.status === "held" && slot.hold) {
    label = displayName(slot.hold.client);
    sub = `until ${formatTime(slot.hold.expiresAt, tz)}`;
  } else if (slot.status === "blocked") {
    label = slot.blockReason || "Blocked";
  } else {
    label = "Open";
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-full min-h-14 w-full flex-col items-start justify-center gap-0.5 rounded-md border px-2 py-1 text-left text-xs transition-shadow hover:shadow-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        STATUS_STYLE[slot.status],
      )}
    >
      <span className="flex w-full items-center gap-1">
        {slot.status === "held" && <Hourglass className="size-3 shrink-0" aria-hidden />}
        {slot.status === "blocked" && <Ban className="size-3 shrink-0" aria-hidden />}
        <span className="truncate font-medium">{label}</span>
        {slot.status === "booked" && slot.booking?.notes && <StickyNote className="ml-auto size-3 shrink-0" aria-label="Has notes" />}
        {slot.status === "booked" && (slot.booking?.rescheduleCount ?? 0) > 0 && <RefreshCw className="size-3 shrink-0" aria-label="Rescheduled" />}
      </span>
      {sub && <span className="truncate opacity-80">{sub}</span>}
      {slot.status === "booked" && slot.booking && <span className="truncate opacity-70">booked {relativeTime(slot.booking.createdAt)}</span>}
    </button>
  );
}

function Legend() {
  const items: [string, string][] = [
    ["Booked", STATUS_STYLE.booked],
    ["Open", STATUS_STYLE.open],
    ["Held", STATUS_STYLE.held],
    ["Blocked", STATUS_STYLE.blocked],
  ];
  return (
    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
      {items.map(([l, c]) => (
        <span key={l} className="flex items-center gap-1.5">
          <span className={cn("size-3 rounded-sm border", c)} /> {l}
        </span>
      ))}
    </div>
  );
}
