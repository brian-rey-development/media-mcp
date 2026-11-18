import type { Services } from "@media-mcp/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { z } from "zod";
import type { Lifecycle } from "../../src/lifecycle.js";
import { createServer } from "../../src/server.js";

const TextBlocks = z.array(z.object({ type: z.string(), text: z.string() }));

export const withClient = async <T>(
  services: Services,
  run: (client: Client) => Promise<T>,
  lifecycle?: Lifecycle,
): Promise<T> => {
  const server = createServer(services, lifecycle);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  try {
    return await run(client);
  } finally {
    await client.close();
    await server.close();
  }
};

export const callTool = (
  services: Services,
  name: string,
  args: Record<string, unknown>,
  options?: RequestOptions,
) =>
  withClient(services, (client) =>
    client.callTool({ name, arguments: args }, undefined, options),
  );

export const textOf = (content: unknown): string =>
  TextBlocks.parse(content)
    .map((block) => block.text)
    .join("\n");

const Entries = z.object({
  entries: z.array(z.record(z.string(), z.unknown())),
});

export const entriesOf = (
  result: Awaited<ReturnType<typeof callTool>>,
): Record<string, unknown>[] => Entries.parse(result.structuredContent).entries;
