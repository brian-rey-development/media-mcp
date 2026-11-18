import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Config } from "../src/infra/config.js";
import { ENV, ENV_PREFIX, loadConfig, loadEnv } from "../src/infra/config.js";
import { unwrap } from "./support/unwrap.js";

const MS_PER_DAY = 86_400_000;
const THIRTY_DAYS_MS = 30 * MS_PER_DAY;
const THIRTY_MINUTES_MS = 30 * 60 * 1_000;
const TWO_GIB = 2 * 1024 ** 3;
const HOME = "/home/someone";

const configFor = (env: NodeJS.ProcessEnv): Config =>
  unwrap(loadConfig({ env, platform: "linux", home: HOME }));

describe("loadConfig", () => {
  it("returns the documented defaults for an empty environment", () => {
    expect(configFor({})).toEqual({
      ytDlpPath: "yt-dlp",
      outputRoot: join(HOME, "Downloads", "media-mcp"),
      cacheDir: join(HOME, ".cache", "media-mcp"),
      concurrency: 4,
      transcriptCharBudget: 20_000,
      transcriptTtlMs: THIRTY_DAYS_MS,
      infoTtlMs: MS_PER_DAY,
      processTimeoutMs: 120_000,
      downloadTimeoutMs: THIRTY_MINUTES_MS,
      maxDownloadBytes: TWO_GIB,
    });
  });

  it("places the cache under the platform location of the injected platform and home", () => {
    const config = unwrap(
      loadConfig({ env: {}, platform: "darwin", home: HOME }),
    );

    expect(config.cacheDir).toBe(join(HOME, "Library", "Caches", "media-mcp"));
  });

  it("defaults to the real home when none is injected", () => {
    const config = unwrap(loadConfig({ env: {} }));

    expect(config.outputRoot).toBe(join(homedir(), "Downloads", "media-mcp"));
  });

  it("reads every override from the environment", () => {
    const config = configFor({
      MEDIA_MCP_YTDLP_PATH: "/opt/bin/yt-dlp",
      MEDIA_MCP_OUTPUT_DIR: "/data/out",
      MEDIA_MCP_CACHE_DIR: "/data/cache",
      MEDIA_MCP_CONCURRENCY: "8",
      MEDIA_MCP_CHAR_BUDGET: "1000",
      MEDIA_MCP_PROCESS_TIMEOUT_MS: "30000",
      MEDIA_MCP_DOWNLOAD_TIMEOUT_MS: "90000",
      MEDIA_MCP_MAX_DOWNLOAD_BYTES: "1000000",
      MEDIA_MCP_INFO_TTL_MS: "5000",
      MEDIA_MCP_TRANSCRIPT_TTL_DAYS: "2",
    });

    expect(config).toEqual({
      ytDlpPath: "/opt/bin/yt-dlp",
      outputRoot: "/data/out",
      cacheDir: "/data/cache",
      concurrency: 8,
      transcriptCharBudget: 1000,
      processTimeoutMs: 30_000,
      downloadTimeoutMs: 90_000,
      maxDownloadBytes: 1_000_000,
      infoTtlMs: 5_000,
      transcriptTtlMs: 2 * MS_PER_DAY,
    });
  });

  it.each([
    "MEDIA_MCP_CONCURRENCY",
    "MEDIA_MCP_CHAR_BUDGET",
    "MEDIA_MCP_PROCESS_TIMEOUT_MS",
    "MEDIA_MCP_DOWNLOAD_TIMEOUT_MS",
    "MEDIA_MCP_MAX_DOWNLOAD_BYTES",
    "MEDIA_MCP_INFO_TTL_MS",
    "MEDIA_MCP_TRANSCRIPT_TTL_DAYS",
  ])("rejects a non-positive or fractional %s as CONFIG_INVALID", (name) => {
    for (const value of ["0", "abc", "-2", "1.5"]) {
      expect(loadConfig({ env: { [name]: value } })).toMatchObject({
        ok: false,
        error: {
          code: "CONFIG_INVALID",
          message: expect.stringContaining(name),
          hint: "Check the MEDIA_MCP_* environment variables",
        },
      });
    }
  });

  it("enforces the upper bounds on concurrency and the character budget", () => {
    expect(configFor({ MEDIA_MCP_CONCURRENCY: "16" }).concurrency).toBe(16);
    expect(loadConfig({ env: { MEDIA_MCP_CONCURRENCY: "17" } }).ok).toBe(false);
    expect(
      configFor({ MEDIA_MCP_CHAR_BUDGET: "1000000" }).transcriptCharBudget,
    ).toBe(1_000_000);
    expect(loadConfig({ env: { MEDIA_MCP_CHAR_BUDGET: "1000001" } }).ok).toBe(
      false,
    );
  });

  it.each([
    ["MEDIA_MCP_PROCESS_TIMEOUT_MS", "processTimeoutMs"],
    ["MEDIA_MCP_DOWNLOAD_TIMEOUT_MS", "downloadTimeoutMs"],
  ] as const)("rejects a %s too large for a timer", (name, field) => {
    expect(loadConfig({ env: { [name]: "2147483648" } }).ok).toBe(false);
    expect(unwrap(loadConfig({ env: { [name]: "2147483647" } }))[field]).toBe(
      2_147_483_647,
    );
  });

  it.each(["MEDIA_MCP_OUTPUT_DIR", "MEDIA_MCP_CACHE_DIR"])(
    "rejects a relative path for %s",
    (name) => {
      expect(loadConfig({ env: { [name]: "relative/dir" } })).toMatchObject({
        ok: false,
        error: {
          code: "CONFIG_INVALID",
          message: expect.stringMatching(/absolute/),
        },
      });
    },
  );

  it("rejects the filesystem root as the output directory", () => {
    expect(loadConfig({ env: { MEDIA_MCP_OUTPUT_DIR: "/" } })).toMatchObject({
      ok: false,
      error: {
        code: "CONFIG_INVALID",
        message: expect.stringMatching(/filesystem root/),
      },
    });
  });

  it("reports every invalid variable in one message", () => {
    const result = loadConfig({
      env: { MEDIA_MCP_CONCURRENCY: "0", MEDIA_MCP_INFO_TTL_MS: "x" },
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        message: expect.stringMatching(
          /MEDIA_MCP_CONCURRENCY.*MEDIA_MCP_INFO_TTL_MS/,
        ),
      },
    });
  });

  it("treats empty MEDIA_MCP_* variables as unset", () => {
    const config = configFor({
      MEDIA_MCP_YTDLP_PATH: "",
      MEDIA_MCP_OUTPUT_DIR: "",
      MEDIA_MCP_CACHE_DIR: "",
      MEDIA_MCP_CONCURRENCY: "",
      MEDIA_MCP_CHAR_BUDGET: "",
      MEDIA_MCP_PROCESS_TIMEOUT_MS: "",
      MEDIA_MCP_DOWNLOAD_TIMEOUT_MS: "",
      MEDIA_MCP_MAX_DOWNLOAD_BYTES: "",
      MEDIA_MCP_INFO_TTL_MS: "",
      MEDIA_MCP_TRANSCRIPT_TTL_DAYS: "",
    });

    expect(config).toEqual(configFor({}));
  });
});

describe("loadEnv", () => {
  const PortSchema = z.object({
    PORT: z.coerce.number().int().default(8_000),
  });

  it("treats an empty variable as unset and applies the schema defaults", () => {
    expect(loadEnv(PortSchema, { PORT: "" })).toEqual({
      ok: true,
      value: { PORT: 8_000 },
    });
  });

  it("names every invalid variable and carries the given hint", () => {
    expect(loadEnv(PortSchema, { PORT: "x" }, "Fix PORT")).toMatchObject({
      ok: false,
      error: {
        code: "CONFIG_INVALID",
        message: expect.stringMatching(/^Invalid configuration, PORT: /),
        hint: "Fix PORT",
      },
    });
  });
});

describe("the environment prefix", () => {
  it("starts every variable the configuration reads", () => {
    for (const name of Object.values(ENV))
      expect(name.startsWith(ENV_PREFIX)).toBe(true);
  });
});
