import {
  mkdir,
  readdir,
  readFile,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { DownloadOptions } from "../src/domain/media.js";
import { err } from "../src/domain/result.js";
import { runProcess } from "../src/infra/process.js";
import { createYoutubeProvider } from "../src/providers/youtube/provider.js";
import {
  DOWNLOAD_TIMEOUT_MS,
  MAX_DOWNLOAD_BYTES,
  testConfig,
} from "./support/config.js";
import {
  createFakeRunner,
  firstCall,
  type RecordedCall,
  stdoutOf,
  valueAfter,
} from "./support/fake-runner.js";
import { writeFakeYtDlp } from "./support/fake-ytdlp.js";
import { readFixture } from "./support/fixtures.js";
import { withTempDir } from "./support/temp-dir.js";
import { unwrap } from "./support/unwrap.js";
import { verified } from "./support/verified-directory.js";
import { provider, REF, VIDEO_ID, VIDEO_URL } from "./support/youtube-fake.js";

const infoJson = await readFixture("sintel.info.json");
const FILE_NAME = `Sintel [${VIDEO_ID}] 720p.mp4`;
const FILE_BYTES = 1_234;
const TEMPLATE = "%(title).150B [%(id)s] 720p.%(ext)s";

const optionsIn = async (
  outputDir: string,
  overrides: Partial<DownloadOptions> = {},
): Promise<DownloadOptions> => ({
  kind: "video",
  quality: "720p",
  outputDir: await verified(outputDir),
  ...overrides,
});

const printing =
  (...lines: string[]) =>
  ({ options: runOptions }: RecordedCall) => {
    for (const line of lines) runOptions.onStdoutLine?.(line);
    return stdoutOf("");
  };

describe("createYoutubeProvider download", () => {
  const temp = withTempDir("media-mcp-dl-");
  let root: string;
  let outside: string;
  let filePath: string;

  beforeEach(async () => {
    root = join(temp.path, "root");
    outside = join(temp.path, "outside");
    await mkdir(root);
    await mkdir(outside);
    filePath = join(root, FILE_NAME);
    await writeFile(filePath, Buffer.alloc(FILE_BYTES));
  });

  const options = (overrides: Partial<DownloadOptions> = {}) =>
    optionsIn(root, overrides);

  const fakeProvider = (handler: Parameters<typeof createFakeRunner>[0]) => {
    const fake = createFakeRunner(handler);
    const instance = provider(fake.run, { ...testConfig, outputRoot: root });
    return { ...fake, instance };
  };

  it("returns the printed path with its size from disk", async () => {
    const { instance } = fakeProvider(printing("download:100%", FILE_NAME));

    const result = await instance.download(REF, await options());

    expect(result).toEqual({
      ok: true,
      value: { ref: REF, filePath, kind: "video", bytes: FILE_BYTES },
    });
  });

  it("accepts an absolute printed path inside the root", async () => {
    const { instance } = fakeProvider(printing(filePath));

    expect(unwrap(await instance.download(REF, await options())).filePath).toBe(
      filePath,
    );
  });

  it("takes the last printed line as the final path", async () => {
    const { instance } = fakeProvider(
      printing("/somewhere/else/partial.mp4", "download:100%", FILE_NAME),
    );

    expect(unwrap(await instance.download(REF, await options())).filePath).toBe(
      filePath,
    );
  });

  it("reports the requested kind", async () => {
    const { instance } = fakeProvider(printing(FILE_NAME));

    expect(
      unwrap(await instance.download(REF, await options({ kind: "audio" })))
        .kind,
    ).toBe("audio");
  });

  it("feeds percentages from progress lines to onProgress, ignoring other lines", async () => {
    const { instance } = fakeProvider(
      printing(
        "download:12.5%",
        "download:  50.0%",
        "download:100%",
        FILE_NAME,
      ),
    );
    const seen: number[] = [];

    await instance.download(
      REF,
      await options({ onProgress: (p) => seen.push(p) }),
    );

    expect(seen).toEqual([12.5, 50, 100]);
  });

  it("starts the download through the download runner and every other process through the request runner", async () => {
    const requests = createFakeRunner(() => stdoutOf(infoJson));
    const downloads = createFakeRunner(printing(FILE_NAME));
    const instance = createYoutubeProvider({
      run: requests.run,
      downloadRun: downloads.run,
      config: { ...testConfig, outputRoot: root },
    });

    await instance.download(REF, await options());
    await instance.getInfo(REF);

    expect(downloads.calls).toHaveLength(1);
    expect(requests.calls).toHaveLength(1);
    expect(firstCall(downloads.calls).args).toContain("--max-filesize");
    expect(firstCall(requests.calls).args).not.toContain("--max-filesize");
  });

  it("runs one process inside the verified directory with a relative template and the URL after --", async () => {
    await mkdir(join(root, "clips", "2026"), { recursive: true });
    await writeFile(join(root, "clips", "2026", FILE_NAME), "x");
    const { instance, calls } = fakeProvider(printing(FILE_NAME));

    await instance.download(
      REF,
      await options({ outputDir: await verified(join(root, "clips", "2026")) }),
    );

    const call = firstCall(calls);
    expect(calls).toHaveLength(1);
    expect(call.options.cwd).toBe(join(root, "clips", "2026"));
    expect(valueAfter(call.args, "-o")).toBe(TEMPLATE);
    expect(call.args.slice(-2)).toEqual(["--", VIDEO_URL]);
  });

  it("passes the configured size cap", async () => {
    const { instance, calls } = fakeProvider(printing(FILE_NAME));

    await instance.download(REF, await options());

    expect(valueAfter(firstCall(calls).args, "--max-filesize")).toBe(
      String(MAX_DOWNLOAD_BYTES),
    );
  });

  it("rejects a printed path that points outside the root", async () => {
    const stray = join(outside, "stray.mp4");
    await writeFile(stray, "x");
    const { instance } = fakeProvider(printing(stray));

    const result = await instance.download(REF, await options());

    expect(result).toMatchObject({
      ok: false,
      error: { code: "OUTPUT_PATH_ESCAPE" },
    });
  });

  it("rejects a printed path that leaves the root through a symlink", async () => {
    await writeFile(join(outside, "stray.mp4"), "x");
    await symlink(outside, join(root, "link"));
    const { instance } = fakeProvider(printing("link/stray.mp4"));

    const result = await instance.download(REF, await options());

    expect(result).toMatchObject({
      ok: false,
      error: { code: "OUTPUT_PATH_ESCAPE" },
    });
  });

  it("passes the abort signal to the process and surfaces CANCELLED", async () => {
    const { instance, calls } = fakeProvider(() =>
      err("CANCELLED", "The operation was cancelled"),
    );
    const controller = new AbortController();

    const result = await instance.download(
      REF,
      await options(),
      controller.signal,
    );

    expect(result).toMatchObject({ ok: false, error: { code: "CANCELLED" } });
    expect(firstCall(calls).options.signal).toBe(controller.signal);
  });

  it("runs with the configured download timeout and a download specific timeout hint", async () => {
    const { instance, calls } = fakeProvider(printing(FILE_NAME));

    await instance.download(REF, await options());

    expect(firstCall(calls).options.timeoutMs).toBe(DOWNLOAD_TIMEOUT_MS);
    expect(firstCall(calls).options.timeoutHint).toContain(
      "MEDIA_MCP_DOWNLOAD_TIMEOUT_MS",
    );
  });

  it("explains a size cap skip when yt-dlp succeeds without printing a path", async () => {
    const { instance } = fakeProvider(printing("download:100%"));

    const result = await instance.download(REF, await options());

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "PROCESS_FAILED",
        message: expect.stringMatching(/larger than the limit of 5 MB/),
        hint: expect.stringContaining("MEDIA_MCP_MAX_DOWNLOAD_BYTES"),
      },
    });
  });
});

describe("createYoutubeProvider download arguments", () => {
  const temp = withTempDir("media-mcp-dl-flags-");

  const runWith = async (
    overrides: Partial<DownloadOptions> = {},
    handler: Parameters<typeof createFakeRunner>[0] = printing(FILE_NAME),
  ) => {
    const { run, calls } = createFakeRunner(handler);
    const instance = provider(run, { ...testConfig, outputRoot: temp.path });
    const outcome = await instance.download(
      REF,
      await optionsIn(temp.path, overrides),
    );
    return { args: firstCall(calls).args, outcome };
  };

  it.each([
    ["best", "bv*+ba/b"],
    ["1080p", "bv*[height<=1080]+ba/b[height<=1080]"],
    ["720p", "bv*[height<=720]+ba/b[height<=720]"],
    ["480p", "bv*[height<=480]+ba/b[height<=480]"],
    ["360p", "bv*[height<=360]+ba/b[height<=360]"],
  ] as const)(
    "selects the %s video format and merges into mp4",
    async (quality, format) => {
      const { args } = await runWith({ quality });

      expect(valueAfter(args, "-f")).toBe(format);
      expect(valueAfter(args, "--merge-output-format")).toBe("mp4");
    },
  );

  it("prefers codecs QuickTime can play for video", async () => {
    const { args } = await runWith();

    expect(valueAfter(args, "-S")).toBe("vcodec:h264,acodec:aac");
  });

  it("extracts m4a audio without choosing a video format and labels the file by kind", async () => {
    const { args } = await runWith({ kind: "audio", quality: "360p" });

    expect(valueAfter(args, "--audio-format")).toBe("m4a");
    expect(args).toContain("-x");
    expect(args).not.toContain("-f");
    expect(args).not.toContain("-S");
    expect(valueAfter(args, "-o")).toBe("%(title).150B [%(id)s] audio.%(ext)s");
  });

  it("prints the final path and uses safe file names", async () => {
    const { args } = await runWith();

    expect(valueAfter(args, "--print")).toBe("after_move:filepath");
    expect(args).toContain("--restrict-filenames");
  });

  it("reads back the progress lines its own template makes yt-dlp print", async () => {
    const seen: number[] = [];
    const rendering = ({ args, options }: RecordedCall) => {
      const template = valueAfter(args, "--progress-template") ?? "";
      const line = template
        .replace(/^download:/, "")
        .replace("%(progress._percent_str)s", "  42.5%");
      options.onStdoutLine?.(line);
      options.onStdoutLine?.(FILE_NAME);
      return stdoutOf("");
    };

    await runWith({ onProgress: (percent) => seen.push(percent) }, rendering);

    expect(seen).toEqual([42.5]);
  });
});

describe("createYoutubeProvider download leftovers", () => {
  const temp = withTempDir("media-mcp-left-");
  const STEM = `Sintel [${VIDEO_ID}] 720p`;
  const OTHER = `Other [zzzzzzzzzzz] 720p`;
  const LEFTOVERS = [
    `${STEM}.f137.mp4`,
    `${STEM}.f251.webm.part`,
    `${STEM}.mp4.part`,
    `${STEM}.mp4.ytdl`,
    `${STEM}.temp.mp4`,
  ];
  const KEPT = [
    `${OTHER}.f137.mp4`,
    `${OTHER}.temp.mp4`,
    `${STEM}.mp4`,
    `Sintel [${VIDEO_ID}] 360p.temp.mp4`,
    `Sintel [${VIDEO_ID}] 360p.f137.mp4`,
    "notes.txt",
  ];

  const options = () => optionsIn(temp.path);

  const seed = async (names: string[]) => {
    for (const name of names) await writeFile(join(temp.path, name), "x");
  };

  const run = async (handler: Parameters<typeof createFakeRunner>[0]) =>
    provider(createFakeRunner(handler).run, {
      ...testConfig,
      outputRoot: temp.path,
    }).download(REF, await options());

  it.each([
    ["a failure", () => err("PROCESS_FAILED", "boom")],
    [
      "a timeout",
      () => err("TIMEOUT", "The operation timed out after 1 seconds"),
    ],
    ["a cancellation", () => err("CANCELLED", "The operation was cancelled")],
  ])(
    "removes this item's partial and stream files after %s but nothing else",
    async (_label, outcome) => {
      await seed([...LEFTOVERS, ...KEPT]);

      await run(outcome);

      expect((await readdir(temp.path)).sort()).toEqual([...KEPT].sort());
    },
  );

  it("removes HLS fragment temporaries and the unextracted audio stream of this item only", async () => {
    const AUDIO = `Sintel [${VIDEO_ID}] audio`;
    const leftovers = [
      `${STEM}.f137.mp4.part-Frag12`,
      `${AUDIO}.webm`,
      `${AUDIO}.f251.webm.part`,
    ];
    const kept = [`${AUDIO}.m4a`, `Other [zzzzzzzzzzz] audio.webm`, ...KEPT];
    await seed([...leftovers, ...kept]);

    await provider(createFakeRunner(() => err("PROCESS_FAILED", "boom")).run, {
      ...testConfig,
      outputRoot: temp.path,
    }).download(REF, await optionsIn(temp.path, { kind: "audio" }));
    await run(() => err("PROCESS_FAILED", "boom"));

    expect((await readdir(temp.path)).sort()).toEqual([...kept].sort());
  });

  it("keeps the final file and everything else after a success", async () => {
    await seed([`${STEM}.mp4`, ...KEPT]);

    await run(printing(`${STEM}.mp4`));

    expect(await readdir(temp.path)).toEqual(
      expect.arrayContaining([`${STEM}.mp4`]),
    );
  });

  it("reports a merge problem with the ffmpeg hint and cleans the stream files when the file is missing", async () => {
    await seed(LEFTOVERS);

    const result = await run(printing(`${STEM}.mp4`));

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "IO_FAILED",
        hint: expect.stringMatching(/brew install ffmpeg/),
      },
    });
    expect(await readdir(temp.path)).toEqual([]);
  });
});

describe("createYoutubeProvider download with a template evaluating process", () => {
  const temp = withTempDir("media-mcp-tpl-");
  let root: string;
  let ytDlpPath: string;

  beforeEach(async () => {
    root = join(temp.path, "root");
    await mkdir(root);
    ytDlpPath = await writeFakeYtDlp(temp.path);
  });

  const directoryIn = async (
    outputRoot: string,
    name: string,
  ): Promise<string> => {
    const directory = join(outputRoot, name);
    await mkdir(directory, { recursive: true });
    return directory;
  };

  const downloadFrom = async (outputRoot: string, name = "") =>
    provider(runProcess, { ...testConfig, ytDlpPath, outputRoot }).download(
      REF,
      await optionsIn(await directoryIn(outputRoot, name)),
    );

  const download = (name: string) => downloadFrom(root, name);

  const everythingUnder = async (directory: string): Promise<string[]> =>
    (await readdir(directory, { recursive: true })).sort();

  it.each(["%(title)s", "%(a|..)s/%(a|..)s/x", "a%%b", "$HOME"])(
    "keeps a template like %j inside the root as a literal directory name",
    async (outputDir) => {
      const result = unwrap(await download(outputDir));

      expect(result.filePath).toBe(
        join(await realpath(root), outputDir, `Title [abc] 720p.mp4`),
      );
      expect(await readFile(result.filePath, "utf8")).toBe("video bytes");
      expect(
        (await everythingUnder(temp.path)).filter((name) =>
          name.endsWith(".mp4"),
        ),
      ).toHaveLength(1);
    },
  );

  it("never writes above the root for a template that climbs with %(a|..)s", async () => {
    const nested = join(temp.path, "outer", "root");
    await mkdir(nested, { recursive: true });

    await downloadFrom(nested, "%(a|..)s/%(a|..)s/x");

    expect((await readdir(temp.path)).sort()).toEqual([
      "fake-yt-dlp",
      "outer",
      "root",
    ]);
    expect(await readdir(join(temp.path, "outer"))).toEqual(["root"]);
  });

  it("works when the output root itself contains a percent sign", async () => {
    const percentRoot = join(temp.path, "100%(title)s");

    const result = unwrap(await downloadFrom(percentRoot));

    expect(result.filePath).toBe(
      join(await realpath(percentRoot), "Title [abc] 720p.mp4"),
    );
  });

  it("never expands environment variables in the directory name or returns their value", async () => {
    process.env.FAKESECRET = "s3cr3t-value";
    try {
      const result = unwrap(await download("$FAKESECRET"));

      expect(result.filePath).toContain("$FAKESECRET");
      expect(JSON.stringify(result)).not.toContain("s3cr3t-value");
      expect(await everythingUnder(root)).not.toContain("s3cr3t-value");
    } finally {
      delete process.env.FAKESECRET;
    }
  });
});
