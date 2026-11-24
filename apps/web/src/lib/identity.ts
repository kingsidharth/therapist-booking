import { useSyncExternalStore } from "react";

export interface Identity {
  clientId: string;
  contact: string;
  name: string | null;
}

const KEY = "therapist-app:identity";
const listeners = new Set<() => void>();
let current: Identity | null = read();

function read(): Identity | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Identity;
    return v && typeof v.clientId === "string" ? v : null;
  } catch {
    return null;
  }
}

function emit() {
  for (const l of listeners) l();
}

export const identityStore = {
  get: () => current,
  set(next: Identity | null) {
    current = next;
    try {
      if (next) localStorage.setItem(KEY, JSON.stringify(next));
      else localStorage.removeItem(KEY);
    } catch {
      /* storage unavailable: keep in memory */
    }
    emit();
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

export function useIdentity(): Identity | null {
  return useSyncExternalStore(identityStore.subscribe, identityStore.get);
}

export function displayName(id: Pick<Identity, "name" | "contact">): string {
  return id.name?.trim() || id.contact;
}
