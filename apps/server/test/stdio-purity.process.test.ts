import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import manifest from "../package.json" with { type: "json" };
import {
  framesOf,
  INITIALIZE_ID,
  initializeFrames,
  LIST_TOOLS_ID,
  listToolsFrame,
} from "./support/mcp-frames.js";
import { FAKE_YTDLP_VERSION, serverProcessEnv } from "./support/process-env.js";
import { runServer, type ServerRun } from "./support/server-process.js";
import { withTempDir } from "./support/temp-dir.js";

const BUNDLE = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const TOOL_NAMES = [
  "download_media",
  "get_transcripts",
  "get_video_info",
  "read_transcript_file",
];

const ToolsReply = z.object({
  id: z.literal(LIST_TOOLS_ID),
  result: z.object({ tools: z.array(z.object({ name: z.string() })) }),
});

const InitializeReply = z.object({
  id: z.literal(INITIALIZE_ID),
  result: z.object({
    serverInfo: z.object({ name: z.string(), version: z.string() }),
    instructions: z.string(),
  }),
});

describe("the stdio entry", () => {
  const temp = withTempDir("media-mcp-stdio-");
  let shared: Promise<ServerRun> | undefined;

  const run = async (): Promise<ServerRun> => {
    shared ??= runServer(
      serverProcessEnv(temp.path),
      initializeFrames() + listToolsFrame(),
    );
    return shared;
  };

  it("writes only JSON-RPC frames to stdout and exits cleanly when stdin ends", async () => {
    const { stdout, code } = await run();

    const frames = framesOf(stdout);
    expect(code).toBe(0);
    expect(frames).toHaveLength(2);
    for (const each of frames) expect(each).toMatchObject({ jsonrpc: "2.0" });
  });

  it("answers initialize with the manifest version and instructions", async () => {
    const { stdout } = await run();

    const { result } = InitializeReply.parse(framesOf(stdout)[0]);
    expect(result.serverInfo).toEqual({
      name: "media-mcp",
      version: manifest.version,
    });
    expect(result.instructions).toMatch(/get_video_info/);
  });

  it("lists the tools over the real process", async () => {
    const { stdout } = await run();

    const listed = ToolsReply.parse(framesOf(stdout)[1]).result.tools;
    expect(listed.map((tool) => tool.name).toSorted()).toEqual(TOOL_NAMES);
  });

  it("ships a bundle that imports no workspace package", async () => {
    const bundle = await readFile(BUNDLE, "utf8");

    expect(bundle).not.toMatch(/from\s+["']@media-mcp\//);
  });

  it("logs its own readiness on stderr only", async () => {
    const { stdout, stderr } = await run();

    expect(stderr).toContain(`media-mcp ready, yt-dlp ${FAKE_YTDLP_VERSION}`);
    expect(stdout).not.toContain("media-mcp ready");
  });
});
