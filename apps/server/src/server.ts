import type { Services } from "@media-mcp/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import pkg from "../package.json" with { type: "json" };
import type { ToolContext, ToolDefinition } from "./define-tool.js";
import { createLifecycle, type Lifecycle } from "./lifecycle.js";
import { tools } from "./tools/index.js";
import { UNTRUSTED_GUIDANCE } from "./tools/untrusted.js";

const SERVER_NAME = "media-mcp";

const SERVER_INSTRUCTIONS = `Reads and downloads online videos, YouTube today. Call get_video_info first for titles, durations, chapters and caption details, then get_transcripts to read what is said, and use download_media last and only when the user needs the media file itself. A transcript that would flood the context comes back as a saved file path plus a preview, so read it with read_transcript_file, which works over stdio and HTTP, or with your own file tools when the server runs on your machine. ${UNTRUSTED_GUIDANCE}`;

type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;

const progressReporter = (extra: Extra): ToolContext["reportProgress"] => {
  const progressToken = extra._meta?.progressToken;
  if (progressToken === undefined) return async () => undefined;
  return async (progress, total, message) => {
    const params = { progressToken, progress, total, message };
    // A closed transport must not fail a call that is already running.
    await extra
      .sendNotification({ method: "notifications/progress", params })
      .catch(() => undefined);
  };
};

const contextFor = (
  extra: Extra,
  services: Services,
  lifecycle: Lifecycle,
): ToolContext => ({
  services,
  signal: AbortSignal.any([extra.signal, lifecycle.signal]),
  reportProgress: progressReporter(extra),
});

const toolConfig = ({
  title,
  description,
  annotations,
  input,
  output,
}: ToolDefinition) => ({
  title,
  description,
  annotations,
  inputSchema: input,
  outputSchema: output,
});

const registerTool = (
  server: McpServer,
  tool: ToolDefinition,
  services: Services,
  lifecycle: Lifecycle,
): void => {
  server.registerTool(tool.name, toolConfig(tool), (args, extra) =>
    lifecycle.track(tool.execute(args, contextFor(extra, services, lifecycle))),
  );
};

export const createServer = (
  services: Services,
  lifecycle: Lifecycle = createLifecycle(),
): McpServer => {
  const server = new McpServer(
    { name: SERVER_NAME, version: pkg.version },
    { instructions: SERVER_INSTRUCTIONS },
  );
  for (const tool of tools) registerTool(server, tool, services, lifecycle);
  return server;
};
