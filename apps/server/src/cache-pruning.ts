import { pruneExpired } from "@media-mcp/core";

export const CACHE_PRUNE_INTERVAL_MS = 60 * 60 * 1_000;

// The timer is unref'd so it never keeps the process alive, and pruneExpired never rejects, so a tick cannot become an unhandled rejection.
export const startCachePruning = (
  cacheDir: string,
  prune: (dir: string) => Promise<void> = pruneExpired,
): (() => void) => {
  const timer = setInterval(
    () => void prune(cacheDir),
    CACHE_PRUNE_INTERVAL_MS,
  );
  timer.unref();
  return () => clearInterval(timer);
};
