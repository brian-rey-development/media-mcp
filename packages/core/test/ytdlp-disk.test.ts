import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BYTES_PER_GIB } from "../src/infra/units.js";
import { testConfig } from "./support/config.js";
import { createFakeRunner, stdoutOf } from "./support/fake-runner.js";
import { withTempDir } from "./support/temp-dir.js";
import { verified } from "./support/verified-directory.js";
import { provider, REF } from "./support/youtube-fake.js";

const BLOCK_SIZE = 4_096;
const statfsMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
  statfs: statfsMock,
}));

const optionsIn = async (outputDir: string) =>
  ({
    kind: "video",
    quality: "720p",
    outputDir: await verified(outputDir),
  }) as const;

const freeBytes = (bytes: number) => ({
  bavail: bytes / BLOCK_SIZE,
  bsize: BLOCK_SIZE,
});

describe("createYoutubeProvider download disk space check", () => {
  const temp = withTempDir("media-mcp-disk-");
  let root: string;
  let clips: string;

  beforeEach(async () => {
    statfsMock.mockReset();
    root = join(temp.path, "root");
    clips = join(root, "clips");
    await mkdir(clips, { recursive: true });
  });

  const instance = (run: ReturnType<typeof createFakeRunner>["run"]) =>
    provider(run, { ...testConfig, outputRoot: root });

  it("fails with IO_FAILED and a hint before any process starts when the output disk is nearly full", async () => {
    statfsMock.mockImplementation(async (path: string) =>
      freeBytes(path === clips ? BYTES_PER_GIB / 2 : BYTES_PER_GIB * 100),
    );
    const { run, calls } = createFakeRunner(() => stdoutOf(""));

    const result = await instance(run).download(REF, await optionsIn(clips));

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "IO_FAILED",
        message: expect.stringMatching(/less than 1024 MB free/),
        hint: expect.stringContaining("MEDIA_MCP_OUTPUT_DIR"),
      },
    });
    expect(calls).toEqual([]);
  });

  it("starts the download when there is exactly the minimum free", async () => {
    statfsMock.mockResolvedValue(freeBytes(BYTES_PER_GIB));
    const { run, calls } = createFakeRunner(() => stdoutOf(""));

    await instance(run).download(REF, await optionsIn(root));

    expect(calls).toHaveLength(1);
  });

  it("does not block the download when the file system cannot report free space", async () => {
    statfsMock.mockRejectedValue(new Error("unsupported"));
    const { run, calls } = createFakeRunner(() => stdoutOf(""));

    await instance(run).download(REF, await optionsIn(root));

    expect(calls).toHaveLength(1);
  });
});
