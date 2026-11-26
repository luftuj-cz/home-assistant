import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import * as api from "@luftuj/features/automatic/api";
import { notify } from "@luftuj/shared/ui/notify";
import { translateApiError } from "@luftuj/shared/utils/apiError";

/** Status and journal change on the backend's 10 s tick; 5 s keeps the page at most 5 s behind. */
const LIVE_REFRESH_MS = 5000;

export const automaticKeys = {
  status: ["automatic", "status"] as const,
  journal: ["automatic", "journal"] as const,
  rooms: ["automatic", "rooms"] as const,
  parameters: ["automatic", "parameters"] as const,
  candidates: ["automatic", "candidates"] as const,
};

export function useAutomaticStatus() {
  return useQuery({
    queryKey: automaticKeys.status,
    queryFn: api.fetchAutomaticStatus,
    refetchInterval: LIVE_REFRESH_MS,
  });
}

export function useAutomaticJournal() {
  return useQuery({
    queryKey: automaticKeys.journal,
    queryFn: () => api.fetchJournal(50),
    refetchInterval: LIVE_REFRESH_MS,
  });
}

export function useRooms() {
  return useQuery({ queryKey: automaticKeys.rooms, queryFn: api.fetchRooms });
}

export function useSensorCandidates(enabled: boolean) {
  return useQuery({
    queryKey: automaticKeys.candidates,
    queryFn: api.fetchSensorCandidates,
    enabled,
    // The picker shows live values; fresh enough while a dialog is open.
    refetchInterval: enabled ? 15_000 : false,
  });
}

export function useParameters() {
  return useQuery({ queryKey: automaticKeys.parameters, queryFn: api.fetchParameters });
}

function useInvalidateAutomatic() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["automatic"] });
  };
}

export function useSaveRoom() {
  const { t } = useTranslation();
  const invalidate = useInvalidateAutomatic();
  return useMutation({
    mutationFn: ({ id, input }: { id: number | null; input: api.RoomInput }) =>
      id === null ? api.createRoom(input) : api.updateRoom(id, input),
    onSuccess: () => {
      invalidate();
      notify({ variant: "success", message: t("automatic.rooms.saved") });
    },
    onError: (error) => {
      notify({
        variant: "error",
        title: t("automatic.rooms.saveFailed"),
        message: translateApiError(error, t),
      });
    },
  });
}

export function useDeleteRoom() {
  const { t } = useTranslation();
  const invalidate = useInvalidateAutomatic();
  return useMutation({
    mutationFn: (id: number) => api.deleteRoom(id),
    onSuccess: invalidate,
    onError: (error) => {
      notify({
        variant: "error",
        title: t("automatic.rooms.deleteFailed"),
        message: translateApiError(error, t),
      });
    },
  });
}

export function useSaveParameters() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.saveParameters,
    onSuccess: (payload) => {
      queryClient.setQueryData(automaticKeys.parameters, payload);
      void queryClient.invalidateQueries({ queryKey: automaticKeys.journal });
      notify({ variant: "success", message: t("automatic.parameters.saved") });
    },
    onError: (error) => {
      notify({
        variant: "error",
        title: t("automatic.parameters.saveFailed"),
        message: translateApiError(error, t),
      });
    },
  });
}
