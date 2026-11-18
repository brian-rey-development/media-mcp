import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import {
  FORCE_KILL_DELAY_MS,
  superviseGroup,
} from "../src/infra/process-group.js";

const PID = 41_000;
const WELL_PAST_DELAY_MS = 10 * FORCE_KILL_DELAY_MS;

describe.skipIf(process.platform === "win32")("superviseGroup", () => {
  let kill: MockInstance<typeof process.kill>;

  beforeEach(() => {
    vi.useFakeTimers();
    kill = vi.spyOn(process, "kill").mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    kill.mockRestore();
  });

  it("terminates the whole group when the stop signal aborts", () => {
    const stop = new AbortController();
    superviseGroup(PID, stop.signal);

    stop.abort();

    expect(kill.mock.calls).toEqual([[-PID, "SIGTERM"]]);
  });

  it("terminates at once when the stop signal is already aborted", () => {
    superviseGroup(PID, AbortSignal.abort());

    expect(kill.mock.calls).toEqual([[-PID, "SIGTERM"]]);
  });

  it("force kills a group that is still supervised after the delay", () => {
    const stop = new AbortController();
    superviseGroup(PID, stop.signal);
    stop.abort();

    vi.advanceTimersByTime(FORCE_KILL_DELAY_MS);

    expect(kill.mock.calls).toEqual([
      [-PID, "SIGTERM"],
      [-PID, "SIGKILL"],
    ]);
  });

  it("force kills stragglers when the leader finishes after a termination, then stops", () => {
    const stop = new AbortController();
    const release = superviseGroup(PID, stop.signal);
    stop.abort();

    release();
    vi.advanceTimersByTime(WELL_PAST_DELAY_MS);

    expect(kill.mock.calls).toEqual([
      [-PID, "SIGTERM"],
      [-PID, "SIGKILL"],
    ]);
  });

  it("never signals a group that finished normally, however late the stop signal aborts", () => {
    const stop = new AbortController();
    const release = superviseGroup(PID, stop.signal);

    release();
    stop.abort();
    vi.advanceTimersByTime(WELL_PAST_DELAY_MS);

    expect(kill).not.toHaveBeenCalled();
  });

  it("never signals a recycled process id on behalf of the process that used to own it", () => {
    const oldStop = new AbortController();
    const releaseOld = superviseGroup(PID, oldStop.signal);
    releaseOld();
    const recycledStop = new AbortController();
    superviseGroup(PID, recycledStop.signal);

    oldStop.abort();
    vi.advanceTimersByTime(WELL_PAST_DELAY_MS);

    expect(kill).not.toHaveBeenCalled();
    recycledStop.abort();
    expect(kill.mock.calls).toEqual([[-PID, "SIGTERM"]]);
  });

  it("does nothing for a process that never started", () => {
    const stop = new AbortController();
    const release = superviseGroup(undefined, stop.signal);

    stop.abort();
    release();

    expect(kill).not.toHaveBeenCalled();
  });
});
