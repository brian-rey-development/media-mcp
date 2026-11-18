import type { VideoRef } from "../domain/media.js";
import type { Result } from "../domain/result.js";
import { runBatch } from "../infra/batch.js";
import { expandUrls, type Target, videoCount } from "./expand.js";
import type { Runtime } from "./runtime.js";
import {
  type BatchOutcome,
  type BatchRequest,
  type UrlEntry,
  withValue,
} from "./types.js";

type Worker<T> = (target: Target) => Promise<Result<T>>;

const runEntry =
  <T>(worker: Worker<T>, onItemDone?: (ref: VideoRef) => void) =>
  async (entry: UrlEntry<Target>): Promise<Result<T>> => {
    if (!entry.ok) return entry;
    const result = await worker(entry.value);
    onItemDone?.(entry.value.ref);
    return result;
  };

export const runRequest = async <T>(
  runtime: Runtime,
  request: BatchRequest,
  worker: Worker<T>,
  signal?: AbortSignal,
): Promise<BatchOutcome<T>> => {
  const expansion = await expandUrls(runtime, request, signal);
  request.onPlan?.(videoCount(expansion));
  const settled = await runBatch(
    expansion.entries,
    runEntry(worker, request.onItemDone),
    signal,
  );
  return {
    entries: settled.map(({ input, result }) => withValue(input, result)),
    truncations: expansion.truncations,
  };
};
