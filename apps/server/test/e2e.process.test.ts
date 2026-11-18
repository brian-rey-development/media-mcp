import { mkdir } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { fakeYtDlpEnv } from "./support/fake-ytdlp-pipeline.js";
import {
  callToolFrame,
  framesOf,
  INITIALIZE_ID,
  initializeFrames,
} from "./support/mcp-frames.js";
import {
  type RunningServer,
  startServer,
  waitFor,
  writeFakeFfmpeg,
} from "./support/server-process.js";
import { withTempDir } from "./support/temp-dir.js";

const SINTEL = "https://www.youtube.com/watch?v=eRsGyueVLvQ";
const TRANSCRIPT_ID = 11;
const INFO_ID = 12;
const DOWNLOAD_ID = 13;

const Reply = z.object({
  id: z.number(),
  result: z
    .object({
      isError: z.boolean().optional(),
      structuredContent: z.object({
        entries: z.array(z.object({ ok: z.boolean() }).loose()),
      }),
    })
    .optional(),
  error: z.unknown().optional(),
});

const Frame = z.object({ id: z.number().optional() }).loose();

const replyTo = (server: RunningServer, id: number) =>
  framesOf(server.stdout())
    .map((frame) => Frame.parse(frame))
    .find((frame) => frame.id === id);

describe("the built server with a fake yt-dlp", () => {
  const temp = withTempDir("media-mcp-e2e-");

  const call = async (server: RunningServer, frame: string, id: number) => {
    server.child.stdin?.write(frame);
    return Reply.parse(await waitFor(async () => replyTo(server, id)));
  };

  const boot = async (): Promise<RunningServer> => {
    const bin = join(temp.path, "bin");
    await mkdir(bin);
    await writeFakeFfmpeg(bin);
    const server = startServer({
      ...fakeYtDlpEnv(temp.path),
      PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
    });
    server.child.stdin?.write(initializeFrames());
    await waitFor(async () => replyTo(server, INITIALIZE_ID));
    return server;
  };

  const callEach = async (server: RunningServer) => [
    await call(
      server,
      callToolFrame("get_transcripts", { urls: [SINTEL] }, TRANSCRIPT_ID),
      TRANSCRIPT_ID,
    ),
    await call(
      server,
      callToolFrame("get_video_info", { urls: [SINTEL] }, INFO_ID),
      INFO_ID,
    ),
    await call(
      server,
      callToolFrame(
        "download_media",
        { urls: [SINTEL], kind: "audio" },
        DOWNLOAD_ID,
      ),
      DOWNLOAD_ID,
    ),
  ];

  it("answers all three tools over stdio with output its own schemas accept", async () => {
    const server = await boot();

    const replies = await callEach(server);

    for (const reply of replies) {
      expect(reply.error).toBeUndefined();
      expect(reply.result?.isError).toBeUndefined();
      expect(reply.result?.structuredContent.entries).toMatchObject([
        { ok: true },
      ]);
    }
    server.child.stdin?.end();
    const { code, stderr } = await server.exit;
    expect(code).toBe(0);
    expect(stderr).not.toMatch(/error/i);
  });
});
