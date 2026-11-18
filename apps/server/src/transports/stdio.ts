import { ok } from "@media-mcp/core";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "../server.js";
import type { Transport } from "./run.js";

export const stdioTransport: Transport = {
  async start({ services, ytDlpVersion }, lifecycle) {
    const server = createServer(services, lifecycle);
    await server.connect(new StdioServerTransport());
    return ok({
      close: () => server.close(),
      readyLine: `media-mcp ready, yt-dlp ${ytDlpVersion}`,
      watchesStdio: true,
    });
  },
};
