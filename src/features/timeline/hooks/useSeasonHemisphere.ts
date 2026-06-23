import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { resolveApiUrl } from "@luftuj/shared/utils/api";
import { parseApiError } from "@luftuj/shared/utils/apiError";
import type { Hemisphere } from "@luftuj/shared/types/timeline";

export function useSeasonHemisphere() {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["season-hemisphere"],
    queryFn: async () => {
      const res = await fetch(resolveApiUrl("/api/settings/season-hemisphere"));
      if (!res.ok) throw await parseApiError(res);
      return (await res.json()) as { hemisphere: Hemisphere };
    },
    staleTime: 60_000,
  });

  const save = useMutation({
    mutationFn: async (hemisphere: Hemisphere) => {
      const res = await fetch(resolveApiUrl("/api/settings/season-hemisphere"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hemisphere }),
      });
      if (!res.ok) throw await parseApiError(res);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["season-hemisphere"] }),
  });

  return { ...query, save };
}
