import { createDownloadService } from "./downloads.js";
import { createInfoService } from "./info.js";
import { createRuntime } from "./runtime.js";
import { createTranscriptPageService } from "./transcript-pages.js";
import { createTranscriptService } from "./transcripts.js";
import type { ServiceDeps, Services } from "./types.js";

export type {
  BatchOutcome,
  Services,
  TranscriptDelivery,
  TranscriptPage,
  Truncation,
} from "./types.js";

export const createServices = (deps: ServiceDeps): Services => {
  const runtime = createRuntime(deps);
  return {
    transcripts: createTranscriptService(runtime),
    info: createInfoService(runtime),
    downloads: createDownloadService(runtime),
    transcriptFiles: createTranscriptPageService(runtime),
  };
};
