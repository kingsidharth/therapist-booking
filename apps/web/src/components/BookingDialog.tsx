import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, CalendarCheck, CircleAlert, Clock, Loader2, Timer } from "lucide-react";
import { toast } from "sonner";
import { normalizeContact, type Booking, type Hold, type PublicSlot, type Therapist } from "@app/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api";
import { displayName, useIdentity } from "@/lib/identity";
import {
  errorMessage,
  useCreateBooking,
  useCreateHold,
  useIdentify,
  useReleaseHold,
  useReschedule,
  useUpdateMe,
} from "@/lib/queries";
import { formatCountdown, formatSession, viewerTz } from "@/lib/time";
import { useNow } from "@/hooks/use-now";

type Step = "identify" | "holding" | "confirm" | "done" | "failed";

export function BookingDialog({
  slot,
  reschedule,
  therapist,
  onClose,
  onViewSessions,
  onBooked,
}: {
  slot: PublicSlot;
  reschedule: Booking | null;
  therapist: Therapist;
  onClose: () => void;
  onViewSessions: () => void;
  onBooked: () => void;
}) {
  const id = useIdentity();
  const wasReschedule = useRef(!!reschedule).current;
  const [step, setStep] = useState<Step>(id ? "holding" : "identify");
  const [hold, setHold] = useState<Hold | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lost, setLost] = useState<false | "expired" | "taken">(false); // set when server rejects
  const [contact, setContact] = useState("");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const started = useRef(false);

  const identify = useIdentify();
  const updateMe = useUpdateMe();
  const createHold = useCreateHold();
  const releaseHold = useReleaseHold();
  const createBooking = useCreateBooking();
  const doReschedule = useReschedule();

  const now = useNow(1000, step === "confirm");
  const remaining = hold ? new Date(hold.expiresAt).getTime() - now : 0;
  const expired = step === "confirm" && (lost || remaining <= 0);

  const placeHold = useCallback(async () => {
    setStep("holding");
    setError(null);
    setLost(false);
    try {
      const r = await createHold.mutateAsync(slot.id);
      setHold(r.hold);
      setStep("confirm");
    } catch (e) {
      setError(errorMessage(e));
      setStep("failed");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot.id]);

  useEffect(() => {
    if (id && step === "holding" && !started.current) {
      started.current = true;
      void placeHold();
    }
  }, [id, step, placeHold]);

  const close = () => {
    if (step === "confirm" && hold && !expired) releaseHold.mutate(slot.id);
    onClose();
  };

  const submitIdentify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!normalizeContact(contact)) {
      setError("Enter a valid email address or phone number.");
      return;
    }
    try {
      await identify.mutateAsync({ contact: contact.trim(), name: name.trim() || undefined });
      setStep("holding");
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const needName = !!id && !id.name;
  const busy = createBooking.isPending || doReschedule.isPending || updateMe.isPending;

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (needName && name.trim()) await updateMe.mutateAsync(name.trim());
      if (reschedule) await doReschedule.mutateAsync({ bookingId: reschedule.id, newSlotId: slot.id });
      else await createBooking.mutateAsync({ slotId: slot.id, notes: notes.trim() || undefined });
      setStep("done");
      onBooked();
      toast.success(wasReschedule ? "Session rescheduled" : "You're booked");
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError && err.code === "SLOT_UNAVAILABLE") setLost("taken");
      else if (err instanceof ApiError && err.code === "HOLD_EXPIRED") setLost("expired");
    }
  };

  const when = formatSession(slot.startAt, viewerTz);
  const p = therapist.policies;
  const title =
    step === "done" ? (wasReschedule ? "Session rescheduled" : "You're booked") : step === "identify" ? "Book this time" : reschedule ? "Confirm new time" : "Confirm your session";

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-md" onInteractOutside={(e) => busy && e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="flex items-center gap-1.5">
            <Clock className="size-3.5" aria-hidden /> {when} · {p.sessionMinutes} min
          </DialogDescription>
        </DialogHeader>

        {step === "identify" && (
          <form onSubmit={submitIdentify} className="space-y-4">
            <p className="text-sm text-muted-foreground">Tell us how to reach you. There's no password — your email or phone is how we find your sessions again.</p>
            <div className="space-y-1.5">
              <Label htmlFor="contact">Email or phone</Label>
              <Input id="contact" autoFocus autoComplete="email" inputMode="email" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="you@example.com or +1 555 123 4567" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="name">Your name (optional)</Label>
              <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            {error && <InlineError message={error} />}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
              <Button type="submit" disabled={identify.isPending}>
                {identify.isPending && <Loader2 className="animate-spin" />} Continue
              </Button>
            </DialogFooter>
          </form>
        )}

        {step === "holding" && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Holding this time for you…
          </div>
        )}

        {step === "failed" && (
          <div className="space-y-4">
            <InlineError message={error ?? "We couldn't hold this time."} />
            <DialogFooter>
              <Button onClick={onClose}>Choose another time</Button>
            </DialogFooter>
          </div>
        )}

        {step === "confirm" && hold && (
          expired ? (
            <div className="space-y-4">
              <InlineError message={error ?? "Your hold expired and the time was released."} />
              <DialogFooter>
                <Button variant="ghost" onClick={onClose}>Close</Button>
                {lost !== "taken" ? (
                  <Button onClick={() => { started.current = true; void placeHold(); }}>Hold it again</Button>
                ) : null}
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={confirm} className="space-y-4">
              {reschedule && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted p-3 text-sm">
                  <span className="text-muted-foreground line-through">{formatSession(reschedule.slot.startAt, viewerTz)}</span>
                  <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
                  <span className="font-medium">{when}</span>
                </div>
              )}
              <div className="flex items-center gap-1.5 text-sm font-medium text-success" role="timer" aria-live="off">
                <Timer className="size-4" aria-hidden /> Held for you · <span className="tabular-nums">{formatCountdown(remaining)}</span>
              </div>
              {needName && (
                <div className="space-y-1.5">
                  <Label htmlFor="your-name">Your name (optional)</Label>
                  <Input id="your-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
              )}
              {!reschedule && (
                <div className="space-y-1.5">
                  <Label htmlFor="notes">Anything you'd like {therapist.name} to know?</Label>
                  <Textarea id="notes" rows={3} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Free changes up to {p.changeCutoffHours}h before your session. Booking as {id ? displayName(id) : ""}.
              </p>
              {error && <InlineError message={error} />}
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={close} disabled={busy}>Cancel</Button>
                <Button type="submit" disabled={busy}>
                  {busy && <Loader2 className="animate-spin" />} {reschedule ? "Confirm new time" : "Confirm booking"}
                </Button>
              </DialogFooter>
            </form>
          )
        )}

        {step === "done" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-lg bg-success-soft p-4 text-success">
              <CalendarCheck className="size-6 shrink-0" aria-hidden />
              <div className="text-sm">
                <p className="font-medium">{when}</p>
                <p>with {therapist.name} · {p.sessionMinutes} min</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Free changes up to {p.changeCutoffHours}h before your session.</p>
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>Done</Button>
              <Button onClick={() => { onViewSessions(); }}>View my sessions</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> <span>{message}</span>
    </div>
  );
}
