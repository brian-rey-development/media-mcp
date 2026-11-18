import { describe, expect, it } from "vitest";
import { captionFilesFor } from "./support/caption-emulation.js";

const LISTING = {
  subtitles: { en: [], "es-3pK74FgVxOs": [] },
  automatic_captions: { "en-orig": [], en: [], fr: [] },
};
const ARGS = ["--sub-format", "json3", "-o", "captions"];

describe("captionFilesFor", () => {
  it("lists a file per matching key of each group the flags ask for", () => {
    const args = [
      ...ARGS,
      "--write-subs",
      "--write-auto-subs",
      "--sub-langs",
      "^en(?:-orig)?$",
    ];

    expect(captionFilesFor(args, LISTING)).toEqual([
      { name: "captions.en.json3", source: "manual" },
      { name: "captions.en-orig.json3", source: "auto" },
      { name: "captions.en.json3", source: "auto" },
    ]);
  });

  it("skips a group whose write flag is absent", () => {
    const args = [...ARGS, "--write-subs", "--sub-langs", "^en"];

    expect(captionFilesFor(args, LISTING)).toEqual([
      { name: "captions.en.json3", source: "manual" },
    ]);
  });

  it("writes nothing when yt-dlp was not asked for subtitle languages", () => {
    expect(captionFilesFor([...ARGS, "--write-subs"], LISTING)).toEqual([]);
  });

  it("tolerates a listing without caption maps", () => {
    const args = [...ARGS, "--write-subs", "--sub-langs", "^en$"];

    expect(captionFilesFor(args, {})).toEqual([]);
  });
});
