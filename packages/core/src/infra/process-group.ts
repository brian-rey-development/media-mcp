const SUPPORTS_GROUPS = process.platform !== "win32";
export const FORCE_KILL_DELAY_MS = 2_000;

const live = new Set<number>();
let exitHookInstalled = false;

const signalGroup = (pid: number, signal: NodeJS.Signals): void => {
  try {
    process.kill(-pid, signal);
  } catch {
    return;
  }
};

const installExitHook = (): void => {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once("exit", () => {
    for (const pid of live) signalGroup(pid, "SIGKILL");
  });
};

const startTermination = (pid: number): (() => void) => {
  signalGroup(pid, "SIGTERM");
  const forceKill = setTimeout(
    () => signalGroup(pid, "SIGKILL"),
    FORCE_KILL_DELAY_MS,
  );
  forceKill.unref();
  return () => {
    clearTimeout(forceKill);
    // The leader is gone, so only stragglers can still hold this group id, and an id is never reused while its group has members.
    signalGroup(pid, "SIGKILL");
  };
};

export const spawnsInOwnGroup = SUPPORTS_GROUPS;

export const superviseGroup = (
  pid: number | undefined,
  stop: AbortSignal,
): (() => void) => {
  if (!SUPPORTS_GROUPS || pid === undefined) return () => undefined;
  installExitHook();
  live.add(pid);
  let finishTermination: (() => void) | undefined;
  const terminate = (): void => {
    finishTermination = startTermination(pid);
  };
  stop.addEventListener("abort", terminate, { once: true });
  if (stop.aborted) terminate();
  return () => {
    stop.removeEventListener("abort", terminate);
    live.delete(pid);
    finishTermination?.();
  };
};
