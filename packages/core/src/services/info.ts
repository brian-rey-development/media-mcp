import { videoKey } from "./keys.js";
import { runRequest } from "./run-targets.js";
import type { Runtime } from "./runtime.js";
import type { Services } from "./types.js";

export const createInfoService = (runtime: Runtime): Services["info"] => ({
  fetch: (request, signal) =>
    runRequest(
      runtime,
      request,
      ({ provider, ref }) =>
        runtime.info(
          `info:${videoKey(ref)}`,
          () => provider.getInfo(ref, signal),
          signal,
        ),
      signal,
    ),
});
