import { useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Globe2,
  MapPin,
  Sunrise,
  Sun,
  Moon,
  NotebookPen,
} from "lucide-react";
import { toast } from "sonner";
import type { Booking, PublicSlot, Therapist } from "@app/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorState } from "@/components/ErrorState";
import { BookingDialog } from "@/components/BookingDialog";
import { useIdentity } from "@/lib/identity";
import {
  useSlots,
  useMyBookings,
  useIdentify,
  useCancelBooking,
  useTherapist,
  errorMessage,
} from "@/lib/queries";
import {
  addDays,
  dateKeyInTz,
  formatKey,
  formatTime,
  formatSession,
  viewerTz,
  weekRange,
} from "@/lib/time";

function Profile({ therapist }: { therapist: Therapist }) {
  return (
    <aside className="profile panel">
      <div className="landscape" aria-hidden="true">
        <i className="sun-disc" />
        <i className="hill far" />
        <i className="hill near" />
        <i className="hill front" />
      </div>
      <div className="p-6">
        <span className="eyebrow">Your therapist</span>
        <h2 className="display mt-2 text-3xl">{therapist.name}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {therapist.credentials}
        </p>
        <p className="mt-5 text-sm leading-6">{therapist.bio}</p>
        <div className="my-5 flex flex-wrap gap-2">
          {therapist.specialties.map((item) => (
            <span className="tag" key={item}>
              {item}
            </span>
          ))}
        </div>
        <p className="profile-line">
          <MapPin />
          {therapist.location}
        </p>
        <p className="profile-line">
          <Clock3 />
          {therapist.policies.sessionMinutes}-minute sessions
        </p>
      </div>
    </aside>
  );
}

function BookingPanel({
  therapist,
  moving,
  done,
}: {
  therapist: Therapist;
  moving: Booking | null;
  done: () => void;
}) {
  const today = dateKeyInTz(Date.now(), viewerTz);
  const [start, setStart] = useState(today);
  const [day, setDay] = useState("");
  const [slot, setSlot] = useState<PublicSlot | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [booked, setBooked] = useState(false);
  const slots = useSlots(weekRange(start, viewerTz));
  const available = (slots.data?.slots ?? []).filter(
    (s) => s.availability === "available" || s.availability === "held_by_you",
  );
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const activeDay =
    day ||
    available
      .map((s) => dateKeyInTz(s.startAt, viewerTz))
      .find((d) => days.includes(d)) ||
    start;
  const times = available.filter(
    (s) => dateKeyInTz(s.startAt, viewerTz) === activeDay,
  );
  function step(amount: number) {
    setStart(addDays(start, amount));
    setDay("");
    setSlot(null);
  }
  if (slots.error)
    return (
      <ErrorState error={slots.error} onRetry={() => void slots.refetch()} />
    );
  return (
    <section className="panel booking-panel">
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="eyebrow">Availability</span>
          <h2 className="display mt-2 text-3xl">Choose a date</h2>
        </div>
        <CalendarDays className="text-primary size-6" />
      </div>
      {moving && (
        <p className="my-3 text-sm">
          Moving your session from{" "}
          {formatSession(moving.slot.startAt, viewerTz)}.
        </p>
      )}
      <div className="mt-7 mb-3 flex items-center justify-between">
        <strong>{formatKey(start, { month: "long", year: "numeric" })}</strong>
        <div className="flex gap-2">
          <Button
            aria-label="Previous week"
            variant="outline"
            size="icon"
            disabled={start === today}
            onClick={() => step(-7)}
          >
            <ChevronLeft />
          </Button>
          <Button
            aria-label="Next week"
            variant="outline"
            size="icon"
            disabled={
              addDays(start, 7) > addDays(today, therapist.policies.horizonDays)
            }
            onClick={() => step(7)}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 sm:gap-2">
        {days.map((d) => (
          <button
            className="date-tile"
            aria-pressed={activeDay === d}
            key={d}
            aria-label={formatKey(d, { dateStyle: "full" })}
            onClick={() => {
              setDay(d);
              setSlot(null);
            }}
          >
            <small>{formatKey(d, { weekday: "short" })}</small>
            <strong>{Number(d.slice(-2))}</strong>
            <i
              className={
                available.some((s) => dateKeyInTz(s.startAt, viewerTz) === d)
                  ? "has-times"
                  : ""
              }
            />
          </button>
        ))}
      </div>
      <hr className="my-6" />
      <h3 className="display text-2xl">Available times</h3>
      <p className="mt-1 mb-4 text-sm text-muted-foreground">
        {formatKey(activeDay, {
          weekday: "long",
          month: "long",
          day: "numeric",
        })}
      </p>
      {slots.isLoading ? (
        <p>Loading times…</p>
      ) : times.length === 0 ? (
        <p className="rounded-lg bg-secondary p-4 text-sm">
          No available sessions on this date. Choose another day or week.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {times.map((s) => {
            const hour = new Date(s.startAt).getHours(),
              Icon = hour < 12 ? Sunrise : hour < 18 ? Sun : Moon;
            return (
              <button
                key={s.id}
                className="time-tile"
                aria-pressed={s.id === slot?.id}
                onClick={() => setSlot(s)}
              >
                <Icon />
                {formatTime(s.startAt, viewerTz)}
              </button>
            );
          })}
        </div>
      )}
      <p className="profile-line mt-5">
        <Globe2 />
        {viewerTz.replaceAll("_", " ")}
      </p>
      <div className="mt-7 flex flex-wrap justify-between items-center gap-3 border-t pt-5">
        <span className="text-sm text-muted-foreground">
          {slot
            ? formatSession(slot.startAt, viewerTz)
            : "Select a time to continue"}
        </span>
        <Button
          disabled={!slot || !times.some((s) => s.id === slot.id)}
          onClick={() => setConfirm(true)}
        >
          Continue <ArrowRight />
        </Button>
      </div>
      {confirm && slot && (
        // Identify (if needed) → hold with countdown → confirm; releases the hold on close.
        <BookingDialog
          key={slot.id}
          slot={slot}
          reschedule={moving}
          therapist={therapist}
          onClose={() => {
            setConfirm(false);
            if (booked) done();
          }}
          onBooked={() => setBooked(true)}
          onViewSessions={() => {
            setConfirm(false);
            done();
          }}
        />
      )}
    </section>
  );
}

function Sessions({
  reschedule,
  book,
}: {
  reschedule: (b: Booking) => void;
  book: () => void;
}) {
  const identity = useIdentity(),
    bookings = useMyBookings(),
    identify = useIdentify(),
    cancel = useCancelBooking();
  const [contact, setContact] = useState(""),
    [target, setTarget] = useState<Booking | null>(null);
  return (
    <section className="panel booking-panel">
      <NotebookPen className="mb-4 text-primary" />
      <h2 className="display text-3xl">My sessions</h2>
      {!identity ? (
        <form
          className="mt-5 grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            identify.mutate({ contact });
          }}
        >
          <Label htmlFor="lookup">
            Enter the email or phone number you booked with.
          </Label>
          <Input
            id="lookup"
            required
            value={contact}
            onChange={(e) => setContact(e.target.value)}
          />
          {identify.error && <p role="alert">{errorMessage(identify.error)}</p>}
          <Button disabled={identify.isPending}>Find my sessions</Button>
        </form>
      ) : bookings.error ? (
        <ErrorState
          error={bookings.error}
          onRetry={() => void bookings.refetch()}
        />
      ) : bookings.isLoading ? (
        <p>Loading sessions…</p>
      ) : (
        <>
          {!bookings.data?.upcoming.length && (
            <div className="my-6">
              <p className="mb-4">You have no upcoming sessions.</p>
              <Button onClick={book}>Book a session</Button>
            </div>
          )}
          {bookings.data?.upcoming.map((b) => (
            <article key={b.id} className="space-y-3 border-b py-5">
              <strong>{formatSession(b.slot.startAt, viewerTz)}</strong>
              <p className="text-sm">
                {viewerTz} · Confirmed
                {b.rescheduleCount > 0 && ` · Rescheduled ×${b.rescheduleCount}`}
              </p>
              {b.notes && (
                <p className="text-sm text-muted-foreground">“{b.notes}”</p>
              )}
              {b.canModify ? (
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => reschedule(b)}>
                    Reschedule
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      cancel.reset();
                      setTarget(b);
                    }}
                  >
                    Cancel session
                  </Button>
                </div>
              ) : (
                <p className="text-sm">
                  The window for online changes has closed.
                </p>
              )}
            </article>
          ))}
          {!!bookings.data?.past.length && (
            <details className="mt-6">
              <summary>Past and cancelled sessions</summary>
              {bookings.data.past.map((b) => (
                <p className="mt-3 text-sm" key={b.id}>
                  {formatSession(b.slot.startAt, viewerTz)} ·{" "}
                  {b.status === "cancelled" ? "Cancelled" : "Past"}
                </p>
              ))}
            </details>
          )}
        </>
      )}
      <Dialog
        open={!!target}
        onOpenChange={(o) => {
          if (!o && !cancel.isPending) setTarget(null);
        }}
      >
        <DialogContent>
          <DialogTitle>Cancel this session?</DialogTitle>
          <DialogDescription>
            {target && formatSession(target.slot.startAt, viewerTz)} will become
            available to other clients.
          </DialogDescription>
          {cancel.error && <p role="alert">{errorMessage(cancel.error)}</p>}
          <Button
            variant="destructive"
            disabled={cancel.isPending}
            onClick={() =>
              target &&
              cancel.mutate(
                { bookingId: target.id },
                {
                  onSuccess: () => {
                    setTarget(null);
                    toast.success("Session cancelled");
                  },
                },
              )
            }
          >
            Confirm cancellation
          </Button>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export function ClientView() {
  const therapist = useTherapist(),
    identity = useIdentity();
  const [tab, setTab] = useState("booking"),
    [moving, setMoving] = useState<Booking | null>(null);
  if (therapist.error)
    return (
      <ErrorState
        error={therapist.error}
        onRetry={() => void therapist.refetch()}
      />
    );
  return (
    <>
      <div className="page-heading">
        <span className="eyebrow">Client portal</span>
        <h1 className="display">
          {moving && tab === "booking"
            ? "Reschedule your session"
            : "Session booking"}
        </h1>
        <p>
          Find a time with your therapist and manage your upcoming sessions.
        </p>
      </div>
      <nav className="section-tabs" aria-label="Booking options">
        <button
          aria-current={tab === "booking" ? "page" : undefined}
          onClick={() => {
            setMoving(null);
            setTab("booking");
          }}
        >
          <CalendarDays />
          Book a session
        </button>
        <button
          aria-current={tab === "sessions" ? "page" : undefined}
          onClick={() => {
            setMoving(null);
            setTab("sessions");
          }}
        >
          <NotebookPen />
          My sessions
        </button>
      </nav>
      {therapist.data ? (
        <div className="booking-grid">
          <Profile therapist={therapist.data.therapist} />
          {tab === "booking" ? (
            <BookingPanel
              key={identity?.clientId && moving ? moving.id : "booking"}
              therapist={therapist.data.therapist}
              moving={moving}
              done={() => {
                setMoving(null);
                setTab("sessions");
              }}
            />
          ) : (
            <Sessions
              reschedule={(b) => {
                setMoving(b);
                setTab("booking");
              }}
              book={() => setTab("booking")}
            />
          )}
        </div>
      ) : (
        <p>Loading schedule…</p>
      )}
    </>
  );
}
