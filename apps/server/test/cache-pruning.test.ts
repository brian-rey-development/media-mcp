import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CACHE_PRUNE_INTERVAL_MS,
  startCachePruning,
} from "../src/cache-pruning.js";
import { createLifecycle } from "../src/lifecycle.js";
import { createLogger } from "../src/logger.js";
import { httpTransport } from "../src/transports/http.js";
import { fakeServices } from "./support/fake-services.js";
import { TOKEN } from "./support/http-server.js";
import { freePort, waitFor } from "./support/server-process.js";
import { withTempDir } from "./support/temp-dir.js";

const EXPIRED_ENTRY = '{"expiresAt":1,"value":null}';
const SETTLE_MS = 100;

afterEach(() => vi.useRealTimers());

const timeouts = () =>
  process.getActiveResourcesInfo().filter((name) => name === "Timeout").length;

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

describe("cache pruning for a long-lived server", () => {
  it("prunes the cache folder once per interval until stopped", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const prune = vi.fn(async () => undefined);

    const stop = startCachePruning("/cache", prune);
    vi.advanceTimersByTime(CACHE_PRUNE_INTERVAL_MS - 1);
    expect(prune).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    vi.advanceTimersByTime(CACHE_PRUNE_INTERVAL_MS);
    stop();
    vi.advanceTimersByTime(CACHE_PRUNE_INTERVAL_MS);

    expect(prune.mock.calls).toEqual([["/cache"], ["/cache"]]);
  });

  it("does not keep the process alive", () => {
    const before = timeouts();

    const stop = startCachePruning("/cache", async () => undefined);

    expect(timeouts()).toBe(before);
    stop();
  });
});

describe("the HTTP transport", () => {
  const temp = withTempDir("media-mcp-prune-");

  const startTransport = async (cacheDir: string) => {
    const env = {
      MEDIA_MCP_HTTP_TOKEN: TOKEN,
      MEDIA_MCP_HTTP_PORT: String(await freePort()),
    };
    const transport = httpTransport(
      env,
      createLogger(() => undefined),
    );
    if (!transport.ok) throw new Error(transport.error.message);
    const booted = { services: fakeServices(), ytDlpVersion: "9.9", cacheDir };
    const started = await transport.value.start(booted, createLifecycle());
    if (!started.ok) throw new Error(started.error.message);
    return { started: started.value, port: env.MEDIA_MCP_HTTP_PORT };
  };

  it("describes itself to the shared runner and ignores stdin", async () => {
    const { started, port } = await startTransport(join(temp.path, "cache"));

    expect(started.watchesStdio).toBe(false);
    expect(started.readyLine).toBe(
      `media-mcp ready on http://127.0.0.1:${port}/mcp (yt-dlp 9.9)`,
    );
    await started.close();
  });

  it("prunes expired cache entries every hour and stops when it closes", async () => {
    const cacheDir = join(temp.path, "cache");
    await mkdir(cacheDir);
    const first = join(cacheDir, "first.json");
    const second = join(cacheDir, "second.json");
    await writeFile(first, EXPIRED_ENTRY);
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { started } = await startTransport(cacheDir);

    vi.advanceTimersByTime(CACHE_PRUNE_INTERVAL_MS);
    await waitFor(async () => ((await exists(first)) ? undefined : true));
    await started.close();
    await writeFile(second, EXPIRED_ENTRY);
    vi.advanceTimersByTime(CACHE_PRUNE_INTERVAL_MS);
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

    expect(await exists(second)).toBe(true);
  });
});
