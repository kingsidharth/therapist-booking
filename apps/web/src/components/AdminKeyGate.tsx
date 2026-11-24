import { useState, type FormEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setAdminKey } from "@/lib/api";

const STORAGE_KEY = "therapist-admin-key";

function readStored(): string {
  try {
    return sessionStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Valid keys are remembered for this browser tab only (sessionStorage). */
function persist(key: string) {
  try {
    if (key) sessionStorage.setItem(STORAGE_KEY, key);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable — key stays in memory only */
  }
}

async function checkKey(key: string): Promise<boolean> {
  const res = await fetch("/api/admin/events?limit=1", {
    headers: { Authorization: `Bearer ${key}` },
  });
  return res.ok;
}

/**
 * The therapist API is protected by a bearer key (generated into
 * apps/server/data/admin-key, or ADMIN_KEY). Asks for it once per tab.
 */
export function AdminKeyGate({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [key, setKey] = useState(() => {
    const stored = readStored();
    setAdminKey(stored);
    return stored;
  });
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const value = draft.trim();
    if (!value) return;
    setChecking(true);
    setError("");
    try {
      if (!(await checkKey(value))) {
        setError("That key wasn't accepted. Check apps/server/data/admin-key.");
        return;
      }
      setAdminKey(value);
      persist(value);
      await qc.invalidateQueries({ queryKey: ["admin"] });
      setKey(value);
    } catch {
      setError("Couldn't reach the server. Is the API running?");
    } finally {
      setChecking(false);
    }
  }

  if (key) return <>{children}</>;

  return (
    <section className="panel booking-panel mx-auto mt-10 max-w-md">
      <KeyRound className="mb-4 text-primary" aria-hidden />
      <h1 className="display text-3xl">Therapist access</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The schedule shows client names and contact details, so it needs the
        therapist access key. Find it in <code>apps/server/data/admin-key</code>{" "}
        (or set <code>ADMIN_KEY</code> when starting the server).
      </p>
      <form className="mt-6 grid gap-3" onSubmit={submit}>
        <Label htmlFor="admin-key">Access key</Label>
        <Input
          id="admin-key"
          type="password"
          autoComplete="off"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button disabled={checking || !draft.trim()}>
          {checking ? "Checking…" : "Unlock schedule"}
        </Button>
      </form>
    </section>
  );
}
