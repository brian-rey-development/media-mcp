import type { Result } from "@media-mcp/core";
import { type Booted, bootstrap } from "../bootstrap.js";
import { createLifecycle, type Lifecycle } from "../lifecycle.js";
import type { Logger } from "../logger.js";
import { watchProcess } from "../process-events.js";
import { reportFailure } from "../report-failure.js";
import { createShutdown } from "../shutdown.js";

export interface Started {
  close(): Promise<void>;
  readyLine: string;
  watchesStdio: boolean;
}

export interface Transport {
  start(booted: Booted, lifecycle: Lifecycle): Promise<Result<Started>>;
}

const drainStdout = (): Promise<void> =>
  new Promise((resolve) => process.stdout.write("", () => resolve()));

const exitAfterDrain = (code: number): void => {
  void drainStdout().then(() => process.exit(code));
};

const watchForStop = (
  { close, watchesStdio }: Started,
  lifecycle: Lifecycle,
  logger: Logger,
): void => {
  const stop = createShutdown({
    logger,
    lifecycle,
    close,
    exit: exitAfterDrain,
    forceExit: (code) => process.exit(code),
  });
  watchProcess(process, stop, logger, { watchStdio: watchesStdio });
};

export const runTransport = async (
  transport: Transport,
  env: NodeJS.ProcessEnv,
  logger: Logger,
): Promise<void> => {
  const booted = await bootstrap(env, logger);
  if (!booted.ok) return reportFailure(logger, booted.error);
  const lifecycle = createLifecycle();
  const started = await transport.start(booted.value, lifecycle);
  if (!started.ok) return reportFailure(logger, started.error);
  watchForStop(started.value, lifecycle, logger);
  logger.info(started.value.readyLine);
};
