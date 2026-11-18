import type { VideoRef } from "@media-mcp/core";
import { describe, expect, it } from "vitest";
import {
  createCountProgress,
  createDownloadProgress,
} from "../src/tools/progress.js";
import { REF_A, REF_B } from "./support/fixtures.js";

const INTERVAL_MS = 250;

const recorder = () => {
  const clock = { time: 0 };
  const sent: { progress: number; total: number; message?: string }[] = [];
  const report = async (progress: number, total: number, message?: string) => {
    sent.push({ progress, total, ...(message && { message }) });
  };
  return { clock, sent, report, now: () => clock.time };
};

const refNamed = (id: string): VideoRef => ({ ...REF_A, id });

describe("download progress", () => {
  const setup = (videos: number) => {
    const fake = recorder();
    const progress = createDownloadProgress(fake.report, fake.now);
    progress.plan(videos);
    return { ...fake, progress };
  };

  it("never goes backwards when yt-dlp restarts at zero for the audio stream", () => {
    const { progress, sent, clock } = setup(1);

    progress.update(REF_A, 60);
    clock.time += INTERVAL_MS;
    progress.update(REF_A, 100);
    clock.time += INTERVAL_MS;
    progress.update(REF_A, 0);
    clock.time += INTERVAL_MS;
    progress.update(REF_A, 30);

    expect(sent.map(({ progress: value }) => value)).toEqual([60, 99]);
  });

  it("keeps what a video had reached when it restarts at zero while another one advances", () => {
    const { progress, sent, clock } = setup(2);

    progress.update(REF_A, 100);
    clock.time += INTERVAL_MS;
    progress.update(REF_A, 0);
    clock.time += INTERVAL_MS;
    progress.update(REF_B, 50);

    expect(sent.map(({ progress: value }) => value)).toEqual([100, 150]);
  });

  it("sends nothing for a repeated percentage", () => {
    const { progress, sent, clock } = setup(1);

    for (const _ of [1, 2, 3]) {
      progress.update(REF_A, 40);
      clock.time += INTERVAL_MS;
    }

    expect(sent).toHaveLength(1);
  });

  it("sends only when the whole percent grows", () => {
    const { progress, sent, clock } = setup(1);

    progress.update(REF_A, 10.2);
    clock.time += INTERVAL_MS;
    progress.update(REF_A, 10.7);
    clock.time += INTERVAL_MS;
    progress.update(REF_A, 11.1);

    expect(sent.map(({ progress: value }) => value)).toEqual([10, 11]);
  });

  it("keeps the total fixed at the real number of videos while videos start one after another", () => {
    const { progress, sent, clock } = setup(2);

    progress.update(REF_A, 100);
    clock.time += INTERVAL_MS;
    progress.update(REF_B, 50);

    expect(sent).toEqual([
      expect.objectContaining({ progress: 100, total: 200 }),
      expect.objectContaining({ progress: 150, total: 200 }),
    ]);
  });

  it("sends at most about four notifications a second", () => {
    const { progress, sent, clock } = setup(1);

    for (let percent = 1; percent <= 40; percent += 1) {
      progress.update(REF_A, percent);
      clock.time += 10;
    }

    expect(sent).toHaveLength(2);
  });

  it("always sends the finishing notification, past the rate limit", () => {
    const { progress, sent } = setup(1);
    progress.update(REF_A, 100);

    progress.finish();

    expect(sent.at(-1)).toEqual({
      progress: 100,
      total: 100,
      message: "Finished downloading",
    });
    expect(sent).toHaveLength(2);
  });

  it("sends nothing when no video was planned", () => {
    const { progress, sent } = setup(0);

    progress.update(REF_A, 50);
    progress.finish();

    expect(sent).toEqual([]);
  });
});

describe("count progress", () => {
  const setup = (videos: number) => {
    const fake = recorder();
    const progress = createCountProgress(fake.report, fake.now);
    progress.plan(videos);
    return { ...fake, progress };
  };

  it("reports each finished video against the planned total", () => {
    const { progress, sent, clock } = setup(3);

    for (const id of ["a", "b", "c"]) {
      progress.itemDone(refNamed(id));
      clock.time += INTERVAL_MS;
    }

    expect(sent).toEqual([
      { progress: 1, total: 3, message: "Fetched a" },
      { progress: 2, total: 3, message: "Fetched b" },
      { progress: 3, total: 3, message: "Fetched c" },
    ]);
  });

  it("rate limits the middle but always reports the last video", () => {
    const { progress, sent } = setup(4);

    for (const id of ["a", "b", "c", "d"]) progress.itemDone(refNamed(id));

    expect(sent.map(({ progress: value }) => value)).toEqual([1, 4]);
  });
});
