import type { Lifecycle } from "./lifecycle.js";
import type { Logger } from "./logger.js";

export const SETTLE_TIMEOUT_MS = 5_000;
export const FORCE_EXIT_TIMEOUT_MS = SETTLE_TIMEOUT_MS * 2;

export type Stop = (reason: string, exitCode: number) => Promise<void>;

interface ShutdownDeps {
  logger: Logger;
  lifecycle: Lifecycle;
  close(): Promise<void>;
  exit(code: number): void;
  forceExit(code: number): void;
}

const within = (work: Promise<void>, timeoutMs: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    void work.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });

const closeQuietly = async (deps: ShutdownDeps): Promise<void> => {
  try {
    await deps.close();
  } catch (error) {
    deps.logger.error(`closing the server failed, ${String(error)}`);
  }
};

const armForceExit = (deps: ShutdownDeps, exitCode: number): void => {
  setTimeout(() => deps.forceExit(exitCode), FORCE_EXIT_TIMEOUT_MS).unref();
};

export const createShutdown = (deps: ShutdownDeps): Stop => {
  let started = false;
  return async (reason, exitCode) => {
    if (started) return;
    started = true;
    armForceExit(deps, exitCode);
    deps.logger.info(`shutting down, ${reason}`);
    deps.lifecycle.abort();
    await closeQuietly(deps);
    await within(deps.lifecycle.settled(), SETTLE_TIMEOUT_MS);
    deps.exit(exitCode);
  };
};
