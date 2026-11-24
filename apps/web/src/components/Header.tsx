import { CalendarHeart, LayoutDashboard, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { navigate } from "@/hooks/use-path";
import { displayName, identityStore, useIdentity } from "@/lib/identity";
import { queryClient } from "@/lib/queries";

export function Header({ isTherapist }: { isTherapist: boolean }) {
  const id = useIdentity();
  return (
    <header className="border-b bg-card/60 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate("/");
          }}
          className="flex items-center gap-2 font-semibold tracking-tight"
        >
          <img src="/icon.svg" alt="" className="size-7 rounded-md" />
          <span>Therapy Notes</span>
        </a>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {!isTherapist && id && (
            <span className="flex items-center gap-1.5 text-muted-foreground" data-testid="identity">
              <UserRound className="size-4" aria-hidden />
              <span>
                Booking as <span className="font-medium text-foreground">{displayName(id)}</span>
              </span>
              <span aria-hidden>·</span>
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0"
                onClick={() => {
                  identityStore.set(null);
                  queryClient.removeQueries({ queryKey: ["myBookings"] });
                }}
              >
                Switch
              </Button>
            </span>
          )}
          {isTherapist ? (
            <Button variant="outline" size="sm" onClick={() => navigate("/")}>
              <CalendarHeart /> Client booking page
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => navigate("/therapist")}>
              <LayoutDashboard /> Therapist view
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
