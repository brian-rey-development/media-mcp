import type { VideoRef } from "../domain/media.js";
import { deliverTranscripts } from "./delivery.js";
import type { Target } from "./expand.js";
import { formatOf, videoKey } from "./keys.js";
import { runRequest } from "./run-targets.js";
import type { Runtime } from "./runtime.js";
import type { Services, TranscriptRequest } from "./types.js";

const cacheKey = (
  ref: VideoRef,
  { language, timestamps }: TranscriptRequest,
): string => `transcript:${videoKey(ref)}:${language}:${formatOf(timestamps)}`;

const transcriptWorker =
  (runtime: Runtime, request: TranscriptRequest, signal?: AbortSignal) =>
  ({ provider, ref }: Target) =>
    runtime.transcripts(
      cacheKey(ref, request),
      () =>
        provider.getTranscript(
          ref,
          { language: request.language, timestamps: request.timestamps },
          signal,
        ),
      signal,
    );

export const createTranscriptService = (
  runtime: Runtime,
): Services["transcripts"] => ({
  async fetch(request, signal) {
    const fetched = await runRequest(
      runtime,
      request,
      transcriptWorker(runtime, request, signal),
      signal,
    );
    const entries = await deliverTranscripts(fetched.entries, {
      outputRoot: runtime.config.outputRoot,
      budget: runtime.config.transcriptCharBudget,
      timestamps: request.timestamps,
    });
    return { entries, truncations: fetched.truncations };
  },
});
