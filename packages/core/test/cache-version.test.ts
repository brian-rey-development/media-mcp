import { describe, expect, it } from "vitest";
import { CACHE_FORMAT_VERSION } from "../src/services/cache-version.js";
import { TranscriptSchema, VideoInfoSchema } from "../src/services/schemas.js";

const RECORDED_FORMAT = {
  version: 2,
  transcript: [
    "channel",
    "language",
    "ref",
    "source",
    "text",
    "title",
    "wordCount",
  ],
  videoInfo: [
    "captionLanguages",
    "channel",
    "chapters",
    "description",
    "durationSeconds",
    "ref",
    "title",
  ],
};

describe("the cache format version", () => {
  it("is bumped together with any change to the cached shapes", () => {
    expect({
      version: CACHE_FORMAT_VERSION,
      transcript: Object.keys(TranscriptSchema.shape).sort(),
      videoInfo: Object.keys(VideoInfoSchema.shape).sort(),
    }).toEqual(RECORDED_FORMAT);
  });
});
