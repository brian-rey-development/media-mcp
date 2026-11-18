import { cancelled, type Result } from "../domain/result.js";

export interface SingleFlight<V> {
  run(
    key: string,
    start: () => Promise<Result<V>>,
    signal?: AbortSignal,
  ): Promise<Result<V>>;
}

type Flights<V> = Map<string, Promise<Result<V>>>;

const wasCancelled = <V>(result: Result<V>): boolean =>
  !result.ok && result.error.code === "CANCELLED";

const lead = <V>(
  flights: Flights<V>,
  key: string,
  start: () => Promise<Result<V>>,
): Promise<Result<V>> => {
  const flight = start().finally(() => flights.delete(key));
  flights.set(key, flight);
  return flight;
};

const untilAborted = <V>(
  flight: Promise<Result<V>>,
  signal?: AbortSignal,
): Promise<Result<V>> => {
  if (!signal) return flight;
  if (signal.aborted) return Promise.resolve(cancelled());
  const aborted = Promise.withResolvers<Result<never>>();
  const onAbort = () => aborted.resolve(cancelled());
  signal.addEventListener("abort", onAbort, { once: true });
  return Promise.race([flight, aborted.promise]).finally(() =>
    signal.removeEventListener("abort", onAbort),
  );
};

export const createSingleFlight = <V>(): SingleFlight<V> => {
  const flights: Flights<V> = new Map();
  const run: SingleFlight<V>["run"] = async (key, start, signal) => {
    const running = flights.get(key);
    if (!running) return lead(flights, key, start);
    const shared = await untilAborted(running, signal);
    const leaderWasCancelled = wasCancelled(shared) && !signal?.aborted;
    return leaderWasCancelled ? run(key, start, signal) : shared;
  };
  return { run };
};
