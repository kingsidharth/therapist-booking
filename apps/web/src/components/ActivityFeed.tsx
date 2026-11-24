import type { AdminEventsResponse } from "@app/shared";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { displayName } from "@/lib/identity";
import { useAdminEvents } from "@/lib/queries";
import { formatSession, relativeTime } from "@/lib/time";

type Ev = AdminEventsResponse["events"][number];

function describe(e: Ev, tz: string): string {
  const who = e.client ? displayName(e.client) : e.actor === "therapist" ? "You" : "A client";
  const when = e.slotStartAt ? formatSession(e.slotStartAt, tz) : "";
  switch (e.type) {
    case "booked":
      return `${who} booked ${when}`;
    case "rescheduled":
      return `${who} rescheduled to ${when}`;
    case "cancelled":
      return `${e.actor === "therapist" ? "You cancelled" : `${who} cancelled`} ${when}`;
    case "slot_blocked":
      return `You blocked ${when}`;
    case "slot_released":
      return `${when} was released`;
  }
}

export function ActivityFeed({ tz }: { tz: string }) {
  const q = useAdminEvents();
  return (
    <Card className="h-fit gap-3 p-4">
      <h2 className="font-semibold">Recent activity</h2>
      {q.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : q.isError ? (
        <p className="text-sm text-muted-foreground">Activity is unavailable right now.</p>
      ) : q.data.events.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing yet.</p>
      ) : (
        <ul className="divide-y">
          {q.data.events.map((e) => (
            <li key={e.id} className="py-2 text-sm">
              <p>{describe(e, tz)}</p>
              <p className="text-xs text-muted-foreground">{relativeTime(e.at)}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
