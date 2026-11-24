import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addDays, formatKey } from "@/lib/time";

export function WeekNav({
  weekStart,
  onPrev,
  onNext,
  onToday,
  prevDisabled,
  nextDisabled,
  todayDisabled,
}: {
  weekStart: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  prevDisabled?: boolean;
  nextDisabled?: boolean;
  todayDisabled?: boolean;
}) {
  const end = addDays(weekStart, 6);
  const sameMonth = formatKey(weekStart, { month: "short" }) === formatKey(end, { month: "short" });
  const label = `${formatKey(weekStart, { month: "short", day: "numeric" })} – ${formatKey(end, sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" })}, ${formatKey(end, { year: "numeric" })}`;
  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="icon" onClick={onPrev} disabled={prevDisabled} aria-label="Previous week">
        <ChevronLeft />
      </Button>
      <Button variant="outline" size="icon" onClick={onNext} disabled={nextDisabled} aria-label="Next week">
        <ChevronRight />
      </Button>
      <Button variant="outline" onClick={onToday} disabled={todayDisabled}>
        This week
      </Button>
      <span className="ml-1 text-sm font-medium" aria-live="polite">
        {label}
      </span>
    </div>
  );
}
