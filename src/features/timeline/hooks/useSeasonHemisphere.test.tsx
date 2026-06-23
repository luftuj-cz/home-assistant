import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSeasonHemisphere } from "./useSeasonHemisphere";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useSeasonHemisphere", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads and saves season hemisphere setting", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ hemisphere: "northern" })))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ hemisphere: "southern" })));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSeasonHemisphere(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.data?.hemisphere).toBe("northern"));
    await result.current.save.mutateAsync("southern");

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://localhost:3000/api/settings/season-hemisphere",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hemisphere: "southern" }),
      },
    );
  });
});
