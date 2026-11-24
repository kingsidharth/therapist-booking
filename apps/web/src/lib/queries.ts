import { MutationCache, QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { CancelBookingRequest, IdentifyRequest } from "@app/shared";
import { api, ApiError } from "./api";
import { identityStore, useIdentity } from "./identity";

export const keys = {
  therapist: ["therapist"] as const,
  slots: (range: { from: string; to: string }, clientId: string | null) =>
    ["slots", range.from, range.to, clientId] as const,
  slotsAll: ["slots"] as const,
  myBookings: (clientId: string | null) => ["myBookings", clientId] as const,
  adminSchedule: (range: { from: string; to: string }) => ["admin", "schedule", range.from, range.to] as const,
  adminEvents: ["admin", "events"] as const,
  adminClients: ["admin", "clients"] as const,
  adminAll: ["admin"] as const,
};

export const queryClient: QueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 1,
      staleTime: 10_000,
      refetchOnWindowFocus: true,
    },
  },
  mutationCache: new MutationCache({
    onError: (err) => {
      if (err instanceof ApiError && (err.code === "SLOT_UNAVAILABLE" || err.code === "HOLD_EXPIRED")) {
        toast.error(err.message);
        void queryClient.invalidateQueries({ queryKey: keys.slotsAll });
      }
    },
  }),
});

export const errorMessage = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong.");

export function useTherapist() {
  return useQuery({ queryKey: keys.therapist, queryFn: api.therapist, staleTime: 5 * 60_000 });
}

export function useSlots(range: { from: string; to: string }) {
  const id = useIdentity();
  const clientId = id?.clientId ?? null;
  return useQuery({
    queryKey: keys.slots(range, clientId),
    queryFn: () => api.slots(range),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });
}

export function useMyBookings() {
  const id = useIdentity();
  return useQuery({
    queryKey: keys.myBookings(id?.clientId ?? null),
    queryFn: api.myBookings,
    enabled: !!id,
    refetchInterval: 60_000,
  });
}

export function useIdentify() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: IdentifyRequest) => api.identify(b),
    onSuccess: ({ client }) => {
      identityStore.set({ clientId: client.id, contact: client.contact, name: client.name });
      void qc.invalidateQueries({ queryKey: keys.slotsAll });
    },
  });
}

export function useUpdateMe() {
  return useMutation({
    mutationFn: (name: string) => api.updateMe({ name }),
    onSuccess: ({ client }) => identityStore.set({ clientId: client.id, contact: client.contact, name: client.name }),
  });
}

function useInvalidateBookingState() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: keys.slotsAll });
    void qc.invalidateQueries({ queryKey: ["myBookings"] });
    void qc.invalidateQueries({ queryKey: keys.adminAll });
  };
}

export function useCreateHold() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slotId: string) => api.createHold(slotId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.slotsAll }),
  });
}

export function useReleaseHold() {
  const invalidate = useInvalidateBookingState();
  return useMutation({ mutationFn: (slotId: string) => api.releaseHold(slotId), onSettled: invalidate });
}

export function useCreateBooking() {
  const invalidate = useInvalidateBookingState();
  return useMutation({
    mutationFn: (b: { slotId: string; notes?: string }) => api.createBooking(b),
    onSuccess: invalidate,
  });
}

export function useReschedule() {
  const invalidate = useInvalidateBookingState();
  return useMutation({
    mutationFn: (v: { bookingId: string; newSlotId: string }) => api.reschedule(v.bookingId, v.newSlotId),
    onSuccess: invalidate,
  });
}

export function useCancelBooking() {
  const invalidate = useInvalidateBookingState();
  return useMutation({
    mutationFn: (v: { bookingId: string } & CancelBookingRequest) => api.cancel(v.bookingId, { reason: v.reason }),
    onSuccess: invalidate,
  });
}

// ---- therapist ----

export function useAdminSchedule(range: { from: string; to: string }) {
  return useQuery({
    queryKey: keys.adminSchedule(range),
    queryFn: () => api.adminSchedule(range),
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });
}

export function useAdminEvents() {
  return useQuery({ queryKey: keys.adminEvents, queryFn: () => api.adminEvents(30), refetchInterval: 30_000 });
}

export function useAdminClients(enabled = true) {
  return useQuery({ queryKey: keys.adminClients, queryFn: api.adminClients, enabled });
}

export function useAdminBlock() {
  const invalidate = useInvalidateBookingState();
  return useMutation({
    mutationFn: (v: { slotId: string; reason?: string }) => api.adminBlock(v.slotId, { reason: v.reason }),
    onSuccess: invalidate,
  });
}

export function useAdminUnblock() {
  const invalidate = useInvalidateBookingState();
  return useMutation({ mutationFn: (slotId: string) => api.adminUnblock(slotId), onSuccess: invalidate });
}

export function useAdminCancel() {
  const invalidate = useInvalidateBookingState();
  return useMutation({
    mutationFn: (v: { bookingId: string; reason?: string }) => api.adminCancel(v.bookingId, { reason: v.reason }),
    onSuccess: invalidate,
  });
}
