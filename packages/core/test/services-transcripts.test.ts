import { describe, expect, it, vi } from "vitest";
import { err, ok } from "../src/domain/result.js";
import { transcriptOf, videoId, watchUrl } from "./support/fake-provider.js";
import { EN, servicesFixture } from "./support/services-fixture.js";

const A = videoId(1);
const B = videoId(2);
const C = videoId(3);

const withoutCaptions = (id: string) =>
  err("NO_CAPTIONS", `No captions for ${id}`, "Available languages: none");

describe("transcripts", () => {
  const { setup } = servicesFixture();

  it("serves a repeated request for the same video, language and format from the cache", async () => {
    const { services, calls } = setup();
    const input = { urls: [watchUrl(A)], ...EN };

    const first = await services.transcripts.fetch(input);
    const second = await services.transcripts.fetch(input);

    expect(calls.transcript).toHaveLength(1);
    expect(second).toEqual(first);
  });

  it("keys the cache by language and by timestamps", async () => {
    const { services, calls } = setup();
    const urls = [watchUrl(A)];

    await services.transcripts.fetch({ urls, ...EN });
    await services.transcripts.fetch({ urls, ...EN, language: "es" });
    await services.transcripts.fetch({ urls, ...EN, timestamps: true });

    expect(calls.transcript).toHaveLength(3);
  });

  it("does not cache failures", async () => {
    const getTranscript = vi.fn(async () => withoutCaptions(A));
    const { services } = setup({ overrides: { getTranscript } });
    const input = { urls: [watchUrl(A)], ...EN };

    await services.transcripts.fetch(input);
    await services.transcripts.fetch(input);

    expect(getTranscript).toHaveBeenCalledTimes(2);
  });

  it("hands the provider the language and timestamps choice", async () => {
    const getTranscript = vi.fn(async () =>
      ok(transcriptOf({ provider: "fake", id: A, url: watchUrl(A) }, "words")),
    );
    const { services } = setup({ overrides: { getTranscript } });

    await services.transcripts.fetch({
      urls: [watchUrl(A)],
      ...EN,
      language: "pt-BR",
      timestamps: true,
    });

    expect(getTranscript).toHaveBeenCalledWith(
      expect.objectContaining({ id: A }),
      { language: "pt-BR", timestamps: true },
      undefined,
    );
  });

  it("passes the abort signal to the provider", async () => {
    const { services, calls } = setup();
    const controller = new AbortController();

    await services.transcripts.fetch(
      { urls: [watchUrl(A)], ...EN },
      controller.signal,
    );

    expect(calls.signals).toEqual([controller.signal]);
  });

  it("lets an item without captions fail alone", async () => {
    const { services } = setup({
      overrides: {
        getTranscript: async (ref) =>
          ref.id === B
            ? withoutCaptions(B)
            : ok(transcriptOf(ref, `words of ${ref.id}`)),
      },
    });

    const outcome = await services.transcripts.fetch({
      urls: [watchUrl(A), watchUrl(B), watchUrl(C)],
      ...EN,
    });

    expect(outcome.entries).toMatchObject([
      { url: watchUrl(A), ok: true, value: { mode: "inline" } },
      { url: watchUrl(B), ok: false, error: { code: "NO_CAPTIONS" } },
      { url: watchUrl(C), ok: true, value: { mode: "inline" } },
    ]);
  });

  it("reports the number of videos before any work and each video when it is done", async () => {
    const { services } = setup();
    const events: string[] = [];

    await services.transcripts.fetch({
      urls: [watchUrl(A), "not a url", watchUrl(B)],
      ...EN,
      onPlan: (total) => events.push(`plan ${total}`),
      onItemDone: (ref) => events.push(`done ${ref.id}`),
    });

    expect(events[0]).toBe("plan 2");
    expect(events.slice(1).toSorted()).toEqual([`done ${A}`, `done ${B}`]);
  });

  it("reports a video served from the cache as done too", async () => {
    const { services } = setup();
    const input = { urls: [watchUrl(A)], ...EN };
    await services.transcripts.fetch(input);
    const done = vi.fn();

    await services.transcripts.fetch({ ...input, onItemDone: done });

    expect(done).toHaveBeenCalledOnce();
  });
});
