import { Clock, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Therapist } from "@app/shared";
import { tzLabel, viewerTz } from "@/lib/time";

export function TherapistCard({ therapist }: { therapist: Therapist | undefined }) {
  if (!therapist) {
    return (
      <Card className="gap-3 p-6">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-16 w-full" />
      </Card>
    );
  }
  const sameTz = therapist.timezone === viewerTz;
  return (
    <Card className="gap-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{therapist.name}</h1>
        <p className="text-sm text-muted-foreground">{therapist.credentials}</p>
      </div>
      <p className="max-w-3xl text-sm leading-relaxed">{therapist.bio}</p>
      <div className="flex flex-wrap gap-1.5">
        {therapist.specialties.map((s) => (
          <Badge key={s} variant="secondary" className="font-normal">
            {s}
          </Badge>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <MapPin className="size-4" aria-hidden /> {therapist.location}
        </span>
        <span className="flex items-center gap-1.5">
          <Clock className="size-4" aria-hidden /> {therapist.policies.sessionMinutes}-min sessions
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Times shown in {tzLabel(viewerTz)}
        {!sameTz && <> · therapist's time zone is {tzLabel(therapist.timezone)}</>}
      </p>
    </Card>
  );
}
