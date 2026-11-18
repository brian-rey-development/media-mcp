import { err, type Result } from "../domain/result.js";
import { redactedErrorMessage } from "./errors.js";

interface ItemResult<I, O> {
  input: I;
  result: Result<O>;
}

const runItem = async <I, O>(
  input: I,
  worker: (item: I) => Promise<Result<O>>,
  signal?: AbortSignal,
): Promise<ItemResult<I, O>> => {
  if (signal?.aborted)
    return { input, result: err("CANCELLED", "Cancelled before it started") };
  try {
    return { input, result: await worker(input) };
  } catch (error) {
    return {
      input,
      result: err("PROCESS_FAILED", redactedErrorMessage(error)),
    };
  }
};

export const runBatch = <I, O>(
  items: readonly I[],
  worker: (item: I) => Promise<Result<O>>,
  signal?: AbortSignal,
): Promise<ItemResult<I, O>[]> =>
  Promise.all(items.map((input) => runItem(input, worker, signal)));
