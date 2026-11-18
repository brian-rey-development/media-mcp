import { describe, expect, it } from "vitest";
import type { BatchOutcome } from "../src/services/types.js";
import { playlistUrl, videoId, watchUrl } from "./support/fake-provider.js";
import { EN, FIRST_ITEM, servicesFixture } from "./support/services-fixture.js";

const OTHER = { name: "other", host: "https://other.example/" };
const FIRST = videoId(1);
const SECOND = videoId(2);
const MAX_ITEMS = 4;

const providersOf = (outcome: BatchOutcome<{ ref: { provider: string } }>) =>
  outcome.entries.map((entry) =>
    entry.ok ? entry.value.ref.provider : "failed",
  );

describe("services with two registered providers", () => {
  const { setup } = servicesFixture();
  const twoProviders = () => {
    const { others, ...rest } = setup({ others: [OTHER] });
    return { ...rest, other: others[0]?.calls };
  };
  const urls = [
    watchUrl(FIRST),
    watchUrl(SECOND, OTHER),
    playlistUrl("first", OTHER),
  ];
  const batch = { urls, maxItems: MAX_ITEMS, startIndex: FIRST_ITEM };

  it("routes every link to the provider that matches it for info and transcripts", async () => {
    const { calls, other, services } = twoProviders();

    const info = await services.info.fetch(batch);
    const transcripts = await services.transcripts.fetch({
      ...EN,
      ...batch,
    });

    expect(providersOf(info)).toEqual(["fake", "other", "other", "other"]);
    expect(transcripts.entries.map((entry) => entry.ok)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(calls.info).toHaveLength(1);
    expect(other?.info).toHaveLength(3);
    expect(other?.resolve).toEqual([
      watchUrl(SECOND, OTHER),
      playlistUrl("first", OTHER),
    ]);
  });

  it("keeps the same video id under two providers as two videos", async () => {
    const { other, services } = twoProviders();

    const outcome = await services.info.fetch({
      ...batch,
      urls: [watchUrl(FIRST), watchUrl(FIRST, OTHER)],
    });

    expect(providersOf(outcome)).toEqual(["fake", "other"]);
    expect(other?.info).toHaveLength(1);
  });

  it("routes downloads to the provider that matches each link", async () => {
    const { calls, other, services } = twoProviders();

    const downloads = await services.downloads.run({
      ...batch,
      kind: "audio",
      quality: "best",
    });

    expect(downloads.entries.map((entry) => entry.ok)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(calls.download).toHaveLength(1);
    expect(other?.download).toHaveLength(3);
  });
});
