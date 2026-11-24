import { useState } from "react";
import { CalendarClock, CalendarX2, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { Booking, MyBookingsResponse, Therapist } from "@app/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { errorMessage, useCancelBooking } from "@/lib/queries";
import { formatSession, relativeTime, viewerTz } from "@/lib/time";
import { cn } from "@/lib/utils";

export function MySessions({
  data,
  loading,
  therapist,
  onReschedule,
  onBrowse,
}: {
  data: MyBookingsResponse | undefined;
  loading: boolean;
  therapist: Therapist | undefined;
  onReschedule: (b: Booking) => void;
  onBrowse: () => void;
}) {
  const [cancelling, setCancelling] = useState<Booking | null>(null);
  const doctor = therapist?.name ?? "your therapist";

  if (loading && !data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const upcoming = data?.upcoming ?? [];
  const past = data?.past ?? [];

  return (
    <div className="space-y-8">
      <section aria-label="Upcoming sessions" className="space-y-3">
        {upcoming.length === 0 ? (
          <Card className="items-center gap-3 border-dashed px-6 py-10 text-center">
            <CalendarClock className="size-6 text-muted-foreground" aria-hidden />
            <p className="font-medium">No upcoming sessions</p>
            <Button onClick={onBrowse}>Find a time</Button>
          </Card>
        ) : (
          upcoming.map((b) => (
            <Card key={b.id} className="gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{formatSession(b.slot.startAt, viewerTz)}</p>
                  <span className="text-sm text-muted-foreground">{relativeTime(b.slot.startAt)}</span>
                  {b.rescheduleCount > 0 && (
                    <Badge variant="secondary" className="gap-1 font-normal">
                      <RefreshCw className="size-3" aria-hidden /> Rescheduled ×{b.rescheduleCount}
                    </Badge>
                  )}
                </div>
                {b.notes && <p className="line-clamp-2 break-words text-sm text-muted-foreground">“{b.notes}”</p>}
              </div>
              <div className="flex shrink-0 gap-2">
                <ModifyButton disabled={!b.canModify} doctor={doctor} cutoff={therapist?.policies.changeCutoffHours ?? 24} onClick={() => onReschedule(b)}>
                  Reschedule
                </ModifyButton>
                <ModifyButton disabled={!b.canModify} doctor={doctor} cutoff={therapist?.policies.changeCutoffHours ?? 24} onClick={() => setCancelling(b)} variant="ghost">
                  Cancel
                </ModifyButton>
              </div>
            </Card>
          ))
        )}
      </section>

      {past.length > 0 && (
        <section aria-label="History" className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">History</h2>
          <ul className="divide-y rounded-xl border bg-card/50 text-muted-foreground">
            {past.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span className={cn(b.status === "cancelled" && "line-through")}>{formatSession(b.slot.startAt, viewerTz)}</span>
                <span className="flex items-center gap-2">
                  {b.status === "cancelled" ? <Badge variant="outline" className="gap-1 font-normal"><CalendarX2 className="size-3" aria-hidden /> Cancelled</Badge> : <Badge variant="outline" className="font-normal">Completed</Badge>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {cancelling && <CancelDialog booking={cancelling} onClose={() => setCancelling(null)} />}
    </div>
  );
}

function ModifyButton({
  disabled,
  doctor,
  cutoff,
  onClick,
  variant = "outline",
  children,
}: {
  disabled: boolean;
  doctor: string;
  cutoff: number;
  onClick: () => void;
  variant?: "outline" | "ghost";
  children: React.ReactNode;
}) {
  const btn = (
    <Button variant={variant} size="sm" disabled={disabled} onClick={onClick}>
      {children}
    </Button>
  );
  if (!disabled) return btn;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0}>{btn}</span>
      </TooltipTrigger>
      <TooltipContent>Changes close {cutoff}h before your session — please contact {doctor}</TooltipContent>
    </Tooltip>
  );
}

function CancelDialog({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const cancel = useCancelBooking();
  return (
    <AlertDialog open onOpenChange={(o) => !o && !cancel.isPending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel this session?</AlertDialogTitle>
          <AlertDialogDescription>{formatSession(booking.slot.startAt, viewerTz)} will be released for others to book.</AlertDialogDescription>
        </AlertDialogHeader>
        <Textarea placeholder="Reason (optional)" aria-label="Reason" rows={2} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={cancel.isPending}>Keep session</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={cancel.isPending}
            onClick={async () => {
              setError(null);
              try {
                await cancel.mutateAsync({ bookingId: booking.id, reason: reason.trim() || undefined });
                toast.success("Session cancelled");
                onClose();
              } catch (e) {
                setError(errorMessage(e));
              }
            }}
          >
            {cancel.isPending && <Loader2 className="animate-spin" />} Cancel session
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
