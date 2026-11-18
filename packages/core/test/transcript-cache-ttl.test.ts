import { describe, expect, it } from "vitest";
import { ok } from "../src/domain/result.js";
import type { Cache } from "../src/infra/cache.js";
import { MS_PER_DAY } from "../src/infra/units.js";
import { transcriptOf, videoId, watchUrl } from "./support/fake-provider.js";
import { EN, servicesFixture } from "./support/services-fixture.js";

const AUTO_TTL_MS = 7 * MS_PER_DAY;
const THIRTY_DAYS_MS = 30 * MS_PER_DAY;
const ID = videoId(1);

const recordingCache = () => {
  const ttls: number[] = [];
  const cache: Cache = {
    get: async () => undefined,
    set: async (_key, _value, ttlMs) => {
      ttls.push(ttlMs);
    },
  };
  return { cache, ttls };
};

describe("transcript cache time to live", () => {
  const { setup } = servicesFixture();

  const fetchWith = async (
    source: "manual" | "auto",
    transcriptTtlMs: number,
  ) => {
    const { cache, ttls } = recordingCache();
    const { services } = setup({
      overrides: {
        getTranscript: async (ref) =>
          ok({ ...transcriptOf(ref, "spoken words"), source }),
      },
      config: { transcriptTtlMs },
      deps: { cache },
    });

    await services.transcripts.fetch({ urls: [watchUrl(ID)], ...EN });
    return ttls;
  };

  it("keeps manual transcripts for the configured time", async () => {
    expect(await fetchWith("manual", THIRTY_DAYS_MS)).toEqual([THIRTY_DAYS_MS]);
  });

  it("keeps automatic transcripts for seven days at most", async () => {
    expect(await fetchWith("auto", THIRTY_DAYS_MS)).toEqual([AUTO_TTL_MS]);
  });

  it("never extends an automatic transcript beyond a shorter configured time", async () => {
    expect(await fetchWith("auto", MS_PER_DAY)).toEqual([MS_PER_DAY]);
  });
});
