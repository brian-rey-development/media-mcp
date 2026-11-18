import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { err, ok, type Result, type Services } from "@media-mcp/core";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Booted } from "../bootstrap.js";
import { startCachePruning } from "../cache-pruning.js";
import type { Lifecycle } from "../lifecycle.js";
import type { Logger } from "../logger.js";
import { createServer } from "../server.js";
import { SETTLE_TIMEOUT_MS } from "../shutdown.js";
import { createTokenCheck } from "./http-auth.js";
import { type HttpSettings, loadHttpSettings } from "./http-config.js";
import type { Started, Transport } from "./run.js";

const IDLE_SWEEP_MS = 50;
const MCP_PATH = "/mcp";
const HEALTH_PATH = "/healthz";
export const MAX_BODY_BYTES = 1024 * 1024;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

const urlHost = (host: string): string =>
  host.includes(":") ? `[${host}]` : host;

const LOCAL_HOST_NAMES = [...LOOPBACK_HOSTS].map(urlHost);
const UNAUTHORIZED = -32001;
const FORBIDDEN = -32002;
const NOT_FOUND = -32003;
const METHOD_NOT_ALLOWED = -32004;
const INTERNAL_ERROR = -32603;

// An unauthenticated peer can hold a socket open until the headers timeout, so the connection cap bounds the file descriptors it can take. 64 stays well under the 256 a macOS shell allows by default and leaves room for the yt-dlp and ffmpeg pipes.
const DEFAULT_LIMITS = {
  maxConnections: 64,
  maxConnectionsPerAddress: 16,
  headersTimeoutMs: 10_000,
  requestTimeoutMs: 60_000,
  keepAliveTimeoutMs: 5_000,
  checkIntervalMs: 1_000,
};

type HttpLimits = typeof DEFAULT_LIMITS;

interface Context {
  services: Services;
  lifecycle: Lifecycle;
  logger: Logger;
  allowedHosts: ReadonlySet<string>;
  isAuthorized(header: string | undefined): boolean;
  failures: { count: number };
}

interface HttpDeps {
  settings: HttpSettings;
  services: Services;
  lifecycle: Lifecycle;
  logger: Logger;
  limits?: Partial<HttpLimits>;
}

interface RunningHttp {
  port: number;
  close(): Promise<void>;
}

const sendRpcError = (
  res: ServerResponse,
  status: number,
  code: number,
  message: string,
  headers: Record<string, string> = {},
): void => {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(
    JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }),
  );
};

const pathOf = (req: IncomingMessage): string =>
  (req.url ?? "").split("?")[0] ?? "";

// Connection: close makes Node drop the socket as soon as the response is flushed, without draining a request body that a peer
// trickles in, which would otherwise hold the connection until the request timeout.
const sendRejection = (
  res: ServerResponse,
  status: number,
  code: number,
  message: string,
  headers: Record<string, string> = {},
): void => {
  sendRpcError(res, status, code, message, { ...headers, Connection: "close" });
};

const rejectUnauthorized = (
  req: IncomingMessage,
  res: ServerResponse,
  { failures, logger }: Context,
): void => {
  failures.count += 1;
  logger.error(
    `rejected request ${failures.count} without a valid token from ${req.socket.remoteAddress}`,
  );
  sendRejection(res, 401, UNAUTHORIZED, "Unauthorized", {
    "WWW-Authenticate": "Bearer",
  });
};

const handleMcp = async (
  req: IncomingMessage,
  res: ServerResponse,
  { services, lifecycle }: Context,
): Promise<void> => {
  const transport = new StreamableHTTPServerTransport({
    maxRequestBodySize: MAX_BODY_BYTES,
  });
  const server = createServer(services, lifecycle);
  res.on("close", () => void server.close().catch(() => undefined));
  await server.connect(transport);
  await transport.handleRequest(req, res);
};

const routeMcp = async (
  req: IncomingMessage,
  res: ServerResponse,
  context: Context,
): Promise<void> => {
  if (!context.isAuthorized(req.headers.authorization)) {
    return rejectUnauthorized(req, res, context);
  }
  if (req.method !== "POST") {
    return sendRejection(res, 405, METHOD_NOT_ALLOWED, "Use POST", {
      Allow: "POST",
    });
  }
  await handleMcp(req, res, context);
};

const route = async (
  req: IncomingMessage,
  res: ServerResponse,
  context: Context,
): Promise<void> => {
  const path = pathOf(req);
  if (path === HEALTH_PATH && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
  } else if (path === MCP_PATH) {
    await routeMcp(req, res, context);
  } else {
    sendRejection(res, 404, NOT_FOUND, "Not found");
  }
};

const failRequest = (
  res: ServerResponse,
  logger: Logger,
  error: unknown,
): void => {
  logger.error(`request failed, ${String(error)}`);
  if (res.headersSent) res.destroy();
  else sendRpcError(res, 500, INTERNAL_ERROR, "Internal error");
};

const onRequest =
  (context: Context) =>
  (req: IncomingMessage, res: ServerResponse): void => {
    const host = (req.headers.host ?? "").toLowerCase();
    if (context.allowedHosts.has(host)) {
      route(req, res, context).catch((error) =>
        failRequest(res, context.logger, error),
      );
    } else {
      sendRejection(res, 403, FORBIDDEN, "Host not allowed");
    }
  };

const listen = (server: Server, host: string, port: number): Promise<void> =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

// A request that finishes after close() leaves its connection idle, and Node
// keeps an idle connection for its 5 second keep-alive, so sweep until none is left.
const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve) => {
    const sweepIdle = setInterval(
      () => server.closeIdleConnections(),
      IDLE_SWEEP_MS,
    );
    const forceClose = setTimeout(
      () => server.closeAllConnections(),
      SETTLE_TIMEOUT_MS,
    );
    server.close(() => {
      clearInterval(sweepIdle);
      clearTimeout(forceClose);
      resolve();
    });
  });

const allowedHostsFor = (port: number, extraHosts: string[]) =>
  new Set([
    ...LOCAL_HOST_NAMES.map((name) => `${name}:${port}`),
    ...extraHosts.flatMap((name) => [name, `${name}:${port}`]),
  ]);

const boundPort = (server: Server): number => {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the HTTP server is not listening on a TCP port");
  }
  return address.port;
};

const contextFor = (
  { settings, services, lifecycle, logger }: HttpDeps,
  port: number,
): Context => ({
  services,
  lifecycle,
  logger,
  allowedHosts: allowedHostsFor(port, settings.extraHosts),
  isAuthorized: createTokenCheck(settings.token),
  failures: { count: 0 },
});

// Behind a tunnel on loopback every client arrives from 127.0.0.1, so the per-address cap only makes sense when the server is exposed.
const capPerAddress = (server: Server, max: number): void => {
  const open = new Map<string, number>();
  server.on("connection", (socket) => {
    const address = socket.remoteAddress ?? "";
    const count = open.get(address) ?? 0;
    if (count >= max) {
      socket.destroy();
      return;
    }
    open.set(address, count + 1);
    socket.once("close", () => {
      const left = (open.get(address) ?? 1) - 1;
      if (left > 0) open.set(address, left);
      else open.delete(address);
    });
  });
};

const createLimitedServer = (
  host: string,
  limits: Partial<HttpLimits> = {},
): Server => {
  const merged = { ...DEFAULT_LIMITS, ...limits };
  const server = createHttpServer({
    headersTimeout: merged.headersTimeoutMs,
    requestTimeout: merged.requestTimeoutMs,
    keepAliveTimeout: merged.keepAliveTimeoutMs,
    connectionsCheckingInterval: merged.checkIntervalMs,
  });
  server.maxConnections = merged.maxConnections;
  if (!LOOPBACK_HOSTS.has(host)) {
    capPerAddress(server, merged.maxConnectionsPerAddress);
  }
  return server;
};

export const startHttpServer = async (deps: HttpDeps): Promise<RunningHttp> => {
  const server = createLimitedServer(deps.settings.host, deps.limits);
  await listen(server, deps.settings.host, deps.settings.port);
  const port = boundPort(server);
  server.on("request", onRequest(contextFor(deps, port)));
  return { port, close: () => closeServer(server) };
};

const warnIfExposed = (logger: Logger, { host }: HttpSettings): void => {
  if (LOOPBACK_HOSTS.has(host)) return;
  logger.info(
    "warning, this server is reachable beyond this machine and the bearer token is its only protection. Terminate TLS in a tunnel or a reverse proxy.",
  );
};

const listenOrFail = async (deps: HttpDeps): Promise<Result<RunningHttp>> => {
  const { host, port } = deps.settings;
  try {
    return ok(await startHttpServer(deps));
  } catch (error) {
    return err(
      "IO_FAILED",
      `Could not listen on ${host}:${port}, ${String(error)}`,
    );
  }
};

const startHttp = async (
  settings: HttpSettings,
  { services, ytDlpVersion, cacheDir }: Booted,
  lifecycle: Lifecycle,
  logger: Logger,
): Promise<Result<Started>> => {
  const running = await listenOrFail({ settings, services, lifecycle, logger });
  if (!running.ok) return running;
  warnIfExposed(logger, settings);
  const stopPruning = startCachePruning(cacheDir);
  const { port } = running.value;
  return ok({
    close: async () => {
      stopPruning();
      await running.value.close();
    },
    readyLine: `media-mcp ready on http://${urlHost(settings.host)}:${port}${MCP_PATH} (yt-dlp ${ytDlpVersion})`,
    watchesStdio: false,
  });
};

export const httpTransport = (
  env: NodeJS.ProcessEnv,
  logger: Logger,
): Result<Transport> => {
  const settings = loadHttpSettings(env);
  if (!settings.ok) return settings;
  return ok({
    start: (booted, lifecycle) =>
      startHttp(settings.value, booted, lifecycle, logger),
  });
};
