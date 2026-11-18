import type {
  BatchOutcome,
  DownloadResult,
  MediaError,
  TranscriptDelivery,
  VideoInfo,
} from "@media-mcp/core";
import { expectTypeOf, it } from "vitest";
import type { BatchOutput, FailedEntry } from "../src/tools/batch-output.js";
import type { DownloadedFile } from "../src/tools/download-media.js";
import type { TranscriptEntry } from "../src/tools/transcript-output.js";
import type { VideoInfoEntry } from "../src/tools/video-info-output.js";

type Added = "ok" | "url" | "inputUrl" | "videoId";
type CoreFailure = Extract<
  BatchOutcome<unknown>["entries"][number],
  { ok: false }
>;
type CoreError = MediaError;
type Settled<T> = { [K in keyof T]-?: NonNullable<T[K]> };

type InlineDelivery = Extract<TranscriptDelivery, { mode: "inline" }>;
type FileDelivery = Extract<TranscriptDelivery, { mode: "file" }>;
type InlineEntry = Extract<TranscriptEntry, { mode: "inline" }>;
type FileEntry = Extract<TranscriptEntry, { mode: "file" }>;

type Carried<Core> = Exclude<keyof Core, "ref">;

it("keeps the transcript wire schema in step with the core delivery", () => {
  expectTypeOf<keyof InlineEntry>().toEqualTypeOf<
    Carried<InlineDelivery> | Added
  >();
  expectTypeOf<Pick<InlineEntry, Carried<InlineDelivery>>>().toEqualTypeOf<
    Pick<InlineDelivery, Carried<InlineDelivery>>
  >();
  expectTypeOf<keyof FileEntry>().toEqualTypeOf<
    Carried<FileDelivery> | Added
  >();
  expectTypeOf<Pick<FileEntry, Carried<FileDelivery>>>().toEqualTypeOf<
    Pick<FileDelivery, Carried<FileDelivery>>
  >();
});

type InfoCarried = Exclude<Carried<VideoInfo>, "description">;

it("keeps the video info wire schema in step with the core info", () => {
  expectTypeOf<keyof VideoInfoEntry>().toEqualTypeOf<
    Carried<VideoInfo> | Added | "descriptionTruncated" | "chaptersTruncated"
  >();
  expectTypeOf<Pick<VideoInfoEntry, InfoCarried>>().toEqualTypeOf<
    Pick<VideoInfo, InfoCarried>
  >();
});

it("keeps the download wire schema in step with the core result", () => {
  expectTypeOf<keyof DownloadedFile>().toEqualTypeOf<
    Carried<DownloadResult> | Added
  >();
  expectTypeOf<Pick<DownloadedFile, Carried<DownloadResult>>>().toEqualTypeOf<
    Pick<DownloadResult, Carried<DownloadResult>>
  >();
});

it("keeps the failed entry wire schema in step with the core failure", () => {
  expectTypeOf<keyof FailedEntry>().toEqualTypeOf<keyof CoreFailure>();
  expectTypeOf<FailedEntry["ok"]>().toEqualTypeOf<CoreFailure["ok"]>();
  expectTypeOf<keyof FailedEntry["error"]>().toEqualTypeOf<keyof CoreError>();
  expectTypeOf<Settled<FailedEntry["error"]>>().toEqualTypeOf<
    Settled<CoreError>
  >();
  expectTypeOf<CoreError>().toExtend<FailedEntry["error"]>();
});

it("keeps the batch envelope in step with the core outcome", () => {
  expectTypeOf<keyof BatchOutput<{ ok: true }>>().toEqualTypeOf<
    keyof BatchOutcome<unknown>
  >();
});
