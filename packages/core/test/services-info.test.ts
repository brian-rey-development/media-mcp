import { describe, expect, it } from "vitest";
import { fakeClock } from "./support/fake-clock.js";
import { videoId, watchUrl } from "./support/fake-provider.js";
import { FIRST_ITEM, servicesFixture } from "./support/services-fixture.js";

const A = videoId(1);
const B = videoId(2);
const INFO_TTL_MS = 5_000;

describe("info", () => {
  const { setup } = servicesFixture();
  const input = { urls: [watchUrl(A)], maxItems: 50, startIndex: FIRST_ITEM };

  it("caches info by provider and video", async () => {
    const { services, calls } = setup();

    const first = await services.info.fetch(input);
    const second = await services.info.fetch(input);

    expect(calls.info).toHaveLength(1);
    expect(second).toEqual(first);
    expect(first.entries[0]).toMatchObject({
      ok: true,
      value: {
        title: `Title ${A}`,
        captionLanguages: { manual: ["en"], auto: [] },
        chapters: [{ title: "Intro" }],
      },
    });
  });

  it.each([
    ["inside the configured TTL", INFO_TTL_MS - 1, 1],
    ["after the configured TTL", INFO_TTL_MS + 1, 2],
  ])("refetches only %s", async (_label, elapsed, expectedCalls) => {
    const { clock, state } = fakeClock();
    const { services, calls } = setup({
      config: { infoTtlMs: INFO_TTL_MS },
      deps: { clock },
    });

    await services.info.fetch(input);
    state.time += elapsed;
    await services.info.fetch(input);

    expect(calls.info).toHaveLength(expectedCalls);
  });

  it("reports the number of videos first and then each finished video", async () => {
    const { services } = setup();
    const events: string[] = [];

    await services.info.fetch({
      ...input,
      urls: [watchUrl(A), watchUrl(B)],
      onPlan: (total) => events.push(`plan ${total}`),
      onItemDone: (ref) => events.push(`done ${ref.id}`),
    });

    expect(events[0]).toBe("plan 2");
    expect(events.slice(1).toSorted()).toEqual([`done ${A}`, `done ${B}`]);
  });
});
