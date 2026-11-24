import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { AdminSlot } from "@app/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage, useAdminBlock, useAdminCancel, useAdminUnblock } from "@/lib/queries";
import { formatCountdown, formatSession, formatTime } from "@/lib/time";

export function AdminSlotDialog({ slot, tz, onClose }: { slot: AdminSlot; tz: string; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const block = useAdminBlock();
  const unblock = useAdminUnblock();
  const cancel = useAdminCancel();
  const busy = block.isPending || unblock.isPending || cancel.isPending;

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setError(null);
    try {
      await fn();
      toast.success(ok);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const b = slot.booking;
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {formatSession(slot.startAt, tz)} <Badge variant="secondary" className="capitalize">{slot.status}</Badge>
          </DialogTitle>
          <DialogDescription>Until {formatTime(slot.endAt, tz)}</DialogDescription>
        </DialogHeader>

        {slot.status === "open" && (
          <div className="space-y-2">
            <Label htmlFor="block-reason">Reason (optional)</Label>
            <Input id="block-reason" maxLength={120} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Lunch, training" />
          </div>
        )}

        {slot.status === "blocked" && <p className="text-sm">{slot.blockReason ? <>Blocked: {slot.blockReason}</> : "Blocked, no reason given."}</p>}

        {slot.status === "held" && slot.hold && (
          <p className="text-sm">
            Held by <strong>{slot.hold.client.name ?? slot.hold.client.contact}</strong> until {formatTime(slot.hold.expiresAt, tz)} (
            <span className="tabular-nums">{formatCountdown(new Date(slot.hold.expiresAt).getTime() - Date.now())}</span> left). They are still confirming.
          </p>
        )}

        {slot.status === "booked" && b && (
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Client</dt>
              <dd className="font-medium">{b.client.name ?? "—"}</dd>
              <dd className="break-all text-muted-foreground">{b.client.contact}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Notes</dt>
              <dd className="whitespace-pre-wrap break-words">{b.notes || <span className="text-muted-foreground">None</span>}</dd>
            </div>
            {b.rescheduleCount > 0 && <Badge variant="outline">Rescheduled ×{b.rescheduleCount}</Badge>}
            {confirmCancel && (
              <div className="space-y-2 rounded-lg border border-destructive/30 p-3">
                <Label htmlFor="cancel-reason">Cancel this booking? Reason (optional)</Label>
                <Textarea id="cancel-reason" rows={2} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
            )}
          </dl>
        )}

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Close</Button>
          {slot.status === "open" && (
            <Button disabled={busy} onClick={() => run(() => block.mutateAsync({ slotId: slot.id, reason: reason.trim() || undefined }), "Slot blocked")}>
              {busy && <Loader2 className="animate-spin" />} Block
            </Button>
          )}
          {slot.status === "blocked" && (
            <Button disabled={busy} onClick={() => run(() => unblock.mutateAsync(slot.id), "Slot unblocked")}>
              {busy && <Loader2 className="animate-spin" />} Unblock
            </Button>
          )}
          {slot.status === "booked" && b && !confirmCancel && (
            <Button variant="destructive" onClick={() => setConfirmCancel(true)}>Cancel booking</Button>
          )}
          {slot.status === "booked" && b && confirmCancel && (
            <Button variant="destructive" disabled={busy} onClick={() => run(() => cancel.mutateAsync({ bookingId: b.id, reason: reason.trim() || undefined }), "Booking cancelled")}>
              {busy && <Loader2 className="animate-spin" />} Yes, cancel booking
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
