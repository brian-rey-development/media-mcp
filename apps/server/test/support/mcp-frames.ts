import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";

export const INITIALIZE_ID = 1;
export const LIST_TOOLS_ID = 2;
const CALL_TOOL_ID = 3;

const frame = (message: object): string =>
  `${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`;

export const initializeFrame = (): string =>
  frame({
    id: INITIALIZE_ID,
    method: "initialize",
    params: {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "process-test", version: "0.0.0" },
    },
  });

export const initializeFrames = (): string =>
  initializeFrame() + frame({ method: "notifications/initialized" });

export const framesOf = (stdout: string): unknown[] =>
  stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

export const listToolsFrame = (): string =>
  frame({ id: LIST_TOOLS_ID, method: "tools/list" });

export const callToolFrame = (
  name: string,
  args: object,
  id = CALL_TOOL_ID,
): string =>
  frame({
    id,
    method: "tools/call",
    params: { name, arguments: args },
  });
