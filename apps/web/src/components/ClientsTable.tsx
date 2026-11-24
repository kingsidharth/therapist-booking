import { ErrorState } from "@/components/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminClients } from "@/lib/queries";

export function ClientsTable() {
  const q = useAdminClients();
  if (q.isPending) return <Skeleton className="h-40 w-full" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} title="We couldn't load clients" />;
  if (q.data.clients.length === 0) return <p className="text-sm text-muted-foreground">No clients yet.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">Client</th>
            <th className="px-4 py-2 font-medium">Contact</th>
            <th className="px-4 py-2 text-right font-medium">Upcoming</th>
            <th className="px-4 py-2 text-right font-medium">Total sessions</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {q.data.clients.map((c) => (
            <tr key={c.id}>
              <td className="px-4 py-2 font-medium">{c.name ?? <span className="text-muted-foreground">—</span>}</td>
              <td className="px-4 py-2 break-all">{c.contact}</td>
              <td className="px-4 py-2 text-right tabular-nums">{c.upcomingCount}</td>
              <td className="px-4 py-2 text-right tabular-nums">{c.totalSessions}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
