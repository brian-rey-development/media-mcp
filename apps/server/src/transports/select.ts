import { loadEnv, ok, type Result } from "@media-mcp/core";
import { z } from "zod";
import { ENV } from "../env.js";
import type { Logger } from "../logger.js";
import { createLogger } from "../logger.js";
import { reportFailure } from "../report-failure.js";
import { httpTransport } from "./http.js";
import { runTransport, type Transport } from "./run.js";
import { stdioTransport } from "./stdio.js";

const TransportSchema = z.object({
  [ENV.transport]: z.enum(["stdio", "http"]).default("stdio"),
});
const TRANSPORT_HINT = `Set ${ENV.transport} to stdio or http`;

type Build = (env: NodeJS.ProcessEnv, logger: Logger) => Result<Transport>;

const BUILDERS: Record<"stdio" | "http", Build> = {
  stdio: () => ok(stdioTransport),
  http: httpTransport,
};

export const runSelectedTransport = async (
  env: NodeJS.ProcessEnv,
): Promise<void> => {
  const logger = createLogger();
  const chosen = loadEnv(TransportSchema, env, TRANSPORT_HINT);
  if (!chosen.ok) return reportFailure(logger, chosen.error);
  const transport = BUILDERS[chosen.value[ENV.transport]](env, logger);
  if (!transport.ok) return reportFailure(logger, transport.error);
  await runTransport(transport.value, env, logger);
};
