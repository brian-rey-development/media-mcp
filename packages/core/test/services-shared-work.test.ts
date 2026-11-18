import { describe, expect, it, vi } from "vitest";
import { err, ok } from "../src/domain/result.js";
import type { Provider } from "../src/providers/provider.js";
import {
  shortUrl,
  transcriptOf,
  videoId,
  watchUrl,
} from "./support/fake-provider.js";
import { EN, servicesFixture } from "./support/services-fixture.js";

const ids = (from: number, count: number): string[] =>
  Array.from({ length: count }, (_, index) => watchUrl(videoId(from + index)));

const settleMicrotasks = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

describe("work shared between calls", () => {
  const { setup } = servicesFixture();

  describe("one run per video at a time", () => {
    const slowProvider = () => {
      const release = Promise.withResolvers<void>();
      const getTranscript = vi.fn<Provider["getTranscript"]>(async (ref) => {
        await release.promise;
        return ok(transcriptOf(ref, `words of ${ref.id}`));
      });
      return { release, getTranscript };
    };

    it("lets two simultaneous requests for the same transcript share one run", async () => {
      const { release, getTranscript } = slowProvider();
      const { services } = setup({ overrides: { getTranscript } });
      const input = { urls: ids(1, 1), ...EN };

      const both = Promise.all([
        services.transcripts.fetch(input),
        services.transcripts.fetch(input),
      ]);
      await vi.waitFor(() => expect(getTranscript).toHaveBeenCalled());
      release.resolve();
      const [first, second] = await both;

      expect(getTranscript).toHaveBeenCalledOnce();
      expect(second).toEqual(first);
      expect(first.entries).toMatchObject([{ ok: true }]);
    });

    it("keeps different formats of the same video apart", async () => {
      const { release, getTranscript } = slowProvider();
      const { services } = setup({ overrides: { getTranscript } });
      const urls = ids(1, 1);

      const both = Promise.all([
        services.transcripts.fetch({ urls, ...EN }),
        services.transcripts.fetch({ urls, ...EN, timestamps: true }),
      ]);
      await vi.waitFor(() => expect(getTranscript).toHaveBeenCalledTimes(2));
      release.resolve();
      await both;

      expect(getTranscript).toHaveBeenCalledTimes(2);
    });

    it("runs again for a waiting request when the request that started it was cancelled", async () => {
      const started = Promise.withResolvers<void>();
      const getTranscript = vi
        .fn<Provider["getTranscript"]>()
        .mockImplementationOnce(async (_ref, _options, signal) => {
          started.resolve();
          await new Promise((resolve) =>
            signal?.addEventListener("abort", resolve),
          );
          return err("CANCELLED", "The operation was cancelled");
        })
        .mockImplementation(async (ref) => ok(transcriptOf(ref, "words")));
      const { services, calls } = setup({ overrides: { getTranscript } });
      const leader = new AbortController();

      const first = services.transcripts.fetch(
        { urls: ids(1, 1), ...EN },
        leader.signal,
      );
      await started.promise;
      const waiting = services.transcripts.fetch({
        urls: [shortUrl(videoId(1))],
        ...EN,
      });
      await vi.waitFor(() => expect(calls.resolve).toHaveLength(2));
      await settleMicrotasks();
      expect(getTranscript).toHaveBeenCalledOnce();
      leader.abort();

      expect((await first).entries).toMatchObject([
        { ok: false, error: { code: "CANCELLED" } },
      ]);
      expect((await waiting).entries).toMatchObject([{ ok: true }]);
      expect(getTranscript).toHaveBeenCalledTimes(2);
    });

    it("returns a cancelled waiting request at once and leaves the shared run to the others", async () => {
      const { release, getTranscript } = slowProvider();
      const { services, calls } = setup({ overrides: { getTranscript } });
      const running = services.transcripts.fetch({ urls: ids(1, 1), ...EN });
      await vi.waitFor(() => expect(getTranscript).toHaveBeenCalled());
      const impatient = new AbortController();
      const waiting = services.transcripts.fetch(
        { urls: [shortUrl(videoId(1))], ...EN },
        impatient.signal,
      );
      await vi.waitFor(() => expect(calls.resolve).toHaveLength(2));
      await settleMicrotasks();

      impatient.abort();

      expect((await waiting).entries).toMatchObject([
        { ok: false, error: { code: "CANCELLED" } },
      ]);
      release.resolve();
      expect((await running).entries).toMatchObject([{ ok: true }]);
      expect(getTranscript).toHaveBeenCalledOnce();
    });
  });
});
