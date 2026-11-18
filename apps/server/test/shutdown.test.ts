import { afterEach, describe, expect, it, vi } from "vitest";
import { createLifecycle } from "../src/lifecycle.js";
import { createLogger } from "../src/logger.js";
import {
  createShutdown,
  FORCE_EXIT_TIMEOUT_MS,
  SETTLE_TIMEOUT_MS,
} from "../src/shutdown.js";
import { withClient } from "./support/client.js";
import { fakeServices, requireSignal } from "./support/fake-services.js";
import { URL_A } from "./support/fixtures.js";

const harness = () => {
  const lifecycle = createLifecycle();
  const events: string[] = [];
  const lines: string[] = [];
  lifecycle.signal.addEventListener("abort", () => events.push("abort"));
  const stop = createShutdown({
    logger: createLogger((line) => lines.push(line)),
    lifecycle,
    close: async () => {
      events.push("close");
    },
    exit: (code) => events.push(`exit ${code}`),
    forceExit: (code) => events.push(`force ${code}`),
  });
  return { lifecycle, events, lines, stop };
};

const nextMacrotask = () =>
  new Promise<void>((resolve) => setImmediate(resolve));

afterEach(() => vi.useRealTimers());

describe("graceful shutdown", () => {
  it("aborts, closes the server, then exits with the given code", async () => {
    const { events, stop } = harness();

    await stop("test", 7);

    expect(events).toEqual(["abort", "close", "exit 7"]);
  });

  it("waits for in-flight work to settle before exiting", async () => {
    const { lifecycle, events, stop } = harness();
    const work = Promise.withResolvers<void>();
    void lifecycle.track(work.promise);

    const stopping = stop("test", 0);
    await vi.waitFor(() => expect(events).toContain("close"));
    expect(events).not.toContain("exit 0");
    work.resolve();
    await stopping;

    expect(events.at(-1)).toBe("exit 0");
  });

  it("gives up on work that never settles after the timeout", async () => {
    vi.useFakeTimers();
    const { lifecycle, events, stop } = harness();
    void lifecycle.track(new Promise(() => undefined));

    const stopping = stop("test", 0);
    await vi.advanceTimersByTimeAsync(SETTLE_TIMEOUT_MS);
    await stopping;

    expect(events.at(-1)).toBe("exit 0");
  });

  it("still settles when the tracked work fails", async () => {
    const { lifecycle, events, stop } = harness();
    const failing = Promise.reject(new Error("boom"));
    void lifecycle.track(failing).catch(() => undefined);

    await stop("test", 0);

    expect(events.at(-1)).toBe("exit 0");
  });

  it("forces the exit with the failure code when closing hangs forever", async () => {
    vi.useFakeTimers();
    const lifecycle = createLifecycle();
    const forced: number[] = [];
    const stop = createShutdown({
      logger: createLogger(() => undefined),
      lifecycle,
      close: () => new Promise(() => undefined),
      exit: () => undefined,
      forceExit: (code) => forced.push(code),
    });

    void stop("uncaughtException", 1);
    await vi.advanceTimersByTimeAsync(FORCE_EXIT_TIMEOUT_MS);

    expect(forced).toEqual([1]);
  });

  it("runs once however many triggers arrive", async () => {
    const { events, lines, stop } = harness();

    await Promise.all([stop("stdin closed", 0), stop("received SIGTERM", 143)]);

    expect(events.filter((event) => event.startsWith("exit"))).toEqual([
      "exit 0",
    ]);
    expect(lines).toEqual(["[info] shutting down, stdin closed"]);
  });

  it("names the reason on stderr", async () => {
    const { lines, stop } = harness();

    await stop("received SIGINT", 130);

    expect(lines).toEqual(["[info] shutting down, received SIGINT"]);
  });
});

describe("the server-wide signal", () => {
  it("aborts the signal of a running call without the client cancelling it", async () => {
    const lifecycle = createLifecycle();
    const started = Promise.withResolvers<AbortSignal>();
    const services = fakeServices({
      transcripts: (_input, signal) => {
        started.resolve(requireSignal(signal));
        return new Promise(() => undefined);
      },
    });

    await withClient(
      services,
      async (client) => {
        void client
          .callTool({ name: "get_transcripts", arguments: { urls: [URL_A] } })
          .catch(() => undefined);
        const serviceSignal = await started.promise;
        expect(serviceSignal.aborted).toBe(false);

        lifecycle.abort();

        expect(serviceSignal.aborted).toBe(true);
      },
      lifecycle,
    );
  });

  it("tracks a running call until it settles", async () => {
    const lifecycle = createLifecycle();
    const release = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const services = fakeServices({
      transcripts: async () => {
        started.resolve();
        await release.promise;
        return { entries: [], truncations: [] };
      },
    });
    const state = async () => {
      let settled = false;
      void lifecycle.settled().then(() => {
        settled = true;
      });
      await nextMacrotask();
      return settled ? "settled" : "pending";
    };

    await withClient(
      services,
      async (client) => {
        const call = client.callTool({
          name: "get_transcripts",
          arguments: { urls: [URL_A] },
        });
        await started.promise;
        expect(await state()).toBe("pending");

        release.resolve();
        await call;

        expect(await state()).toBe("settled");
      },
      lifecycle,
    );
  });
});
