import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { initializeFrames, listToolsFrame } from "./support/mcp-frames.js";
import { FAKE_YT_DLP, serverProcessEnv } from "./support/process-env.js";
import {
  nodeOnlyPath,
  runServer,
  writeFakeFfmpeg,
} from "./support/server-process.js";
import { withTempDir } from "./support/temp-dir.js";

describe("starting the server", () => {
  const temp = withTempDir("media-mcp-start-");

  it("exits with the message and install hint when yt-dlp is missing", async () => {
    const result = await runServer(
      { MEDIA_MCP_YTDLP_PATH: join(temp.path, "missing-yt-dlp") },
      "",
    );

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("was not found on this machine");
    expect(result.stderr).toContain("brew install yt-dlp");
  });

  it("exits with the message and upgrade hint when yt-dlp is too old", async () => {
    const result = await runServer(
      {
        MEDIA_MCP_YTDLP_PATH: FAKE_YT_DLP,
        FAKE_YTDLP_VERSION_OVERRIDE: "2020.01.01",
      },
      "",
    );

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("older than the required");
    expect(result.stderr).toContain("brew upgrade yt-dlp");
  });

  it("exits with a readable message when the environment is invalid", async () => {
    const result = await runServer({ MEDIA_MCP_CONCURRENCY: "zero" }, "");

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Invalid configuration");
    expect(result.stderr).toContain("MEDIA_MCP_CONCURRENCY");
  });

  describe("without ffmpeg", () => {
    const startWithPath = (path: string) =>
      runServer(
        { ...serverProcessEnv(temp.path), PATH: path },
        initializeFrames() + listToolsFrame(),
      );

    it("starts anyway and warns once on stderr with the install hint", async () => {
      const result = await startWithPath(await nodeOnlyPath(temp.path));

      expect(result.code).toBe(0);
      expect(result.stderr).toContain("brew install ffmpeg");
      expect(result.stderr.match(/warning/g)).toHaveLength(1);
    });

    it("stays quiet about ffmpeg when it is reachable", async () => {
      const bin = await nodeOnlyPath(temp.path);
      await writeFakeFfmpeg(bin);

      const result = await startWithPath(bin);

      expect(result.code).toBe(0);
      expect(result.stderr).not.toContain("warning");
    });
  });
});
